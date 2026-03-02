import { readFile } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

import { OllamaClient } from './llm/ollama.js';
import { SkillLoader } from './skills/skillLoader.js';
import { Agent } from './agent/agent.js';
import { DebugLogger } from './agent/debugLogger.js';
import { CLI } from './cli/cli.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  // 載入設定
  const configPath = resolve(__dirname, '../config/default.json');
  let config;
  try {
    const raw = await readFile(configPath, 'utf-8');
    config = JSON.parse(raw);
  } catch {
    console.error(`無法讀取設定檔: ${configPath}`);
    process.exit(1);
  }

  // 初始化 Ollama 客戶端
  const ollamaClient = new OllamaClient(config.ollama);

  // 載入技能模組
  const skillsDir = resolve(__dirname, '..', config.skills.directory);
  const skillLoader = new SkillLoader(skillsDir);
  await skillLoader.load();
  const registry = skillLoader.getRegistry();

  // 初始化 DebugLogger
  const logDir = resolve(__dirname, '..', config.debug?.logDir ?? './logs');
  const debugLogger = new DebugLogger(logDir);
  if (config.debug?.enabled) {
    debugLogger.enable();
    console.log(`[Debug] 除錯模式已開啟，日誌儲存至: ${logDir}`);
  }

  // 初始化 Agent（含連線檢查）
  const agent = new Agent(ollamaClient, registry, config.agent, debugLogger);
  try {
    await agent.initialize();
  } catch (err) {
    console.error(`\n[啟動失敗] ${err.message}`);
    console.error('\n請參閱 OLLAMA_SETUP.md 了解如何安裝與啟動 Ollama。\n');
    process.exit(1);
  }

  // 啟動 CLI
  const cli = new CLI(agent, ollamaClient, registry, debugLogger);
  await cli.start();
}

main().catch((err) => {
  console.error('[未預期錯誤]', err);
  process.exit(1);
});
