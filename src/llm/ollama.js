export class OllamaClient {
  constructor(config) {
    this.baseUrl = config.baseUrl;
    this.model = config.model;
    this.stream = config.stream ?? true;
    this.temperature = config.temperature ?? 0.7;
  }

  async checkConnection() {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`);
      return res.ok;
    } catch {
      return false;
    }
  }

  async listModels() {
    const res = await fetch(`${this.baseUrl}/api/tags`);
    if (!res.ok) throw new Error(`Ollama API error: ${res.status}`);
    const data = await res.json();
    return data.models ?? [];
  }

  async chat(messages, options = {}) {
    const { onChunk, stream = this.stream } = options;

    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages,
        stream,
        options: { temperature: this.temperature },
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Ollama chat error: ${res.status} — ${err}`);
    }

    if (!stream) {
      const data = await res.json();
      return data.message?.content ?? '';
    }

    // 處理 ndjson streaming
    let fullContent = '';
    const decoder = new TextDecoder();

    for await (const chunk of res.body) {
      const text = decoder.decode(chunk, { stream: true });
      const lines = text.split('\n').filter(l => l.trim());

      for (const line of lines) {
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

    return fullContent;
  }

  setModel(model) {
    this.model = model;
  }
}
