# 文件结构优化计划

**创建日期**: 2025-01-14  
**当前版本**: v0.1.3

---

## 📊 现状分析

### 当前文件统计

| 目录 | 文件数 | 总行数 | 问题 |
|------|:------:|:------:|------|
| components | 11 | ~8,200 | SettingsPanel 过大 (2,198行) |
| services | 7 | ~2,000 | 4个翻译相关文件职责重叠 |
| providers | 12 | ~1,500 | 结构良好 ✅ |
| stores | 4 | ~900 | 结构良好 ✅ |
| styles | 13 | N/A | 位置不统一 |

### 发现的问题

#### 🔴 问题 1: Services 层冗余

```
services/
├── translation.js        # 核心调度 (771行)
├── translator.js         # 模板+缓存 (310行)  ← 与上面重叠
├── main-translation.js   # 主窗口逻辑 (399行)
├── translation-service.js # 仅重定向 (10行)   ← 完全冗余
├── pipeline.js           # 玻璃窗口 (308行)
├── cache.js              # 缓存 (185行)
└── index.js              # 导出
```

**问题**: 
- `translation-service.js` 仅是重定向，完全多余
- `translation.js` 和 `translator.js` 功能重叠

---

#### 🔴 问题 2: 组件目录结构不一致

```
components/
├── DocumentTranslator/     # 文件夹 + index.jsx
│   └── index.jsx
├── GlassTranslator/        # 文件夹 + index.jsx
│   └── index.jsx
├── SelectionTranslator.jsx # 单文件           ← 不一致
├── TranslationPanel.jsx    # 单文件 (1,206行)
├── SettingsPanel.jsx       # 单文件 (2,198行) ← 太大
└── ...
```

**问题**:
- 有的用文件夹，有的用单文件
- SettingsPanel 太大，需要拆分

---

#### 🟡 问题 3: 样式文件位置不统一

```
styles/
├── App.css               # 根目录
├── index.css             # 根目录
├── main.css              # 根目录
├── glass.css             # 根目录 ← 应该在 components/
├── selection.css         # 根目录 ← 应该在 components/
└── components/
    ├── DocumentTranslator.css
    ├── FavoritesPanel.css
    └── ...               # 其他组件样式
```

**问题**: `glass.css` 和 `selection.css` 应该移到 `components/`

---

#### 🟡 问题 4: 命名风格不统一

| 类型 | 当前命名 | 期望 |
|------|----------|------|
| 组件 | `TranslationPanel.jsx` | PascalCase ✅ |
| Service | `main-translation.js` | kebab-case ✅ |
| Service | `translationService` (导出名) | camelCase ✅ |
| Store | `translation-store.js` | kebab-case ✅ |
| CSS | `TranslationPanel.css` | PascalCase ✅ |

**结论**: 命名基本统一，无需大改

---

## 📋 优化计划

### 🔴 优先级 1: 必须做（影响维护性）

#### 1.1 删除冗余文件

```bash
# 删除仅重定向的兼容层
rm src/services/translation-service.js

# 更新所有引用
# SelectionTranslator.jsx: import translationService from '../services/translation.js'
```

**工作量**: 5 分钟

---

#### 1.2 拆分 SettingsPanel (2,198行 → 多个子组件)

**当前结构**:
```jsx
// SettingsPanel.jsx (2,198行)
- 翻译设置 (TranslationSettings)
- 翻译源配置 (ProviderConfig)  
- 快捷键设置 (ShortcutSettings)
- 划词翻译设置 (SelectionSettings)
- 界面设置 (AppearanceSettings)
- 隐私设置 (PrivacySettings)
- 关于页面 (AboutSection)
```

**优化后**:
```
components/
└── SettingsPanel/
    ├── index.jsx              # 主入口 (~200行)
    ├── TranslationSettings.jsx # 翻译设置 (~300行)
    ├── ProviderConfig.jsx      # 翻译源配置 (~400行)
    ├── ShortcutSettings.jsx    # 快捷键设置 (~300行)
    ├── SelectionSettings.jsx   # 划词翻译设置 (~300行)
    ├── AppearanceSettings.jsx  # 界面设置 (~200行)
    ├── PrivacySettings.jsx     # 隐私设置 (~200行)
    └── AboutSection.jsx        # 关于页面 (~150行)
```

**工作量**: 2-3 小时

---

### 🟡 优先级 2: 建议做（提升一致性）

#### 2.1 统一组件目录结构

**方案 A: 全部改为文件夹** (推荐)
```
components/
├── DocumentTranslator/
│   ├── index.jsx
│   └── DocumentTranslator.css  # CSS 移入
├── FavoritesPanel/
│   ├── index.jsx
│   └── FavoritesPanel.css
├── GlassTranslator/
│   ├── index.jsx
│   └── GlassTranslator.css     # 从 styles/glass.css 移入
├── HistoryPanel/
│   ├── index.jsx
│   └── HistoryPanel.css
├── SelectionTranslator/
│   ├── index.jsx
│   └── SelectionTranslator.css # 从 styles/selection.css 移入
├── SettingsPanel/
│   ├── index.jsx
│   ├── ...子组件
│   └── SettingsPanel.css
├── TranslationPanel/
│   ├── index.jsx
│   └── TranslationPanel.css
├── MainWindow/
│   ├── index.jsx
│   └── MainWindow.css
├── TitleBar/
│   ├── index.jsx
│   └── TitleBar.css
└── ProviderSettings/
    ├── index.jsx
    └── ProviderSettings.css
```

**方案 B: 全部改为单文件** (简单但不推荐)
- 将 DocumentTranslator/index.jsx → DocumentTranslator.jsx
- 将 GlassTranslator/index.jsx → GlassTranslator.jsx

**推荐**: 方案 A，每个组件有独立文件夹，便于管理

**工作量**: 1-2 小时

---

#### 2.2 合并 Services 翻译模块

**当前** (4个文件):
```
translation.js     → 核心调度
translator.js      → 模板+缓存
main-translation.js → 主窗口逻辑
pipeline.js        → 玻璃窗口
```

**优化后** (3个文件):
```
translation.js     → 核心调度 + 模板 (合并 translator.js)
main-translation.js → 主窗口逻辑 (不变)
pipeline.js        → 玻璃窗口 (不变)
```

**或者保持不变**: 当前职责已经比较清晰，合并可能引入风险

**建议**: 暂不合并，仅删除 translation-service.js

---

### 🟢 优先级 3: 可选做（进一步优化）

#### 3.1 拆分 electron/main.js (3,971行)

**当前所有功能都在一个文件**:
- 窗口管理
- 托盘管理
- 快捷键管理
- IPC 处理
- 划词翻译逻辑
- 截图逻辑

**可拆分为**:
```
electron/
├── main.js              # 入口 + 窗口管理 (~1000行)
├── tray.js              # 托盘管理 (~200行)
├── shortcuts.js         # 快捷键管理 (~300行)
├── ipc-handlers.js      # IPC 处理 (~500行)
├── selection-hook.js    # 划词翻译 (~800行)
├── screenshot-module.js # 截图 (已独立)
└── preload*.js          # 预加载脚本
```

**工作量**: 4-6 小时  
**风险**: 中等（需要仔细处理模块间依赖）

---

#### 3.2 整理 windows 目录

**当前**:
```
windows/
├── glass-entry.jsx       # 玻璃窗口入口
├── glass.html            # 玻璃窗口 HTML
├── selection-entry.jsx   # 划词窗口入口
└── subtitle-capture.html # 字幕捕获
```

**建议**: 保持不变，当前结构合理

---

## 📊 工作量评估

| 任务 | 优先级 | 工作量 | 风险 |
|------|:------:|:------:|:----:|
| 删除 translation-service.js | 🔴 高 | 5分钟 | 低 |
| 拆分 SettingsPanel | 🔴 高 | 2-3小时 | 低 |
| 统一组件目录结构 | 🟡 中 | 1-2小时 | 低 |
| 合并 Services | 🟡 中 | 1小时 | 中 |
| 拆分 main.js | 🟢 低 | 4-6小时 | 中 |

**总计**: 
- 必须做: ~3 小时
- 建议做: ~3 小时
- 可选做: ~6 小时

---

## 🎯 推荐执行顺序

### 第一阶段（立即执行）
1. ✅ 删除 `translation-service.js`
2. ✅ 拆分 `SettingsPanel.jsx`

### 第二阶段（下次迭代）
3. 统一组件目录结构（CSS 移入组件文件夹）
4. 评估是否合并 Services

### 第三阶段（稳定后）
5. 拆分 `electron/main.js`

---

## 📁 目标文件结构

```
t-translate/
├── electron/
│   ├── main.js                 # 主进程入口
│   ├── screenshot-module.js    # 截图模块
│   ├── preload.js             # 主窗口预加载
│   ├── preload-glass.js       # 玻璃窗口预加载
│   └── preload-selection.js   # 划词窗口预加载
├── src/
│   ├── components/            # View 层
│   │   ├── DocumentTranslator/
│   │   │   ├── index.jsx
│   │   │   └── styles.css
│   │   ├── FavoritesPanel/
│   │   │   ├── index.jsx
│   │   │   └── styles.css
│   │   ├── GlassTranslator/
│   │   │   ├── index.jsx
│   │   │   └── styles.css
│   │   ├── HistoryPanel/
│   │   │   ├── index.jsx
│   │   │   └── styles.css
│   │   ├── MainWindow/
│   │   │   ├── index.jsx
│   │   │   └── styles.css
│   │   ├── SelectionTranslator/
│   │   │   ├── index.jsx
│   │   │   └── styles.css
│   │   ├── SettingsPanel/          # 拆分后
│   │   │   ├── index.jsx
│   │   │   ├── TranslationSettings.jsx
│   │   │   ├── ProviderConfig.jsx
│   │   │   ├── ShortcutSettings.jsx
│   │   │   ├── SelectionSettings.jsx
│   │   │   ├── AppearanceSettings.jsx
│   │   │   ├── PrivacySettings.jsx
│   │   │   ├── AboutSection.jsx
│   │   │   └── styles.css
│   │   ├── TranslationPanel/
│   │   │   ├── index.jsx
│   │   │   └── styles.css
│   │   ├── TitleBar/
│   │   │   ├── index.jsx
│   │   │   └── styles.css
│   │   └── ProviderSettings/
│   │       ├── index.jsx
│   │       └── styles.css
│   ├── services/              # Service 层
│   │   ├── translation.js     # 核心翻译调度
│   │   ├── main-translation.js # 主窗口逻辑
│   │   ├── pipeline.js        # 玻璃窗口流水线
│   │   ├── translator.js      # 模板+缓存
│   │   ├── cache.js           # 缓存服务
│   │   └── index.js           # 统一导出
│   ├── providers/             # Provider 层 (保持不变)
│   ├── stores/                # Model 层 (保持不变)
│   ├── config/                # 配置 (保持不变)
│   ├── utils/                 # 工具 (保持不变)
│   ├── windows/               # 窗口入口 (保持不变)
│   ├── workers/               # Web Workers (保持不变)
│   └── styles/                # 全局样式
│       ├── index.css          # 全局样式
│       ├── App.css            # App 样式
│       └── variables.css      # CSS 变量 (新增)
├── public/
└── docs/
```

---

## ❓ 需要决策

1. **SettingsPanel 是否立即拆分？**
   - 是 → 执行第一阶段
   - 否 → 仅删除冗余文件

2. **组件目录结构是否统一？**
   - 方案 A (全部文件夹) → 更规范
   - 方案 B (保持现状) → 改动小

3. **main.js 是否需要拆分？**
   - 是 → 第三阶段执行
   - 否 → 保持现状

---

**请告诉我您的决定，我将开始执行。**
