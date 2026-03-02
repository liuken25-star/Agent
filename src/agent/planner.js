export class Planner {
  parse(llmResponse) {
    // 找出所有 { 的位置，嘗試從每個位置解析 JSON
    for (let i = 0; i < llmResponse.length; i++) {
      if (llmResponse[i] !== '{') continue;

      // 找出對應的配對 }（考慮巢狀括號）
      let depth = 0;
      let end = -1;
      for (let j = i; j < llmResponse.length; j++) {
        if (llmResponse[j] === '{') depth++;
        else if (llmResponse[j] === '}') {
          depth--;
          if (depth === 0) { end = j; break; }
        }
      }
      if (end === -1) continue;

      const candidate = llmResponse.slice(i, end + 1);
      try {
        const parsed = JSON.parse(candidate);
        if (
          parsed.action === 'use_skill' &&
          typeof parsed.module === 'string' &&
          typeof parsed.skill === 'string'
        ) {
          return {
            type: 'skill_call',
            module: parsed.module,
            skill: parsed.skill,
            parameters: parsed.parameters ?? {},
            raw: llmResponse,
          };
        }
      } catch {
        // 非合法 JSON，繼續找下一個
      }
    }

    return { type: 'text', content: llmResponse };
  }
}
