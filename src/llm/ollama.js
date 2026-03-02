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

// 將 Ollama 回傳的原始 stats 轉為易讀格式
function parseUsage(json, ttftMs = 0) {
  const evalCount = json.eval_count ?? 0;
  const evalDurationNs = json.eval_duration ?? 0;
  const promptTokens = json.prompt_eval_count ?? 0;
  const totalDurationNs = json.total_duration ?? 0;

  return {
    promptTokens,
    completionTokens: evalCount,
    totalTokens: promptTokens + evalCount,
    tokensPerSecond: evalDurationNs > 0
      ? Math.round(evalCount / (evalDurationNs / 1e9) * 10) / 10
      : 0,
    totalDurationMs: Math.round(totalDurationNs / 1e6),
    ttftMs,
  };
}

export class OllamaClient {
  constructor(config) {
    this.baseUrl = config.baseUrl;
    this.model = config.model;
    this.stream = config.stream ?? true;
    this.temperature = config.temperature ?? 0.7;
    this.apiType = 'ollama';
    this._numCtxConfig = config.numCtx ?? {};
  }

  getNumCtx(mode) {
    return this._numCtxConfig[mode] ?? this._numCtxConfig.default ?? null;
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

  // 回傳 { content: string, toolCalls: null, usage: object }
  async chat(messages, options = {}) {
    const { onChunk, stream = this.stream, numCtx } = options;

    const ollamaOptions = { temperature: this.temperature };
    if (numCtx) ollamaOptions.num_ctx = numCtx;

    const bodyStr = JSON.stringify({
      model: this.model,
      messages,
      stream,
      options: ollamaOptions,
    });

    const requestStart = Date.now();
    let firstTokenAt = null;

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
      return {
        content: data.message?.content ?? '',
        toolCalls: null,
        usage: parseUsage(data),
      };
    }

    // 處理 ndjson streaming
    let fullContent = '';
    let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, tokensPerSecond: 0, totalDurationMs: 0, ttftMs: 0 };
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
            if (!firstTokenAt) firstTokenAt = Date.now();
            fullContent += token;
            if (onChunk) onChunk(token);
          }
          // 最後一個 chunk（done: true）包含 usage stats
          if (json.done) {
            const ttftMs = firstTokenAt ? firstTokenAt - requestStart : 0;
            usage = parseUsage(json, ttftMs);
          }
        } catch {
          // 忽略非 JSON 的行
        }
      }
    }

    // 處理緩衝區剩餘內容
    if (buffer.trim()) {
      try {
        const json = JSON.parse(buffer);
        const token = json.message?.content ?? '';
        if (token) {
          if (!firstTokenAt) firstTokenAt = Date.now();
          fullContent += token;
          if (onChunk) onChunk(token);
        }
        if (json.done) {
          const ttftMs = firstTokenAt ? firstTokenAt - requestStart : 0;
          usage = parseUsage(json, ttftMs);
        }
      } catch { /* ignore */ }
    }

    return { content: fullContent, toolCalls: null, usage };
  }

  setModel(model) {
    this.model = model;
  }
}
