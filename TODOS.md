# TODOS

Forward-looking work clipboard. Git history / GitHub release notes are the archive — these notes stay concise (1-3 lines each + file:line links). Stale-check on each release; delete shipped items.

## v0.2.8 scope

主题：平台升级（Electron + electron-builder），单独分支 `v0.2.8`，不混入功能改动。

### Electron 28 → 42 + electron-builder 24 → 26 平台升级（主项）

Electron 28 EOL 两年半，audit 报 17 个已知 CVE，数条命中本项目场景（`setLoginItemSettings` 自启、clipboard、ASAR 完整性）。四个 native 模块（koffi/uiohook-napi/node-screenshots/@gutenye OCR）均为 N-API，预期平滑，但必须完整回归：划词钩子、截屏、OCR、safeStorage 解密。electron-builder 26 同时清掉构建链 tar/tmp 漏洞（npm audit 剩余 8 项全在此）。顺带 Vite 5 → 7（esbuild dev-server 漏洞随之消失）。注意 vite.config 的 `build.target: 'chrome89'` 与 esbuild target 要同步升到对应 Chromium 版本。

### 更新体验：差分下载 + 静默安装（依赖 builder 26，伪热更新先行）

现状：[auto-updater.js](electron/utils/auto-updater.js) 手写 GitHub API 全量下载 .exe，`differentialPackage: false`。

- **第一步（推荐）**：迁移 electron-updater — blockmap 差分下载（更新包降到全量 10-30%）、SHA512 校验、断点续传、`quitAndInstall(isSilent)` 静默安装。体验 ≈ 热更新，风险低
- **第二步（仅评估，不承诺）**：真 asar 热替换只覆盖纯 JS 改动；koffi/uiohook/node-screenshots/OCR 全在 asarUnpack，native 或 Electron 版本一变必须回全量；且热更新通道必须做包签名校验，否则是供应链攻击口

### NSIS 安装界面美化（轻量版，不自研）

默认 NSIS 向导确实简陋。方案：electron-builder `installerSidebar`/`installerHeader` 位图 + 自定义 .nsh（MUI 欢迎/完成页、中文文案），1-2 天拿 80% 视觉收益。**不自研安装器**：杀软误报、签名、卸载/注册表正确性都是坑，收益不成比例。若未来要全自定义 UI，正确姿势是"Electron 壳 + 后台静默 NSIS `/S`"。

### 文档翻译并发（在线 provider 3-5x，独立小项）

[translation.js](src/services/translation.js) `translateBatch` 逐条 await；DocumentTranslator 的 batch 只是 UI 分组。在线 API（OpenAI/DeepSeek/DeepL）可并发 3-5 路，本地 LLM 保持串行（GPU 排队无益）。presets 已有 `requiresNetwork` 字段，正好做并发度开关依据。

## v0.3 candidates

### 划词检测完整性计划（v0.3 主题）

目标：主流应用全覆盖 + 覆盖不到的场景优雅降级并给用户明确提示。"任何程序都能识别"技术上无法承诺（UIPI 隔离的提权窗口、DRM/反截屏应用、独占全屏游戏），按分层推进：

- **第 4 层探测：UI Automation TextPattern** — 不动剪贴板、不抢焦点；Chrome/Electron/UWP 大多支持。作为 Layer 2.5 插入现有三层之间
- **Layer 1/2 文本捕获 root-fix** — `hasTextSelection` 只返回布尔不带 text，图标点击走二次 fetch。成功时主动调 Layer 3 fetch，text 全部在 mouseup 时捕获，零二次 fetch（~60-80 行）
- **"按下没内容"文本缓存 root-fix** — v0.2.4 用 800ms 轮询缓解了症状；真因是焦点转移。缓存成功取到的 text + 时间戳到 `runtime.lastSelectionText`，<500ms 内复用。需校准失效策略
- **权限对齐（UIPI）** — 提权目标窗口会静默吞掉合成 Ctrl+C。检测目标进程 elevation，提示"目标程序以管理员运行"而非无响应；评估 manifest `uiAccess` 的代价（需签名 + Program Files）
- **PDF 阅读器矩阵重测** — Adobe 已确认不行；重测 Foxit / Edge 内置 / SumatraPDF，可用的写进 README 支持列表，全不可用则 debug 剪贴板路径（[native-helper.js](electron/utils/native-helper.js) `simulateCtrlC` + `checkSelectionViaClipboard`）
- **验收**：应用矩阵清单（Chrome/Edge/VSCode/Word/Excel/Outlook/Acrobat/Foxit/IntelliJ/Windows Terminal/UWP 设置/记事本），逐项标注走哪一层、已知限制

### 翻译栈下沉主进程评估

主窗口/划词/玻璃窗三个 renderer 各持一份 provider 实例 + L1 缓存 + failure count，互不共享；L2 经 localStorage 共享但写入互相覆盖。下沉主进程后：跨窗口缓存命中、密钥单点解密、隐私模式单点强制。改动大，与下条 provider 合并评估同档期权衡。

### Anthropic / Gemini provider consolidation evaluation

v0.2.6 only merged OpenAI-compatible providers. Anthropic and Gemini have different API shapes (messages format / generateContent). Evaluate if they share enough structure with each other or with a "REST translator" abstraction. Risk: abstract base class is reverse-DRY (see `dry-merge-over-abstract` learning). May find the right call is "leave them be".

### Full onboarding wizard

The v0.2.6 OCR error-to-guidance fix is the short version. Full version: first-launch welcome flow, guided OCR/LLM setup, feature tour. Needs design.

### Incremental unit test coverage buildout

`tests/unit/` 现有 4 个测试文件（selection-state-machine / selection-trigger-passthrough / translate-text-sourcelang / stream-throttle）。Principle: add tests when you touch a file, new features ship with tests, bug fixes ship with regression tests. Not chasing 100% coverage.

### SelectionTranslator: `translation.sourceLanguage` is dead payload

Copilot 在 v0.2.4 PR 审查发现的既有问题。`translateText` 内部硬编码 `sourceLang: 'auto'`（[SelectionTranslator/index.jsx:528](src/components/SelectionTranslator/index.jsx:528)）。三个调用点都只传 targetLanguage，sourceLanguage 字段一路传却从不读。二选一：
- 打通：`translateText` 签名加 `overrideSourceLang`，三处调用传入
- 删除：从 `DEFAULT_TRANSLATION` / IPC payload 移除 sourceLanguage

先拍产品决策：UI 里"手动指定源语言"该不该真生效？

### Lint backlog cleanup

v0.2.5 Phase T 装通 eslint 9 后跑 `npm run lint` 出 539 warnings + 21 pre-existing errors（已在 eslint.config.js per-file 降级兜底）。历史累积，需要逐个清：
- `src/i18n/locales/{en,zh}.js`: 三对重复 key (selectStyle / notify / docParser) — 后定义静默覆盖前定义
- `src/App.jsx`: 8 个 `react-hooks/rules-of-hooks` errors — hook 在 early return 后调
- `src/components/DocumentTranslator/index.jsx`: 3 个 `navigateSearch` undefined
- `src/utils/logger.js`: `??` 左侧 constant 是 dead code

清完后删 eslint.config.js 里的 per-file override，恢复全局严格。

### Provider 层存量硬编码中文字符串迁 i18n

[openai-compatible.js](src/providers/openai-compatible.js) 与 [presets.js](src/providers/openai-compatible/presets.js) 仍有十余条 v0.2.5 前的硬编码中文（`文本为空`/`连接失败`/`testConnectionMessage` 等）。v0.2.7 已建立 `providerError.*` + `_t()` 模式，照搬即可。注意 [error-handler.js](src/utils/error-handler.js) 靠 `/timeout/i` + `/超时/` 正则分类，英文文案需保留关键词。
