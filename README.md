# SkillAgent

Node.js AI Agent，透過本地端 Ollama 大語言模型執行對話，並支援可擴充的技能（Skills）系統。

## 功能特色

- **連結 Ollama**：使用本地端 LLM，資料不外傳，完全離線可用
- **技能系統**：模組化設計，輕鬆新增自訂技能
- **CLI 界面**：直覺的命令列互動
- **零外部依賴**：僅使用 Node.js 16+ 原生 API

## 快速開始

### 1. 安裝 Ollama 並下載模型

詳見 [OLLAMA_SETUP.md](./OLLAMA_SETUP.md)

```bash
# 下載模型
ollama pull llama3.2
```

### 2. 需求

- Node.js >= 16.0.0
- Ollama 已安裝並運行

### 3. 啟動

```bash
node src/index.js
# 或
npm start
```

## CLI 指令

| 指令 | 說明 |
|------|------|
| `/help` | 顯示指令說明 |
| `/skills` | 列出所有可用技能 |
| `/model <名稱>` | 切換 Ollama 模型 |
| `/clear` | 清除對話歷史 |
| `/exit` | 離開程式 |

## 內建技能模組

### system — 系統資訊
| 技能 | 說明 |
|------|------|
| `get_time` | 取得目前日期時間 |
| `get_platform` | 取得 OS 平台資訊 |
| `run_command` | 執行 shell 指令 |

### file — 檔案操作
| 技能 | 說明 |
|------|------|
| `read_file` | 讀取檔案內容 |
| `write_file` | 寫入檔案 |
| `list_directory` | 列出目錄內容 |

### web — 網路請求
| 技能 | 說明 |
|------|------|
| `fetch_url` | HTTP GET 請求 |
| `post_request` | HTTP POST 請求 |

## 自訂技能模組

在 `skills/` 目錄下新增子目錄，程式啟動時會自動載入：

```
skills/
└── my-module/
    ├── skill.md          # 技能描述（必填）
    ├── index.js          # JS 實作（選填）
    ├── script/           # 外部腳本目錄（選填）
    │   ├── say_hello.sh  # bash 腳本，對應 say_hello 技能
    │   └── analyze.py    # python 腳本，對應 analyze 技能
    └── reference/        # 外部參考資料目錄（選填，自動載入）
        ├── knowledge.md
        └── faq.txt
```

### skill.md 格式

採用 **Anthropic 格式**：YAML front matter 定義模組描述，Markdown 內文定義技能清單。模組名稱由**目錄名稱**決定。

```markdown
---
description: 我的自訂技能模組
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
查詢參考資料並回答

### Parameters
- query (string, required): 查詢關鍵字

### Reference
- ./data/knowledge.md
- ./data/faq.md
```

**格式規則：**
- `---` 區塊（front matter）— 定義模組描述，`description: 模組說明`
- 模組名稱 — 自動取自目錄名稱（如目錄為 `my-module`，名稱即為 `my-module`）
- `## 技能名稱` — 定義一個技能，下方段落為技能描述
- `### Parameters` — 列出該技能的參數
  - `- 參數名 (type, required): 描述` — 必填參數
  - `- 參數名 (type): 描述` — 選填參數
  - 支援的 type：`string`、`number`、`boolean`、`object`
- `### Script` — 內嵌腳本（可選，亦可改用外部腳本檔）
  - 支援語言：`bash`、`sh`、`python`、`python3`、`node`
  - 參數以環境變數傳入：`PARAM_<NAME>`（大寫）
- `### Reference` — 指定額外參考檔案路徑（相對於模組目錄）
  - 檔案內容以環境變數傳入 script：`SKILLREF_0`、`SKILLREF_1`...
  - JS 技能可透過 `context.references[n].content` 取得

### Script 來源（優先順序）

| 優先 | 來源 | 說明 |
|------|------|------|
| 1 | `script/<skillName>.<ext>` | 外部腳本檔（最高優先） |
| 2 | `### Script` 區塊 | skill.md 內嵌腳本 |
| 3 | `index.js` | JavaScript 實作 |

**外部腳本檔命名規則：** 檔名需與技能名稱相同，副檔名決定直譯器：
- `.sh` / `.bash` → bash
- `.py` → python3
- `.js` → node

### Reference 來源（自動合併）

| 來源 | 說明 |
|------|------|
| `### Reference` 區塊 | 指定特定技能使用的參考檔 |
| `reference/` 目錄 | 模組層級，目錄內所有檔案自動載入，對所有技能可用 |

### index.js 格式（選填）

若技能未定義任何 Script，則從 `index.js` 的 `execute` 函數執行：

```javascript
export async function execute(skillName, parameters, context) {
  // context.references 包含所有 reference 檔案的內容
  // context.references[0] = { path: '...', content: '...' }
  switch (skillName) {
    case 'say_hello':
      return `你好，${parameters.name}！`;
    default:
      throw new Error(`Unknown skill: ${skillName}`);
  }
}
```

> 若所有技能皆有 Script（內嵌或外部），則 `index.js` 可省略。

重啟程式後，新技能即自動可用。

## 設定

編輯 `config/default.json`：

```json
{
  "ollama": {
    "baseUrl": "http://localhost:11434",
    "model": "llama3.2",
    "stream": true,
    "temperature": 0.7
  },
  "agent": {
    "maxRetries": 3
  },
  "skills": {
    "directory": "./skills"
  }
}
```

## 專案結構

```
SkillAgent/
├── config/default.json      # 全域設定
├── src/
│   ├── index.js             # 程式進入點
│   ├── llm/ollama.js        # Ollama API 通訊
│   ├── agent/
│   │   ├── agent.js         # Agent 核心（ReAct 循環）
│   │   └── planner.js       # LLM 回覆解析器
│   ├── skills/skillLoader.js # 技能自動載入器
│   └── cli/cli.js           # CLI 互動界面
└── skills/
    ├── system/              # 系統資訊技能（skill.md + index.js）
    ├── file/                # 檔案操作技能（skill.md + index.js）
    └── web/                 # 網路請求技能（skill.md + index.js）
```
