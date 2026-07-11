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
│   ├── ipc/                    # IPC 处理器 (按功能拆分，translation-stack.js 为栈 facade)
│   ├── managers/               # 窗口/托盘/菜单管理器
│   └── utils/                  # 工具函数（secure-vault/secure-audit/ocr-engine 等）
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
