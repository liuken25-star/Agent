import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';

const execAsync = promisify(exec);

export async function execute(skillName, parameters) {
  switch (skillName) {
    case 'get_time':
      return getTime();
    case 'get_platform':
      return getPlatform();
    case 'run_command':
      return runCommand(parameters.command);
    default:
      throw new Error(`[system] 未知技能: ${skillName}`);
  }
}

function getTime() {
  const now = new Date();
  return `目前時間：${now.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}`;
}

function getPlatform() {
  return [
    `作業系統: ${os.type()} ${os.release()}`,
    `平台: ${os.platform()} (${os.arch()})`,
    `主機名稱: ${os.hostname()}`,
    `Node.js: ${process.version}`,
    `記憶體: 總計 ${Math.round(os.totalmem() / 1024 / 1024)} MB，可用 ${Math.round(os.freemem() / 1024 / 1024)} MB`,
  ].join('\n');
}

async function runCommand(command) {
  if (!command) throw new Error('command 參數為必填');
  try {
    const { stdout, stderr } = await execAsync(command, { timeout: 10000 });
    if (stderr) return `stdout:\n${stdout}\nstderr:\n${stderr}`;
    return stdout || '（指令執行完畢，無輸出）';
  } catch (err) {
    throw new Error(`指令執行失敗: ${err.message}`);
  }
}
