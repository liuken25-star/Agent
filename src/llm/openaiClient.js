import { request as httpRequest } from 'http';
import { request as httpsRequest } from 'https';
import { URL } from 'url';

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

// 將技能 registry 轉換為 OpenAI tools 格式
function buildTools(registry) {
  const tools = [];
  for (const [moduleName, { manifest }] of registry) {
    for (const skill of manifest.skills) {
      const props = {};
      const required = [];
      for (const [paramName, paramDef] of Object.entries(skill.parameters ?? {})) {
        props[paramName] = {
          type: paramDef.type === 'string' ? 'string' : (paramDef.type ?? 'string'),
          description: paramDef.description ?? '',
        };
        if (paramDef.required) required.push(paramName);
      }
      tools.push({
        type: 'function',
        function: {
          name: `${moduleName}.${skill.name}`,
          description: skill.description ?? '',
          parameters: {
            type: 'object',
            properties: props,
            required,
          },
        },
      });
    }
  }
  return tools;
}

// OpenAI-compatible API 客戶端
// 相容 LM Studio、vLLM、OpenRouter、Ollama OpenAI 模式等後端
// 支援原生 Tool Calling（tools / tool_calls）
export class OpenAICompatClient {
  constructor(config) {
    this.baseUrl = config.baseUrl;
    this.model = config.model;
    this.stream = config.stream ?? true;
    this.temperature = config.temperature ?? 0.7;
    this.apiKey = config.apiKey ?? 'ollama';
    this.apiType = 'openai';
    this._numCtxConfig = config.numCtx ?? {};
  }

  getNumCtx(mode) {
    return this._numCtxConfig[mode] ?? this._numCtxConfig.default ?? null;
  }

  async checkConnection() {
    try {
      const res = await request(`${this.baseUrl}/v1/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      return res.statusCode >= 200 && res.statusCode < 300;
    } catch {
      return false;
    }
  }

  async listModels() {
    const res = await request(`${this.baseUrl}/v1/models`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new Error(`OpenAI API error: ${res.statusCode}`);
    }
    const data = JSON.parse(await readBody(res));
    return (data.data ?? []).map(m => ({ name: m.id }));
  }

  // 建立 tools 陣列（由 Agent 傳入 registry）
  buildTools(registry) {
    return buildTools(registry);
  }

  // 回傳 { content: string, toolCalls: Array|null, usage: object }
  // toolCalls 格式: [{ id, name: 'module.skill', arguments: {...} }]
  async chat(messages, options = {}) {
    const { onChunk, stream = this.stream, tools, numCtx } = options;

    const body = {
      model: this.model,
      messages,
      stream,
      temperature: this.temperature,
    };

    if (tools?.length) body.tools = tools;
    // 部分後端（如 Ollama OpenAI 模式）支援 num_ctx
    if (numCtx) body.num_ctx = numCtx;

    const bodyStr = JSON.stringify(body);
    const requestStart = Date.now();
    let firstTokenAt = null;

    const res = await request(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    }, bodyStr);

    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new Error(`OpenAI API error: ${res.statusCode} — ${await readBody(res)}`);
    }

    if (!stream) {
      const data = JSON.parse(await readBody(res));
      const choice = data.choices?.[0];
      const msg = choice?.message;
      const toolCalls = _parseToolCalls(msg?.tool_calls ?? null);
      return {
        content: msg?.content ?? '',
        toolCalls,
        usage: {
          promptTokens: data.usage?.prompt_tokens ?? 0,
          completionTokens: data.usage?.completion_tokens ?? 0,
          totalTokens: data.usage?.total_tokens ?? 0,
          tokensPerSecond: 0,
          totalDurationMs: 0,
          ttftMs: 0,
        },
      };
    }

    // 處理 SSE streaming（data: {...}\n\n 格式）
    let fullContent = '';
    const toolCallsAcc = {}; // index → { id, name, arguments }
    let buffer = '';
    const usageAcc = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    for await (const chunk of res) {
      buffer += chunk.toString('utf-8');
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') continue;
        try {
          const json = JSON.parse(data);
          const delta = json.choices?.[0]?.delta;

          if (delta?.content) {
            if (!firstTokenAt) firstTokenAt = Date.now();
            fullContent += delta.content;
            if (onChunk) onChunk(delta.content);
          }

          // 累積 tool_calls（串流時分片傳送）
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              if (!toolCallsAcc[idx]) toolCallsAcc[idx] = { id: '', name: '', arguments: '' };
              if (tc.id) toolCallsAcc[idx].id = tc.id;
              if (tc.function?.name) toolCallsAcc[idx].name += tc.function.name;
              if (tc.function?.arguments) toolCallsAcc[idx].arguments += tc.function.arguments;
            }
          }

          // 部分後端在最後一個 chunk 回傳 usage
          if (json.usage) {
            usageAcc.promptTokens = json.usage.prompt_tokens ?? 0;
            usageAcc.completionTokens = json.usage.completion_tokens ?? 0;
            usageAcc.totalTokens = json.usage.total_tokens ?? 0;
          }
        } catch { /* ignore malformed lines */ }
      }
    }

    const ttftMs = firstTokenAt ? firstTokenAt - requestStart : 0;
    const totalDurationMs = Date.now() - requestStart;
    const tokensPerSecond = totalDurationMs > 0
      ? Math.round(usageAcc.completionTokens / (totalDurationMs / 1000) * 10) / 10
      : 0;

    const toolCalls = Object.values(toolCallsAcc).map(tc => ({
      id: tc.id,
      name: tc.name,
      arguments: (() => { try { return JSON.parse(tc.arguments); } catch { return {}; } })(),
    }));

    return {
      content: fullContent,
      toolCalls: toolCalls.length ? toolCalls : null,
      usage: { ...usageAcc, tokensPerSecond, totalDurationMs, ttftMs },
    };
  }

  setModel(model) {
    this.model = model;
  }
}

function _parseToolCalls(rawCalls) {
  if (!rawCalls?.length) return null;
  return rawCalls.map(tc => ({
    id: tc.id,
    name: tc.function?.name ?? '',
    arguments: (() => {
      try { return JSON.parse(tc.function?.arguments ?? '{}'); }
      catch { return {}; }
    })(),
  }));
}
