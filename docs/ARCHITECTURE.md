# T-Translate 架构文档

## 项目概述

T-Translate 是一个基于 Electron + React + Vite 的离线翻译工具，支持：
- 划词翻译（最多 8 个冻结窗口）
- 截图 OCR 翻译
- 玻璃窗口实时翻译
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
│   ├── DEVELOPMENT.md          # 开发者指南
│   ├── FEATURES.md             # 功能特性
│   ├── I18N_GUIDE.md           # 国际化指南
│   ├── SELECTION_TRANSLATOR_TECH.md  # 划词翻译原理
│   ├── THEME_CUSTOMIZATION.md  # 主题定制
│   └── TTS_DEVELOPMENT.md      # TTS 开发指南
│
├── electron/                   # 主进程代码
│   ├── main.js                 # 主进程入口
│   ├── state.js                # 全局状态 (store, runtime, windows)
│   ├── screenshot-module.js    # 截图核心逻辑
│   ├── preloads/               # Preload 脚本 (每个窗口一个)
│   ├── shared/                 # 主/渲染进程共享常量
│   ├── ipc/                    # IPC 处理器 (按功能拆分)
│   ├── managers/               # 窗口/托盘/菜单管理器
│   └── utils/                  # 工具函数
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
│   │   ├── GlassTranslator/    # 玻璃窗口
│   │   ├── SelectionTranslator/# 划词翻译
│   │   ├── DocumentTranslator/ # 文档翻译
│   │   ├── ProviderSettings/   # 翻译源设置
│   │   ├── TitleBar/           # 标题栏
│   │   └── ErrorBoundary/      # 错误边界
│   │
│   ├── providers/              # 翻译源 Provider（kebab-case 目录）
│   │   ├── base.js             # BaseProvider 基类
│   │   ├── registry.js         # Provider 注册中心
│   │   ├── local-llm/          # 本地 LLM
│   │   ├── openai/             # OpenAI API
│   │   ├── deepl/              # DeepL
│   │   ├── gemini/             # Gemini
│   │   ├── deepseek/           # DeepSeek
│   │   ├── google-translate/   # Google 翻译
│   │   └── ocr/                # OCR 引擎 (base, rapid, llm-vision 等)
│   │
│   ├── services/               # 服务层
│   │   ├── index.js            # 统一入口
│   │   ├── translation.js      # 翻译服务（门面）
│   │   ├── main-translation.js # 主窗口翻译
│   │   ├── pipeline.js         # 玻璃窗口流水线
│   │   ├── cache.js            # 翻译缓存
│   │   └── tts/                # TTS 语音 (base, index, web-speech)
│   │
│   ├── stores/                 # Zustand 状态管理
│   │   ├── translation-store.js# 翻译状态
│   │   ├── config.js           # 配置状态
│   │   ├── session.js          # 会话状态
│   │   └── sync-to-electron.js # 主进程同步
│   │
│   ├── config/                 # 前端配置
│   │   ├── constants.js        # 常量定义
│   │   ├── defaults.js         # 默认值
│   │   ├── templates.js        # 翻译模板
│   │   ├── privacy-modes.js    # 隐私模式
│   │   └── filters.js          # 免译过滤器
│   │
│   ├── i18n/                   # 语言包
│   │   └── locales/
│   │       ├── zh.js           # 中文
│   │       └── en.js           # English
│   │
│   ├── utils/                  # 工具函数
│   ├── styles/                 # 全局样式
│   │   ├── index.css           # CSS Reset + 基础变量
│   │   └── App.css             # 全局共享样式
│   │
│   ├── windows/                # 子窗口入口
│   │   ├── glass-entry.jsx     # 玻璃窗口入口
│   │   └── selection-entry.jsx # 划词翻译入口
│   │
│   └── workers/                # Web Workers
│
├── public/                     # 静态资源 + HTML 入口
│   ├── index.html              # 主窗口
│   ├── selection.html          # 划词翻译
│   ├── glass.html              # 玻璃窗口
│   ├── child-pane.html         # 子面板
│   ├── screenshot.html         # 截图选区
│   ├── icon.png                # 应用图标
│   ├── icon.ico                # Windows 图标
│   └── tray-icon.ico           # 托盘图标
│
├── resources/                  # 应用资源
│   └── ocr/                    # OCR 训练数据
│
├── scripts/                    # 工具脚本
│   └── check-constants.js      # 常量同步检查
│
└── tests/                      # 测试
    ├── setup.js                # 测试环境配置
    └── unit/                   # 单元测试
```

## 架构分层

```
┌─────────────────────────────────────────────────────────────────┐
│                         View Layer                              │
│  components/* (React Components)                                │
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
│                       Service Layer                             │
│  translation.js, main-translation.js, pipeline.js, cache.js     │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Provider Layer                             │
│  registry.js → local-llm, openai, deepl, gemini, ocr/*          │
└────────────────────────────────┬────────────────────────────────┘
                                 │ IPC
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Electron Main Process                      │
│  main.js → ipc/* → managers/*                                   │
└─────────────────────────────────────────────────────────────────┘
```

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
npm start               # 启动开发环境
npm run build            # 构建生产版本
npm run dist             # 打包安装程序
npm run lint             # ESLint 检查
npm run format           # Prettier 格式化
npm test                 # 运行测试
npm run check:constants  # 检查常量同步
```
