# 文件结构优化计划

**创建日期**: 2025-01-14  
**完成日期**: 2025-01-17  
**当前版本**: v0.1.3  
**状态**: ✅ **Phase 1-6 已全部完成**

---

## 📊 执行摘要

### ✅ 已完成的重构

| 阶段 | 内容 | 状态 |
|------|------|------|
| Phase 1 | Preload 文件整理到 `electron/preloads/` | ✅ 完成 |
| Phase 2 | HTML 文件统一到 `public/` | ✅ 完成 |
| Phase 3 | OCR 资源移动到 `resources/ocr/` | ✅ 完成 |
| Phase 4 | 配置常量同步机制 | ✅ 完成 |
| Phase 5 | 路径引用集中配置 | ✅ 完成 |
| Phase 6 | 清理与文档 | ✅ 完成 |

---

## 📁 重构后的目录结构

```
t-translate/
├── electron/                   # 主进程代码
│   ├── main.js                 # 主进程入口
│   ├── state.js                # 状态管理 (store, runtime, windows)
│   ├── screenshot-module.js    # 截图核心逻辑
│   │
│   ├── preloads/               # ✅ Preload 脚本 (重构后)
│   │   ├── main.js             # 原 preload.js
│   │   ├── selection.js        # 原 preload-selection.js
│   │   ├── glass.js            # 原 preload-glass.js
│   │   └── subtitle-capture.js # 原 preload-subtitle-capture.js
│   │
│   ├── shared/                 # 主/渲染进程共享
│   │   ├── paths.js            # ✅ 路径配置中心 (新建)
│   │   ├── channels.js         # IPC 通道定义
│   │   ├── constants.js        # 常量定义 (单一数据源)
│   │   └── index.js
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
│   │   ├── window-manager.js   # 窗口管理 (已更新使用 PATHS)
│   │   ├── tray-manager.js     # 托盘管理 (已更新使用 PATHS)
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
│   │   ├── DocumentTranslator/ # 文档翻译
│   │   ├── FavoritesPanel/     # 收藏功能
│   │   ├── GlassTranslator/    # 玻璃窗口组件
│   │   ├── HistoryPanel/       # 历史记录
│   │   ├── MainWindow/         # 主窗口布局
│   │   ├── ProviderSettings/   # 翻译源设置
│   │   ├── SelectionTranslator/# 划词翻译组件
│   │   ├── SettingsPanel/      # 设置面板
│   │   ├── TitleBar/           # 标题栏
│   │   └── TranslationPanel/   # 翻译面板
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
│   │   ├── constants.js        # 常量定义 (同步副本)
│   │   ├── defaults.js         # 默认值
│   │   ├── templates.js        # 翻译模板
│   │   ├── privacy-modes.js    # 隐私模式配置
│   │   └── filters.js          # 免译过滤器
│   │
│   ├── utils/                  # 工具函数
│   ├── styles/                 # 全局样式
│   ├── windows/                # 子窗口入口
│   │   ├── glass-entry.jsx
│   │   └── selection-entry.jsx
│   └── workers/                # Web Workers
│
├── public/                     # ✅ HTML 入口 + 静态资源 (重构后)
│   ├── index.html              # 主窗口 (原根目录)
│   ├── selection.html          # 划词翻译 (原根目录)
│   ├── glass.html              # 玻璃窗口 (原 src/windows/)
│   ├── subtitle-capture.html   # 字幕采集 (原 src/windows/)
│   ├── screenshot.html         # 截图选区 (原 electron/)
│   ├── icon.png                # 应用图标
│   └── *.ico                   # 图标文件
│
├── resources/                  # ✅ 应用资源 (重构后)
│   └── ocr/
│       ├── chi_sim.traineddata # 原根目录
│       └── eng.traineddata     # 原根目录
│
├── scripts/                    # ✅ 工具脚本 (新建)
│   └── check-constants.js      # 常量同步检查
│
├── docs/                       # 文档
│   ├── ARCHITECTURE.md         # 架构文档
│   ├── REFACTOR_PLAN.md        # 重构计划
│   └── ...
│
└── build/                      # Vite 构建输出
```

---

## 📋 详细变更记录

### Phase 1: Preload 文件整理

**移动的文件**:
| 原路径 | 新路径 |
|--------|--------|
| `electron/preload.js` | `electron/preloads/main.js` |
| `electron/preload-selection.js` | `electron/preloads/selection.js` |
| `electron/preload-glass.js` | `electron/preloads/glass.js` |
| `electron/preload-subtitle-capture.js` | `electron/preloads/subtitle-capture.js` |

**修改的文件**:
- `electron/managers/window-manager.js` (4 处 preload 路径)

---

### Phase 2: HTML 文件统一

**移动的文件**:
| 原路径 | 新路径 |
|--------|--------|
| `index.html` | `public/index.html` |
| `selection.html` | `public/selection.html` |
| `src/windows/glass.html` | `public/glass.html` |
| `src/windows/subtitle-capture.html` | `public/subtitle-capture.html` |
| `electron/screenshot.html` | `public/screenshot.html` |

**修改的文件**:
- `vite.config.js` (rollupOptions.input)
- `electron/managers/window-manager.js` (5 处 HTML 路径)
- `electron/ipc/screenshot.js` (1 处 HTML 路径)

---

### Phase 3: 资源文件整理

**移动的文件**:
| 原路径 | 新路径 |
|--------|--------|
| `chi_sim.traineddata` | `resources/ocr/chi_sim.traineddata` |
| `eng.traineddata` | `resources/ocr/eng.traineddata` |

**修改的文件**:
- `package.json` (extraResources 配置)

---

### Phase 4: 配置常量同步机制

**新建文件**:
- `scripts/check-constants.js` - 常量同步检查脚本

**修改的文件**:
- `electron/shared/constants.js` - 添加同步标记
- `src/config/constants.js` - 添加同步标记
- `package.json` - 添加 `npm run check:constants` 命令

---

### Phase 5: 路径引用集中配置

**新建文件**:
- `electron/shared/paths.js` - 路径配置中心

**修改的文件**:
- `electron/managers/window-manager.js` - 使用 PATHS 配置
- `electron/managers/tray-manager.js` - 使用 PATHS 配置
- `electron/ipc/screenshot.js` - 使用 PATHS 配置

---

### Phase 6: 清理与文档

**删除的目录**:
- `src/entries/` (空目录)

**新建的文档**:
- `docs/ARCHITECTURE.md` - 架构文档
- `docs/REFACTOR_PLAN.md` - 重构计划

---

## 🔧 路径配置中心

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

---

## 📊 后续优化建议

### 待办项（未执行）

| 优化项 | 优先级 | 工作量 | 状态 |
|--------|:------:|:------:|:----:|
| 拆分 SettingsPanel (2,198行) | 🔴 高 | 2-3小时 | 待定 |
| 统一组件目录结构 | 🟡 中 | 1-2小时 | 待定 |
| screenshot.html 安全改造 | 🟡 中 | 1小时 | 待定 |
| 常量完全统一 (ESM) | 🟢 低 | 2小时 | 待定 |
| TypeScript 支持 | 🟢 低 | 8小时+ | 待定 |

---

## ✅ 验证命令

```bash
# 检查常量同步
npm run check:constants

# 开发环境启动
npm install
npm start

# 生产构建
npm run build
npm run dist
```

---

**文档更新日期**: 2025-01-17
