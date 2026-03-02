# SkillAgent 開發計畫

## 背景

根據 requirement.md 開發一個 Node.js AI Agent，連結本地端 Ollama 或 OpenAI-compatible 後端，支援可擴充的技能系統（Skills），提供 CLI 與 Web UI 互動界面。

**原則：零外部依賴，使用 Node.js 16+ 原生 API（`http`/`https`、`readline`、`crypto`），ESM 模式（`"type": "module"`）。**

---

## 目錄結構

```
SkillAgent/
├── package.json
├── README.md
├── OLLAMA_SETUP.md
├── plan.md
├── config/
│   └── default.json
├── src/
│   ├── index.js
│   ├── llm/
│   │   ├── ollama.js
│   │   └── openaiClient.js
│   ├── agent/
│   │   ├── agent.js
│   │   ├── planner.js
│   │   └── debugLogger.js
│   ├── skills/
│   │   ├── skillLoader.js
│   │   └── scriptRunner.js
│   ├── cli/
│   │   └── cli.js
│   └── web/
│       ├── websocket.js
│       ├── server.js
│       └── public/index.html
└── skills/
    ├── system/
    │   ├── skill.md
    │   ├── index.js
    │   └── platform_context.md
    ├── file/
    │   ├── skill.md
    │   ├── index.js
    │   ├── script/list_directory.sh
    │   └── reference/file_tips.md
    └── web/
        ├── skill.md
        └── index.js
```

---

## 模組說明

### `config/default.json`

全域設定：

- `ollama.apiType` — `"ollama"` 或 `"openai"`，決定使用哪個 LLM 客戶端
- `ollama.numCtx` — 各模式對應的 Context Window 大小（`chat:2048`、`react/plan:8192` 等）
- `agent.defaultMode` — 預設為 `"auto"`
- `agent.maxIterations` — ReAct 最大迭代次數，預設 `5`
- `swarm.agents` — 子 Agent 分組定義（name / skills[] / description）
- `debug.enabled` / `debug.logDir` — 除錯模式設定
- `server.port` — Web UI 伺服器埠號，預設 `3000`

---

### `src/llm/ollama.js` — Ollama 原生 API

- `OllamaClient(config)` — 連線至 Ollama `/api/chat`
- `chat(messages, options)` — ndjson streaming，回傳 `{ content, toolCalls: null, usage }`
- `usage` 包含：`promptTokens`、`completionTokens`、`totalTokens`、`tokensPerSecond`、`ttftMs`、`totalDurationMs`
- TTFT 追蹤：記錄請求開始時間與收到第一個 token 的時間差
- `numCtx` 透過 `options.num_ctx` 傳給 Ollama

---

### `src/llm/openaiClient.js` — OpenAI-compatible API

- `OpenAICompatClient(config)` — 連線至 `/v1/chat/completions`
- 相容 LM Studio、vLLM、OpenRouter、Ollama OpenAI 模式等後端
- 原生 Tool Calling：傳送 `tools` 陣列，解析 `tool_calls` 回覆
- SSE streaming 格式（`data: {...}\n\n`）
- `buildTools(registry)` — 將技能 registry 轉為 OpenAI `tools` 格式
- 回傳 `{ content, toolCalls, usage }`（`toolCalls` 為 `null` 或陣列）

---

### `src/agent/planner.js` — LLM 回覆解析器

- 使用 brace-depth counting 掃描 LLM 回覆，找出 JSON 格式的工具呼叫
- 偵測 `{"action":"use_skill","module":"...","skill":"...","parameters":{...}}`
- 回傳 `{ type: 'skill_call', module, skill, parameters }` 或 `{ type: 'text', content }`
- 僅用於 Ollama 原生 API；OpenAI 模式直接讀取 `toolCalls`

---

### `src/agent/agent.js` — Agent 核心

**六種執行模式：**

| 模式 | 方法 | 說明 |
|------|------|------|
| `auto` | `_runAuto()` | LLM 分類後路由至 `chat` 或 `react` |
| `react` | `_runReact()` | ReAct 工具循環，最多 `maxIterations` 次 |
| `plan` | `_runPlan()` | 生成計畫 → 等待使用者確認/修改 → 執行 |
| `chat` | `_runChat()` | 純對話，不帶技能描述 |
| `reflexion` | `_runReflexion()` | ReAct 執行 → 自我審查修正 |
| `swarm` | `_runSwarm()` | Router 選擇子 Agent → 以限定 registry 執行 |

**`run(userInput, options)` 回呼介面：**

- `onChunk(chunk)` — 串流輸出每個 token
- `onPlanReview(plan) → Promise<string|null>` — 展示計畫給使用者，null 表示取消
- `onConfirm(skillName, params) → Promise<boolean>` — 執行高風險技能前確認

**OpenAI Tool Calling 整合：**
- 偵測 `ollama.apiType === 'openai'` 後，傳送 `tools` 陣列給 LLM
- `toolCalls` 非 null 時直接使用，跳過 Planner 解析
- 訊息格式改為 `{role:'tool', tool_call_id, content}`

---

### `src/agent/debugLogger.js` — 除錯日誌

- `log(model, messages, response, usage)` — 寫入 `logs/<session>_turn<NNN>.json`
- `usage` 欄位包含：`promptTokens`、`completionTokens`、`totalTokens`、`tokensPerSecond`、`ttftMs`、`totalDurationMs`

---

### `src/skills/skillLoader.js` — 技能載入器

- 掃描 `skills/` 子目錄，讀取 `skill.md`
- **Front Matter 解析**：支援純量（`key: value`）與列表（`key:\n  - item`）
- `confirm: [skill1, skill2]` → 標記對應技能的 `requiresConfirm: true`
- 外部腳本偵測：`script/<skillName>.<sh|py|js>`，優先於 skill.md 內嵌腳本
- 外部參考目錄：`reference/` 下所有檔案自動載入，對模組所有技能共用
- `index.js` 為選填，所有技能有 Script 時可省略

---

### `src/skills/scriptRunner.js` — 腳本執行器

- 支援 `bash`、`sh`、`python`、`python3`、`node`
- 參數以 `PARAM_<NAME>` 環境變數傳入（大寫）
- 參考資料以 `SKILLREF_N`（內容）和 `SKILLREF_PATH_N`（路徑）傳入
- 30 秒 timeout，超時強制終止

---

### `src/cli/cli.js` — CLI 界面

- Prompt 顯示當前模式：`[auto] >`、`[react] >` 等
- 指令：`/help`、`/skills`、`/model`、`/mode`、`/clear`、`/debug`、`/exit`
- `_promptUser(message)` — 攔截下一行輸入，用於 plan review 與 confirm 互動
- Plan 模式：展示計畫文字，等待使用者按 Enter 確認、輸入修改版、或 `n` 取消
- 安全確認：顯示技能名稱與參數，等待 Y/n

---

### `src/web/websocket.js` — WebSocket 實作

- RFC 6455 最小化實作，使用 Node.js 內建 `crypto`（SHA-1 + base64 握手）
- `handshake(req, socket)` — 完成 HTTP Upgrade 握手
- `WSClient` 類別：幀解碼/編碼、text/binary/ping/close opcode 處理

---

### `src/web/server.js` — Web 伺服器

- `createServer()` 處理 HTTP（靜態頁面 + `/api/skills`）
- `server.on('upgrade')` 處理 WebSocket 連線
- `WebSession` 類別：每個連線獨立狀態，`_waitFor(type)` 等待使用者回應
- WebSocket 訊息協定：

  | 方向 | type | 說明 |
  |------|------|------|
  | 客戶端 → 伺服器 | `chat` | 使用者輸入 |
  | 客戶端 → 伺服器 | `command` | 指令（mode/debug/clear/model/skills）|
  | 客戶端 → 伺服器 | `plan_confirm` | Plan 模式確認/修改/取消 |
  | 客戶端 → 伺服器 | `confirm_response` | 安全確認 Y/N |
  | 伺服器 → 客戶端 | `init` | 初始狀態（model/mode/debug）|
  | 伺服器 → 客戶端 | `chunk` | 串流輸出片段 |
  | 伺服器 → 客戶端 | `done` | 回應完畢 |
  | 伺服器 → 客戶端 | `plan` | 展示計畫供審閱 |
  | 伺服器 → 客戶端 | `confirm` | 安全確認請求 |
  | 伺服器 → 客戶端 | `state` | 狀態變更通知 |
  | 伺服器 → 客戶端 | `error` | 錯誤訊息 |

---

### `src/web/public/index.html` — Web UI 前端

- 純 HTML/CSS/JS，無外部框架或 CDN
- 深色主題，monospace 字型
- 功能：對話歷史、串流輸出、模式切換下拉、除錯開關、技能列表側邊欄
- Plan 確認 Modal：顯示計畫文字，可編輯修改後確認
- 安全確認 Modal：顯示技能名稱與參數，確認/拒絕
- WebSocket 自動重連（5 秒後重試）

---

## 技能安全確認機制

在 `skill.md` front matter 加入 `confirm` 陣列：

```yaml
---
description: 系統資訊查詢技能
confirm:
  - run_command
---
```

- `skillLoader` 載入時將對應技能標記 `requiresConfirm: true`
- Agent `_executeLoop()` 在執行前呼叫 `onConfirm` 回呼
- CLI 顯示 Y/n 提示，Web UI 顯示確認 Modal
- 目前已標記：`system.run_command`、`file.write_file`

---

## 版本變更記錄

### v1.0 — 初始版本
- Ollama 連線、ReAct 模式、Skills 系統、CLI

### v1.1 — 除錯模式 + Node.js 16 相容
- DebugLogger（`logs/` JSON 日誌）
- `fetch` → `http`/`https` 模組（Node.js 16 相容）
- Skill 格式：JSON manifest → Markdown（Anthropic 格式）
- Script 執行（bash/python/node）+ Reference 支援
- 外部腳本（`script/` 目錄）+ 外部參考（`reference/` 目錄）
- Plan 模式

### v1.2 — 雙 API + 多模式 + Web UI
- OpenAI-compatible API 客戶端（原生 Tool Calling）
- TTFT（首字生成時間）追蹤
- `numCtx` 各模式獨立設定
- 新模式：`auto`（預設）、`chat`、`reflexion`、`swarm`
- Plan 模式：使用者確認/修改計畫後才執行
- 腳本安全確認（`confirm` front matter）
- CLI prompt 顯示當前模式（`[mode] >`）
- `--serve` 模式：HTTP + WebSocket 伺服器 + 純 HTML/CSS/JS Web UI

---

## 驗證清單

- [ ] `node src/index.js` 啟動，顯示連線狀態與技能數量
- [ ] Prompt 顯示 `[auto] >`
- [ ] 輸入「現在幾點？」→ 自動選擇 react，呼叫 `system.get_time`
- [ ] 輸入「你好」→ 自動選擇 chat，直接回覆不呼叫工具
- [ ] `/mode plan` → 輸入任務，確認顯示計畫等待確認/修改
- [ ] `/mode reflexion` → 執行後出現自我審查輸出
- [ ] 觸發 `system.run_command` → 執行前出現確認提示
- [ ] 觸發 `file.write_file` → 執行前出現確認提示
- [ ] `/debug` 開啟，確認 `logs/` 中含 `ttftMs` 欄位
- [ ] `node src/index.js --serve` → http://localhost:3000 可用，串流正常
- [ ] Web UI：模式切換、除錯開關、技能列表、Plan 確認 Modal 正常
- [ ] `config.ollama.apiType: "openai"` → 切換 OpenAI-compat 模式，Tool Calling 正常
