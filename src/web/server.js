import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { handshake, WSClient } from './websocket.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function startWebServer(agent, ollamaClient, registry, debugLogger, config) {
  const port = config.server?.port ?? 3000;

  const server = createServer(async (req, res) => {
    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
      try {
        const html = await readFile(join(__dirname, 'public', 'index.html'), 'utf-8');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      } catch {
        res.writeHead(404);
        res.end('Not found');
      }
    } else if (req.method === 'GET' && req.url === '/api/skills') {
      const skills = [];
      for (const [name, { manifest }] of registry) {
        skills.push({
          name,
          description: manifest.description,
          skills: manifest.skills.map(s => ({ name: s.name, description: s.description, requiresConfirm: !!s.requiresConfirm })),
        });
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(skills));
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  server.on('upgrade', (req, socket, _head) => {
    if (req.url !== '/ws') { socket.destroy(); return; }
    if (!handshake(req, socket)) return;
    const ws = new WSClient(socket);
    new WebSession(ws, agent, ollamaClient, registry, debugLogger).start();
  });

  server.listen(port, () => {
    console.log(`\n🌐 Web UI 已啟動: http://localhost:${port}`);
    console.log('（Ctrl+C 停止伺服器）\n');
  });

  return server;
}

// ── 每個 WebSocket 連線的獨立 Session ──────────────────────────────────────
class WebSession {
  constructor(ws, agent, ollamaClient, registry, debugLogger) {
    this.ws = ws;
    this.agent = agent;
    this.ollama = ollamaClient;
    this.registry = registry;
    this.debugLogger = debugLogger;
    this.isProcessing = false;
    // 等待使用者回應的 Promise resolver（plan_confirm / confirm_response）
    this._waitResolvers = new Map();
  }

  start() {
    // 發送初始狀態
    this.ws.send({
      type: 'init',
      model: this.ollama.model,
      apiType: this.ollama.apiType,
      mode: this.agent.getMode(),
      debug: this.debugLogger?.isEnabled() ?? false,
    });

    this.ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }

      // 若有等待中的 resolver，先嘗試交給它
      if (this._waitResolvers.has(msg.type)) {
        const resolve = this._waitResolvers.get(msg.type);
        this._waitResolvers.delete(msg.type);
        resolve(msg);
        return;
      }

      this._dispatch(msg);
    });

    this.ws.on('close', () => {
      // 清理等待中的 resolvers
      for (const [, resolve] of this._waitResolvers) resolve({ cancelled: true });
      this._waitResolvers.clear();
    });
  }

  _dispatch(msg) {
    if (msg.type === 'chat') this._handleChat(msg.content).catch(() => {});
    else if (msg.type === 'command') this._handleCommand(msg).catch(() => {});
  }

  _waitFor(type) {
    return new Promise(resolve => this._waitResolvers.set(type, resolve));
  }

  async _handleChat(userInput) {
    if (this.isProcessing) {
      this.ws.send({ type: 'error', message: '正在處理中，請稍候' });
      return;
    }
    this.isProcessing = true;

    try {
      await this.agent.run(userInput, {
        onChunk: (chunk) => this.ws.send({ type: 'chunk', content: chunk }),

        onPlanReview: async (plan) => {
          this.ws.send({ type: 'plan', plan });
          const reply = await this._waitFor('plan_confirm');
          if (reply.cancelled) return null;
          return reply.cancelled ? null : (reply.plan || plan);
        },

        onConfirm: async (skillName, params) => {
          this.ws.send({ type: 'confirm', skillName, params });
          const reply = await this._waitFor('confirm_response');
          return !reply.cancelled && !!reply.confirmed;
        },
      });

      this.ws.send({ type: 'done' });
    } catch (err) {
      this.ws.send({ type: 'error', message: err.message });
    } finally {
      this.isProcessing = false;
    }
  }

  async _handleCommand(msg) {
    const { command, args } = msg;

    switch (command) {
      case 'mode': {
        if (!args?.[0]) {
          this.ws.send({ type: 'state', mode: this.agent.getMode() });
        } else {
          try {
            this.agent.setMode(args[0]);
            this.agent.clearHistory();
            this.ws.send({ type: 'state', mode: this.agent.getMode(), message: `已切換至 ${args[0]} 模式` });
          } catch (err) {
            this.ws.send({ type: 'error', message: err.message });
          }
        }
        break;
      }
      case 'debug': {
        if (this.debugLogger) {
          const isOn = this.debugLogger.toggle();
          this.ws.send({ type: 'state', debug: isOn, message: `除錯模式已${isOn ? '開啟' : '關閉'}` });
        }
        break;
      }
      case 'clear': {
        this.agent.clearHistory();
        this.ws.send({ type: 'state', message: '對話歷史已清除' });
        break;
      }
      case 'model': {
        if (args?.[0]) {
          this.ollama.setModel(args[0]);
          this.ws.send({ type: 'state', model: args[0], message: `已切換至模型: ${args[0]}` });
        }
        break;
      }
      case 'skills': {
        const skills = [];
        for (const [name, { manifest }] of this.registry) {
          skills.push({
            name,
            description: manifest.description,
            skills: manifest.skills.map(s => ({ name: s.name, description: s.description })),
          });
        }
        this.ws.send({ type: 'skills', skills });
        break;
      }
    }
  }
}
