---
description: 檔案讀寫與目錄操作技能
---

## read_file
讀取指定路徑的檔案內容

### Parameters
- path (string, required): 檔案路徑

## write_file
將內容寫入指定路徑的檔案

### Parameters
- path (string, required): 檔案路徑
- content (string, required): 要寫入的內容

## list_directory
列出指定目錄下的檔案與子目錄

### Parameters
- path (string): 目錄路徑，預設為當前目錄
