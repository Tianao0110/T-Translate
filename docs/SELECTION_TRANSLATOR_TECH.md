# 划词翻译技术文档

> Selection Translator Technical Documentation v2.3
> 
> 更新日期: 2026-01-16

---

## 目录

1. [架构概览](#1-架构概览)
2. [状态机系统](#2-状态机系统)
3. [三层混合选区检测](#3-三层混合选区检测)
4. [多窗口管理](#4-多窗口管理)
5. [语言同步机制](#5-语言同步机制)
6. [预热机制](#6-预热机制)
7. [文件清单](#7-文件清单)
8. [配置参数](#8-配置参数)
9. [调试指南](#9-调试指南)

---

## 1. 架构概览

### 1.1 核心设计原则

**关键认知**：
> "是否存在 selection 行为" ≠ "是否存在 selection 结果"

- **状态机**：判断用户是否在进行划选**行为**
- **三层检测**：验证是否真的选中了**文本结果**

两者缺一不可。只判断行为会导致空白处划选误触发；只验证结果会缺少行为意图判断。

### 1.2 数据流

```
用户操作 (mousedown → mousemove → mouseup)
              ↓
      状态机评估行为 (SelectionStateMachine)
              ↓
        shouldShow = true?
              ↓
      三层混合检测验证结果 (hasTextSelection + checkSelectionViaClipboard)
              ↓
    确认有选中文本? → 显示图标 → 用户点击 → 翻译
```

### 1.3 系统组成

```
┌─────────────────────────────────────────────────────────────┐
│                        主进程 (Main)                         │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ uIOhook     │  │ 状态机      │  │ 三层选区检测        │  │
│  │ 鼠标监听    │→ │ 行为判断    │→ │ 结果验证            │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
│         ↓                                    ↓              │
│  ┌─────────────────────────────────────────────────────────┐│
│  │                   窗口管理器                             ││
│  │  • selectionWindow (触发图标)                           ││
│  │  • frozenSelectionWindows (冻结窗口池, 最多8个)         ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
              ↓ IPC
┌─────────────────────────────────────────────────────────────┐
│                      渲染进程 (Renderer)                     │
│  ┌─────────────────────────────────────────────────────────┐│
│  │              SelectionTranslator 组件                    ││
│  │  • 触发图标显示                                         ││
│  │  • 翻译结果展示                                         ││
│  │  • 拖拽/冻结交互                                        ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

---

## 2. 状态机系统

### 2.1 状态定义

```javascript
const STATES = {
  IDLE: 'idle',           // 空闲，等待 mousedown
  POSSIBLE: 'possible',   // 可能是划选（采样中）
  LIKELY: 'likely',       // 很可能是划选（准备确认）
  CONFIRMED: 'confirmed', // 确认划选（等待结果验证）
};
```

### 2.2 状态转换图

```
                    mousedown
        ┌─────────────────────────────┐
        ↓                             │
     ┌──────┐                         │
     │ IDLE │←────────────────────────┤
     └──┬───┘      timeout/reset      │
        │                             │
        │ mousedown                   │
        ↓                             │
   ┌──────────┐                       │
   │ POSSIBLE │←──────────┐           │
   └────┬─────┘           │           │
        │                 │ 条件不满足 │
        │ 条件A/B/C满足   │           │
        ↓                 │           │
   ┌──────────┐           │           │
   │  LIKELY  │───────────┘           │
   └────┬─────┘                       │
        │                             │
        │ mouseup                     │
        ↓                             │
  ┌───────────┐                       │
  │ CONFIRMED │───────────────────────┘
  └───────────┘    结果验证后 reset
```

### 2.3 进入 LIKELY 的三个条件

满足**任意一个**即可进入 LIKELY：

| 条件 | 名称 | 算法 | 典型场景 |
|------|------|------|---------|
| A | 方向稳定 | 最近5段方向变化中位数 < 15° | 正常划选文本 |
| B | 低速精细 | 速度 < 0.1 px/ms | 选短词、精确选择 |
| C | 双击/三击 | 间隔 < 300ms, 距离 < 10px | 快速选词/选段 |

**条件 A 算法详解**：
```javascript
// 计算最近 5 段的方向变化
const recentDirections = this.directions.slice(-5);
const changes = [];
for (let i = 1; i < recentDirections.length; i++) {
  let change = Math.abs(recentDirections[i] - recentDirections[i-1]);
  if (change > 180) change = 360 - change;  // 处理角度环绕
  if (change > 120) continue;  // 忽略离群值
  changes.push(change);
}
const median = getMedian(changes);

// 必须同时满足：方向稳定 + 位移足够 + 持续时间足够
return median < 15 && totalDistance > 12 && duration > 80;
```

### 2.4 双击/三击特殊处理

为避免三击时的窗口闪烁：

```
双击/三击 mousedown
        ↓
peekMultiClick() = true → 不隐藏现有窗口
        ↓
状态机标记 isMultiClickTriggered = true
        ↓
直接进入 LIKELY（跳过 POSSIBLE）
        ↓
mouseup → 返回 needsDelayedConfirm: true
        ↓
走完整三层检测验证结果
```

---

## 3. 三层混合选区检测

### 3.1 核心原则

```
最终判定 =
    状态机判断 shouldShow = true
    AND (
        第一层确认有选区
        OR 第二层确认有选区  
        OR 第三层剪贴板验证有选区
    )
```

### 3.2 架构图

```
mouseup (shouldShow = true)
              ↓
┌─────────────────────────────────────────────────────────────┐
│           第一层：焦点 + 控件类型判定 (Cheap Filter)          │
│                                                             │
│  GetForegroundWindow() → GetGUIThreadInfo()                 │
│              ↓                                              │
│  检查焦点窗口类名：                                          │
│  • Progman/WorkerW → false (桌面)                           │
│  • SHELLDLL_DefView → false (文件管理器)                    │
│  • Button/Static → false (按钮/标签)                        │
│  • Edit/RichEdit → 继续第二层                               │
│  • Chrome/Firefox → 返回 null，需要第三层                   │
│                                                             │
│  特点：零副作用，< 1ms                                       │
└─────────────────────────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────────────────────────┐
│           第二层：标准控件快速路径 (Strong & Clean)           │
│                                                             │
│  检查是否为标准 Edit 控件：                                  │
│  • Edit, RichEdit, TextBox, _WwG                            │
│              ↓                                              │
│  SendMessage(EM_GETSEL) → start, end                        │
│              ↓                                              │
│  start != end → true (有选区)                               │
│  start == end → false (无选区，只是光标位置)                 │
│                                                             │
│  特点：零剪贴板，同步，快速                                   │
└─────────────────────────────────────────────────────────────┘
              ↓ 返回 null (无法判断)
┌─────────────────────────────────────────────────────────────┐
│           第三层：剪贴板兜底 (Controlled Fallback)           │
│                                                             │
│  触发条件：                                                  │
│  • 前两层返回 null                                          │
│  • 复杂应用（浏览器/VSCode/Electron）                        │
│  • 防抖检查通过（100ms 内不重复）                            │
│              ↓                                              │
│  1. 保存剪贴板快照 (text + html + rtf)                      │
│  2. 模拟 Ctrl+C（不清空剪贴板！）                           │
│  3. 等待 30ms                                               │
│  4. 读取剪贴板                                              │
│  5. 与快照比较                                              │
│  6. 恢复剪贴板                                              │
│              ↓                                              │
│  判定逻辑：                                                  │
│  • 剪贴板未变化 → false（Ctrl+C 没复制到东西）              │
│  • 剪贴板变化且非空 → true（有 selection）                  │
│                                                             │
│  特点：验证 selection 结果，最"安静"的用法                   │
└─────────────────────────────────────────────────────────────┘
```

### 3.3 返回值说明

| hasSelection | 含义 | 后续处理 |
|--------------|------|---------|
| `true` | 确认有选区 | 显示图标 |
| `false` | 确认无选区 | 不显示 |
| `null` | 无法判断 | 走下一层检测 |

### 3.4 控件类名分类

**肯定无选区 (第一层返回 false)**：
```javascript
const noTextClasses = [
  'Progman', 'WorkerW',           // 桌面
  'SHELLDLL_DefView',             // 文件管理器视图
  'SysListView32', 'SysTreeView32', // 列表/树控件
  'Button', 'Static',             // 按钮、标签
  'msctls_trackbar32',            // 滑块
  'ScrollBar',                    // 滚动条
];
```

**标准控件 (第二层使用 EM_GETSEL)**：
```javascript
const standardEditClasses = [
  'Edit',                         // 标准输入框
  'RICHEDIT50W', 'RichEdit20W',   // RichEdit 系列
  'TextBox',                      // .NET TextBox
  '_WwG',                         // Word 编辑区
];
```

**复杂应用 (第三层剪贴板兜底)**：
```javascript
const complexAppClasses = [
  'Chrome_WidgetWin_',            // Chrome/Edge 顶层窗口
  'Chrome_RenderWidgetHostHWND',  // Chrome/Edge 渲染区
  'MozillaWindowClass',           // Firefox
  'CASCADIA_HOSTING_WINDOW_CLASS', // Windows Terminal
  'Electron',                     // Electron 应用
  'EXCEL7', 'OpusApp',            // Office
];
```

### 3.5 场景覆盖

| 场景 | 第一层 | 第二层 | 第三层 | 结果 |
|------|--------|--------|--------|------|
| 桌面空白双击 | false | - | - | ❌ 不显示 |
| 桌面空白划选 | false | - | - | ❌ 不显示 |
| 文件管理器空白 | false | - | - | ❌ 不显示 |
| 记事本双击选词 | - | true | - | ✅ 显示 |
| 记事本划选文本 | - | true | - | ✅ 显示 |
| 记事本空白划选 | - | false | - | ❌ 不显示 |
| 浏览器空白双击 | null | - | false (未变化) | ❌ 不显示 |
| 浏览器空白划选 | null | - | false (未变化) | ❌ 不显示 |
| 浏览器双击选词 | null | - | true (有变化) | ✅ 显示 |
| 浏览器划选文本 | null | - | true (有变化) | ✅ 显示 |
| VSCode 选中代码 | null | - | true (有变化) | ✅ 显示 |

### 3.6 第三层为什么不清空剪贴板

**错误做法**：
```javascript
// ❌ 清空剪贴板作为信号量
clipboard.clear();
simulateCtrlC();
const text = clipboard.readText();
return text.length > 0;  // 有内容就认为有选区
```

**问题**：
1. `clipboard.clear()` 会触发剪贴板变更事件，被其他应用感知
2. 如果 Ctrl+C 失败，无法区分"没选中"和"复制失败"
3. 不必要的副作用

**正确做法**：
```javascript
// ✅ 比较变化，不清空
const snapshot = clipboard.readText();
simulateCtrlC();
const current = clipboard.readText();

if (current === snapshot) {
  return false;  // 未变化 = 没复制到东西 = 无选区
}
return current.length > 0;  // 变化且非空 = 有选区
```

---

## 4. 多窗口管理

### 4.1 窗口类型

| 类型 | 说明 |
|------|------|
| `selectionWindow` | 当前活动的触发图标/翻译窗口 |
| `frozenSelectionWindows` | 冻结的翻译结果窗口池 |

### 4.2 冻结流程

```
用户拖动窗口超过 10px
        ↓
触发 freeze()
        ↓
当前窗口加入 frozenSelectionWindows 池
        ↓
创建新的 selectionWindow
        ↓
新划词使用新窗口，旧窗口保持显示
```

### 4.3 窗口池管理

```javascript
const MAX_FROZEN_WINDOWS = 8;

// 超过限制时关闭最早的窗口
if (frozenSelectionWindows.length >= MAX_FROZEN_WINDOWS) {
  const oldest = frozenSelectionWindows.shift();
  oldest.close();
}
```

---

## 5. 语言同步机制

### 5.1 优先级

```
1. translation store → currentTranslation.targetLanguage (当前会话)
2. config store → targetLanguage (持久化配置)
3. 默认值 → 'zh'
```

### 5.2 获取逻辑

```javascript
function getLanguageFromMainWindow() {
  // 优先使用当前翻译会话的语言
  const transStore = window.__TRANSLATION_STORE__;
  if (transStore?.currentTranslation?.targetLanguage) {
    return transStore.currentTranslation.targetLanguage;
  }
  
  // 备选：持久化配置
  const configStore = window.__CONFIG_STORE__;
  if (configStore?.targetLanguage) {
    return configStore.targetLanguage;
  }
  
  return 'zh';
}
```

---

## 6. 预热机制

### 6.1 目的

解决首次划词卡顿问题（模块懒加载 + 窗口创建延迟）

### 6.2 预热内容

```javascript
function preheatSelectionModules() {
  // 1. 预加载 uIOhook（鼠标监听）
  require('uiohook-napi');
  
  // 2. 预加载 koffi（Win32 API 调用）
  require('koffi');
  
  // 3. 预创建窗口（避免首次创建延迟）
  windowManager.createSelectionWindow();
  
  // 4. 预初始化状态机
  selectionStateMachine = new SelectionStateMachine();
}
```

### 6.3 触发时机

应用启动后 3 秒执行，避免影响启动速度

---

## 7. 文件清单

| 文件 | 位置 | 职责 |
|------|------|------|
| `main.js` | `electron/` | 入口、钩子管理、mouseup 处理、handleDelayedConfirm |
| `selection-state-machine.js` | `electron/utils/` | 状态机逻辑、条件判断、peekMultiClick |
| `native-helper.js` | `electron/utils/` | 三层选区检测、Win32 API、剪贴板兜底 |
| `window-manager.js` | `electron/managers/` | 窗口创建、冻结池管理 |
| `selection.js` | `electron/ipc/` | IPC 处理、文本获取、OCR 兜底 |
| `preload-selection.js` | `electron/` | 渲染进程 API 暴露 |
| `channels.js` | `electron/shared/` | IPC 通道定义 |
| `SelectionTranslator/index.jsx` | `src/components/` | 翻译 UI 组件 |
| `SelectionTranslator/styles.css` | `src/components/` | 样式 |

---

## 8. 配置参数

### 8.1 选区检测参数

```javascript
// native-helper.js
const CLIPBOARD_CHECK_COOLDOWN = 100; // 剪贴板检测防抖（ms）
```

### 8.2 状态机参数

```javascript
// selection-state-machine.js
const CONFIG = {
  // 采样
  SAMPLE_INTERVAL: 16,        // 采样间隔（ms），约 60fps
  MIN_SAMPLES: 3,             // 最小采样数
  
  // 条件 A: 方向稳定
  DIRECTION_THRESHOLD: 15,    // 方向变化阈值（度）
  MIN_TOTAL_DISTANCE: 12,     // 最小总位移（px）
  MIN_DURATION: 80,           // 最小持续时间（ms）
  
  // 条件 B: 低速精细
  SLOW_SPEED_THRESHOLD: 0.1,  // 低速阈值（px/ms）
  
  // 条件 C: 双击/三击
  DOUBLE_CLICK_TIME: 300,     // 双击时间窗口（ms）
  DOUBLE_CLICK_DISTANCE: 10,  // 双击距离阈值（px）
  
  // 超时
  POSSIBLE_TIMEOUT: 4000,     // Possible 超时（ms）
  LIKELY_TIMEOUT: 2000,       // Likely 超时（ms）
};
```

### 8.3 窗口参数

```javascript
// window-manager.js
const MAX_FROZEN_WINDOWS = 8;  // 最大冻结窗口数
```

---

## 9. 调试指南

### 9.1 日志标签

| 标签 | 来源 | 说明 |
|------|------|------|
| `[SelectionSM]` | selection-state-machine.js | 状态转换、条件判断 |
| `[Main]` | main.js | mouseup 处理、检测结果 |
| `[Native]` | native-helper.js | 窗口类名、选区检测 |

### 9.2 关键日志示例

**正常划选文本（记事本）**：
```
[SelectionSM] State: idle -> possible
[SelectionSM] Condition A met: direction stability
[SelectionSM] State: possible -> likely
[SelectionSM] State: likely -> confirmed
[Native] Focus window: "Edit" (caret: true, usedForeground: false)
[Main] Normal drag selection check: true (em_getsel: range 0-15)
// 显示图标
```

**浏览器双击选词**：
```
[SelectionSM] Multi-click detected, entering Likely
[SelectionSM] State: idle -> likely
[SelectionSM] State: likely -> confirmed
[SelectionSM] Multi-click needs delayed confirmation
[Native] Focus window: "Chrome_WidgetWin_1" (caret: false, usedForeground: true)
[Main] Selection check: null (needs_clipboard: complex app: Chrome_WidgetWin_1)
[Main] Delayed confirm: layer 3 - clipboard fallback
[Native] Clipboard changed, has selection: "selected text..."
// 显示图标
```

**浏览器空白划选**：
```
[SelectionSM] State: idle -> possible
[SelectionSM] Condition A met: direction stability
[SelectionSM] State: possible -> likely
[SelectionSM] State: likely -> confirmed
[Native] Focus window: "Chrome_WidgetWin_1" (caret: false, usedForeground: true)
[Main] Normal drag selection check: null (needs_clipboard: complex app: Chrome_WidgetWin_1)
[Main] Normal drag: complex app, using clipboard fallback
[Native] Clipboard unchanged, no selection
[Main] Normal drag: clipboard check found no selection
// 不显示图标
```

**桌面空白双击**：
```
[SelectionSM] Multi-click detected, entering Likely
[SelectionSM] State: idle -> likely
[SelectionSM] State: likely -> confirmed
[Native] Focus window: "Progman" (caret: false, usedForeground: true)
[Main] Selection check: false (class_filter: non-text control: Progman)
[Main] Delayed confirm: no selection detected (layer 1-2)
// 不显示图标
```

### 9.3 常见问题排查

**Q: 双击没反应**
1. 检查 `Focus window` 类名是否在 `complexAppClasses` 中
2. 检查是否被防抖跳过：`Clipboard check skipped (cooldown)`
3. 检查剪贴板是否真的变化了

**Q: 空白处仍然显示图标**
1. 检查 `Selection check` 返回值，应该是 `false` 或 `null`
2. 如果是 `null`，检查 `Clipboard unchanged` 是否出现
3. 检查窗口类名是否需要加入 `noTextClasses`

**Q: 三击时窗口闪烁**
1. 检查 `peekMultiClick` 是否返回 `true`
2. 日志应显示 `peekMultiClick: true (timeDiff=...)`

**Q: 翻译语言不对**
1. 检查主窗口的 `__TRANSLATION_STORE__` 是否存在
2. 检查 `currentTranslation.targetLanguage` 值

---

## 更新历史

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.0 | - | 基础划词翻译 |
| 2.0 | 2026-01-16 | 状态机判断、多窗口支持、预热机制 |
| 2.1 | 2026-01-16 | 三层混合选区检测 |
| 2.2 | 2026-01-16 | 正常划选也走完整三层检测；防抖调整为 100ms |
| 2.3 | 2026-01-16 | 优化第三层：移除 clipboard.clear()，改用快照对比 |
