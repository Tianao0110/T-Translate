# T-Translate 主题自定义指南

本文档介绍如何自定义 T-Translate 的主题样式。

---

## 📋 内置主题

T-Translate 提供三种内置主题：

| 主题 | ID | 说明 |
|------|-----|------|
| 经典 | `light` | 浅色主题，白色背景 |
| 深色 | `dark` | 深色主题，深灰背景 |
| 清新 | `fresh` | 青绿色主题，清新自然 |

---

## 🎨 快速自定义：修改强调色

最简单的自定义方式是修改强调色（按钮、链接、高亮等的颜色）。

### 方法 1：通过 CSS 变量

在 `src/styles/App.css` 中修改 `:root` 下的强调色变量：

```css
:root {
  /* 修改这三个变量即可改变强调色 */
  --accent-primary: #3b82f6;   /* 主强调色 */
  --accent-hover: #2563eb;     /* 悬停时颜色 */
  --accent-active: #1d4ed8;    /* 点击时颜色 */
}
```

### 方法 2：通过 JavaScript（运行时）

```javascript
// 设置自定义强调色
document.documentElement.style.setProperty('--custom-accent', '#8b5cf6');
document.documentElement.setAttribute('data-custom-accent', 'true');

// 恢复默认
document.documentElement.removeAttribute('data-custom-accent');
```

---

## 🎯 进阶自定义：创建新主题

### 步骤 1：定义 CSS 变量

在 `src/styles/App.css` 中添加新主题：

```css
/* 🌸 示例：樱花主题 */
[data-theme="sakura"] {
  /* 背景色 */
  --bg-primary: #fdf2f8;      /* 主背景 */
  --bg-secondary: #fce7f3;    /* 次要背景 */
  --bg-tertiary: #fbcfe8;     /* 第三背景 */
  --bg-hover: rgba(236, 72, 153, 0.08);   /* 悬停背景 */
  --bg-active: rgba(236, 72, 153, 0.15);  /* 激活背景 */
  
  /* 文字颜色 */
  --text-primary: #831843;    /* 主文字 */
  --text-secondary: #9d174d;  /* 次要文字 */
  --text-tertiary: #be185d;   /* 第三文字 */
  --text-inverse: #ffffff;    /* 反色文字（用于按钮等） */
  
  /* 边框 */
  --border-primary: rgba(236, 72, 153, 0.2);
  --border-secondary: rgba(236, 72, 153, 0.12);
  
  /* 强调色 */
  --accent-primary: #ec4899;
  --accent-hover: #db2777;
  --accent-active: #be185d;
  
  /* 状态色（一般保持不变） */
  --success: #22c55e;
  --warning: #f59e0b;
  --error: #ef4444;
  --info: #3b82f6;
  
  /* 阴影 */
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.04);
  --shadow-md: 0 4px 6px rgba(0, 0, 0, 0.06);
  --shadow-lg: 0 10px 20px rgba(0, 0, 0, 0.08);
}
```

### 步骤 2：添加悬浮窗口主题（可选）

如果需要悬浮窗口也支持新主题，在 `src/components/FloatingWindow/styles.css` 中添加：

```css
[data-theme="sakura"] .floating-window {
  --floating-bg: rgba(253, 242, 248, var(--floating-opacity, 0.92));
  --floating-border: rgba(236, 72, 153, 0.2);
  --floating-text: #831843;
  --floating-text-muted: #9d174d;
  --floating-accent: #ec4899;
}

[data-theme="sakura"] .floating-top-area {
  background: rgba(236, 72, 153, 0.08);
  border-bottom-color: rgba(236, 72, 153, 0.12);
}

[data-theme="sakura"] .toolbar-btn {
  background: rgba(255, 255, 255, 0.7);
  color: #db2777;
}

[data-theme="sakura"] .toolbar-btn:hover {
  background: rgba(255, 255, 255, 0.9);
  color: #be185d;
}

[data-theme="sakura"] .toolbar-btn.active {
  background: linear-gradient(135deg, #ec4899, #f472b6);
  color: white;
}

[data-theme="sakura"] .lang-tag {
  background: rgba(236, 72, 153, 0.15);
  color: #db2777;
}
```

### 步骤 3：添加划词翻译主题（可选）

在 `src/components/SelectionTranslator/styles.css` 中添加：

```css
[data-theme="sakura"] .sel-card {
  background: rgba(253, 242, 248, 0.95);
  border-color: rgba(236, 72, 153, 0.2);
}

[data-theme="sakura"] .sel-toolbar {
  background: rgba(236, 72, 153, 0.05);
  border-bottom-color: rgba(236, 72, 153, 0.1);
}

[data-theme="sakura"] .sel-btn {
  color: #9d174d;
}

[data-theme="sakura"] .sel-btn:hover {
  background: rgba(236, 72, 153, 0.1);
}

[data-theme="sakura"] .sel-text {
  color: #831843;
}
```

### 步骤 4：注册主题

1. 在 `src/config/constants.js` 中添加：

```javascript
export const THEMES = {
  LIGHT: 'light',
  DARK: 'dark',
  FRESH: 'fresh',
  SAKURA: 'sakura',  // 新增
};
```

2. 在 `src/components/SettingsPanel/sections/InterfaceSection.jsx` 中添加按钮：

```jsx
<button 
  className={`theme-option sakura ${settings.interface.theme === 'sakura' ? 'active' : ''}`} 
  onClick={() => switchTheme('sakura')}
>
  <Flower size={16}/>樱花
</button>
```

3. 在 `src/components/FloatingWindow/index.jsx` 中更新主题验证：

```javascript
if (newTheme && ['light', 'dark', 'fresh', 'sakura'].includes(newTheme)) {
```

---

## 📁 CSS 变量完整列表

### 颜色变量

| 变量 | 用途 |
|------|------|
| `--bg-primary` | 主背景（页面、卡片） |
| `--bg-secondary` | 次要背景（侧边栏、面板） |
| `--bg-tertiary` | 第三背景（输入框背景） |
| `--bg-hover` | 悬停状态背景 |
| `--bg-active` | 激活状态背景 |
| `--text-primary` | 主文字颜色 |
| `--text-secondary` | 次要文字颜色 |
| `--text-tertiary` | 提示文字颜色 |
| `--text-inverse` | 反色文字（深色背景上的文字） |
| `--border-primary` | 主边框颜色 |
| `--border-secondary` | 次要边框颜色 |
| `--accent-primary` | 强调色（按钮、链接） |
| `--accent-hover` | 强调色悬停状态 |
| `--accent-active` | 强调色激活状态 |

### 状态颜色

| 变量 | 用途 |
|------|------|
| `--success` | 成功状态（绿色） |
| `--warning` | 警告状态（黄色） |
| `--error` | 错误状态（红色） |
| `--info` | 信息状态（蓝色） |

### 阴影

| 变量 | 用途 |
|------|------|
| `--shadow-sm` | 小阴影（悬停效果） |
| `--shadow-md` | 中等阴影（卡片） |
| `--shadow-lg` | 大阴影（弹窗） |

### 悬浮窗口专用变量

| 变量 | 用途 |
|------|------|
| `--floating-bg` | 玻璃背景色 |
| `--floating-border` | 玻璃边框色 |
| `--floating-text` | 悬浮窗口文字色 |
| `--floating-text-muted` | 悬浮窗口次要文字色 |
| `--floating-accent` | 悬浮窗口强调色 |
| `--floating-opacity` | 玻璃透明度（0-1） |

---

## 🎨 配色建议

### 浅色主题

- 背景：使用 `#f5-#ff` 范围的浅色
- 文字：使用 `#1a-#4a` 范围的深色
- 强调色：选择饱和度适中的颜色

### 深色主题

- 背景：使用 `#1a-#2a` 范围的深色
- 文字：使用 `#e0-#f5` 范围的浅色
- 强调色：选择亮度较高的颜色（避免太暗看不清）

### 色彩工具推荐

- [Tailwind CSS 调色板](https://tailwindcss.com/docs/customizing-colors)
- [Coolors 配色生成器](https://coolors.co/)
- [ColorHunt 配色方案](https://colorhunt.co/)

---

## 💡 最佳实践

1. **对比度**：确保文字与背景有足够对比度（WCAG AA 标准：4.5:1）
2. **一致性**：同一主题中的颜色应该协调
3. **测试**：在不同窗口（主窗口、玻璃板、划词翻译）中测试主题效果
4. **渐进式**：先修改基础变量，再根据需要调整组件特定样式

---

## 📝 常见问题

### Q: 修改后主题不生效？
A: 确保 CSS 选择器优先级足够高，可以使用浏览器开发者工具检查。

### Q: 悬浮窗口主题和主窗口不同步？
A: 检查 `FloatingWindow/index.jsx` 中的主题验证列表是否包含新主题。

### Q: 如何只修改某个组件的样式？
A: 使用更具体的选择器，如 `[data-theme="sakura"] .specific-component`。

---

**文档更新日期**: 2025-01-21
