import { writeFile, mkdir } from 'fs/promises';
import { resolve, join } from 'path';

export class DebugLogger {
  constructor(logDir) {
    this.logDir = resolve(logDir);
    this.enabled = false;
    this.sessionId = formatTimestamp(new Date());
    this.turnCount = 0;
  }

  enable() { this.enabled = true; }
  disable() { this.enabled = false; }
  toggle() { this.enabled = !this.enabled; return this.enabled; }
  isEnabled() { return this.enabled; }

  async log(model, messages, response, usage) {
    if (!this.enabled) return;

    this.turnCount++;
    const entry = {
      timestamp: new Date().toISOString(),
      session: this.sessionId,
      turn: this.turnCount,
      model,
      usage: usage ? {
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalTokens: usage.totalTokens,
        tokensPerSecond: usage.tokensPerSecond,
        ttftMs: usage.ttftMs ?? 0,
        totalDurationMs: usage.totalDurationMs,
      } : null,
      messages,
      response,
    };

    try {
      await mkdir(this.logDir, { recursive: true });
      const filename = `${this.sessionId}_turn${String(this.turnCount).padStart(3, '0')}.json`;
      await writeFile(join(this.logDir, filename), JSON.stringify(entry, null, 2), 'utf-8');
    } catch (err) {
      console.warn(`[Debug] 無法寫入日誌: ${err.message}`);
    }
  }
}

function formatTimestamp(date) {
  return date.toISOString().replace(/:/g, '-').replace(/\..+/, '');
}
