# T-Translate 架构文档

## 项目概述

T-Translate 是一个基于 Electron + React + Vite 的离线翻译工具，支持：
- 划词翻译（最多 8 个冻结窗口）
- 截图 OCR 翻译
- 悬浮窗口实时翻译
- 文档翻译（PDF、DOCX、EPUB、TXT、SRT/VTT）
- 多种翻译源（本地 LLM、OpenAI、DeepL、Gemini 等）

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
│   └── THEME_CUSTOMIZATION.md  # 主题定制
│
├── electron/                   # 主进程代码
│   ├── main.js                 # 主进程入口
│   ├── state.js                # 全局状态 (store, runtime, windows)
│   ├── screenshot-module.js    # 截图核心逻辑
│   ├── generated/              # esbuild 产物 translation-stack.cjs（gitignore，构建时生成）
│   ├── preloads/               # Preload 脚本 (每个窗口一个)
│   ├── shared/                 # 主/渲染进程共享常量
│   ├── ipc/                    # IPC 处理器 (按功能拆分，translation-stack.js 为栈 facade，history-vault.js 为历史加密库)
│   ├── managers/               # 窗口/托盘/菜单管理器
│   └── utils/                  # 工具函数（secure-vault/secure-audit/history-vault/ocr-engine 等）
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
│   ├── services/               # 渲染端服务层
│   │   ├── stack-client.js     # 主进程栈的渲染端客户端（stack:* IPC，同名 API）
│   │   ├── main-translation.js # 主窗口翻译编排
│   │   ├── pipeline.js         # 悬浮窗口流水线
│   │   └── tts/                # TTS 语音 (base, index, web-speech)
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
│   │   ├── defaults.js         # 默认值
│   │   ├── templates.js        # 翻译模板
│   │   ├── privacy-modes.js    # 隐私模式
│   │   ├── languages.js       # 语言目录（134 种）+ 拼音索引，渲染端与栈共用
│   │   ├── ocr-languages.js   # OCR 可识别语言（56 种）→ 模型包，与主进程那份互校
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
│   ├── hooks/                  # 共享 hooks（use-visible-hotkey 等）
│   ├── utils/                  # 工具函数
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
├── scripts/                    # 工具脚本
│   ├── build-stack.js          # esbuild 打包翻译栈（dev/build 自动执行）
│   ├── fetch-ocr-models.js     # 拉取内置 OCR 基础模型
│   ├── build-ocr-release.js    # 生成 ocr-models Release 资产（发模型用）
│   ├── check-constants.js      # 常量同步检查
│   ├── check-i18n.js           # i18n key 一致性检查
│   └── check-hardcoded-chinese.js  # 硬编码中文扫描
│
└── tests/                      # 测试
    ├── setup.js                # 测试环境配置
    ├── mocks/electron.js       # 主进程模块单测用 electron stub
    └── unit/                   # 单元测试
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
│  main.js → ipc/*（translation-stack.js facade）→ managers/*     │
└─────────────────────────────────────────────────────────────────┘
```

三个渲染窗口（主窗/悬浮/划词）共享同一个主进程栈实例：缓存全局命中、
翻译源故障计数全局生效、设置保存一次生效；渲染进程不含任何翻译/在线
OCR 网络代码，离线与无痕语义由主进程按请求强制（结构性隐私保证）。

### AI 动作框架（v0.3.3）

「总结 / 理解」这类动作**是数据不是代码**：一个动作 = 一份提示词配置。加动作
不用改逻辑，只加一条配置；用户导入的第三方配置走同一条路径。

```
config/ai-actions.js        动作目录：内置两条（summarize / explain）+ 字段契约
                            + normalizeActionConfig（导入唯一闸门）
services/ai-action-runner   纯逻辑：文本量度 / 触发判定 / 模板渲染 / 路径选择
                            + runAiAction（唯一出口，调 stack-client）
services/ai-action-store    导入配置的读取缓存，每次读都重新过一遍闸门
hooks/use-ai-actions        三个窗口共用：能力探测、可用动作、结果折叠展开
```

三条容易被违反的约束：

1. **能力看实现不看元数据**。`metadata.supportsChat` 只供 UI 显示；运行时一律走
   `service.getChatCapability()`（与 `chatCompletion` 同一个 provider 循环），AI
   路径带 `requireChat`——否则只会翻译的源会把提示词翻译一遍还回来，看着像功能
   正常。`tests/unit/provider-chat.test.js` 拿真实类核对那一列，防止漂移
2. **两条路径，失败降级**。有视觉模型且手里有截图 → 路径 B（模型直接读图）；否则
   路径 A（文本）。路径 B 失败且有识别文本时自动回落 A——用户不该为模型看不见图
   买单
3. **隐私跟随翻译**。LLM 调用的门在主进程 facade（同 translate）；结果写历史的门
   在 `translation-store.attachAiResult`（同 addToHistory，无痕不写）；理解模式的
   结果作为独立主条目走 addToHistory（kind `'understand'`，同一道无痕门，动作声明
   `history:'none'` 则不写）；路径 B 在离线模式下还要求视觉端点必须在本机

### 稳定性与系统集成（v0.3.7）

```
electron/utils/crash-guard.js   崩溃自愈：渲染进程异常退出限次自动重载（3 分钟
                                窗口内 3 次；clean-exit/killed 不触发）+ 启动哨兵
                                （连续 3 次未撑过 60s 稳定窗口 → 安全模式：禁硬件
                                加速、跳过原生模块预热）。依赖注入、零 electron
                                require，直接可测
src/utils/migration-pack.js     迁移包 build/parse 纯函数。导出读 electron-store
                                存储态（设置页内存态含解密后的 OCR 密钥，绝不可
                                导）；两端都过 stripSecrets + 结构白名单
electron/utils/open-with.js     右键菜单 argv 解析（.pdf/.docx/.txt 白名单）。
                                冷启动走 process.argv，热启动走 second-instance
                                转发；路径只在主进程暂存，渲染端单一 invoke 取
                                文件内容——无任意路径读取面。注册表项由
                                installer/installer.nsh 安装写入、卸载对称清除
```

### 听译引擎与驻留口径（v0.4.0）

```
electron/managers/audio-engine-manager.js  ASR utilityProcess 的唯一持有者
electron/services/audio-engine/audio-worker.js  两个模型都住在这个子进程里
electron/utils/model-root.js               模型根目录解析（安装目录优先）
electron/utils/audio-pack-manager.js       模型包下载/卸载（工厂第二实例）
```

**载卸时序**：模型只在会话内驻留，不做常驻缓存。

| 时刻 | 发生什么 |
|------|----------|
| 点开始 | fork 子进程 → `init` 声明模型路径 → `asr-start` 才真正加载 |
| 会话中 | 定稿引擎 SenseVoice + 可选草稿引擎 zipformer 同时在内存 |
| 点停止 | `asr-stop` 冲刷 → 主进程发 `unload`（丢引擎引用、放开模型文件）→ `shutdown` → 进程退出 |
| 关窗/切 SECURE | 同上，`once('closed')` 与隐私监听各自兜底 |
| 换包 | `stopSessionAndWait` 等进程真正退出才动目录——Windows 上文件句柄没放开，换包会在 150MB 下载的最后一步失败 |

**内存口径**（2026-08-27 实测，双模型 3 分钟 soak）：会话中子进程 RSS 665–676MB
且平稳；会话结束进程退出，回到 0。只装基座包约省一半。主进程侧的 OCR 会话是另一
套缓存（LRU 2 个，换包/换档位时清），与听译互不影响。

**延迟口径**（`npm run smoke:listen` 实测，两次跑差 <20ms）：

| 指标 | 装草稿引擎 | 只装基座包 |
|------|-----------|-----------|
| 引擎加载 | 2.2 s | 1.2–1.4 s |
| 首字（草稿出第一个字） | 0.56–0.57 s | 0.80–0.83 s |
| 草稿刷新间隔 | 0.31 s | 1.03 s（伪流式节流值） |
| 定稿（说完到出定稿） | 0.37 s | 0.37 s |
| 解码 RTF | 0.033–0.044 | 同 |

口径说明：计时从 `feedPcm` 到事件送达，**不含采集与渲染**——渲染端
`createScriptProcessor(4096)` 在 48kHz 下再压 ~85ms，加 IPC 与绘制，用户眼里约
再多 0.1s。定稿延迟的主要成分是 VAD 尾静音（`minSilence` 0.35s）而不是算力，
所以调它才是调定稿快慢。样本是合成语音，真实带 BGM 的场景 VAD 闭合更晚。

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
npm run check:all        # 常量同步 + i18n 键同步 + 硬编码中文，三连
```
