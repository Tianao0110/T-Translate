# T-Translate 架构文档

## 项目概述

T-Translate 是一个基于 Electron + React + Vite 的离线翻译工具，支持：
- 划词翻译（最多 8 个冻结窗口）
- 截图 OCR 翻译
- 玻璃窗口实时翻译
- 字幕采集翻译
- 多种翻译源（本地 LLM、OpenAI、DeepL、Gemini 等）

## 目录结构

```
t-translate/
├── electron/                   # 主进程代码
│   ├── main.js                 # 主进程入口
│   ├── state.js                # 状态管理 (store, runtime, windows)
│   ├── screenshot-module.js    # 截图核心逻辑
│   │
│   ├── preloads/               # Preload 脚本
│   │   ├── main.js             # 主窗口 preload
│   │   ├── selection.js        # 划词翻译 preload
│   │   ├── glass.js            # 玻璃窗口 preload
│   │   └── subtitle-capture.js # 字幕采集 preload
│   │
│   ├── shared/                 # 主/渲染进程共享
│   │   ├── paths.js            # 路径配置中心
│   │   ├── channels.js         # IPC 通道定义
│   │   └── constants.js        # 常量定义
│   │
│   ├── ipc/                    # IPC 处理器
│   │   ├── index.js            # IPC 初始化入口
│   │   ├── system.js           # 系统级 IPC
│   │   ├── store.js            # 存储 IPC
│   │   ├── shortcuts.js        # 快捷键管理
│   │   ├── screenshot.js       # 截图功能
│   │   ├── clipboard.js        # 剪贴板操作
│   │   ├── glass.js            # 玻璃窗口 IPC
│   │   ├── subtitle.js         # 字幕采集 IPC
│   │   ├── selection.js        # 划词翻译 IPC
│   │   ├── secure-storage.js   # 安全存储
│   │   ├── ocr.js              # OCR 引擎管理
│   │   └── privacy.js          # 隐私模式
│   │
│   ├── managers/               # 管理器
│   │   ├── window-manager.js   # 窗口管理
│   │   ├── tray-manager.js     # 托盘管理
│   │   └── menu-manager.js     # 菜单管理
│   │
│   └── utils/                  # 工具函数
│       ├── logger.js           # 日志系统
│       ├── native-helper.js    # Windows API 调用
│       └── selection-state-machine.js # 划词状态机
│
├── src/                        # 渲染进程代码
│   ├── main.jsx                # 主窗口入口
│   ├── App.jsx                 # 主应用组件
│   │
│   ├── components/             # React 组件
│   │   ├── MainWindow/         # 主窗口布局
│   │   ├── TranslationPanel/   # 翻译面板
│   │   ├── SettingsPanel/      # 设置面板
│   │   ├── HistoryPanel/       # 历史记录
│   │   ├── FavoritesPanel/     # 收藏功能
│   │   ├── GlassTranslator/    # 玻璃窗口组件
│   │   ├── SelectionTranslator/# 划词翻译组件
│   │   ├── DocumentTranslator/ # 文档翻译
│   │   ├── ProviderSettings/   # 翻译源设置
│   │   └── TitleBar/           # 标题栏
│   │
│   ├── providers/              # 翻译源 Provider
│   │   ├── base.js             # BaseProvider 基类
│   │   ├── registry.js         # Provider 注册中心
│   │   ├── local-llm/          # 本地 LLM
│   │   ├── openai/             # OpenAI API
│   │   ├── deepl/              # DeepL
│   │   ├── gemini/             # Gemini
│   │   ├── deepseek/           # DeepSeek
│   │   ├── google-translate/   # Google 翻译
│   │   └── ocr/                # OCR 引擎
│   │
│   ├── services/               # 服务层
│   │   ├── translation.js      # 翻译服务（门面）
│   │   ├── main-translation.js # 主窗口翻译服务
│   │   ├── pipeline.js         # 玻璃窗口流水线
│   │   └── cache.js            # 翻译缓存
│   │
│   ├── stores/                 # Zustand 状态管理
│   │   ├── translation-store.js# 翻译状态
│   │   ├── config.js           # 配置状态
│   │   └── session.js          # 会话状态
│   │
│   ├── config/                 # 前端配置
│   │   ├── constants.js        # 常量定义
│   │   ├── defaults.js         # 默认值
│   │   ├── templates.js        # 翻译模板
│   │   ├── privacy-modes.js    # 隐私模式配置
│   │   └── filters.js          # 免译过滤器
│   │
│   ├── utils/                  # 工具函数
│   ├── styles/                 # 全局样式
│   ├── windows/                # 子窗口入口
│   └── workers/                # Web Workers
│
├── public/                     # 静态资源 + HTML 入口
│   ├── index.html              # 主窗口
│   ├── selection.html          # 划词翻译
│   ├── glass.html              # 玻璃窗口
│   ├── subtitle-capture.html   # 字幕采集
│   ├── screenshot.html         # 截图选区
│   └── *.png, *.ico            # 图标资源
│
├── resources/                  # 应用资源
│   └── ocr/                    # OCR 训练数据
│
├── scripts/                    # 构建/工具脚本
│   └── check-constants.js      # 常量同步检查
│
└── build/                      # Vite 构建输出
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

## 窗口类型

| 窗口 | HTML | Preload | 安全模式 |
|------|------|---------|---------|
| 主窗口 | index.html | main.js | contextIsolation: true |
| 划词翻译 | selection.html | selection.js | contextIsolation: true |
| 玻璃窗口 | glass.html | glass.js | contextIsolation: true |
| 字幕采集 | subtitle-capture.html | subtitle-capture.js | contextIsolation: true |
| 截图选区 | screenshot.html | (无) | nodeIntegration: true |

## 路径配置

所有文件路径通过 `electron/shared/paths.js` 统一管理：

```javascript
const PATHS = require('./shared/paths');

// Preload 脚本
PATHS.preloads.main
PATHS.preloads.selection
PATHS.preloads.glass
PATHS.preloads.subtitleCapture

// HTML 页面
PATHS.pages.main.url    // 开发环境 URL
PATHS.pages.main.file   // 生产环境文件路径

// 资源文件
PATHS.resources.icon
PATHS.resources.ocrData
```

## 常量同步

主进程和渲染进程各有一份常量定义：
- `electron/shared/constants.js` (CommonJS，单一数据源)
- `src/config/constants.js` (ESM，同步副本)

运行 `npm run check:constants` 验证同步状态。

## 开发命令

```bash
npm start           # 启动开发环境
npm run build       # 构建生产版本
npm run dist        # 打包安装程序
npm run check:constants  # 检查常量同步
```
