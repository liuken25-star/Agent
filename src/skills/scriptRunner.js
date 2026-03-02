import { writeFile, unlink } from 'fs/promises';
import { spawn } from 'child_process';
import { join } from 'path';
import { tmpdir } from 'os';

const INTERPRETERS = {
  bash: 'bash',
  sh: 'sh',
  python: 'python3',
  python3: 'python3',
  node: 'node',
  nodejs: 'node',
};

const EXTENSIONS = {
  python: '.py',
  python3: '.py',
  node: '.js',
  nodejs: '.js',
};

// 執行腳本，回傳 stdout 字串
// parameters 以 PARAM_<NAME> 環境變數傳入
// references 以 SKILLREF_<N>（內容）和 SKILLREF_PATH_<N>（路徑）傳入
export async function runScript(language, code, parameters = {}, references = []) {
  const lang = language.toLowerCase();
  const interpreter = INTERPRETERS[lang];
  if (!interpreter) throw new Error(`不支援的腳本語言: ${language}，支援: ${Object.keys(INTERPRETERS).join(', ')}`);

  const ext = EXTENSIONS[lang] ?? '.sh';
  const tmpFile = join(tmpdir(), `skillagent_${Date.now()}${ext}`);

  await writeFile(tmpFile, code, { encoding: 'utf-8', mode: 0o700 });

  // 建立環境變數
  const env = { ...process.env };

  for (const [key, value] of Object.entries(parameters)) {
    env[`PARAM_${key.toUpperCase()}`] = String(value ?? '');
  }

  references.forEach(({ path, content }, i) => {
    env[`SKILLREF_PATH_${i}`] = path;
    env[`SKILLREF_${i}`] = content;
  });

  return new Promise((resolve, reject) => {
    const child = spawn(interpreter, [tmpFile], { env });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });

    child.on('close', async (exitCode) => {
      try { await unlink(tmpFile); } catch { /* ignore */ }

      if (exitCode !== 0) {
        reject(new Error(`腳本執行失敗 (exit ${exitCode}):\n${stderr.trim()}`));
      } else {
        resolve(stdout || '（腳本執行完畢，無輸出）');
      }
    });

    child.on('error', async (err) => {
      try { await unlink(tmpFile); } catch { /* ignore */ }
      reject(new Error(`無法啟動直譯器 "${interpreter}": ${err.message}`));
    });

    // 逾時 30 秒
    setTimeout(() => {
      child.kill();
      reject(new Error('腳本執行逾時（30 秒）'));
    }, 30000);
  });
}
