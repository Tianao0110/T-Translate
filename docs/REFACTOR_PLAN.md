# T-Translate 重构迁移计划

> 生成时间: 2026-01-17
> 基于: 阶段 1-4 深度代码分析
> **状态: ✅ 全部完成 (2026-01-17)**

---

## 执行摘要

### 已完成的迁移

| 阶段 | 内容 | 状态 |
|------|------|------|
| Phase 1 | Preload 文件整理到 `electron/preloads/` | ✅ 完成 |
| Phase 2 | HTML 文件统一到 `public/` | ✅ 完成 |
| Phase 3 | OCR 资源移动到 `resources/ocr/` | ✅ 完成 |
| Phase 4 | 配置常量同步机制 | ✅ 完成 |
| Phase 5 | 路径引用集中配置 | ✅ 完成 |
| Phase 6 | 清理与文档 | ✅ 完成 |

### 新目录结构

```
t-translate/
├── public/                     # HTML 入口 + 静态资源
│   ├── index.html              # 主窗口
│   ├── selection.html          # 划词翻译
│   ├── glass.html              # 玻璃窗口
│   ├── subtitle-capture.html   # 字幕采集
│   ├── screenshot.html         # 截图选区
│   └── icon.png, *.ico         # 图标
│
├── resources/                  # 应用资源
│   └── ocr/
│       ├── chi_sim.traineddata
│       └── eng.traineddata
│
├── electron/
│   ├── preloads/               # Preload 脚本 (新建)
│   │   ├── main.js
│   │   ├── selection.js
│   │   ├── glass.js
│   │   └── subtitle-capture.js
│   │
│   └── shared/
│       ├── paths.js            # 路径配置中心 (新建)
│       ├── channels.js
│       └── constants.js
│
├── scripts/
│   └── check-constants.js      # 常量同步检查 (新建)
│
└── src/                        # 渲染进程代码 (无变化)
```

---

## 一、当前问题汇总

### 1.1 文件位置混乱

| 问题 | 当前位置 | 理想位置 |
|------|---------|---------|
| HTML 入口散落多处 | 根目录、src/windows/、electron/ | 统一到 public/ |
| Preload 文件无组织 | electron/*.js | electron/preloads/ |
| OCR 训练数据在根目录 | *.traineddata | resources/ocr/ |
| 截图 HTML 在主进程目录 | electron/screenshot.html | public/ |

### 1.2 配置重复

| 文件 | 位置 | 内容 |
|------|------|------|
| constants.js | electron/shared/ | CommonJS 格式常量 |
| constants.js | src/config/ | ESM 格式常量（部分重复）|
| defaults.js | src/config/ | 重导出 + 便捷对象 |

### 1.3 硬编码路径

**window-manager.js 中的硬编码**:
```javascript
// 行 63: preload 路径
preload: path.join(__dirname, '../preload.js')

// 行 79-84: 主窗口 HTML
mainWindow.loadFile(path.join(__dirname, '../../build/index.html'))
mainWindow.loadURL('http://localhost:5173')

// 行 165: 玻璃窗口 preload
preload: path.join(__dirname, '../preload-glass.js')

// 行 177-180: 玻璃窗口 HTML  
loadFile: ../../build/src/windows/glass.html
loadURL: http://localhost:5173/src/windows/glass.html

// 行 266: 字幕采集 preload
preload: path.join(__dirname, '../preload-subtitle-capture.js')

// 行 278-281: 字幕采集 HTML
loadFile: ../../build/src/windows/subtitle-capture.html
loadURL: http://localhost:5173/src/windows/subtitle-capture.html

// 行 369: 划词翻译 preload
preload: path.join(__dirname, '../preload-selection.js')

// 行 384-387: 划词翻译 HTML
loadFile: ../../build/selection.html
loadURL: http://localhost:5173/selection.html

// 行 516: 截图窗口 HTML
loadFile: path.join(__dirname, '../screenshot.html')
```

**ipc/screenshot.js 中的硬编码**:
```javascript
// 行 275
loadFile: path.join(__dirname, '../screenshot.html')
```

---

## 二、目标目录结构

```
t-translate/
├── package.json
├── vite.config.js
├── electron-builder.json
│
├── public/                          # 静态资源 + HTML 入口
│   ├── index.html                   # 主窗口 (从根目录迁移)
│   ├── selection.html               # 划词翻译 (从根目录迁移)
│   ├── glass.html                   # 玻璃窗口 (从 src/windows/ 迁移)
│   ├── subtitle-capture.html        # 字幕采集 (从 src/windows/ 迁移)
│   ├── screenshot.html              # 截图选区 (从 electron/ 迁移)
│   ├── icon.png
│   ├── favicon.ico
│   └── ...
│
├── resources/                       # 应用资源
│   └── ocr/
│       ├── chi_sim.traineddata      # (从根目录迁移)
│       └── eng.traineddata          # (从根目录迁移)
│
├── electron/                        # 主进程代码
│   ├── main.js
│   ├── state.js
│   ├── screenshot-module.js
│   │
│   ├── preloads/                    # Preload 脚本 (新建目录)
│   │   ├── main.js                  # (从 preload.js 迁移)
│   │   ├── selection.js             # (从 preload-selection.js 迁移)
│   │   ├── glass.js                 # (从 preload-glass.js 迁移)
│   │   └── subtitle-capture.js      # (从 preload-subtitle-capture.js 迁移)
│   │
│   ├── shared/                      # 主进程/渲染进程共享
│   │   ├── channels.js              # IPC 通道名
│   │   ├── constants.js             # 共享常量 (单一数据源)
│   │   └── index.js
│   │
│   ├── ipc/                         # IPC 处理器 (保持不变)
│   │   └── ...
│   │
│   ├── managers/                    # 管理器 (保持不变)
│   │   └── ...
│   │
│   └── utils/                       # 工具函数 (保持不变)
│       └── ...
│
├── src/                             # 渲染进程代码 (保持不变)
│   ├── App.jsx
│   ├── main.jsx
│   ├── components/
│   ├── config/
│   │   └── constants.js             # 改为从 electron/shared 导入
│   ├── providers/
│   ├── services/
│   ├── stores/
│   ├── styles/
│   ├── utils/
│   ├── windows/
│   │   ├── glass-entry.jsx          # 保留入口 JSX
│   │   └── selection-entry.jsx      # 保留入口 JSX
│   └── workers/
│
└── build/                           # Vite 构建输出
    └── ...
```

---

## 三、迁移阶段规划

### Phase 1: Preload 文件整理 (低风险)

**目标**: 将 4 个 preload 文件移动到 `electron/preloads/` 目录

**步骤**:
1. 创建 `electron/preloads/` 目录
2. 移动文件:
   - `electron/preload.js` → `electron/preloads/main.js`
   - `electron/preload-selection.js` → `electron/preloads/selection.js`
   - `electron/preload-glass.js` → `electron/preloads/glass.js`
   - `electron/preload-subtitle-capture.js` → `electron/preloads/subtitle-capture.js`
3. 更新 `electron/managers/window-manager.js` 中的路径引用

**影响范围**:
- `electron/managers/window-manager.js` (4 处修改)

**验证方法**:
```bash
npm start
# 测试: 主窗口、划词翻译、玻璃窗口、字幕采集 是否正常加载
```

**预计时间**: 10 分钟

---

### Phase 2: HTML 文件统一 (中风险)

**目标**: 将所有 HTML 入口文件移动到 `public/` 目录

**步骤**:

#### 2.1 迁移 HTML 文件
```
index.html (根目录) → public/index.html
selection.html (根目录) → public/selection.html
src/windows/glass.html → public/glass.html
src/windows/subtitle-capture.html → public/subtitle-capture.html
electron/screenshot.html → public/screenshot.html
```

#### 2.2 更新 vite.config.js
```javascript
// 修改 rollupOptions.input
input: {
  main: path.resolve(__dirname, 'public/index.html'),
  selection: path.resolve(__dirname, 'public/selection.html'),
  glass: path.resolve(__dirname, 'public/glass.html'),
  // subtitle-capture 和 screenshot 不需要 Vite 构建
}
```

#### 2.3 更新 window-manager.js
```javascript
// 开发环境 URL (Vite 自动处理 public/ 下的文件)
mainWindow.loadURL('http://localhost:5173/index.html');
glassWindow.loadURL('http://localhost:5173/glass.html');
selectionWindow.loadURL('http://localhost:5173/selection.html');
subtitleWindow.loadURL('http://localhost:5173/subtitle-capture.html');

// 生产环境路径
mainWindow.loadFile(path.join(__dirname, '../../build/index.html'));
glassWindow.loadFile(path.join(__dirname, '../../build/glass.html'));
selectionWindow.loadFile(path.join(__dirname, '../../build/selection.html'));
// subtitle-capture 和 screenshot 直接从 public 加载
subtitleWindow.loadFile(path.join(__dirname, '../../public/subtitle-capture.html'));
screenshotWindow.loadFile(path.join(__dirname, '../../public/screenshot.html'));
```

#### 2.4 更新 HTML 内的脚本路径
```html
<!-- public/index.html -->
<script type="module" src="/src/main.jsx"></script>

<!-- public/selection.html -->
<script type="module" src="/src/windows/selection-entry.jsx"></script>

<!-- public/glass.html -->
<script type="module" src="/src/windows/glass-entry.jsx"></script>
```

**影响范围**:
- `vite.config.js` (1 处修改)
- `electron/managers/window-manager.js` (5 处修改)
- `electron/ipc/screenshot.js` (1 处修改)
- 5 个 HTML 文件位置变更

**验证方法**:
```bash
# 开发环境
npm start
# 测试所有窗口加载

# 生产环境
npm run build
npm run dist
# 安装并测试打包后的应用
```

**预计时间**: 30 分钟

---

### Phase 3: 资源文件整理 (低风险)

**目标**: 将 OCR 训练数据移动到 `resources/ocr/`

**步骤**:
1. 创建 `resources/ocr/` 目录
2. 移动文件:
   - `chi_sim.traineddata` → `resources/ocr/chi_sim.traineddata`
   - `eng.traineddata` → `resources/ocr/eng.traineddata`
3. 更新 `electron/ipc/ocr.js` 中的路径配置
4. 更新 `package.json` 的 `build.extraResources`

**影响范围**:
- `electron/ipc/ocr.js`
- `package.json` (electron-builder 配置)

**验证方法**:
```bash
npm start
# 测试 OCR 识别功能
```

**预计时间**: 15 分钟

---

### Phase 4: 配置常量统一 (中风险)

**目标**: 消除 `electron/shared/constants.js` 和 `src/config/constants.js` 的重复

**方案**: 保持两份文件，但确保内容同步

**理由**:
- 主进程使用 CommonJS (`require`)
- 渲染进程使用 ESM (`import`)
- Vite 可以处理 CommonJS，但会增加复杂性

**步骤**:
1. 在 `electron/shared/constants.js` 顶部添加注释标记为"单一数据源"
2. 在 `src/config/constants.js` 中标注"从 electron/shared 同步"
3. 创建同步脚本 `scripts/sync-constants.js` 用于检查一致性
4. 在 `package.json` 中添加 `npm run check:constants`

**验证方法**:
```bash
npm run check:constants
# 应显示: "Constants are in sync"
```

**预计时间**: 20 分钟

---

### Phase 5: 路径引用重构 (高风险)

**目标**: 消除所有硬编码路径，改用集中配置

**步骤**:

#### 5.1 创建路径配置文件
```javascript
// electron/shared/paths.js
const path = require('path');
const { app } = require('electron');

const isDev = !app.isPackaged;

module.exports = {
  // Preload 脚本
  preloads: {
    main: path.join(__dirname, '../preloads/main.js'),
    selection: path.join(__dirname, '../preloads/selection.js'),
    glass: path.join(__dirname, '../preloads/glass.js'),
    subtitleCapture: path.join(__dirname, '../preloads/subtitle-capture.js'),
  },
  
  // HTML 页面
  pages: {
    main: isDev 
      ? 'http://localhost:5173/index.html'
      : path.join(__dirname, '../../build/index.html'),
    selection: isDev
      ? 'http://localhost:5173/selection.html'
      : path.join(__dirname, '../../build/selection.html'),
    glass: isDev
      ? 'http://localhost:5173/glass.html'
      : path.join(__dirname, '../../build/glass.html'),
    subtitleCapture: isDev
      ? 'http://localhost:5173/subtitle-capture.html'
      : path.join(__dirname, '../../public/subtitle-capture.html'),
    screenshot: path.join(__dirname, '../../public/screenshot.html'),
  },
  
  // 资源文件
  resources: {
    icon: path.join(__dirname, '../../public/icon.png'),
    ocrData: path.join(__dirname, '../../resources/ocr'),
  },
};
```

#### 5.2 更新 window-manager.js
```javascript
const PATHS = require('../shared/paths');

function createMainWindow() {
  const mainWindow = new BrowserWindow({
    webPreferences: {
      preload: PATHS.preloads.main,
      // ...
    }
  });
  
  if (isDev) {
    mainWindow.loadURL(PATHS.pages.main);
  } else {
    mainWindow.loadFile(PATHS.pages.main);
  }
}
```

**影响范围**:
- 新建 `electron/shared/paths.js`
- `electron/managers/window-manager.js` (全面重构)
- `electron/ipc/screenshot.js`
- `electron/managers/tray-manager.js`
- `electron/managers/menu-manager.js`

**验证方法**:
```bash
# 开发环境
npm start
# 测试所有窗口

# 生产环境
npm run build && npm run dist
# 完整测试
```

**预计时间**: 45 分钟

---

### Phase 6: 清理与文档 (低风险)

**目标**: 清理废弃代码，更新文档

**步骤**:
1. 删除空目录 `src/entries/`
2. 检查并删除未使用的文件
3. 更新 `README.md` 中的目录结构说明
4. 创建 `ARCHITECTURE.md` 文档

**预计时间**: 20 分钟

---

## 四、完整迁移清单

### 文件移动清单

| 序号 | 源路径 | 目标路径 | 阶段 |
|------|--------|---------|------|
| 1 | `electron/preload.js` | `electron/preloads/main.js` | Phase 1 |
| 2 | `electron/preload-selection.js` | `electron/preloads/selection.js` | Phase 1 |
| 3 | `electron/preload-glass.js` | `electron/preloads/glass.js` | Phase 1 |
| 4 | `electron/preload-subtitle-capture.js` | `electron/preloads/subtitle-capture.js` | Phase 1 |
| 5 | `index.html` | `public/index.html` | Phase 2 |
| 6 | `selection.html` | `public/selection.html` | Phase 2 |
| 7 | `src/windows/glass.html` | `public/glass.html` | Phase 2 |
| 8 | `src/windows/subtitle-capture.html` | `public/subtitle-capture.html` | Phase 2 |
| 9 | `electron/screenshot.html` | `public/screenshot.html` | Phase 2 |
| 10 | `chi_sim.traineddata` | `resources/ocr/chi_sim.traineddata` | Phase 3 |
| 11 | `eng.traineddata` | `resources/ocr/eng.traineddata` | Phase 3 |

### 代码修改清单

| 序号 | 文件 | 修改内容 | 阶段 |
|------|------|---------|------|
| 1 | `electron/managers/window-manager.js` | 更新 preload 路径 (4处) | Phase 1 |
| 2 | `vite.config.js` | 更新 rollupOptions.input | Phase 2 |
| 3 | `electron/managers/window-manager.js` | 更新 HTML 加载路径 (5处) | Phase 2 |
| 4 | `electron/ipc/screenshot.js` | 更新 screenshot.html 路径 | Phase 2 |
| 5 | `public/index.html` | 验证脚本路径 | Phase 2 |
| 6 | `public/selection.html` | 验证脚本路径 | Phase 2 |
| 7 | `public/glass.html` | 验证脚本路径 | Phase 2 |
| 8 | `electron/ipc/ocr.js` | 更新 traineddata 路径 | Phase 3 |
| 9 | `package.json` | 更新 extraResources | Phase 3 |
| 10 | `electron/shared/constants.js` | 添加同步标记 | Phase 4 |
| 11 | `src/config/constants.js` | 添加同步标记 | Phase 4 |
| 12 | 新建 `electron/shared/paths.js` | 路径配置中心 | Phase 5 |
| 13 | `electron/managers/window-manager.js` | 使用 PATHS 配置 | Phase 5 |
| 14 | `electron/managers/tray-manager.js` | 使用 PATHS 配置 | Phase 5 |
| 15 | `electron/managers/menu-manager.js` | 使用 PATHS 配置 | Phase 5 |

---

## 五、风险评估与回滚

### 风险矩阵

| 阶段 | 风险等级 | 主要风险 | 缓解措施 |
|------|---------|---------|---------|
| Phase 1 | 🟢 低 | preload 路径错误导致窗口白屏 | Git 版本控制，快速回滚 |
| Phase 2 | 🟡 中 | Vite 构建失败、页面 404 | 分步测试，保留原文件直到验证 |
| Phase 3 | 🟢 低 | OCR 功能失效 | 验证路径后再删除原文件 |
| Phase 4 | 🟡 中 | 常量不同步导致行为不一致 | 自动化检查脚本 |
| Phase 5 | 🔴 高 | 多处引用修改导致连锁问题 | 逐个窗口测试，完整回归 |
| Phase 6 | 🟢 低 | 误删有用文件 | 只删除确认无引用的文件 |

### 回滚策略

```bash
# 每个阶段完成后打 tag
git tag -a phase1-complete -m "Phase 1: Preload files reorganized"
git tag -a phase2-complete -m "Phase 2: HTML files unified"
# ...

# 回滚到指定阶段
git checkout phase1-complete
```

---

## 六、执行时间表

| 阶段 | 预计时间 | 累计时间 | 检查点 |
|------|---------|---------|--------|
| Phase 1 | 10 分钟 | 10 分钟 | ✅ 所有窗口正常加载 |
| Phase 2 | 30 分钟 | 40 分钟 | ✅ 开发/生产环境都正常 |
| Phase 3 | 15 分钟 | 55 分钟 | ✅ OCR 功能正常 |
| Phase 4 | 20 分钟 | 75 分钟 | ✅ 检查脚本通过 |
| Phase 5 | 45 分钟 | 120 分钟 | ✅ 完整回归测试 |
| Phase 6 | 20 分钟 | 140 分钟 | ✅ 文档更新完成 |

**总计**: 约 2.5 小时

---

## 七、验收标准

### 功能测试清单

- [ ] 主窗口正常启动和显示
- [ ] 标题栏拖动、最小化、最大化、关闭
- [ ] 翻译功能（本地 LLM）
- [ ] 截图翻译流程
- [ ] 划词翻译触发和显示
- [ ] 划词翻译冻结窗口（最多 8 个）
- [ ] 玻璃窗口打开/关闭
- [ ] 玻璃窗口 OCR + 翻译
- [ ] 字幕采集区域选择
- [ ] 快捷键注册和响应
- [ ] 托盘菜单功能
- [ ] 设置面板所有选项
- [ ] 历史记录保存/恢复
- [ ] 收藏功能

### 构建测试清单

- [ ] `npm run dev` 正常启动
- [ ] `npm run build` 构建成功
- [ ] `npm run dist` 打包成功
- [ ] Windows 安装包可正常安装运行
- [ ] 应用更新功能正常

---

## 八、后续优化建议

### 8.1 SettingsPanel 拆分
当前 `SettingsPanel` 有 139K，建议拆分为:
- `SettingsPanel/GeneralSettings.jsx`
- `SettingsPanel/TranslationSettings.jsx`
- `SettingsPanel/ProviderSettings.jsx`
- `SettingsPanel/ShortcutSettings.jsx`
- `SettingsPanel/PrivacySettings.jsx`
- `SettingsPanel/AboutSection.jsx`

### 8.2 screenshot.html 安全改造
当前使用 `nodeIntegration: true`，建议:
1. 创建 `electron/preloads/screenshot.js`
2. 改用 `contextIsolation: true`
3. 通过 preload 暴露安全 API

### 8.3 常量完全统一
长期方案：
1. 将 `electron/shared/constants.js` 改为 ESM
2. 使用 Vite 的 `resolve.alias` 在渲染进程中直接导入
3. 主进程使用动态 `import()` 或构建时转换

### 8.4 类型安全
- 添加 TypeScript 支持
- 或使用 JSDoc + `@ts-check`

---

## 九、执行命令汇总

```bash
# Phase 1: Preload 整理
mkdir -p electron/preloads
mv electron/preload.js electron/preloads/main.js
mv electron/preload-selection.js electron/preloads/selection.js
mv electron/preload-glass.js electron/preloads/glass.js
mv electron/preload-subtitle-capture.js electron/preloads/subtitle-capture.js

# Phase 2: HTML 统一
mkdir -p public
mv index.html public/
mv selection.html public/
mv src/windows/glass.html public/
mv src/windows/subtitle-capture.html public/
mv electron/screenshot.html public/

# Phase 3: 资源整理
mkdir -p resources/ocr
mv chi_sim.traineddata resources/ocr/
mv eng.traineddata resources/ocr/

# Phase 6: 清理
rmdir src/entries 2>/dev/null || true
```

---

**文档结束**
