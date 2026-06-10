# TODOS

Forward-looking work clipboard. Git history / GitHub release notes are the archive — these notes stay concise (1-3 lines each + file:line links). Stale-check on each release; delete shipped items.

## v0.2.8 scope

主题：平台升级（Electron + electron-builder），单独分支 `v0.2.8`，不混入功能改动。

### Electron 28 → 42 + electron-builder 24 → 26 平台升级（主项）— ✅ 已完成（7b52fd1，待人工回归 + merge）

2026-06-09 完成于分支 `v0.2.8`：E42.4.0（Chromium 148/Node 24）+ builder 26.15.2 + Vite 7.3.5 + plugin-react 5.2.0，target 同步 chrome148。四条 native 线 + safeStorage E28→E42 跨版本解密实测通过，NSIS 打包验证 OK，npm audit 8→0。回归探针在 temp/（gitignored）。待人工回归项：真实划词、玻璃窗、文档翻译、设置页 API key 存取。

### 更新体验：差分下载 + 静默安装（依赖 builder 26，伪热更新先行）

- **第一步 ✅ 已完成（2026-06-10，feat/electron-updater 187a36e）**：electron-updater 迁移落地，净 -95 行。**发布流程从 v0.2.8 起变更**：GitHub Release 必须上传三件套 `T-Translate-Setup-x.x.x.exe`（连字符名，artifactName 已固定）+ `.exe.blockmap` + `latest.yml`，缺 latest.yml 用户端检查更新直接报错。0.2.7→0.2.8 首跳全量（旧 Release 无 blockmap），0.2.8→0.2.9 起差分。差分代价：安装包 187→207MB（+10%，分块压缩）。quitAndInstall 静默安装待首次真实版本跳变人工验证
- **第二步（仅评估，不承诺）**：真 asar 热替换只覆盖纯 JS 改动；koffi/uiohook/node-screenshots/OCR 全在 asarUnpack，native 或 Electron 版本一变必须回全量；且热更新通道必须做包签名校验，否则是供应链攻击口

### NSIS 安装界面美化（轻量版，不自研）— ✅ 已完成（2026-06-10，feat/nsis-installer-ui 485f27d）

落地：双语 en_US/zh_CN 自动选语言（系统中文→中文，其余英文）、MUI 欢迎页（内置本地化文案）、品牌侧栏/header 位图（installer/ 目录，生成脚本 temp/make-installer-bmps.ps1）。语言选择框验证两语言在包内后已移除。中文向导视觉待有中文显示语言的机器人工过目（本机显示语言 en-GB 只能验英文路径）。原计划备忘如下：

方案：electron-builder `installerSidebar`/`installerHeader` 位图 + 自定义 .nsh（MUI 欢迎/完成页），1-2 天拿 80% 视觉收益。**双语已拍板**：`installerLanguages: ['en_US', 'zh_CN']` + multiLanguageInstaller，en_US 排第一 = 兜底语言；NSIS 自动按系统 locale 选语言 → 系统中文显示中文、其他语言一律英文，正好是需求行为，不出语言选择对话框。.nsh 文案用 LangString 写双语。**进度条回弹已定位（2026-06-10，结论：wontfix）**：app-builder-lib NSIS 模板的安装 Section 里同一条 bar 被四段先后驱动——①静默 ExecWait 旧版卸载器（bar 停滞不动）→ ②`File` 把 ~200MB 内嵌 app-64.7z 写入 $PLUGINSDIR（NSIS 按 File 字节算进度，bar 冲高）→ ③`Nsis7z::Extract` 插件接管 bar 从 0 重爬（**回弹主因**）→ ④`CopyFiles` 临时目录→安装目录再动一段。见 installSection.nsh:52/66 与 extractAppPackage.nsh:92-138。解压宏不在 electron-builder 的 customInstall 等 hook 覆盖范围，干净修复=整个覆盖 nsis.template，违背"轻量/不自研"原则且每次 builder 升级都要重新对齐——不做。缓解事实：updater 迁移后老用户走静默更新不再见向导；首装用户只见一次②→③回弹。**不自研安装器**：杀软误报、签名、卸载/注册表正确性都是坑，收益不成比例。注意：updater 迁移上线后老用户基本不再见到安装向导（静默更新），此项投入锁死轻量版不加码。

### 设置目录弱引导（一次性提示）— ✅ 已完成（2026-06-10，feat/settings-catalog-hint 1459bab）

落地 66 行：首开设置且简洁目录时切换链接上方气泡提示，「知道了」/点切换均记 localStorage 永不再现，zh/en 双语。headless 浏览器实测渲染/消失/持久化全过。原计划备忘如下：

设置页已有简洁/完整双目录：[constants.js](src/components/SettingsPanel/constants.js) `NAV_ITEMS` 的 `basic` 标志（简洁=翻译源/翻译/界面/关于 4 项，完整=10 项两组），切换链接在侧栏底部 [index.jsx:690](src/components/SettingsPanel/index.jsx:690) `mode-text-link`，状态存 localStorage `settings-simple-mode`（默认简洁）。

弱引导 = 仅一件事：首次打开设置时在该链接旁出一次性气泡/高亮，告知"当前为简洁目录，可切换完整目录（划词/玻璃窗/OCR/隐私等）"。看过或点过即记 localStorage 标志，永不再现。zh/en 双语 i18n。**不做**欢迎页、分步向导、功能导览（完整版 onboarding 是 v0.3 候选）。预估 ≤60 行含样式。

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

### 划词 UI 动效/加载现代化评估（低优先级，user 提出）

现状判断：触发/加载/卡片动画全是 CSS transform/opacity（GPU 合成，已是低开销路径），窗口常驻预热（见 selection window persistent 设计意图），没有性能问题要解。可评估的增量：① 加载态从 spinner 换骨架/进度环等更现代形态；② Chromium 148 支持的 CSS `linear()` 缓动做弹簧手感（纯 CSS，零 JS 开销）；③ "换框架呈现"结论倾向否——透明 frameless 窗口 + CSS 已是 Electron 下最轻方案，引入动画库（framer-motion 等）增包增耗不成比例。注意透明窗口视觉铁律：任何效果不得超出窗口矩形（模糊阴影会被硬裁成方形，2ad56a9 的教训）。

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
