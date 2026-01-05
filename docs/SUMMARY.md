# T-Translate 开发总结

## 项目概述

| 项目名称 | T-Translate |
|----------|-------------|
| 类型 | 桌面翻译工具 |
| 平台 | Windows (Electron) |
| 前端 | React + CSS |
| 后端 | 本地 LLM (LM Studio) |
| 开发周期 | 2024年12月 - 2025年1月 |

---

## 功能模块完成度

### 核心功能 (95%)

| 模块 | 完成度 | 说明 |
|------|--------|------|
| 主窗口翻译 | 100% | 文本输入、翻译、复制 |
| 玻璃窗口 | 100% | 置顶透明、实时翻译 |
| 划词翻译 | 95% | 选词、翻译、便利贴显示 |
| OCR 识别 | 90% | 截图识别、划词兜底 |
| 历史记录 | 100% | 保存、搜索、删除 |
| 收藏夹 | 100% | 收藏、AI标签、筛选 |
| 设置面板 | 95% | 连接、翻译、界面、划词 |
| 系统托盘 | 100% | 菜单、开关、退出 |

### 划词翻译详细进度 (v1 → v32)

| 版本 | 主要内容 |
|------|----------|
| v1-v3 | 基础窗口创建、设置面板 |
| v4-v9 | 调试修复、流程优化 |
| v10-v14 | 自动划词、OCR兜底 |
| v15-v17 | 便利贴UI、拖动功能 |
| v18-v21 | 点击触发、文字获取时机 |
| v22 | focusable: false 关键修复 |
| v23-v25 | 便利贴样式、位置优化 |
| v26-v27 | 死循环修复、拖动标志 |
| v28 | CSS原生拖动替代JS拖动 |
| v29 | 体验优化（自动消失、原文对照） |
| v30-v31 | 设置面板集成、主题跟随 |
| v32 | 开关修复、语言同步、防误触 |

---

## 技术难点与解决方案

### 1. 划词翻译焦点问题

**问题**：点击翻译按钮时，原窗口失去焦点，选区消失，无法复制文字。

**解决**：
```javascript
new BrowserWindow({
  focusable: false,  // 窗口不抢焦点
});
```

### 2. 拖动窗口无限变大

**问题**：用 JS 实现拖动时，uiohook 捕获到鼠标事件，误判为新的划词操作。

**解决**：
- 改用 CSS `-webkit-app-region: drag` 原生拖动
- 添加 `isDraggingOverlay` 标志位

### 3. 文字获取时机

**问题**：mouseup 时选区还在，但点击按钮时选区已消失。

**解决**：
- 方案A（废弃）：mouseup 时立即复制
- 方案B（采用）：focusable: false + 点击时复制

### 4. 坐标系统不准确

**问题**：`uiohook-napi` 返回的坐标在高 DPI 屏幕上不准确。

**解决**：
```javascript
const cursorPos = screen.getCursorScreenPoint(); // 使用 Electron API
```

### 5. 防误触

**问题**：双击、右键、拖拽文件等操作被误判为划词。

**解决**：
```javascript
// 多重条件过滤
if (distance > 50 && duration > 200 && duration < 5000) {
  // 才视为划词
}
```

---

## 项目亮点

### 1. 隐私保护
- 完全本地化，数据不出设备
- 无账号、无云端、无追踪

### 2. AI 增强
- LLM 翻译，理解上下文
- AI 自动生成收藏标签

### 3. 多模式翻译
- 主窗口 - 传统界面
- 玻璃窗口 - 看视频神器
- 划词翻译 - 无缝阅读

### 4. 用户体验
- 深色/亮色主题
- 设置丰富可自定义
- 快捷键支持

---

## 文件结构

```
t-translate/
├── electron/
│   ├── main.js              # 主进程 (~2000行)
│   ├── preload.js           # 主窗口预加载
│   ├── preload-glass.js     # 玻璃窗口预加载
│   └── preload-selection.js # 划词窗口预加载
│
├── src/
│   ├── components/
│   │   ├── App.jsx
│   │   ├── TranslatorPanel.jsx
│   │   ├── HistoryPanel.jsx
│   │   ├── FavoritesPanel.jsx
│   │   ├── SettingsPanel.jsx
│   │   ├── GlassWindow.jsx
│   │   └── SelectionTranslator.jsx
│   │
│   └── styles/
│       ├── App.css
│       ├── selection.css
│       └── components/
│           └── SettingsPanel.css
│
├── public/
│   ├── index.html
│   ├── glass.html
│   └── selection.html
│
├── docs/
│   ├── FEATURES.md
│   └── images/
│
├── README.md
├── package.json
└── vite.config.js
```

---

## 依赖清单

### 生产依赖
```json
{
  "electron": "^28.0.0",
  "electron-store": "^8.1.0",
  "uiohook-napi": "^1.5.0",
  "screenshot-desktop": "^1.15.0",
  "sharp": "^0.33.0",
  "robotjs": "^0.6.0"
}
```

### 开发依赖
```json
{
  "react": "^18.2.0",
  "vite": "^5.0.0",
  "lucide-react": "^0.294.0"
}
```

---

## 后续计划

### 高优先级
- [ ] 稳定性测试
- [ ] 打包发布流程
- [ ] 自动更新功能

### 中优先级
- [ ] 多显示器支持
- [ ] 翻译结果朗读
- [ ] 更多语言支持

### 低优先级
- [ ] macOS 支持
- [ ] 词典模式
- [ ] 插件系统

---

## 开发心得

> "这个项目从一个简单的想法开始——想要一个注重隐私的本地翻译工具。在开发过程中，划词翻译功能是最具挑战性的，经历了 32 个版本的迭代才达到目前的稳定状态。
> 
> 最大的收获是理解了产品思维的重要性：功能不是越多越好，而是要解决用户的真实需求。隐私保护、AI 标签、玻璃窗口——这些都是从实际使用中发现的痛点。
> 
> 代码虽然主要由 AI 辅助完成，但每一个决策、每一次迭代都是学习的过程。"

---

*最后更新: 2025年1月*
