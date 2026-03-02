import { readdir, readFile } from 'fs/promises';
import { join, resolve } from 'path';
import { existsSync } from 'fs';
import { pathToFileURL } from 'url';

// 解析 YAML front matter（Anthropic 格式）
// 格式：
//   ---
//   key: value
//   ---
//   Markdown 內文
function parseFrontMatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)/);
  if (!match) return { meta: {}, body: content };

  const meta = {};
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (key) meta[key] = value;
  }
  return { meta, body: match[2] };
}

// 解析 Markdown 內文中的技能定義
// 格式：
//   ## 技能名稱
//   技能描述
//
//   ### Parameters
//   - paramName (type, required): 描述
//   - paramName (type): 描述
function parseSkillsFromBody(body) {
  const skills = [];
  let currentSkill = null;
  let inParams = false;
  let pendingDescription = [];

  for (const rawLine of body.split('\n')) {
    const line = rawLine.trimEnd();

    if (line.startsWith('## ')) {
      if (currentSkill) {
        if (!currentSkill.description) {
          currentSkill.description = pendingDescription.join(' ').trim();
        }
        skills.push(currentSkill);
      }
      currentSkill = { name: line.slice(3).trim(), description: '', parameters: {} };
      pendingDescription = [];
      inParams = false;
    } else if (line.startsWith('### Parameters')) {
      if (currentSkill) {
        currentSkill.description = pendingDescription.join(' ').trim();
        pendingDescription = [];
      }
      inParams = true;
    } else if (line.startsWith('- ') && inParams && currentSkill) {
      const match = line.match(/^-\s+(\w+)\s+\((\w+)(?:,\s*required)?\)\s*:\s*(.+)/);
      const isRequired = line.includes(', required)');
      if (match) {
        currentSkill.parameters[match[1]] = {
          type: match[2],
          required: isRequired,
          description: match[3].trim(),
        };
      }
    } else if (!line.startsWith('#') && !line.startsWith('-') && !inParams) {
      if (line.trim()) pendingDescription.push(line.trim());
    }
  }

  if (currentSkill) {
    if (!currentSkill.description) {
      currentSkill.description = pendingDescription.join(' ').trim();
    }
    skills.push(currentSkill);
  }

  return skills;
}

export class SkillLoader {
  constructor(skillsDir) {
    this.skillsDir = resolve(skillsDir);
    this.registry = new Map();
  }

  async load() {
    if (!existsSync(this.skillsDir)) {
      console.warn(`[SkillLoader] 技能目錄不存在: ${this.skillsDir}`);
      return this.registry;
    }

    const entries = await readdir(this.skillsDir, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory());

    for (const dir of dirs) {
      const modulePath = join(this.skillsDir, dir.name);
      const skillMdPath = join(modulePath, 'skill.md');
      const indexPath = join(modulePath, 'index.js');

      if (!existsSync(skillMdPath) || !existsSync(indexPath)) {
        console.warn(`[SkillLoader] 跳過 ${dir.name}：缺少 skill.md 或 index.js`);
        continue;
      }

      try {
        const mdContent = await readFile(skillMdPath, 'utf-8');
        const { meta, body } = parseFrontMatter(mdContent);

        // 模組名稱取自目錄名稱，描述來自 front matter
        const manifest = {
          name: dir.name,
          description: meta.description ?? '',
          skills: parseSkillsFromBody(body),
        };

        if (manifest.skills.length === 0) {
          console.warn(`[SkillLoader] 跳過 ${dir.name}：skill.md 未定義任何技能`);
          continue;
        }

        const module = await import(pathToFileURL(indexPath).href);
        if (typeof module.execute !== 'function') {
          console.warn(`[SkillLoader] 跳過 ${dir.name}：index.js 未匯出 execute 函數`);
          continue;
        }

        this.registry.set(dir.name, { manifest, execute: module.execute });
        console.log(`[SkillLoader] 載入模組: ${manifest.name} (${manifest.skills.length} 個技能)`);
      } catch (err) {
        console.warn(`[SkillLoader] 載入 ${dir.name} 失敗: ${err.message}`);
      }
    }

    return this.registry;
  }

  getRegistry() {
    return this.registry;
  }

  getSkillsDescription() {
    if (this.registry.size === 0) return '目前沒有可用的技能。';

    const lines = ['## 可用技能'];
    for (const [, { manifest }] of this.registry) {
      lines.push(`\n### 模組: ${manifest.name} — ${manifest.description}`);
      for (const skill of manifest.skills) {
        const params = Object.entries(skill.parameters ?? {})
          .map(([k, v]) => `${k}(${v.type}${v.required ? ',必填' : ''})`)
          .join(', ');
        lines.push(`- ${skill.name}: ${skill.description}${params ? ` [參數: ${params}]` : ''}`);
      }
    }
    return lines.join('\n');
  }
}
