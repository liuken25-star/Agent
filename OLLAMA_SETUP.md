# Ollama 安裝與連結說明

本文件說明如何在本地端安裝 Ollama、下載大語言模型，以及透過 SkillAgent 與其連結。

---

## 一、安裝 Ollama

### macOS
```bash
brew install ollama
```

### Linux
```bash
curl -fsSL https://ollama.com/install.sh | sh
```

### Windows
前往 https://ollama.com 下載並安裝 Windows 版安裝程式。

---

## 二、啟動 Ollama 服務

安裝完成後，執行以下指令啟動 Ollama 服務（需保持終端開啟）：

```bash
ollama serve
```

Ollama 預設監聽 `http://localhost:11434`。

> **提示**：macOS 安裝 Ollama 桌面版後，服務會自動在背景執行，無需手動 `ollama serve`。

---

## 三、下載語言模型

Ollama 啟動後，使用 `ollama pull` 下載模型：

```bash
# 推薦：llama3.2（約 2GB，繁中支援佳）
ollama pull llama3.2

# 中文能力優秀（約 4.7GB）
ollama pull qwen2.5:7b

# 輕量快速（約 4.1GB）
ollama pull mistral

# 繁體中文優化
ollama pull aya:8b
```

查看已下載的模型：
```bash
ollama list
```

---

## 四、驗證 Ollama 正常運作

在瀏覽器或終端機測試 API：

```bash
# 列出所有模型
curl http://localhost:11434/api/tags

# 測試對話（非 streaming）
curl http://localhost:11434/api/chat \
  -d '{
    "model": "llama3.2",
    "messages": [{"role":"user","content":"你好"}],
    "stream": false
  }'
```

---

## 五、設定 SkillAgent 連結 Ollama

編輯 `config/default.json`，修改以下欄位：

```json
{
  "ollama": {
    "baseUrl": "http://localhost:11434",
    "model": "llama3.2",
    "stream": true,
    "temperature": 0.7
  }
}
```

| 欄位 | 說明 |
|------|------|
| `baseUrl` | Ollama 服務位址（遠端部署時修改此項） |
| `model` | 使用的模型名稱（需已用 `ollama pull` 下載） |
| `stream` | 是否啟用逐字輸出（建議保持 `true`） |
| `temperature` | 回覆的創意程度，0.0（嚴謹）至 1.0（創意） |

---

## 六、啟動 SkillAgent

確認 Ollama 已運行且模型已下載後：

```bash
node src/index.js
```

或使用 npm：
```bash
npm start
```

成功啟動後會看到：
```
╔══════════════════════════════════════╗
║         SkillAgent v1.0.0            ║
║  模型: llama3.2                      ║
║  技能: 3 個模組 / 8 個技能            ║
╚══════════════════════════════════════╝

輸入 /help 查看可用指令
```

---

## 七、常見問題

**Q: 啟動時出現「無法連線到 Ollama」？**
- 確認 `ollama serve` 已執行
- 確認防火牆未封鎖 11434 port
- 確認 `config/default.json` 中的 `baseUrl` 正確

**Q: 模型回覆緩慢？**
- 建議使用 `llama3.2` 等較小的模型
- 確認系統有足夠的 RAM（7B 模型約需 8GB RAM）

**Q: 如何使用遠端 Ollama？**
- 修改 `baseUrl` 為遠端主機 IP，例如 `http://192.168.1.100:11434`
- 確認遠端主機的 Ollama 已設定允許外部連線
