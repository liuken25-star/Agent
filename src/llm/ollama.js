import { request as httpRequest } from 'http';
import { request as httpsRequest } from 'https';
import { URL } from 'url';

// Node.js 16 compatible HTTP helper，回傳 IncomingMessage（可 async iterate）
function request(urlStr, options = {}, bodyStr = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const isHttps = url.protocol === 'https:';
    const fn = isHttps ? httpsRequest : httpRequest;

    const req = fn({
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + (url.search || ''),
      method: options.method || 'GET',
      headers: options.headers || {},
    }, resolve);

    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function readBody(res) {
  const chunks = [];
  for await (const chunk of res) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf-8');
}

export class OllamaClient {
  constructor(config) {
    this.baseUrl = config.baseUrl;
    this.model = config.model;
    this.stream = config.stream ?? true;
    this.temperature = config.temperature ?? 0.7;
  }

  async checkConnection() {
    try {
      const res = await request(`${this.baseUrl}/api/tags`);
      return res.statusCode >= 200 && res.statusCode < 300;
    } catch {
      return false;
    }
  }

  async listModels() {
    const res = await request(`${this.baseUrl}/api/tags`);
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new Error(`Ollama API error: ${res.statusCode}`);
    }
    const data = JSON.parse(await readBody(res));
    return data.models ?? [];
  }

  async chat(messages, options = {}) {
    const { onChunk, stream = this.stream } = options;

    const bodyStr = JSON.stringify({
      model: this.model,
      messages,
      stream,
      options: { temperature: this.temperature },
    });

    const res = await request(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    }, bodyStr);

    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new Error(`Ollama chat error: ${res.statusCode} — ${await readBody(res)}`);
    }

    if (!stream) {
      const data = JSON.parse(await readBody(res));
      return data.message?.content ?? '';
    }

    // 處理 ndjson streaming（Node.js 16 stream 支援 async iteration）
    let fullContent = '';
    let buffer = '';

    for await (const chunk of res) {
      buffer += chunk.toString('utf-8');
      const lines = buffer.split('\n');
      buffer = lines.pop(); // 保留不完整的最後一行

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const json = JSON.parse(line);
          const token = json.message?.content ?? '';
          if (token) {
            fullContent += token;
            if (onChunk) onChunk(token);
          }
        } catch {
          // 忽略非 JSON 的行
        }
      }
    }

    // 處理緩衝區中剩餘的內容
    if (buffer.trim()) {
      try {
        const json = JSON.parse(buffer);
        const token = json.message?.content ?? '';
        if (token) {
          fullContent += token;
          if (onChunk) onChunk(token);
        }
      } catch { /* ignore */ }
    }

    return fullContent;
  }

  setModel(model) {
    this.model = model;
  }
}
