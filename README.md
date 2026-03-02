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
    ├── skill.md    # 技能描述（Markdown 格式）
    └── index.js    # 技能實作
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

## say_goodbye
向指定名字道別

### Parameters
- name (string, required): 名字
```

**格式規則：**
- `---` 區塊（front matter）— 定義模組描述，`description: 模組說明`
- 模組名稱 — 自動取自目錄名稱（如目錄為 `my-module`，名稱即為 `my-module`）
- `## 技能名稱` — 定義一個技能，下方段落為技能描述
- `### Parameters` — 列出該技能的參數
- `- 參數名 (type, required): 描述` — 必填參數
- `- 參數名 (type): 描述` — 選填參數
- 支援的 type：`string`、`number`、`boolean`、`object`

### index.js 格式

匯出 `execute(skillName, parameters)` 函數：

```javascript
export async function execute(skillName, parameters) {
  switch (skillName) {
    case 'say_hello':
      return `你好，${parameters.name}！`;
    case 'say_goodbye':
      return `再見，${parameters.name}！`;
    default:
      throw new Error(`Unknown skill: ${skillName}`);
  }
}
```

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
