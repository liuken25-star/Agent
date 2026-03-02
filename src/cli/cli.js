import readline from 'readline';

const VALID_MODES = ['auto', 'react', 'plan', 'chat', 'reflexion', 'swarm'];

const HELP_TEXT = `
可用指令：
  /help                  顯示此說明
  /skills                列出所有可用技能
  /model <名稱>          切換模型
  /mode [模式名稱]       查看或切換 Agent 模式
                         可用模式: auto | react | plan | chat | reflexion | swarm
  /clear                 清除對話歷史
  /debug                 切換除錯模式（開啟時將每次 LLM 對話儲存至 logs/）
  /exit, /quit           離開程式

其他輸入會直接傳送給 AI 助手。
`;

export class CLI {
  constructor(agent, ollamaClient, skillRegistry, debugLogger) {
    this.agent = agent;
    this.ollama = ollamaClient;
    this.registry = skillRegistry;
    this.debugLogger = debugLogger ?? null;
    this.rl = null;
    this.isProcessing = false;
    // 用於攔截下一行輸入（plan review / confirm 時使用）
    this._inputHandler = null;
  }

  async start() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: this._prompt(),
    });

    this._printBanner();
    this.rl.prompt();

    this.rl.on('line', async (line) => {
      // 若有攔截處理器，優先交給它
      if (this._inputHandler) {
        const handler = this._inputHandler;
        this._inputHandler = null;
        handler(line.trim());
        return;
      }

      const input = line.trim();
      if (!input) {
        this.rl.prompt();
        return;
      }

      if (this.isProcessing) {
        console.log('（正在處理中，請稍候...）');
        return;
      }

      await this._handleInput(input);
      this.rl.setPrompt(this._prompt());
      this.rl.prompt();
    });

    this.rl.on('close', () => {
      console.log('\n再見！');
      process.exit(0);
    });
  }

  _prompt() {
    return `\n[${this.agent.getMode()}] > `;
  }

  // 請求使用者輸入一行，回傳 Promise<string>
  _promptUser(message) {
    return new Promise(resolve => {
      process.stdout.write(message);
      this._inputHandler = (answer) => {
        this.rl.setPrompt(this._prompt());
        resolve(answer);
      };
    });
  }

  async _handleInput(input) {
    if (input.startsWith('/')) {
      await this._handleCommand(input);
      return;
    }

    this.isProcessing = true;
    process.stdout.write('\n');

    const onChunk = (chunk) => process.stdout.write(chunk);

    // Plan mode：展示計畫給使用者確認/修改
    const onPlanReview = async (plan) => {
      process.stdout.write(`\n📋 計畫：\n${plan}\n`);
      const answer = await this._promptUser('\n繼續執行？Enter 確認 / 輸入修改後計畫 / n 取消: ');
      if (answer.toLowerCase() === 'n') return null;
      return answer || plan;
    };

    // 安全確認：執行可能修改系統狀態的技能前詢問
    const onConfirm = async (skillName, params) => {
      const paramsStr = Object.keys(params).length
        ? JSON.stringify(params)
        : '（無參數）';
      process.stdout.write(`\n⚠️  即將執行: ${skillName} ${paramsStr}\n`);
      const answer = await this._promptUser('確認執行？(Y/n): ');
      return answer.toLowerCase() !== 'n';
    };

    try {
      let hasOutput = false;
      await this.agent.run(input, {
        onChunk: (chunk) => { onChunk(chunk); hasOutput = true; },
        onPlanReview,
        onConfirm,
      });
      if (!hasOutput) {
        // stream:false 路徑（agent 內部無串流輸出），run() 回傳值已由 agent 處理
      }
      process.stdout.write('\n');
    } catch (err) {
      console.error(`\n[錯誤] ${err.message}`);
    } finally {
      this.isProcessing = false;
    }
  }

  async _handleCommand(input) {
    const [cmd, ...args] = input.split(/\s+/);

    switch (cmd) {
      case '/help':
        console.log(HELP_TEXT);
        break;

      case '/skills':
        this._printSkills();
        break;

      case '/model':
        if (!args[0]) {
          console.log(`目前模型: ${this.ollama.model}`);
          console.log('用法: /model <模型名稱>');
        } else {
          this.ollama.setModel(args[0]);
          console.log(`已切換到模型: ${args[0]}`);
        }
        break;

      case '/mode':
        if (!args[0]) {
          console.log(`目前模式: ${this.agent.getMode()}  (可用: ${VALID_MODES.join(' | ')})`);
        } else {
          try {
            this.agent.setMode(args[0]);
            this.agent.clearHistory();
            console.log(`已切換至 ${args[0]} 模式，對話歷史已清除。`);
          } catch (err) {
            console.log(`[錯誤] ${err.message}`);
          }
        }
        break;

      case '/clear':
        this.agent.clearHistory();
        console.log('對話歷史已清除。');
        break;

      case '/debug':
        if (this.debugLogger) {
          const isOn = this.debugLogger.toggle();
          console.log(`除錯模式已${isOn ? '開啟' : '關閉'}。${isOn ? ` 日誌儲存至: ${this.debugLogger.logDir}` : ''}`);
        } else {
          console.log('除錯模式不可用（未設定 debugLogger）。');
        }
        break;

      case '/exit':
      case '/quit':
        this.rl.close();
        break;

      default:
        console.log(`未知指令: ${cmd}，輸入 /help 查看說明。`);
    }
  }

  _printSkills() {
    if (this.registry.size === 0) {
      console.log('目前沒有載入任何技能模組。');
      return;
    }
    console.log('\n可用技能模組：');
    for (const [, { manifest }] of this.registry) {
      console.log(`\n  [${manifest.name}] ${manifest.description}`);
      for (const skill of manifest.skills) {
        const confirmTag = skill.requiresConfirm ? ' ⚠️' : '';
        console.log(`    - ${skill.name}: ${skill.description}${confirmTag}`);
      }
    }
    console.log();
  }

  _printBanner() {
    const model = this.ollama.model;
    const apiType = this.ollama.apiType === 'openai' ? 'OpenAI-compat' : 'Ollama';
    const skillCount = this.registry.size;
    const totalSkills = [...this.registry.values()].reduce(
      (sum, m) => sum + m.manifest.skills.length, 0
    );
    const modeLabel = this.agent.getMode();
    const debugStatus = this.debugLogger?.isEnabled() ? '開啟' : '關閉';

    const pad = (s, n) => String(s).padEnd(n);

    console.log('');
    console.log('╔══════════════════════════════════════╗');
    console.log('║         SkillAgent v1.1.0            ║');
    console.log(`║  模型: ${pad(`${model} (${apiType})`, 28)}║`);
    console.log(`║  技能: ${pad(`${skillCount} 個模組 / ${totalSkills} 個技能`, 28)}║`);
    console.log(`║  模式: ${pad(modeLabel, 28)}║`);
    console.log(`║  除錯: ${pad(debugStatus, 28)}║`);
    console.log('╚══════════════════════════════════════╝');
    console.log('');
    console.log('輸入 /help 查看可用指令');
  }
}
