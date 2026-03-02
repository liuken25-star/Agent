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
  }

  async initialize() {
    const connected = await this.ollama.checkConnection();
    if (!connected) {
      throw new Error(
        `無法連線到 Ollama (${this.ollama.baseUrl})\n請確認 Ollama 已啟動，並執行: ollama serve`
      );
    }

    // 組裝系統提示：基礎提示 + 技能清單
    const skillsDesc = this.registry.size > 0
      ? `\n\n${buildSkillsDescription(this.registry)}`
      : '';
    this.systemPrompt = this.config.systemPrompt + skillsDesc;
  }

  async run(userInput, onChunk) {
    this.conversationHistory.push({ role: 'user', content: userInput });

    const messages = this._buildMessages();
    let retries = 0;
    const maxRetries = this.config.maxRetries ?? 3;

    while (retries < maxRetries) {
      let llmResponse = '';

      if (onChunk && retries === 0) {
        // 第一次呼叫時 streaming 輸出
        llmResponse = await this.ollama.chat(messages, { onChunk });
      } else {
        llmResponse = await this.ollama.chat(messages, { stream: false });
      }

      await this.debugLogger?.log(this.ollama.model, messages, llmResponse);

      const parsed = this.planner.parse(llmResponse);

      if (parsed.type === 'text') {
        this.conversationHistory.push({ role: 'assistant', content: llmResponse });
        return llmResponse;
      }

      // 執行技能
      const { module: moduleName, skill, parameters } = parsed;
      const skillModule = this.registry.get(moduleName);

      if (!skillModule) {
        const errMsg = `找不到技能模組: ${moduleName}`;
        messages.push(
          { role: 'assistant', content: llmResponse },
          { role: 'user', content: `[工具錯誤] ${errMsg}，請改用其他方式回答。` }
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

      // 將技能結果加入對話
      messages.push(
        { role: 'assistant', content: llmResponse },
        { role: 'user', content: `[工具回傳結果]\n${skillResult}` }
      );

      retries++;
    }

    // 超過重試次數，回傳最後一次的純文字回覆
    const fallback = await this.ollama.chat(messages, { stream: false });
    await this.debugLogger?.log(this.ollama.model, messages, fallback);
    this.conversationHistory.push({ role: 'assistant', content: fallback });
    return fallback;
  }

  clearHistory() {
    this.conversationHistory = [];
  }

  getConversationHistory() {
    return this.conversationHistory;
  }

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
