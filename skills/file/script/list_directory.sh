#!/bin/bash
# 外部腳本示範：列出目錄內容（覆蓋 index.js 的實作）
TARGET="${PARAM_PATH:-.}"
echo "目錄內容 ($TARGET):"
ls -lh "$TARGET" 2>&1
