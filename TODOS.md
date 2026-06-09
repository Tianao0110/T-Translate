# TODOS

Forward-looking work clipboard. Git history / GitHub release notes are the archive — these notes stay concise (1-3 lines each + file:line links). Stale-check on each release; delete shipped items.

## v0.2.7 scope（按优先级）

主题：流式翻译性能包（P0 四件是同一条热路径，一起做）+ 正确性小修 + 用户可感知的 UX 死角。

### P0 — 流式热路径

#### 1. RAF 节流 + 设备分档（原计划项）

Replace per-token `setState` on the `<textarea>` with RAF-based buffering: accumulate tokens, flush one batch per frame, minimum 16ms interval floor (cap at 60fps even on 144/240Hz displays). Two device tiers via `navigator.hardwareConcurrency` + `deviceMemory`: high (≥8 cores, ≥16GB) → 16ms floor, mid/low → 33ms floor. Non-streaming providers (Google/DeepL/Baidu) bypass the throttle. Flush residual buffer on stream end. Verification artifact: before/after Memory snapshots + Performance profile（能看到 stringify/render 占比变化）.

#### 2. 流式中间态不进 persist store

[translation-store.js:592](src/stores/translation-store.js:592) zustand persist 无防抖：每次 setState 都对 partialize 后的状态（含最多 1000 条 history）全量 `JSON.stringify` + 同步 `localStorage.setItem`。流式每 chunk、源文本框每击键都付这笔。流式中间文本改走非持久化路径，翻译完成才 commit；或给 persist storage 包一层防抖。

#### 3. Store 订阅 selector 化

[TranslationPanel:73](src/components/TranslationPanel/index.jsx:73)、[MainWindow:56](src/components/MainWindow/index.jsx:56)、[SettingsPanel:78](src/components/SettingsPanel/index.jsx:78)、[FavoritesPanel:486](src/components/FavoritesPanel/index.jsx:486) 裸 `useTranslationStore()` 订阅整个 store，任何字段变化四个组件全部重渲染（MainWindow 是窗口壳 → 全树）。改 `useShallow` selector 后流式 flush 只重渲染译文子树。与 RAF 节流是乘法关系。

#### 4. postProcess 挪进 flush

[translation.js:659](src/services/translation.js:659) 每 chunk 对**累计全文**跑占位符还原（每个占位符一次 split/join），整条流 O(N²)。chunk 回调只 `buffer += chunk`，postProcess 在每帧 flush 时做一次。

### P1 — 正确性

#### 5. max_tokens 硬编码 2048 截断长译文

[openai-compatible.js:297](src/providers/openai-compatible.js:297) 与 [:338](src/providers/openai-compatible.js:338)。CJK 译文 token 膨胀，文档长段落静默截断且无报错。省略该参数（服务端默认到模型上限）或 preset 可配。

#### 6. 缓存 key 加 model 名

[translation.js:323](src/services/translation.js:323) `_getCacheKey` 缺 `provider.config.model`：LM Studio 换模型（同 provider id）命中旧模型译文。一行修复。

#### 7. 流式 idle watchdog

[openai-compatible.js:344](src/providers/openai-compatible.js:344) 响应头到达即 `clearTimeout`，之后 read 循环无任何超时；本地模型卡死 → UI 永久"翻译中"。加 per-chunk 重置的 inactivity timer（如 30s 无新 chunk 则 abort）。

#### 8. chatCompletion 走 priority 列表

[translation.js:797](src/services/translation.js:797) 硬编码 `getProvider('local-llm')` 且不查 `isConfigured`：主力用 OpenAI/DeepSeek/Ollama 的用户，风格改写 / AI 分析必坏。改为 priority 中第一个可用且有 `chat()` 的 provider。

### P2 — UX 死角 + 易胜

#### 9. electron-log 落地，"打开日志目录"变有用

[logger.js:8](electron/utils/logger.js:8) 整套按 electron-log 设计（轮转/脱敏/清理已配好）但依赖从未安装，永远走 console fallback → 不生成日志文件，About 页按钮形同虚设。`npm i electron-log` 即激活主进程文件日志。renderer 日志 IPC 转发可后做。

#### 10. 隐私页数据管理显示数据量

[PrivacySection.jsx:160](src/components/SettingsPanel/sections/PrivacySection.jsx:160) 只有清除按钮，看不到现有多少数据。显示：历史 N 条 / 收藏 N 条 / 缓存 N 条（`getCacheStats()` 现成）/ 设置与日志文件大小（新增小 IPC）。

#### 11. selectedTemplate 持久化

[TranslationPanel/index.jsx:38](src/components/TranslationPanel/index.jsx:38) React state only，重启回 `'natural'`。persist 到 localStorage（或主进程 electron-store）。

#### 12. 点击热路径去同步读盘

[main.js:494](electron/main.js:494) 与 [:542](electron/main.js:542) 全局 mousedown/mouseup 里 `store.get('settings.selection')`——electron-store 每次 `.get` 都 `readFileSync` + 全文件 JSON.parse，即每次左键 2 次同步磁盘 I/O。缓存进 `runtime` + `store.onDidChange` 刷新。

### P3 — 时间允许

#### 13. MT mode UI indicator

自动检测（[model-template-mapping.js](src/config/model-template-mapping.js)）切到 MT 直出模板时无 UI 反馈，用户疑惑"为什么译文风格变了"。模型名旁加小 badge："MT model detected — using direct prompt"。

#### 14. 隐私页"使用统计"措辞

[PrivacySection.jsx:138](src/components/SettingsPanel/sections/PrivacySection.jsx:138) 标准模式显示"使用统计 ✓ 收集"，但代码库无任何遥测实现。隐私优先的应用不该自称在收集——改为"本地统计"或删行。

#### 15. 启动解密并行化

[translation.js:201](src/services/translation.js:201) `_decryptConfigs` 串行 await ~10 次 secureStorage IPC。`Promise.all` 并行化加快各窗口冷启动（注意解密审计日志是否依赖顺序）。

## v0.2.8 / v0.3 candidates

### 划词检测完整性计划（v0.3 主题）

目标：主流应用全覆盖 + 覆盖不到的场景优雅降级并给用户明确提示。"任何程序都能识别"技术上无法承诺（UIPI 隔离的提权窗口、DRM/反截屏应用、独占全屏游戏），按分层推进：

- **第 4 层探测：UI Automation TextPattern** — 不动剪贴板、不抢焦点；Chrome/Electron/UWP 大多支持。作为 Layer 2.5 插入现有三层之间
- **Layer 1/2 文本捕获 root-fix** — `hasTextSelection` 只返回布尔不带 text，图标点击走二次 fetch。成功时主动调 Layer 3 fetch，text 全部在 mouseup 时捕获，零二次 fetch（~60-80 行）
- **"按下没内容"文本缓存 root-fix** — v0.2.4 用 800ms 轮询缓解了症状；真因是焦点转移。缓存成功取到的 text + 时间戳到 `runtime.lastSelectionText`，<500ms 内复用。需校准失效策略
- **权限对齐（UIPI）** — 提权目标窗口会静默吞掉合成 Ctrl+C。检测目标进程 elevation，提示"目标程序以管理员运行"而非无响应；评估 manifest `uiAccess` 的代价（需签名 + Program Files）
- **PDF 阅读器矩阵重测** — Adobe 已确认不行；重测 Foxit / Edge 内置 / SumatraPDF，可用的写进 README 支持列表，全不可用则 debug 剪贴板路径（[native-helper.js](electron/utils/native-helper.js) `simulateCtrlC` + `checkSelectionViaClipboard`）
- **验收**：应用矩阵清单（Chrome/Edge/VSCode/Word/Excel/Outlook/Acrobat/Foxit/IntelliJ/Windows Terminal/UWP 设置/记事本），逐项标注走哪一层、已知限制

### 更新体验：差分下载 + 静默安装（伪热更新先行）

现状：[auto-updater.js](electron/utils/auto-updater.js) 手写 GitHub API 全量下载 .exe，`differentialPackage: false`。

- **第一步（推荐）**：迁移 electron-updater — blockmap 差分下载（更新包降到全量 10-30%）、SHA512 校验、断点续传、`quitAndInstall(isSilent)` 静默安装。体验 ≈ 热更新，风险低
- **第二步（仅评估，不承诺）**：真 asar 热替换只覆盖纯 JS 改动；koffi/uiohook/node-screenshots/OCR 全在 asarUnpack，native 或 Electron 版本一变必须回全量；且热更新通道必须做包签名校验，否则是供应链攻击口

### NSIS 安装界面美化（轻量版，不自研）

默认 NSIS 向导确实简陋。方案：electron-builder `installerSidebar`/`installerHeader` 位图 + 自定义 .nsh（MUI 欢迎/完成页、中文文案），1-2 天拿 80% 视觉收益。**不自研安装器**：杀软误报、签名、卸载/注册表正确性都是坑，收益不成比例。若未来要全自定义 UI，正确姿势是"Electron 壳 + 后台静默 NSIS `/S`"。

### 文档翻译并发（在线 provider 3-5x）

[translation.js:757](src/services/translation.js:757) `translateBatch` 逐条 await；DocumentTranslator 的 batch 只是 UI 分组。在线 API（OpenAI/DeepSeek/DeepL）可并发 3-5 路，本地 LLM 保持串行（GPU 排队无益）。presets 已有 `requiresNetwork` 字段，正好做并发度开关依据。

### 翻译栈下沉主进程评估

主窗口/划词/玻璃窗三个 renderer 各持一份 provider 实例 + L1 缓存 + failure count，互不共享；L2 经 localStorage 共享但写入互相覆盖。下沉主进程后：跨窗口缓存命中、密钥单点解密、隐私模式单点强制。改动大，与下条 provider 合并评估同档期权衡。

### Anthropic / Gemini provider consolidation evaluation

v0.2.6 only merged OpenAI-compatible providers. Anthropic and Gemini have different API shapes (messages format / generateContent). Evaluate if they share enough structure with each other or with a "REST translator" abstraction. Risk: abstract base class is reverse-DRY (see `dry-merge-over-abstract` learning). May find the right call is "leave them be".

### Full onboarding wizard

The v0.2.6 OCR error-to-guidance fix is the short version. Full version: first-launch welcome flow, guided OCR/LLM setup, feature tour. Needs design.

### Incremental unit test coverage buildout

`tests/unit/` 现有 3 个测试文件（selection-state-machine / selection-trigger-passthrough / translate-text-sourcelang）。Principle: add tests when you touch a file, new features ship with tests, bug fixes ship with regression tests. Not chasing 100% coverage.

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
