import { Planner } from './planner.js';

const VALID_MODES = ['auto', 'react', 'plan', 'chat', 'reflexion', 'swarm'];

export class Agent {
  constructor(llmClient, skillRegistry, config, debugLogger) {
    this.ollama = llmClient;
    this.registry = skillRegistry;
    this.config = config;
    this.debugLogger = debugLogger ?? null;
    this.planner = new Planner();
    this.conversationHistory = [];
    this.systemPrompt = '';
    this.mode = config.defaultMode ?? 'auto';
    // swarm 子 Agent 設定（從 config.swarmConfig 注入）
    this.swarmAgents = config.swarmConfig ?? [];
  }

  async initialize() {
    const connected = await this.ollama.checkConnection();
    if (!connected) {
      throw new Error(
        `無法連線到 ${this.ollama.apiType === 'openai' ? 'OpenAI-compatible API' : 'Ollama'} (${this.ollama.baseUrl})\n` +
        `請確認服務已啟動。`
      );
    }

    this._rebuildSystemPrompt();
  }

  _rebuildSystemPrompt(registry = null) {
    const reg = registry ?? this.registry;
    const skillsDesc = reg.size > 0 ? `\n\n${buildSkillsDescription(reg)}` : '';
    this.systemPrompt = this.config.systemPrompt + skillsDesc;
  }

  setMode(mode) {
    if (!VALID_MODES.includes(mode)) {
      throw new Error(`不支援的模式: ${mode}，可用: ${VALID_MODES.join(', ')}`);
    }
    this.mode = mode;
  }

  getMode() { return this.mode; }

  // options: { onChunk, onPlanReview, onConfirm }
  // onPlanReview(plan) → Promise<string|null>  (null=取消, string=計畫內容)
  // onConfirm(skillName, params) → Promise<boolean>
  async run(userInput, options = {}) {
    switch (this.mode) {
      case 'chat':      return this._runChat(userInput, options);
      case 'react':     return this._runReact(userInput, options);
      case 'plan':      return this._runPlan(userInput, options);
      case 'reflexion': return this._runReflexion(userInput, options);
      case 'swarm':     return this._runSwarm(userInput, options);
      case 'auto':      return this._runAuto(userInput, options);
      default:          return this._runReact(userInput, options);
    }
  }

  // ── 純對話模式（不使用任何 Skill） ─────────────────────────────────────
  async _runChat(userInput, options) {
    const { onChunk } = options;
    this.conversationHistory.push({ role: 'user', content: userInput });

    const messages = [
      { role: 'system', content: '你是一個智能 AI 助手。請直接回答用戶的問題，不需要使用任何工具。' },
      ...this.conversationHistory,
    ];

    const numCtx = this._getNumCtx('chat');
    const { content, usage } = await this.ollama.chat(messages, { onChunk, numCtx });
    await this.debugLogger?.log(this.ollama.model, messages, content, usage);

    this.conversationHistory.push({ role: 'assistant', content });
    return content;
  }

  // ── ReAct 模式 ─────────────────────────────────────────────────────────
  async _runReact(userInput, options) {
    this.conversationHistory.push({ role: 'user', content: userInput });
    const messages = this._buildMessages();
    return this._executeLoop(messages, options);
  }

  // ── Plan 模式 ──────────────────────────────────────────────────────────
  // 階段一：請 LLM 制定計畫（不執行），展示給使用者確認/修改
  // 階段二：依計畫執行
  async _runPlan(userInput, options) {
    const { onChunk, onPlanReview } = options;
    this.conversationHistory.push({ role: 'user', content: userInput });

    const planPrompt = [
      { role: 'system', content: this.systemPrompt },
      ...this.conversationHistory.slice(0, -1),
      { role: 'user', content: `[規劃階段] 請為以下任務制定詳細的執行計畫，以編號列出步驟，不要執行：\n${userInput}` },
    ];

    const numCtx = this._getNumCtx('plan');
    const { content: plan, usage: planUsage } = await this.ollama.chat(planPrompt, { stream: false, numCtx });
    await this.debugLogger?.log(this.ollama.model, planPrompt, plan, planUsage);

    // 展示計畫給使用者，等待確認或修改
    let finalPlan = plan;
    if (onPlanReview) {
      const reviewed = await onPlanReview(plan);
      if (reviewed === null) {
        this.conversationHistory.pop();
        return '（已取消執行計畫）';
      }
      finalPlan = reviewed || plan;
      if (onChunk) onChunk(`\n⚡ 開始執行計畫...\n`);
    } else if (onChunk) {
      onChunk(`\n📋 計畫：\n${plan}\n\n⚡ 執行中...\n`);
    }

    // 階段二：注入計畫後執行
    const execMessages = [
      ...this._buildMessages(),
      { role: 'assistant', content: `[執行計畫]\n${finalPlan}` },
      { role: 'user', content: '請根據以上計畫逐步執行，必要時使用工具，完成後給出最終結果。' },
    ];

    return this._executeLoop(execMessages, options);
  }

  // ── 反思與自我修正模式（Reflexion） ────────────────────────────────────
  // 先以 ReAct 執行，完成後加一步自我審查
  async _runReflexion(userInput, options) {
    const { onChunk } = options;

    // 階段一：執行（暫不串流，等自我審查後再輸出）
    const result = await this._runReact(userInput, { ...options, onChunk: null });

    // 階段二：自我審查
    const reviewMessages = [
      { role: 'system', content: this.systemPrompt },
      { role: 'user', content: userInput },
      { role: 'assistant', content: result },
      {
        role: 'user',
        content: '[反思] 請審查以上回答是否正確、完整、符合需求。若有不足請修正後輸出最終答案；若已完整則直接重複輸出最終答案。',
      },
    ];

    if (onChunk) onChunk('\n[反思中...]\n');

    const numCtx = this._getNumCtx('reflexion');
    const { content: reviewed, usage } = await this.ollama.chat(reviewMessages, { onChunk, numCtx });
    await this.debugLogger?.log(this.ollama.model, reviewMessages, reviewed, usage);

    // 更新歷史中最後一筆 assistant 訊息
    const lastIdx = this.conversationHistory.length - 1;
    if (lastIdx >= 0 && this.conversationHistory[lastIdx].role === 'assistant') {
      this.conversationHistory[lastIdx].content = reviewed;
    } else {
      this.conversationHistory.push({ role: 'assistant', content: reviewed });
    }

    return reviewed;
  }

  // ── Swarm / Multi-Agent 模式 ────────────────────────────────────────────
  // Router 分析任務，選擇合適的子 Agent（有限技能集）執行
  async _runSwarm(userInput, options) {
    const { onChunk } = options;

    if (!this.swarmAgents.length) {
      if (onChunk) onChunk('[Swarm] 未設定子 Agent，回退至 ReAct 模式\n');
      return this._runReact(userInput, options);
    }

    // Router：分析任務，選擇子 Agent
    const agentList = this.swarmAgents.map(a => `- ${a.name}: ${a.description}`).join('\n');
    const routerMessages = [
      {
        role: 'system',
        content: `你是一個任務分派器。根據使用者請求，選擇最合適的子 Agent 處理。\n可用子 Agent:\n${agentList}\n\n請以 JSON 格式回覆: {"agent": "agent-name"}，不要輸出其他文字。`,
      },
      { role: 'user', content: userInput },
    ];

    const { content: routerResp } = await this.ollama.chat(routerMessages, { stream: false });

    // 解析路由結果
    let selectedAgent = null;
    try {
      const match = routerResp.match(/\{[^}]+\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        selectedAgent = this.swarmAgents.find(a => a.name === parsed.agent);
      }
    } catch { /* ignore */ }

    if (!selectedAgent) {
      if (onChunk) onChunk('[Swarm] 無法確定子 Agent，使用完整技能集\n');
      return this._runReact(userInput, options);
    }

    if (onChunk) onChunk(`[Swarm] 指派給: ${selectedAgent.name}\n`);

    // 建立子 Agent 的限定技能 registry
    const subRegistry = new Map();
    for (const skillName of selectedAgent.skills) {
      if (this.registry.has(skillName)) {
        subRegistry.set(skillName, this.registry.get(skillName));
      }
    }

    // 暫時替換 registry 與 systemPrompt
    const savedRegistry = this.registry;
    const savedSystemPrompt = this.systemPrompt;
    this.registry = subRegistry;
    this._rebuildSystemPrompt(subRegistry);

    let result;
    try {
      result = await this._runReact(userInput, options);
    } finally {
      this.registry = savedRegistry;
      this.systemPrompt = savedSystemPrompt;
    }

    return result;
  }

  // ── Auto 模式（預設） ───────────────────────────────────────────────────
  // 由 LLM 分類任務，自動選擇 chat 或 react 模式
  async _runAuto(userInput, options) {
    const { onChunk } = options;

    // 若沒有技能，直接用 chat 模式
    if (this.registry.size === 0) {
      return this._runChat(userInput, options);
    }

    const classifyMessages = [
      {
        role: 'system',
        content: '你是一個任務分類器。根據使用者輸入，判斷最適合的處理模式：\n- chat: 簡單問答、閒聊、知識性問題，不需要任何工具\n- react: 需要使用工具（檔案操作、網路請求、系統指令、需要最新資訊等）\n只輸出 "chat" 或 "react"，不要輸出其他文字。',
      },
      { role: 'user', content: userInput },
    ];

    const { content: classifyResult } = await this.ollama.chat(classifyMessages, { stream: false });
    const suggestedMode = classifyResult.trim().toLowerCase().startsWith('chat') ? 'chat' : 'react';

    if (onChunk) onChunk(`[auto → ${suggestedMode}]\n`);

    if (suggestedMode === 'chat') {
      return this._runChat(userInput, options);
    }
    return this._runReact(userInput, options);
  }

  // ── 共用的 ReAct 執行循環 ───────────────────────────────────────────────
  async _executeLoop(messages, options = {}) {
    const { onChunk, onConfirm } = options;
    const maxIterations = this.config.maxIterations ?? 5;
    const numCtx = this._getNumCtx(this.mode);

    // OpenAI 原生 Tool Calling：建立 tools 陣列
    const tools = this.ollama.apiType === 'openai'
      ? this.ollama.buildTools(this.registry)
      : undefined;

    let iteration = 0;

    while (iteration < maxIterations) {
      const isFirst = iteration === 0;
      const chatOptions = {
        stream: isFirst && !!onChunk,
        numCtx,
        ...(isFirst && onChunk ? { onChunk } : {}),
        ...(tools ? { tools } : {}),
      };

      const { content: llmResponse, toolCalls, usage } = await this.ollama.chat(messages, chatOptions);
      await this.debugLogger?.log(this.ollama.model, messages, llmResponse, usage);

      // 解析技能呼叫：OpenAI tool_calls 優先，否則文字解析
      let parsed;
      if (toolCalls?.length) {
        const tc = toolCalls[0];
        const [moduleName, skillName] = tc.name.split('.');
        parsed = { type: 'skill_call', module: moduleName, skill: skillName, parameters: tc.arguments ?? {} };
      } else {
        parsed = this.planner.parse(llmResponse);
      }

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
        iteration++;
        continue;
      }

      // 安全確認：skill 標記 requiresConfirm 時詢問使用者
      const skillDef = skillModule.manifest.skills.find(s => s.name === skill);
      if (skillDef?.requiresConfirm && onConfirm) {
        const confirmed = await onConfirm(`${moduleName}.${skill}`, parameters);
        if (!confirmed) {
          messages.push(
            { role: 'assistant', content: llmResponse },
            { role: 'user', content: `[工具取消] 使用者拒絕執行 ${moduleName}.${skill}，請嘗試其他方式完成任務或告知使用者。` }
          );
          iteration++;
          continue;
        }
      }

      let skillResult;
      try {
        skillResult = await skillModule.execute(skill, parameters);
      } catch (err) {
        skillResult = `[工具執行錯誤] ${err.message}`;
      }

      // 根據 API 類型使用不同的訊息格式
      if (tools && toolCalls?.length) {
        // OpenAI 格式：assistant 帶 tool_calls，再加 tool role 結果
        const tc = toolCalls[0];
        messages.push(
          {
            role: 'assistant',
            content: llmResponse || null,
            tool_calls: [{
              id: tc.id || `call_${iteration}`,
              type: 'function',
              function: { name: tc.name, arguments: JSON.stringify(tc.arguments ?? {}) },
            }],
          },
          {
            role: 'tool',
            tool_call_id: tc.id || `call_${iteration}`,
            content: skillResult,
          }
        );
      } else {
        // Ollama 文字解析格式
        messages.push(
          { role: 'assistant', content: llmResponse },
          { role: 'user', content: `[工具回傳結果]\n${skillResult}` }
        );
      }

      iteration++;
    }

    // 超過最大迭代次數，請 LLM 給出最終回應
    const { content: fallback, usage } = await this.ollama.chat(messages, { stream: false, numCtx });
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

  _getNumCtx(mode) {
    if (typeof this.ollama.getNumCtx === 'function') {
      return this.ollama.getNumCtx(mode);
    }
    return null;
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
