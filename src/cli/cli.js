import readline from 'readline';

const HELP_TEXT = `
可用指令：
  /help               顯示此說明
  /skills             列出所有可用技能
  /model <名稱>       切換 Ollama 模型
  /mode [react|plan]  查看或切換 Agent 模式
  /clear              清除對話歷史
  /debug              切換除錯模式（開啟時將每次 LLM 對話儲存至 logs/）
  /exit, /quit        離開程式

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
  }

  async start() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: '\n> ',
    });

    this._printBanner();
    this.rl.prompt();

    this.rl.on('line', async (line) => {
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
      this.rl.prompt();
    });

    this.rl.on('close', () => {
      console.log('\n再見！');
      process.exit(0);
    });
  }

  async _handleInput(input) {
    if (input.startsWith('/')) {
      await this._handleCommand(input);
      return;
    }

    this.isProcessing = true;
    process.stdout.write('\n');

    try {
      let hasOutput = false;

      await this.agent.run(input, (chunk) => {
        process.stdout.write(chunk);
        hasOutput = true;
      });

      if (!hasOutput) {
        // streaming 未觸發（可能是 stream:false），run() 已回傳完整結果
        // agent.run 內部已 print，此處不重複
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
          console.log(`目前模式: ${this.agent.getMode()}  (可用: react | plan)`);
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
        console.log(`    - ${skill.name}: ${skill.description}`);
      }
    }
    console.log();
  }

  _printBanner() {
    const models = this.ollama.model;
    const skillCount = this.registry.size;
    const totalSkills = [...this.registry.values()].reduce(
      (sum, m) => sum + m.manifest.skills.length, 0
    );

    console.log('');
    console.log('╔══════════════════════════════════════╗');
    console.log('║         SkillAgent v1.0.0            ║');
    console.log(`║  模型: ${models.padEnd(28)}║`);
    console.log(`║  技能: ${skillCount} 個模組 / ${totalSkills} 個技能${' '.repeat(Math.max(0, 21 - String(skillCount).length - String(totalSkills).length))}║`);
    const modeLabel = this.agent.getMode() === 'plan' ? 'Plan 模式' : 'ReAct 模式';
    console.log(`║  模式: ${modeLabel.padEnd(28)}║`);
    const debugStatus = this.debugLogger?.isEnabled() ? '開啟' : '關閉';
    console.log(`║  除錯: ${debugStatus.padEnd(28)}║`);
    console.log('╚══════════════════════════════════════╝');
    console.log('');
    console.log('輸入 /help 查看可用指令');
  }
}
