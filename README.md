# SkillAgent

Node.js AI Agent，支援本地端 Ollama 或 OpenAI-compatible 後端，具備六種執行模式、可擴充的技能系統、CLI 與 Web UI 界面。

## 功能特色

- **雙 API 支援**：Ollama 原生 API 或 OpenAI-compatible API（LM Studio、vLLM、OpenRouter 等）
- **六種執行模式**：auto（預設）、react、plan、chat、reflexion、swarm
- **技能系統**：Anthropic Markdown 格式，支援 bash/python/node 腳本與外部參考資料
- **腳本安全確認**：可標記高風險技能，執行前顯示 Y/n 確認
- **CLI + Web UI**：命令列或瀏覽器操作，功能完全相同
- **除錯日誌**：記錄 token 用量、TTFT（首字生成時間）、生成速度
- **零外部依賴**：僅使用 Node.js 16+ 原生 API

---

## 快速開始

### 需求

- Node.js >= 16.0.0
- Ollama 已安裝並運行（或其他 OpenAI-compatible 服務）

詳見 [OLLAMA_SETUP.md](./OLLAMA_SETUP.md)

### 啟動

```bash
# CLI 模式
node src/index.js

# Web UI 模式（http://localhost:3000）
node src/index.js --serve
```

---

## CLI 指令

| 指令 | 說明 |
|------|------|
| `/help` | 顯示指令說明 |
| `/skills` | 列出所有可用技能（⚠️ 標示需確認的技能）|
| `/model <名稱>` | 切換模型 |
| `/mode [模式]` | 查看或切換執行模式 |
| `/clear` | 清除對話歷史 |
| `/debug` | 切換除錯模式（日誌儲存至 `logs/`）|
| `/exit` | 離開程式 |

CLI prompt 顯示目前模式，例如 `[auto] >`、`[react] >`。

---

## Agent 執行模式

| 模式 | 說明 |
|------|------|
| `auto`（預設）| LLM 自動分類任務，選擇 `chat` 或 `react` |
| `react` | ReAct 工具呼叫循環，最多 5 次迭代（可設定）|
| `plan` | 先生成計畫，使用者確認或修改後再執行 |
| `chat` | 純對話，不使用任何工具，節省 token 且回應最快 |
| `reflexion` | ReAct 執行後加入自我審查與修正步驟 |
| `swarm` | Router LLM 指派任務給擅長特定技能的子 Agent |

切換模式：`/mode plan`，或在 `config/default.json` 設定 `agent.defaultMode`。

---

## LLM 後端設定

編輯 `config/default.json`：

**Ollama 原生 API（預設）**

```json
{
  "ollama": {
    "baseUrl": "http://localhost:11434",
    "model": "llama3.2",
    "apiType": "ollama",
    "numCtx": {
      "chat": 2048,
      "react": 8192,
      "plan": 8192,
      "reflexion": 8192,
      "auto": 4096,
      "default": 4096
    }
  }
}
```

**OpenAI-compatible API（如 LM Studio）**

```json
{
  "ollama": {
    "baseUrl": "http://localhost:1234",
    "model": "llama-3.2-3b",
    "apiType": "openai",
    "apiKey": "lm-studio"
  }
}
```

> OpenAI-compatible 模式會自動使用原生 Tool Calling（`tools` / `tool_calls`），並直接取得 token 使用量統計。

---

## 內建技能模組

### system — 系統資訊

| 技能 | 說明 | 需確認 |
|------|------|:------:|
| `get_time` | 取得目前日期時間 | |
| `get_platform` | 取得 OS 平台資訊 | |
| `run_command` | 執行 shell 指令 | ⚠️ |

### file — 檔案操作

| 技能 | 說明 | 需確認 |
|------|------|:------:|
| `read_file` | 讀取檔案內容 | |
| `write_file` | 寫入檔案 | ⚠️ |
| `list_directory` | 列出目錄內容 | |

### web — 網路請求

| 技能 | 說明 |
|------|------|
| `fetch_url` | HTTP GET 請求 |
| `post_request` | HTTP POST（JSON）請求 |

---

## 自訂技能模組

在 `skills/` 目錄下新增子目錄，啟動時自動載入：

```
skills/
└── my-module/
    ├── skill.md          # 技能描述（必填）
    ├── index.js          # JS 實作（選填）
    ├── script/           # 外部腳本目錄（選填）
    │   ├── say_hello.sh  # bash 腳本，對應 say_hello 技能
    │   └── analyze.py    # python 腳本，對應 analyze 技能
    └── reference/        # 外部參考資料（選填，自動載入所有檔案）
        └── knowledge.md
```

### skill.md 格式（Anthropic 格式）

模組名稱由**目錄名稱**決定。

````markdown
---
description: 我的自訂技能模組
confirm:
  - dangerous_skill
---

## say_hello
向指定名字打招呼

### Parameters
- name (string, required): 名字

### Script
```bash
echo "你好，$PARAM_NAME！"
```

## lookup
查詢參考資料

### Parameters
- query (string, required): 查詢關鍵字

### Reference
- ./data/knowledge.md
````

**格式說明：**

| 語法 | 說明 |
|------|------|
| front matter `description` | 模組整體說明 |
| front matter `confirm: [skill1]` | 標記執行前需 Y/n 確認的技能 |
| `## 技能名稱` | 定義一個技能（名稱即呼叫用名） |
| `### Parameters` | 參數列表：`- 名稱 (type, required): 說明` |
| `### Script` | 內嵌腳本，參數以 `PARAM_<NAME>` 環境變數傳入 |
| `### Reference` | 參考檔案路徑（相對模組目錄），以 `SKILLREF_0`... 傳入腳本 |

支援腳本語言：`bash`、`sh`、`python`、`python3`、`node`

### Script 優先順序

| 優先 | 來源 |
|------|------|
| 1 | `script/<skillName>.sh` / `.py` / `.js`（外部腳本檔）|
| 2 | skill.md 內嵌 `### Script` |
| 3 | `index.js` 的 `execute()` 函數 |

> 若所有技能皆有 Script，`index.js` 可省略。

### Reference 來源（自動合併）

| 來源 | 說明 |
|------|------|
| `### Reference` 指定的檔案 | 技能專屬 |
| `reference/` 目錄下所有檔案 | 模組層級，對所有技能有效 |

### index.js 格式（選填）

```javascript
export async function execute(skillName, parameters, context) {
  // context.references = [{ path, content }, ...]
  switch (skillName) {
    case 'say_hello':
      return `你好，${parameters.name}！`;
    default:
      throw new Error(`Unknown skill: ${skillName}`);
  }
}
```

---

## Swarm 模式設定

在 `config/default.json` 中定義子 Agent 分組：

```json
{
  "swarm": {
    "agents": [
      { "name": "file-agent", "skills": ["file"], "description": "處理檔案讀寫與目錄操作" },
      { "name": "web-agent",  "skills": ["web"],  "description": "處理 HTTP 網路請求" }
    ]
  },
  "agent": {
    "defaultMode": "swarm"
  }
}
```

Router LLM 分析使用者任務後，自動選擇最適合的子 Agent 執行，子 Agent 只能使用其分配的技能。

---

## 除錯模式

`/debug` 開啟後，每次 LLM 呼叫寫入 `logs/<session>_turn<NNN>.json`：

```json
{
  "timestamp": "2026-03-02T10:30:00.000Z",
  "session": "2026-03-02T10-30-00",
  "turn": 1,
  "model": "llama3.2",
  "usage": {
    "promptTokens": 120,
    "completionTokens": 45,
    "totalTokens": 165,
    "ttftMs": 312,
    "tokensPerSecond": 18.5,
    "totalDurationMs": 2430
  },
  "messages": [...],
  "response": "..."
}
```

| 欄位 | 說明 |
|------|------|
| `ttftMs` | 首字生成時間（Time To First Token）|
| `tokensPerSecond` | 生成速度 |
| `totalDurationMs` | 完整請求總時間 |

---

## 設定檔總覽

`config/default.json` 完整結構：

```json
{
  "ollama": {
    "baseUrl": "http://localhost:11434",
    "model": "llama3.2",
    "stream": true,
    "temperature": 0.7,
    "apiType": "ollama",
    "numCtx": { "chat": 2048, "react": 8192, "plan": 8192, "default": 4096 }
  },
  "agent": {
    "defaultMode": "auto",
    "maxIterations": 5,
    "systemPrompt": "..."
  },
  "swarm": {
    "agents": [...]
  },
  "skills": { "directory": "./skills" },
  "debug": { "enabled": false, "logDir": "./logs" },
  "server": { "port": 3000 }
}
```

---

## 專案結構

```
SkillAgent/
├── config/default.json
├── src/
│   ├── index.js                 # 進入點（支援 --serve 旗標）
│   ├── llm/
│   │   ├── ollama.js            # Ollama 原生 API 客戶端
│   │   └── openaiClient.js      # OpenAI-compatible 客戶端
│   ├── agent/
│   │   ├── agent.js             # 多模式 Agent 核心
│   │   ├── planner.js           # LLM 回覆解析器（brace-depth JSON）
│   │   └── debugLogger.js       # 除錯日誌（TTFT、速度）
│   ├── skills/
│   │   ├── skillLoader.js       # 技能自動載入器（含 confirm 解析）
│   │   └── scriptRunner.js      # 腳本執行器（30s timeout）
│   ├── cli/
│   │   └── cli.js               # readline CLI
│   └── web/
│       ├── websocket.js         # RFC 6455 WebSocket 實作
│       ├── server.js            # HTTP + WebSocket 伺服器
│       └── public/index.html    # Web UI 前端
├── skills/
│   ├── system/                  # 系統資訊（get_time / get_platform / run_command⚠️）
│   ├── file/                    # 檔案操作（read_file / write_file⚠️ / list_directory）
│   └── web/                     # 網路請求（fetch_url / post_request）
├── README.md
├── OLLAMA_SETUP.md
└── plan.md
```
