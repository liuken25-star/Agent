import { Planner } from './planner.js';

export class Agent {
  constructor(ollamaClient, skillRegistry, config, debugLogger) {
    this.ollama = ollamaClient;
    this.registry = skillRegistry;
    this.config = config;
    this.debugLogger = debugLogger ?? null;
    this.planner = new Planner();
    this.conversationHistory = [];
    this.systemPrompt = '';
    this.mode = config.mode ?? 'react'; // 'react' | 'plan'
  }

  async initialize() {
    const connected = await this.ollama.checkConnection();
    if (!connected) {
      throw new Error(
        `無法連線到 Ollama (${this.ollama.baseUrl})\n請確認 Ollama 已啟動，並執行: ollama serve`
      );
    }

    const skillsDesc = this.registry.size > 0
      ? `\n\n${buildSkillsDescription(this.registry)}`
      : '';
    this.systemPrompt = this.config.systemPrompt + skillsDesc;
  }

  setMode(mode) {
    if (mode !== 'react' && mode !== 'plan') throw new Error(`不支援的模式: ${mode}`);
    this.mode = mode;
  }

  getMode() { return this.mode; }

  async run(userInput, onChunk) {
    if (this.mode === 'plan') {
      return this._runPlan(userInput, onChunk);
    }
    return this._runReact(userInput, onChunk);
  }

  // ── ReAct 模式 ─────────────────────────────────────────────────────────
  async _runReact(userInput, onChunk) {
    this.conversationHistory.push({ role: 'user', content: userInput });
    const messages = this._buildMessages();
    return this._executeLoop(messages, onChunk);
  }

  // ── Plan 模式 ──────────────────────────────────────────────────────────
  // 1. 先請 LLM 制定計畫（不執行）
  // 2. 將計畫加入對話，再請 LLM 執行（允許使用工具）
  async _runPlan(userInput, onChunk) {
    this.conversationHistory.push({ role: 'user', content: userInput });

    // 階段一：規劃
    const planPrompt = [
      { role: 'system', content: this.systemPrompt },
      ...this.conversationHistory.slice(0, -1),
      { role: 'user', content: `[規劃階段] 請為以下任務制定詳細的執行計畫，以編號列出步驟，不要執行：\n${userInput}` },
    ];

    const { content: plan, usage: planUsage } = await this.ollama.chat(planPrompt, { stream: false });
    await this.debugLogger?.log(this.ollama.model, planPrompt, plan, planUsage);

    if (onChunk) {
      onChunk(`\n📋 計畫：\n${plan}\n\n⚡ 執行中...\n`);
    }

    // 階段二：執行（將計畫作為 assistant 訊息注入）
    const execMessages = [
      ...this._buildMessages(),
      { role: 'assistant', content: `[執行計畫]\n${plan}` },
      { role: 'user', content: '請根據以上計畫逐步執行，必要時使用工具，完成後給出最終結果。' },
    ];

    return this._executeLoop(execMessages, onChunk);
  }

  // ── 共用的 ReAct 執行循環 ───────────────────────────────────────────────
  async _executeLoop(messages, onChunk) {
    let retries = 0;
    const maxRetries = this.config.maxRetries ?? 3;

    while (retries < maxRetries) {
      const isFirst = retries === 0;
      const { content: llmResponse, usage } = await this.ollama.chat(
        messages,
        isFirst && onChunk ? { onChunk } : { stream: false }
      );

      await this.debugLogger?.log(this.ollama.model, messages, llmResponse, usage);

      const parsed = this.planner.parse(llmResponse);

      if (parsed.type === 'text') {
        this.conversationHistory.push({ role: 'assistant', content: llmResponse });
        return llmResponse;
      }

      // 執行技能
      const { module: moduleName, skill, parameters } = parsed;
      const skillModule = this.registry.get(moduleName);

      if (!skillModule) {
        messages.push(
          { role: 'assistant', content: llmResponse },
          { role: 'user', content: `[工具錯誤] 找不到技能模組: ${moduleName}，請改用其他方式回答。` }
        );
        retries++;
        continue;
      }

      let skillResult;
      try {
        skillResult = await skillModule.execute(skill, parameters);
      } catch (err) {
        skillResult = `[工具執行錯誤] ${err.message}`;
      }

      messages.push(
        { role: 'assistant', content: llmResponse },
        { role: 'user', content: `[工具回傳結果]\n${skillResult}` }
      );

      retries++;
    }

    // 超過重試次數
    const { content: fallback, usage } = await this.ollama.chat(messages, { stream: false });
    await this.debugLogger?.log(this.ollama.model, messages, fallback, usage);
    this.conversationHistory.push({ role: 'assistant', content: fallback });
    return fallback;
  }

  clearHistory() { this.conversationHistory = []; }
  getConversationHistory() { return this.conversationHistory; }

  _buildMessages() {
    return [
      { role: 'system', content: this.systemPrompt },
      ...this.conversationHistory,
    ];
  }
}

function buildSkillsDescription(registry) {
  const lines = ['## 可用技能模組'];
  for (const [, { manifest }] of registry) {
    lines.push(`\n### ${manifest.name} — ${manifest.description}`);
    for (const skill of manifest.skills) {
      const params = Object.entries(skill.parameters ?? {})
        .map(([k, v]) => `${k}(${v.type}${v.required ? ',必填' : ''})`)
        .join(', ');
      lines.push(`- ${skill.name}: ${skill.description}${params ? ` [${params}]` : ''}`);
    }
  }
  lines.push('\n---\n使用工具格式範例：\n{"action":"use_skill","module":"file","skill":"read_file","parameters":{"path":"./README.md"}}');
  return lines.join('\n');
}
