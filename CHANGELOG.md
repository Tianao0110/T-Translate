# 更新日志

本文档记录 T-Translate 各版本变更。早于 v0.2.4 的历史请查 git log 与版本 tag。

## v0.2.4 — 2026-04-24

### 新增
- 划词翻译新增 CapsLock sticky 直出模式（设置页可独立开关）

### 优化
- 剪贴板轮询 500ms → 800ms（轮询次数 10 → 16），降低「按下没内容」发生率
- OCR 兜底阈值放宽（外层 10×5 → 8×4，内层 20×10 → 12×6），小区域文本更易识别

### 修复
- 划词直出窗口初始尺寸异常
- FSM 新增 Condition D「快速选词」，修自动检测路径飞快划词偶尔漏判

### 内部
- 清理死代码（移除 getWindowInfoAtPoint 残留 import 等）
- 新增 Chrome Alt 可行性 spike 脚本 + TODOS.md（追踪 v0.3 候选）
- tests/setup.js 预埋（完整 test toolchain 延后独立 PR 处理）
