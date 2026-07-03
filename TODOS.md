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

## v0.2.8-OCR scope

主题：本地 OCR 升级（PP-OCRv5 + 语言包下载 + Windows OCR 兜底），分支 `v0.2.8-OCR`。维护手册见 [docs/OCR_MODELS.md](docs/OCR_MODELS.md)。

### 已完成（2026-06-10）

引擎 @gutenye(停更,v4,中英) → esearch-ocr(Apache-2.0,v5)：单模型简/繁/英/日+手写竖排，probe 实测 ja 0.999 conf。语言包（韩/拉丁/西里尔/天城/阿拉伯，各 ~8MB）经 GitHub Release `ocr-models` 的 manifest.json 分发，设置页下载/更新/卸载（删净目录）+ sha256 校验 + 失败零残留，probe 8 场景全过。windows-ocr 渲染端引擎类补齐（后端原已存在），优先级链 rapid→windows→llm-vision，BASE_MODELS_MISSING 自动降级。运行时 npm install 机制全删（终端用户无 npm 不再是问题）。模型 gitignored，scripts/fetch-ocr-models.js 拉取（build/dist 自动跑）。

### 发布前人工步骤

- [ ] 悬浮窗口人工回归：Ctrl+Alt+G 开窗 → 空格截图 → 再按空格清空 → ESC 关窗 → 设置页改透明度/锁定语言重启确认保留 → 双击窗格分离 → 含 % 译文窗格正常

- [ ] 文档翻译人工回归（feat/document-translation，28 项修复）：拖入 TXT/PDF 翻译 → 翻译中直接关窗重开同文件确认恢复横幅 → 离线模式下确认不走在线源 → 扫描件 PDF 确认 OCR 逐页进度与结果 → 设置页改分段长度/并发数确认生效 → 术语库开关对照 → 导出 SRT/VTT/Word 各开一次 → GBK 编码字幕不乱码

- [ ] `ocr-models` Release 首发：`npm run ocr:release` 产物已在 release-ocr-models/，按 OCR_MODELS.md 上传 7 个文件（**记得勾 pre-release**）。上传前应用内语言包列表会显示「无法获取清单」属预期
- [ ] 人工回归：设置页语言包下载/更新徽章/卸载、截图翻译（中英日 + 装包后韩语）、Windows OCR 切换、隐私模式引擎过滤（划词 OCR 兜底已在 0.2.9 划词专项删除，图片场景走截图翻译）
- [x] 版本号已改 0.2.9（合并 main 时完成，含 README 徽章）
- [ ] 语言包 rec 模型目前 v4 代际；上游出 v5 多语言 ONNX 后按 OCR_MODELS.md「更新模型」流程换入（bump version 即可，无需发版）

## v0.3 candidates

### 划词检测完整性计划（v0.3 主题）

> **大部分已在 0.2.9 划词专项（feat/selection）落地。** 承重墙（GetGUIThreadInfo `_Inout_`）修复后焦点/caret 检测首次工作，三层探测按设计运转。剩余为矩阵验收 + UIA 决策，待人工回归数据。目标不变：主流应用全覆盖 + 覆盖不到时优雅降级明确提示（UIPI 提权窗/DRM/独占全屏无解）。

- ~~**Layer 1/2 文本捕获 root-fix**~~ ✅ 0.2.9：短时缓存合并同一次划词的探测+抓取，消灭二次 fetch（utils/clipboard-capture）
- ~~**"按下没内容"文本缓存 root-fix**~~ ✅ 0.2.9：<500ms 成功缓存 + mousedown 失效
- ~~**权限对齐（UIPI）终端盲注**~~ ✅ 0.2.9：终端类前台降级为点击确认，纯单击不注入；`uiAccess` 已拍板砍掉（签名+Program Files 负资产）
- **第 4 层探测：UI Automation TextPattern**（待定，切片 C′ 决策）— 不动剪贴板、不抢焦点。**承重墙修复后可能已不需要**，据应用矩阵失败样本决定建/不建；TT_SELECTION_DEBUG 开关已就位辅助定位
- **应用矩阵验收 + PDF 阅读器重测**（切片 C′，人工）— Chrome/Edge/VSCode/Word/Excel/Outlook/Acrobat/Foxit/IntelliJ/Windows Terminal/UWP/记事本 逐项标注走哪层+已知限制，写进 README；Foxit/Edge 内置/SumatraPDF 重测。UIPI 提权窗 elevation 检测提示可在此期补

### PP-OCRv6 ONNX 实测（能否喂进 esearch-ocr）

PP-OCRv6 已发布（2026-06-11，[官方介绍](https://www.paddleocr.ai/main/en/version3.x/algorithm/PP-OCRv6/PP-OCRv6.html)）：PPLCNetV4 骨干，tiny/small/medium 三档（1.5M-34.5M 参数），medium 对 v5_server 识别 +5.1%/检测 +4.6%，**单模型 50 语言**（简繁中/英/日 + 46 拉丁语系，靠词表扩 ~200 变音字符）。CTC 解码保留、官方有 ONNX 导出与浏览器部署文档。

- **实验**：Paddle2ONNX 导出 v6 tiny/small 的 det/rec + 字典，直接喂 esearch-ocr（8.5.0 尚未官方跟进 v6）跑 temp/ 的 probe 8 场景；风险点 = rec 非对称 stride 的输入形状与字典格式是否匹配 esearch-ocr 加载假设
- **成了的话**：走"模型热更新只改 Release"路径（改 `ocr-models` tag 资产 + manifest），**拉丁语言包可删**（被基础模型吸收）；韩/西里尔/天城/阿拉伯不在 50 语言内，四包保留
- 顺带记录：百度 Unlimited-OCR（2026-06-22，MIT，3B MoE 长文档一次通读）只有 NVIDIA GPU 路径（transformers/vLLM/SGLang，无 GGUF/CPU），不适合替代本地引擎；但 vLLM 镜像是 OpenAI 兼容 API，有 N 卡的用户可把连接端点指向它、llm-vision 引擎零改动直连——可写 FAQ，等 Ollama/GGUF 生态跟进再考虑内置

### 翻译栈下沉主进程评估

主窗口/划词/玻璃窗三个 renderer 各持一份 provider 实例 + L1 缓存 + failure count，互不共享；L2 经 localStorage 共享但写入互相覆盖。下沉主进程后：跨窗口缓存命中、密钥单点解密、隐私模式单点强制。改动大，与下条 provider 合并评估同档期权衡。

### Anthropic / Gemini provider consolidation evaluation

v0.2.6 only merged OpenAI-compatible providers. Anthropic and Gemini have different API shapes (messages format / generateContent). Evaluate if they share enough structure with each other or with a "REST translator" abstraction. Risk: abstract base class is reverse-DRY (see `dry-merge-over-abstract` learning). May find the right call is "leave them be".

### Full onboarding wizard

The v0.2.6 OCR error-to-guidance fix is the short version. Full version: first-launch welcome flow, guided OCR/LLM setup, feature tour. Needs design.

### Incremental unit test coverage buildout

`tests/unit/` 现有 4 个测试文件（selection-state-machine / selection-trigger-passthrough / translate-text-sourcelang / stream-throttle）。Principle: add tests when you touch a file, new features ship with tests, bug fixes ship with regression tests. Not chasing 100% coverage.

### Lint backlog cleanup

v0.2.5 Phase T 装通 eslint 9 后跑 `npm run lint` 出 539 warnings + 21 pre-existing errors（已在 eslint.config.js per-file 降级兜底）。历史累积，需要逐个清：
- `src/i18n/locales/{en,zh}.js`: 重复 key (selectStyle / notify) — 后定义静默覆盖前定义（docParser 对已在 0.2.9 文档翻译体检中合并）
- ~~`src/App.jsx`: 9 个 `react-hooks/rules-of-hooks`（实测 9 非 8）~~ 0.2.9 主面板体检已根修：拆掉包裹全部 hooks 的 try/catch（ErrorBoundary 在 main.jsx 已有），per-file 豁免同步删除
- `src/utils/logger.js`: `??` 左侧 constant 是 dead code
- eslint 未启用 `react/jsx-uses-vars`，JSX 引用的组件/图标全报 no-unused-vars 误报（0.2.9 审计时确认，主面板体检批次⑤处理）

App.jsx 的 per-file override 已删（0.2.9）；其余清完后恢复全局严格。

### Provider 层存量硬编码中文字符串迁 i18n

[openai-compatible.js](src/providers/openai-compatible.js) 与 [presets.js](src/providers/openai-compatible/presets.js) 仍有十余条 v0.2.5 前的硬编码中文（`文本为空`/`连接失败`/`testConnectionMessage` 等）。v0.2.7 已建立 `providerError.*` + `_t()` 模式，照搬即可。注意 [error-handler.js](src/utils/error-handler.js) 靠 `/timeout/i` + `/超时/` 正则分类，英文文案需保留关键词。
