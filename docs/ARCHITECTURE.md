# T-Translate 架构文档

## 项目概述

T-Translate 是一个 Windows 桌面翻译工具（Electron 42 + React 18 + Vite 7），面向用户的功能说明在 [MANUAL.zh.md](MANUAL.zh.md)。本文写给改代码的人：目录在哪、层怎么分、隐私怎么保证、各功能的设计说明在哪。

| 类别 | 技术 |
| --- | --- |
| 框架 | Electron 42 + React 18，Vite 7 构建渲染端，esbuild 打包主进程翻译栈 |
| 状态 | Zustand + Immer；主窗口状态经 DPAPI 加密的历史保险库持久化 |
| 引擎宿主 | T-Engine（`electron/tengine/`）：每个原生运行时一个 utilityProcess——onnxruntime-node（OCR）、sherpa-onnx（听译 / 朗读）、llama.cpp（内置模型，koffi FFI） |
| 翻译源 | 内置模型、LM Studio / Ollama、OpenAI / Claude / Gemini / DeepSeek / DeepL / Google / Microsoft / 百度 |
| OCR | PP-OCRv6 本地、Windows OCR、内置视觉模型（PaddleOCR-VL）、LLM Vision、OCR.space / Google Vision / Azure / 百度 |
| 安全 | Electron safeStorage（DPAPI）+ 访问审计；主进程单点隐私门 |
| 打包 | electron-builder，NSIS 安装包 |

设计说明（为什么这样做、踩过的坑）按功能放在 `docs/design/`：`main-process.md`、`selection.md`、`listen.md`、`ocr.md`、`model-packs.md`、`ipc.md`、`stack.md`、`renderer.md`、`tooling.md`；T-Engine 的在 [T-ENGINE.md](T-ENGINE.md)。代码注释只留指针。


## 目录结构

```
t-translate/
├── .editorconfig               # 编辑器统一配置 (LF, 2空格)
├── .gitignore
├── .prettierrc                 # 代码格式化
├── .prettierignore
├── eslint.config.js            # ESLint 配置
├── vite.config.js              # Vite 构建配置
├── vitest.config.js            # 测试配置
├── package.json
│
├── docs/                       # 项目文档
│   ├── ARCHITECTURE.md         # 架构设计（本文件）
│   ├── DEVELOPMENT.md          # 开发者指南（新增翻译源/OCR 引擎）
│   ├── I18N_GUIDE.md           # 国际化指南（三层 i18n 体系）
│   ├── OCR_MODELS.md           # OCR 模型维护手册
│   ├── FAQ.md                  # 常见问题
│   ├── THEME_CUSTOMIZATION.md  # 主题定制
│   ├── T-ENGINE.md             # 引擎接入层维护手册
│   └── design/                 # 各功能的设计说明：代码只留指针，为什么与踩坑记在这里
│       ├── main-process.md     #   主进程平台层（窗口、托盘、崩溃守卫、路径、更新）
│       ├── selection.md        #   划词翻译（手势、三层探测、剪贴板、窗口几何）
│       ├── listen.md           #   听译与朗读（worker、VAD、TTS 门、包）
│       ├── ocr.md              #   本地 OCR（门面、宿主、PP-OCR 流水线、Windows OCR）
│       ├── model-packs.md      #   模型根目录、通用包管理器、搬迁
│       ├── ipc.md              #   IPC 层、预加载、共享表
│       ├── stack.md            #   翻译栈（服务层、缓存、翻译源、OCR 链、语音端点）
│       ├── renderer.md         #   渲染端（各窗口、store、文档翻译、AI 动作、设置页、配置表）
│       └── tooling.md          #   scripts/（门禁、构建发布、取包、冒烟与基准）
│
├── electron/                   # 主进程代码
│   ├── main.js                 # 主进程入口（只做生命周期与接线）
│   ├── state.js                # 全局状态 (store, runtime, windows)
│   ├── generated/              # esbuild 产物 translation-stack.cjs（gitignore，构建时生成）
│   ├── preloads/               # Preload 脚本 (每个窗口一个)
│   ├── shared/                 # 主/渲染进程共享常量与模型包目录
│   ├── ipc/                    # IPC 处理器 (按功能拆分，translation-stack.js 为栈 facade)
│   ├── windows/                # 窗口 / 菜单 / 托盘管理器
│   ├── selection/              # 划词翻译：controller（鼠标钩子、三层探测、图标/直达两条路）、手势状态机、剪贴板抓取
│   ├── screenshot/             # 截图 OCR：flow（截屏→框选→裁剪→交接）、screenshot-module（多屏截取与裁剪）
│   ├── listen/                 # 听译：audio-engine-manager（ASR 子进程会话）、listen-translator、自动保存、模型表、音频包、WASAPI 抓音
│   ├── tts/                    # 朗读：音色表与语音包
│   ├── ocr/                    # 本地 OCR：ocr-engine、Windows OCR、OCR 模型包
│   ├── llm/                    # 内置模型：llm-manager（文本槽 + 视觉槽）、模型包扫描
│   ├── packs/                  # 模型包公共层：model-pack-core（下载安装工厂）、model-root、旧目录迁移
│   ├── security/               # secure-vault / secure-audit / history-vault / privacy-gate / url-policy
│   ├── platform/               # 数据目录、日志、崩溃守卫、开机自启、右键打开、更新器、Win32 与多屏辅助
│   ├── policy/                 # engine-policy：内置模型健康 / 驻留策略的纯函数
│   ├── tengine/                # T-Engine：引擎适配层与 llama.cpp 运行时绑定（见 T-ENGINE.md）
│   └── services/               # 各引擎的 utilityProcess 宿主：audio-engine（audio-worker 分发 + asr-session / capture / tts / io）、ocr-host、llm-host
│
├── src/                        # 渲染进程代码
│   ├── main.jsx                # 应用入口
│   ├── App.jsx                 # 根组件
│   ├── i18n.js                 # 国际化初始化
│   │
│   ├── components/             # React 组件（PascalCase 目录）
│   │   ├── MainWindow/         # 主窗口布局
│   │   ├── TranslationPanel/   # 翻译面板 (含 hooks/ 和 styles/)
│   │   ├── SettingsPanel/      # 设置面板 (含 sections/ 和 styles/)
│   │   ├── HistoryPanel/       # 历史记录
│   │   ├── FavoritesPanel/     # 收藏功能
│   │   ├── FloatingWindow/    # 悬浮窗口
│   │   ├── SelectionTranslator/# 划词翻译
│   │   ├── DocumentTranslator/ # 文档翻译
│   │   ├── ProviderSettings/   # 翻译源设置
│   │   ├── TitleBar/           # 标题栏
│   │   └── ErrorBoundary/      # 错误边界
│   │
│   ├── stack/                  # 翻译+OCR 栈源码（ESM；esbuild 打包为主进程 CJS，运行时单实例）
│   │   ├── index.js            # createStack 入口（ctx 依赖注入：net.fetch/store/密钥）
│   │   ├── service.js          # 翻译服务（provider 路由/降级/两级缓存/免译过滤器/隐私门控单点）
│   │   ├── registry.js         # Provider 注册中心
│   │   ├── providers/          # 翻译源实现 + metadata.js（跨端共享的纯数据表）
│   │   └── ocr/                # 在线 OCR 四引擎 + LLM Vision + 本地引擎 local-bridge
│   │
│   ├── translation/            # 渲染端翻译层：stack-client（stack:* IPC 客户端）、main-translation（主窗口编排）、就绪判断 hook
│   ├── ai/                     # AI 动作：提示词模板、runner、store、use-ai-actions / use-segment-notes
│   ├── floating/               # 悬浮窗：pipeline（流水线）、display-mode、pane-layout
│   ├── document/               # 文档翻译：解析器、术语表 IO、术语一致性
│   ├── ocr/                    # 渲染端 OCR 辅助：密钥保险库、图片工具
│   ├── tts/                    # 朗读：引擎基类、系统语音、神经语音、外接端点、音色挑选
│   ├── listen/                 # 听译字幕文本处理
│   ├── core/                   # 跨窗口基础件：logger、错误分类、性能 hook、流式节流、系统通知、迁移包、隐私模块矩阵、引导与热键 hook
│   │
│   ├── stores/                 # Zustand 状态管理
│   │   ├── translation-store.js# 翻译状态
│   │   ├── config.js           # 配置状态
│   │   ├── session.js          # 会话状态
│   │   └── sync-to-electron.js # 主进程同步
│   │
│   ├── assets/
│   │   └── provider-icons/     # 翻译源 svg 图标（config/provider-icons.js 集中引入）
│   │
│   ├── config/                 # 前端配置
│   │   ├── constants.js        # 常量定义
│   │   ├── templates.js        # 翻译模板
│   │   ├── languages.js       # 语言目录（134 种）+ 拼音索引，渲染端与栈共用
│   │   ├── ocr-languages.js   # OCR 可识别语言（59 种）→ 模型包，与主进程那份互校
│   │   ├── custom-languages.js # 用户自定义语言的校验与合并
│   │   ├── model-language-coverage.js # 模型语言能力表（只影响降级链排序）
│   │   ├── provider-icons.js   # stack 共享表 + 图标合成的渲染端 provider 目录
│   │   └── filters.js          # 免译过滤器（stack 与渲染端共用的纯数据）
│   │
│   ├── i18n/                   # 语言包
│   │   └── locales/
│   │       ├── zh.js           # 中文
│   │       └── en.js           # English
│   │
│   ├── styles/                 # 全局样式
│   │   ├── index.css           # CSS Reset + 基础变量
│   │   └── App.css             # 全局共享样式
│   │
│   └── windows/                # 子窗口入口
│       ├── floating-window-entry.jsx     # 悬浮窗口入口
│       └── selection-entry.jsx # 划词翻译入口
│
├── public/                     # 静态资源 + HTML 入口
│   ├── index.html              # 主窗口
│   ├── selection.html          # 划词翻译
│   ├── floating-window.html              # 悬浮窗口
│   ├── child-pane.html         # 子面板
│   ├── screenshot.html         # 截图选区
│   ├── icon.png                # 应用图标
│   ├── icon.ico                # Windows 图标
│   └── tray-icon.ico           # 托盘图标
│
├── resources/                  # 应用资源
│   └── ocr/                    # 内置 OCR 基础模型（fetch-ocr-models 拉取，gitignore）
│
├── scripts/                    # 工具脚本（按用途分组）
│   ├── check/                  # 提交门禁：常量同步、语言表、i18n key、硬编码中文（含基线 json）
│   ├── build/                  # build-stack（esbuild 打包翻译栈）、两个模型 Release 资产生成、sherpa 运行时覆盖、wait-for-vite
│   ├── fetch/                  # 拉取内置 OCR 基础模型与 llama.cpp 运行时；OCR / 听译模型包来源表（换模型改这里）
│   ├── smoke/                  # 真 Electron / 真 worker 冒烟：listen、ocr、offline、llm 五件
│   ├── bench/                  # bench-listen（FLEURS 听译基准，npm run bench:listen）、verify-google-languages
│   ├── lib/                    # 冒烟与基准共用件：electron-smoke（沙箱 / 清单 / 运行器）、worker-driver、listen-sandbox
│   └── model-licenses/         # 模型协议原文（随包分发，见 NOTICE）
│
└── tests/                      # 测试
    ├── setup.js                # 测试环境配置
    ├── mocks/electron.js       # 主进程模块单测用 electron stub
    └── unit/                   # 单元测试，按主题分目录：tengine / listen / ocr / stack / main / renderer
```

## 架构分层

```
┌─────────────────────────────────────────────────────────────────┐
│                         View Layer                              │
│  components/* (React Components，三渲染窗口)                     │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                         Store Layer (Zustand)                   │
│  translation-store.js, config.js, session.js                    │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Renderer Service Layer                       │
│  stack-client.js（栈客户端）, main-translation.js, pipeline.js   │
└────────────────────────────────┬────────────────────────────────┘
                                 │ stack:* IPC
                                 │ （流式批帧 / 请求 id→abort / 隐私模式主进程注入）
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│              Main-Process Translation Stack（单实例）            │
│  electron/generated/translation-stack.cjs ←esbuild← src/stack/* │
│  service（路由/降级/两级缓存/过滤器/隐私门控单点）                │
│  registry → local-llm, ollama, openai, anthropic, deepl,        │
│             gemini, deepseek, google-translate, microsoft, baidu │
│  ocr/*（在线四引擎 + LLM Vision + 本地 local-bridge 直调）        │
│  网络出口统一 net.fetch（Chromium 栈，随系统代理）；              │
│  密钥解密仅在主进程（secure-vault + 审计）                        │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Electron Main Process                      │
│  main.js → ipc/*（translation-stack.js facade）→ 各功能目录     │
└─────────────────────────────────────────────────────────────────┘
```

三个渲染窗口（主窗/悬浮/划词）共享同一个主进程栈实例：缓存全局命中、
翻译源故障计数全局生效、设置保存一次生效；渲染进程不含任何翻译/在线
OCR 网络代码，离线与无痕语义由主进程按请求强制（结构性隐私保证）。

无痕模式的口径是「本次会话不留任何痕迹」，逐模块落点：历史 / 收藏统计 /
AI 结果不入库（store 侧 stash 回环）；L2 翻译缓存暂停落盘；文档翻译进度不写；
听译会话照常，但会话日志不写（会话中切入无痕即时停写，`log-close`）；
程序运行日志只留 error 一级（`logger.setSecureFileLogging`，渲染进程经
`logs:write` 进来的行同受限）；Windows OCR 因需把截图写成临时文件交给
PowerShell，无痕下不在允许引擎表里（`privacy-modes.js`）；迁移包导出关闭。
API 密钥解密照常（无痕不等于离线）。

离线模式的「不发任何网络请求」还包括局域网：翻译源的可用判断统一走
`service.providerGate`（允许表 + 已配置 + 离线时端点必须本机），翻译、AI 对话、
就绪探测、连接测试四处同一道门；本机判断是 `src/stack/loopback.js` 一份，
视觉模型与外接朗读也用它。

### 引擎层 T-Engine

原生运行时都不在主进程里，而是各自一个 utilityProcess，由 T-Engine 统一装载、监控、报告：

```
electron/tengine/registry.js          引擎表：宿主、运行时、能否上显卡与原因
electron/tengine/host-manager.js      宿主框架：按需拉起、请求配对、崩溃重生与退避、事件流
electron/tengine/engines/{ocr,audio,llm}.js  三个适配器：把各宿主的协议翻成 load / health / setProvider / status
electron/tengine/runtime/             llama.cpp 的 koffi 绑定、会话、视觉（mtmd）、worker 线程
electron/services/{ocr-host,audio-engine,llm-host}/  三个宿主进程本体
electron/ipc/tengine.js               tengine:status 快照、tengine:event 事件流
electron/ipc/gpu.js                   「显卡加速」开关：逐引擎自检，失败的留在 CPU
electron/policy/engine-policy.js      内置模型的策略表（停滞、性能下降、思考泄漏）
```

T-Engine 只报事实，不改产品行为；用哪个引擎、什么时候降档由主进程决定。全部细节与换版检查单见 [T-ENGINE.md](T-ENGINE.md)。

### 内置模型

`electron/llm/`：`llm-pack-manager.js` 扫描 `<models>/llm-models`，只认白名单（`electron/shared/llm-packs.js`：文件名 + 大小 + SHA256，哈希是安全边界）里的文件；`llm-manager.js` 决定载哪个文件、驻留与 5 分钟闲置卸载、显卡自检，并管视觉槽（PaddleOCR-VL，只在显卡加速打开时接活）。栈侧 `src/stack/providers/tengine.js` 是翻译源「内置模型」，`src/stack/ocr/tengine-vision.js` 与 `vision-routing.js` 是 OCR 引擎「内置视觉模型」及其分配规则。设计说明：T-ENGINE.md 第五、七、十节。

### 听译与朗读

`electron/listen/`（会话管理、逐句翻译、字幕自动保存、包定位与下载、WASAPI 捕获）、`electron/tts/`（语音包）、`electron/services/audio-engine/`（worker：捕获、VAD、两个识别引擎、语音合成、静音闸门）。音频在 worker 内进 VAD，不跨进程、不落盘；渲染端只收文字和电平数。VAD 调参、切分、内存与延迟口径、载卸时序、语音包与闸门的取舍全部在 [design/listen.md](design/listen.md)。

### 划词与截图

`electron/selection/`（鼠标钩子与手势状态机、三层探测、剪贴板抓取、文本清理）、`electron/screenshot/`（多显示器截取与裁剪）。每一层为什么这样探测、窗口几何为什么这样算，见 [design/selection.md](design/selection.md)。

### AI 动作

「总结 / 讲解」是数据不是代码：一个动作 = 一份提示词配置，内置的在 `src/config/ai-actions.js`，用户导入的过同一个闸门 `normalizeActionConfig`。`src/ai/ai-action-runner.js` 判触发、建提示、选路径（视觉模型直接读图为路径 B，失败降级到文本路径 A），`use-ai-actions.js` 供三个窗口复用。能力看实现不看元数据（`service.getChatCapability`），结果写历史的门与翻译同一道。设计说明：[design/renderer.md](design/renderer.md) 第 6 节。

### 平台层

`electron/platform/`：`app-paths.js` 在启动最早期定数据目录（安装目录 `data`，不可写则用户目录），`crash-guard.js` 崩溃自愈与安全模式，`open-with.js` + `installer/installer.nsh` 右键菜单，`login-item.js` 开机自启，`native-helper.js` Win32 探测。设计说明：[design/main-process.md](design/main-process.md)。


## 命名规范

| 类别 | 规范 | 示例 |
|------|------|------|
| 组件目录 | PascalCase | `TranslationPanel/`, `TitleBar/` |
| 翻译源目录 | kebab-case | `local-llm/`, `google-translate/` |
| JS/JSX 文件 | kebab-case | `translation-store.js`, `error-handler.js` |
| CSS 文件 | kebab-case | `styles.css`, `layout.css` |
| 常量 | UPPER_SNAKE_CASE | `MAX_FROZEN_WINDOWS` |

## 开发命令

```bash
npm start                # 启动开发环境（先打包栈，再 vite + electron）
npm run start:debug      # 同上 + 划词链路探针日志（TT_SELECTION_DEBUG=1）
npm run stack:build      # 单独打包翻译栈（esbuild → electron/generated/）
npm run build            # 构建生产版本
npm run dist             # 打包安装程序（产物在 release/，发布传三件套 exe+blockmap+latest.yml）
npm run lint             # ESLint 检查（全仓 0 error 是底线）
npm run format           # Prettier 格式化
npm test                 # 运行测试（vitest）
npm run check:all        # 常量同步 + 语言表 + i18n 键同步 + 硬编码中文 + 文档路径与链接
```
