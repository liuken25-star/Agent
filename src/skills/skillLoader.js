import { readdir, readFile } from 'fs/promises';
import { join, resolve } from 'path';
import { existsSync } from 'fs';
import { pathToFileURL } from 'url';

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
      const manifestPath = join(modulePath, 'manifest.json');
      const indexPath = join(modulePath, 'index.js');

      if (!existsSync(manifestPath) || !existsSync(indexPath)) {
        console.warn(`[SkillLoader] 跳過 ${dir.name}：缺少 manifest.json 或 index.js`);
        continue;
      }

      try {
        const manifestRaw = await readFile(manifestPath, 'utf-8');
        const manifest = JSON.parse(manifestRaw);

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
