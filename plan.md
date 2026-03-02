# SkillAgent 開發計畫

## Context
根據 requirement.md，開發一個 Node.js AI Agent，可連結本地 Ollama LLM，支援可擴充的技能系統（Skills），提供 CLI 互動界面。

## 架構概覽

**零外部依賴**，全使用 Node.js 16+ 原生 API（`http`/`https`、`readline`）。ESM 模式（`"type": "module"`）。

> **v1.1 變更**：Node.js 最低版本從 18 降為 16。`fetch`（Node 18+ 內建）與 `AbortSignal.timeout()`（Node 17.3+ 內建）改以 `http`/`https` 模組替代，影響 `src/llm/ollama.js` 與 `skills/web/index.js`。

## 目錄結構

```
SkillAgent/
├── package.json
├── README.md
├── OLLAMA_SETUP.md
├── config/
│   └── default.json              # Ollama URL、模型名稱等設定
├── src/
│   ├── index.js                  # 進入點，組裝並啟動所有模組
│   ├── llm/
│   │   └── ollama.js             # Ollama API 通訊封裝
│   ├── agent/
│   │   ├── agent.js              # Agent 核心（ReAct 執行循環）
│   │   └── planner.js            # 解析 LLM 回覆，識別工具呼叫或純文字
│   ├── skills/
│   │   └── skillLoader.js        # 自動掃描載入 skills/ 模組
│   └── cli/
│       └── cli.js                # readline 互動界面
└── skills/
    ├── system/                   # 系統資訊技能模組
    │   ├── manifest.json
    │   └── index.js
    ├── file/                     # 檔案操作技能模組
    │   ├── manifest.json
    │   └── index.js
    └── web/                      # 網路請求技能模組
        ├── manifest.json
        └── index.js
```

## 實作步驟

### 1. `package.json`
- `"type": "module"`, `"engines": {"node": ">=18.0.0"}`
- scripts: `start`, `dev` (node --watch)
- 零 dependencies

### 2. `config/default.json`
```json
{
  "ollama": { "baseUrl": "http://localhost:11434", "model": "llama3.2", "stream": true },
  "agent": { "maxRetries": 3 },
  "skills": { "directory": "./skills" }
}
```

### 3. `src/llm/ollama.js` — OllamaClient 類別
- `chat(messages, options)` — POST `/api/chat`，支援 stream（逐字 chunk）
- `listModels()` — GET `/api/tags`
- `checkConnection()` — 驗證 Ollama 是否在線
- 使用 Node.js `http`/`https` 模組（Node 16 相容，不用 fetch）

### 4. `src/skills/skillLoader.js` — SkillLoader 類別
- `load()` — 掃描 `skills/` 子目錄，讀 `skill.md`（Markdown 格式），動態 `import` `index.js`
- `getRegistry()` — 回傳 `Map<moduleName, {manifest, execute}>`
- `getSkillsDescription()` — 輸出供注入 system prompt 的技能文字描述
- Skill Markdown 格式：`# 模組名` / `## 技能名` / `### Parameters` / `- param (type, required): 描述`

### 5. `src/agent/planner.js` — Planner 類別
- `parse(llmResponse)` — 用 regex 偵測 JSON 格式工具呼叫
- 回傳 `{type: 'skill_call', module, skill, parameters}` 或 `{type: 'text', content}`
- System Prompt 指示 LLM：需要工具時以 `{"action":"use_skill","module":"...","skill":"...","parameters":{...}}` 格式回覆

### 6. `src/agent/agent.js` — Agent 類別（ReAct Loop）
- `initialize()` — 檢查 Ollama 連線，建立含技能說明的 system prompt
- `run(userInput)` — 主執行入口：組裝 messages → 呼叫 LLM → Planner 解析 → 若 skill_call 則執行技能 → 結果加入 messages → 再次 LLM（最多 maxRetries）→ 回傳最終文字
- 維護 `conversationHistory[]`，`clearHistory()`

### 7. `src/cli/cli.js` — CLI 類別
特殊指令：
| 指令 | 說明 |
|------|------|
| `/help` | 顯示說明 |
| `/skills` | 列出所有技能 |
| `/model <name>` | 切換模型 |
| `/clear` | 清除對話歷史 |
| `/exit` `/quit` | 離開 |

其餘輸入 → `agent.run(input)`，支援 streaming 逐字輸出

### 8. `src/index.js` — 啟動序列
```
載入 config → OllamaClient → SkillLoader.load() → Agent.initialize() → CLI.start()
```

### 9. 三個內建技能模組

**`skills/system/`**
- `get_time` — 目前日期時間
- `get_platform` — OS 資訊
- `run_command` — 執行 shell 指令（用 `child_process.exec`）

**`skills/file/`**
- `read_file` — 讀取檔案（fs/promises）
- `write_file` — 寫入檔案
- `list_directory` — 列目錄

**`skills/web/`**
- `fetch_url` — HTTP GET
- `post_request` — HTTP POST（JSON）

### 10. 說明文件
- `OLLAMA_SETUP.md` — 安裝 Ollama、下載模型、設定連結、啟動 Agent
- `README.md` — 使用說明、CLI 指令、自訂技能模組教學（manifest.json + index.js 格式）

### 11. 除錯模式（新增）

- `src/agent/debugLogger.js` — DebugLogger 類別
  - `enable()` / `disable()` / `toggle()` / `isEnabled()`
  - `log(model, messages, response)` — 每次 LLM 呼叫後寫入 JSON 日誌
  - 日誌路徑：`logs/<session>_turn<NNN>.json`
- `config/default.json` 新增 `"debug": {"enabled": false, "logDir": "./logs"}`
- `src/index.js` — 建立 DebugLogger，傳給 Agent 與 CLI
- `src/agent/agent.js` — 每次 `ollama.chat()` 後呼叫 `debugLogger?.log()`
- `src/cli/cli.js` — 新增 `/debug` 指令切換除錯模式，banner 顯示目前狀態

## 驗證方式
1. `node src/index.js` 啟動，確認顯示 Ollama 連線狀態與技能數量
2. 輸入 `/skills` 確認三個技能模組正確載入
3. 輸入問題（如「現在幾點？」），確認 Agent 呼叫 `system.get_time` 並回覆
4. 輸入「讀取 README.md」，確認 Agent 呼叫 `file.read_file`
5. 輸入 `/clear` 後對話歷史重置，`/exit` 正常離開
6. 在 `skills/` 新增自訂模組目錄，重啟後確認自動載入
7. 輸入 `/debug` 開啟除錯模式，發送訊息後確認 `logs/` 目錄產生 JSON 日誌
