import { readdir, readFile } from 'fs/promises';
import { join, resolve } from 'path';
import { existsSync } from 'fs';
import { pathToFileURL } from 'url';
import { runScript } from './scriptRunner.js';

// ── 解析 YAML front matter（Anthropic 格式） ──────────────────────────────
// 支援純量鍵值（key: value）及列表（key:\n  - item1\n  - item2）
function parseFrontMatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)/);
  if (!match) return { meta: {}, body: content };

  const meta = {};
  const lines = match[1].split('\n');
  let currentKey = null;

  for (const line of lines) {
    // 列表項目（以 "  - " 開頭）
    if (currentKey && line.match(/^\s+-\s+/)) {
      if (!Array.isArray(meta[currentKey])) meta[currentKey] = [];
      meta[currentKey].push(line.replace(/^\s+-\s+/, '').trim());
      continue;
    }
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) { currentKey = null; continue; }
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (!key) { currentKey = null; continue; }
    currentKey = key;
    // 如果值為空，可能後面跟著列表
    meta[key] = value || null;
  }
  return { meta, body: match[2] };
}

// ── 解析 Markdown 內文中的技能定義 ────────────────────────────────────────
// 支援：## 技能、### Parameters、### Script（含程式碼區塊）、### Reference
function parseSkillsFromBody(body) {
  const skills = [];
  let currentSkill = null;
  let pendingDescription = [];
  let inParams = false;
  let inScript = false;
  let inCodeBlock = false;
  let scriptLang = '';
  let scriptLines = [];
  let inReference = false;

  const flushPending = () => pendingDescription.join(' ').trim();

  for (const rawLine of body.split('\n')) {
    const line = rawLine.trimEnd();

    if (line.startsWith('## ')) {
      if (currentSkill) {
        if (!currentSkill.description) currentSkill.description = flushPending();
        skills.push(currentSkill);
      }
      currentSkill = { name: line.slice(3).trim(), description: '', parameters: {}, script: null, references: [] };
      pendingDescription = [];
      inParams = inScript = inCodeBlock = inReference = false;

    } else if (line.startsWith('### Parameters')) {
      if (currentSkill && !currentSkill.description) { currentSkill.description = flushPending(); pendingDescription = []; }
      inParams = true; inScript = inReference = false;

    } else if (line.startsWith('### Script')) {
      if (currentSkill && !currentSkill.description) { currentSkill.description = flushPending(); pendingDescription = []; }
      inScript = true; inParams = inReference = inCodeBlock = false;
      scriptLang = ''; scriptLines = [];

    } else if (line.startsWith('### Reference')) {
      if (currentSkill && !currentSkill.description) { currentSkill.description = flushPending(); pendingDescription = []; }
      inReference = true; inParams = inScript = false;

    } else if (line.startsWith('```') && inScript) {
      if (!inCodeBlock) {
        scriptLang = line.slice(3).trim() || 'bash';
        inCodeBlock = true;
      } else {
        if (currentSkill) currentSkill.script = { language: scriptLang, code: scriptLines.join('\n'), source: 'inline' };
        inCodeBlock = inScript = false;
      }

    } else if (inCodeBlock) {
      scriptLines.push(rawLine);

    } else if (line.startsWith('- ') && inParams && currentSkill) {
      const match = line.match(/^-\s+(\w+)\s+\((\w+)(?:,\s*required)?\)\s*:\s*(.+)/);
      if (match) {
        currentSkill.parameters[match[1]] = {
          type: match[2],
          required: line.includes(', required)'),
          description: match[3].trim(),
        };
      }

    } else if (line.startsWith('- ') && inReference && currentSkill) {
      currentSkill.references.push(line.slice(2).trim());

    } else if (!line.startsWith('#') && !line.startsWith('-') && !inParams && !inScript && !inReference) {
      if (line.trim()) pendingDescription.push(line.trim());
    }
  }

  if (currentSkill) {
    if (!currentSkill.description) currentSkill.description = flushPending();
    skills.push(currentSkill);
  }

  return skills;
}

// ── 外部腳本：在 <modulePath>/script/<skillName>.<ext> 中尋找 ─────────────
// 外部腳本優先於 skill.md 內嵌腳本
const EXT_LANG_MAP = { sh: 'bash', bash: 'bash', py: 'python3', js: 'node' };

async function findExternalScript(skillName, scriptDir) {
  if (!existsSync(scriptDir)) return null;
  for (const [ext, lang] of Object.entries(EXT_LANG_MAP)) {
    const filePath = join(scriptDir, `${skillName}.${ext}`);
    if (existsSync(filePath)) {
      const code = await readFile(filePath, 'utf-8');
      return { language: lang, code, source: filePath };
    }
  }
  return null;
}

// ── 讀取目錄內所有檔案（用於 reference/ 目錄） ───────────────────────────
async function loadDirectoryFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const results = [];
  for (const entry of entries.filter(e => e.isFile())) {
    const absPath = join(dir, entry.name);
    try {
      results.push({ path: absPath, content: await readFile(absPath, 'utf-8') });
    } catch (err) {
      console.warn(`[SkillLoader] 無法讀取 ${absPath}: ${err.message}`);
    }
  }
  return results;
}

// ── 讀取 skill.md 中 ### Reference 指定的檔案 ────────────────────────────
async function loadInlineReferences(refs, modulePath) {
  const results = [];
  for (const ref of refs) {
    const absPath = resolve(modulePath, ref);
    if (!existsSync(absPath)) { console.warn(`[SkillLoader] Reference 不存在: ${absPath}`); continue; }
    try {
      results.push({ path: absPath, content: await readFile(absPath, 'utf-8') });
    } catch (err) {
      console.warn(`[SkillLoader] 無法讀取 reference ${absPath}: ${err.message}`);
    }
  }
  return results;
}

// ── SkillLoader ────────────────────────────────────────────────────────────
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

    for (const dir of entries.filter(e => e.isDirectory())) {
      const modulePath = join(this.skillsDir, dir.name);
      const skillMdPath = join(modulePath, 'skill.md');
      const indexPath = join(modulePath, 'index.js');
      const scriptDir = join(modulePath, 'script');
      const referenceDir = join(modulePath, 'reference');

      if (!existsSync(skillMdPath)) {
        console.warn(`[SkillLoader] 跳過 ${dir.name}：缺少 skill.md`);
        continue;
      }

      try {
        const mdContent = await readFile(skillMdPath, 'utf-8');
        const { meta, body } = parseFrontMatter(mdContent);

        const confirmSkills = Array.isArray(meta.confirm) ? meta.confirm : [];

        const manifest = {
          name: dir.name,
          description: meta.description ?? '',
          skills: parseSkillsFromBody(body),
        };

        // 根據 front matter 的 confirm 陣列標記需確認的技能
        for (const skill of manifest.skills) {
          if (confirmSkills.includes(skill.name)) {
            skill.requiresConfirm = true;
          }
        }

        if (manifest.skills.length === 0) {
          console.warn(`[SkillLoader] 跳過 ${dir.name}：skill.md 未定義任何技能`);
          continue;
        }

        // 預先偵測各技能的外部腳本（external 優先於 inline）
        for (const skill of manifest.skills) {
          skill.externalScript = await findExternalScript(skill.name, scriptDir);
        }

        // 預先載入模組層級的外部 reference 目錄（所有技能共享）
        const moduleExternalRefs = existsSync(referenceDir)
          ? await loadDirectoryFiles(referenceDir)
          : [];

        // index.js 為選填
        let jsModule = null;
        if (existsSync(indexPath)) {
          const mod = await import(pathToFileURL(indexPath).href);
          if (typeof mod.execute === 'function') jsModule = mod;
        }

        // 確認所有技能都有執行方式
        const uncovered = manifest.skills.filter(s => !s.externalScript && !s.script && !jsModule);
        if (uncovered.length > 0) {
          console.warn(`[SkillLoader] 跳過 ${dir.name}：技能 [${uncovered.map(s => s.name).join(', ')}] 無 script 也無 index.js`);
          continue;
        }

        // 建立統一的 execute 函數
        const execute = async (skillName, parameters) => {
          const skill = manifest.skills.find(s => s.name === skillName);
          if (!skill) throw new Error(`找不到技能: ${skillName}`);

          // 合併 references：inline（skill.md ### Reference）+ 模組外部目錄
          const inlineRefs = skill.references.length > 0
            ? await loadInlineReferences(skill.references, modulePath)
            : [];
          const allRefs = [...inlineRefs, ...moduleExternalRefs];

          // 腳本優先順序：外部檔案 > skill.md 內嵌 > index.js
          const script = skill.externalScript ?? skill.script;
          if (script) return runScript(script.language, script.code, parameters, allRefs);
          if (jsModule) return jsModule.execute(skillName, parameters, { references: allRefs });

          throw new Error(`技能 "${skillName}" 無 script 也無 JavaScript 實作`);
        };

        this.registry.set(dir.name, { manifest, execute });

        // 載入摘要
        const scriptCount = manifest.skills.filter(s => s.externalScript || s.script).length;
        const refCount = moduleExternalRefs.length;
        console.log(`[SkillLoader] 載入模組: ${manifest.name} (${manifest.skills.length} 個技能${scriptCount ? `, ${scriptCount} script` : ''}${refCount ? `, ${refCount} ext-ref` : ''})`);
      } catch (err) {
        console.warn(`[SkillLoader] 載入 ${dir.name} 失敗: ${err.message}`);
      }
    }

    return this.registry;
  }

  getRegistry() { return this.registry; }

  getSkillsDescription() {
    if (this.registry.size === 0) return '目前沒有可用的技能。';

    const lines = ['## 可用技能'];
    for (const [, { manifest }] of this.registry) {
      lines.push(`\n### 模組: ${manifest.name} — ${manifest.description}`);
      for (const skill of manifest.skills) {
        const params = Object.entries(skill.parameters ?? {})
          .map(([k, v]) => `${k}(${v.type}${v.required ? ',必填' : ''})`)
          .join(', ');
        const tags = [];
        if (skill.externalScript) tags.push(`[${skill.externalScript.language} ext-script]`);
        else if (skill.script) tags.push(`[${skill.script.language} script]`);
        if (skill.references.length > 0) tags.push(`[${skill.references.length} inline-ref]`);
        lines.push(`- ${skill.name}: ${skill.description}${params ? ` [參數: ${params}]` : ''}${tags.length ? ` ${tags.join(' ')}` : ''}`);
      }
    }
    return lines.join('\n');
  }
}
