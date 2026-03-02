---
description: 系統資訊查詢技能
---

## get_time
取得目前日期與時間

### Script
```bash
date "+目前時間：%Y/%m/%d %H:%M:%S (%A)"
```

## get_platform
取得作業系統與平台資訊

### Reference
- ./platform_context.md

## run_command
執行 shell 指令並回傳輸出（請謹慎使用）

### Parameters
- command (string, required): 要執行的 shell 指令
