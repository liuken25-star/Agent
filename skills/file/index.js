import { readFile, writeFile, readdir, stat } from 'fs/promises';
import { resolve } from 'path';

export async function execute(skillName, parameters) {
  switch (skillName) {
    case 'read_file':
      return readFileSkill(parameters.path);
    case 'write_file':
      return writeFileSkill(parameters.path, parameters.content);
    case 'list_directory':
      return listDirectory(parameters.path);
    default:
      throw new Error(`[file] 未知技能: ${skillName}`);
  }
}

async function readFileSkill(filePath) {
  if (!filePath) throw new Error('path 參數為必填');
  const absPath = resolve(filePath);
  const content = await readFile(absPath, 'utf-8');
  return `檔案內容 (${absPath}):\n\n${content}`;
}

async function writeFileSkill(filePath, content) {
  if (!filePath) throw new Error('path 參數為必填');
  if (content === undefined) throw new Error('content 參數為必填');
  const absPath = resolve(filePath);
  await writeFile(absPath, content, 'utf-8');
  return `已成功寫入檔案: ${absPath}`;
}

async function listDirectory(dirPath = '.') {
  const absPath = resolve(dirPath);
  const entries = await readdir(absPath, { withFileTypes: true });

  const lines = [`目錄內容 (${absPath}):`];
  for (const entry of entries) {
    const type = entry.isDirectory() ? '[目錄]' : '[檔案]';
    let size = '';
    if (entry.isFile()) {
      try {
        const info = await stat(`${absPath}/${entry.name}`);
        size = ` (${info.size} bytes)`;
      } catch { /* ignore */ }
    }
    lines.push(`  ${type} ${entry.name}${size}`);
  }
  return lines.join('\n');
}
