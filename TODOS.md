# TODOS

Forward-looking work clipboard. Git history / GitHub release notes are the archive — these notes stay concise (1-3 lines each + file:line links). Stale-check on each release; delete shipped items.

## 发布流程备忘（每版适用）

- 打包：`npm run dist`，产物在 `release/`；GitHub Release **必传三件套** `T-Translate-Setup-x.x.x.exe` + `.exe.blockmap` + `latest.yml`（缺 latest.yml 用户端检查更新直接报错）
- OCR 模型热更新只改 `ocr-models` Release 资产（bump manifest version 即可，无需发版），维护手册见 [docs/OCR_MODELS.md](docs/OCR_MODELS.md)
- 语言包 rec 模型目前 v4 代际；上游出 v5 多语言 ONNX 后按 OCR_MODELS.md「更新模型」流程换入

## v0.3 candidates

### 设置页 + Provider 管理专项（下一轮体检主题）

审计线索已预埋（协作记忆 settings-leads）。归入本专项的存量评估项：

- **翻译栈下沉主进程评估** — 主窗口/划词/悬浮窗三个 renderer 各持一份 provider 实例 + L1 缓存 + failure count，互不共享；L2 经 localStorage 共享但写入互相覆盖。下沉主进程后：跨窗口缓存命中、密钥单点解密、隐私模式单点强制。改动大，与下条合并评估同档期权衡
- **Anthropic / Gemini provider 合并评估** — v0.2.6 只合并了 OpenAI-compatible 系；两者 API 形状不同（messages / generateContent），评估是否共享结构。警惕 reverse-DRY（dry-merge-over-abstract 教训），结论可以是"不动"
- **Provider 层存量硬编码中文迁 i18n** — [openai-compatible.js](src/providers/openai-compatible.js) 与 [presets.js](src/providers/openai-compatible/presets.js) 十余条 v0.2.5 前中文（`文本为空`/`连接失败`/`testConnectionMessage` 等）；照搬 v0.2.7 的 `providerError.*` + `_t()` 模式。注意 [error-handler.js](src/utils/error-handler.js) 靠正则关键词分类，英文文案需保留关键词

### 划词检测完整性（0.2.9 已基本落地，剩数据驱动项）

- README 应用支持列表 — 等日常使用积累（`npm run start:debug` 探针日志按应用记录走哪层），逐项标注已知限制
- UIA TextPattern 第 4 层 — **默认不建**（承重墙修复后覆盖大幅改善）；仅当日志出现成片失败样本再评估

### PP-OCRv6 ONNX 实测（能否喂进 esearch-ocr）

PP-OCRv6 已发布（2026-06-11，[官方介绍](https://www.paddleocr.ai/main/en/version3.x/algorithm/PP-OCRv6/PP-OCRv6.html)）：PPLCNetV4 骨干，tiny/small/medium 三档（1.5M-34.5M 参数），medium 对 v5_server 识别 +5.1%/检测 +4.6%，**单模型 50 语言**（简繁中/英/日 + 46 拉丁语系）。

- **实验**：Paddle2ONNX 导出 v6 tiny/small 的 det/rec + 字典，直接喂 esearch-ocr 跑 temp/ 的 probe 8 场景；风险点 = rec 非对称 stride 的输入形状与字典格式是否匹配 esearch-ocr 加载假设
- **成了的话**：走"模型热更新只改 Release"路径，**拉丁语言包可删**（被基础模型吸收）；韩/西里尔/天城/阿拉伯四包保留
- 顺带：百度 Unlimited-OCR 只有 NVIDIA GPU 路径，不适合内置；其 vLLM 镜像是 OpenAI 兼容 API，有 N 卡用户可把 llm-vision 端点指过去零改动直连——可写 FAQ

### 真 asar 热替换（仅评估，不承诺）

只覆盖纯 JS 改动；koffi/uiohook/node-screenshots/OCR 全在 asarUnpack，native 或 Electron 版本一变必须回全量；且热更新通道必须做包签名校验，否则是供应链攻击口。当前差分下载（v0.2.8 起）已覆盖大部分收益。

### Full onboarding wizard

The v0.2.6 OCR error-to-guidance fix is the short version. Full version: first-launch welcome flow, guided OCR/LLM setup, feature tour. Needs design.

### Incremental unit test coverage buildout

`tests/unit/` 现有 8 个测试文件（selection 三件套 / stream-throttle / ocr-packs / 历史导入规范化等）。Principle: add tests when you touch a file, new features ship with tests, bug fixes ship with regression tests. Not chasing 100% coverage.

### Lint backlog cleanup

剩余项（App.jsx rules-of-hooks 与 jsx-uses-vars 已在 0.2.9 主面板轮根修）：
- `src/i18n/locales/{en,zh}.js`: 重复 key（selectStyle / notify）— 后定义静默覆盖前定义
- `src/utils/logger.js`: `??` 左侧 constant 是 dead code
- 清完后恢复全局严格（移除 eslint.config.js 剩余 per-file 降级）
