# T-Translate 多语言国际化 (i18n) 开发指南

## 📋 目录

1. [技术栈概述](#技术栈概述)
2. [文件结构](#文件结构)
3. [翻译键组织结构](#翻译键组织结构)
4. [添加新语言](#添加新语言)
5. [在代码中使用翻译](#在代码中使用翻译)
6. [最佳实践](#最佳实践)
7. [常见问题](#常见问题)

---

## 技术栈概述

| 技术 | 版本 | 用途 |
|------|------|------|
| i18next | ^23.x | 核心国际化框架 |
| react-i18next | ^14.x | React 集成 |
| dayjs | ^1.x | 日期本地化 |

### 架构设计：三层 i18n 体系（⚠️ 新增文案先确认落在哪层）

项目有**三个独立的 i18n 实例**，词表归属不同，混淆会导致"key 加了却不生效"：

| 层 | 实例 | 词表来源 | 取词方式 | 典型场景 |
|----|------|---------|---------|---------|
| 渲染进程（三窗 UI） | react-i18next（`src/i18n.js` 初始化） | `src/i18n/locales/zh.js` + `en.js` | `useTranslation()` 的 `t()` | 所有 React 组件文案 |
| 主进程翻译栈 | 栈内独立 i18next（`src/stack/i18n.js`） | **复用同一份** `src/i18n/locales` 词表 | `_t(key, 中文fallback)` | provider/OCR 错误文案（跨 IPC 后两端逐字一致） |
| 主进程原生 UI | `electron/shared/main-i18n.js` | **该文件内自带的 zh/en 双表** | `t(key, params)`（第二参是插值参数，**不是 fallback**） | 托盘/菜单/快捷键冲突提示/OCR 健康检查消息 |

实践规则：
- 渲染端组件文案 → 加 `locales/zh.js` + `en.js`（两份都加，`check:i18n` 锁同步）
- 栈内（provider/OCR）文案 → 同样加 locales 两份，代码里用栈的 `_t`
- 主进程托盘/菜单/IPC 返回给用户的错误串 → 加 `main-i18n.js` 的 **zh 和 en 两个块**
- 错误分类器 `ERROR_PATTERNS`（`src/utils/error-handler.js`）匹配关键词必须**中英双语**各写一份（栈返回哪种语言取决于用户界面语言），`tests/unit/error-classification.test.js` 锁行为

---

## 文件结构

```
src/
├── i18n.js                     # 渲染端 i18next 初始化（resources 引 locales）
├── i18n/locales/
│   ├── zh.js                   # 中文词表（渲染端 + 栈共用）
│   └── en.js                   # 英文词表（渲染端 + 栈共用）
├── stack/i18n.js               # 栈内 i18n 实例（复用上面的词表，导出 _t）
├── utils/ai-prompts.js         # AI 提示词双语模板（isZh 分支）
└── components/SettingsPanel/sections/InterfaceSection.jsx  # 语言切换 UI

electron/shared/main-i18n.js    # 主进程独立双语消息表（托盘/菜单/IPC 错误串）
scripts/check-i18n.js           # zh/en key 同步检查（npm run check:i18n，提交前必过）
scripts/check-hardcoded-chinese.js  # 硬编码中文扫描（npm run check:hardcoded）
```

---

## 翻译键组织结构

### 命名空间设计

```javascript
const zh = {
  // ========== 全局 ==========
  app: { name, version },           // 应用信息
  nav: { translate, history, ... }, // 导航栏
  status: { ready, online, ... },   // 状态栏
  screenshot: { failed },           // 截图功能
  notify: { unknownError, ... },    // 通用通知

  // ========== 功能模块 ==========
  translation: { ... },             // 翻译面板
  history: { ... },                 // 历史记录
  favorites: { ... },               // 收藏夹
  documents: { ... },               // 文档翻译

  // ========== 设置相关 ==========
  settingsNav: { ... },             // 设置导航
  settings: { ... },                // 通用设置
  providerSettings: { ... },        // 翻译源设置
  translationSettings: { ... },     // 翻译设置
  selectionSettings: { ... },       // 划词翻译
  floatingWindowSettings: { ... },     // 悬浮窗口
  documentSettings: { ... },        // 文档翻译
  connectionSettings: { ... },      // LM Studio 连接
  
  // ========== 其他 ==========
  ocr: { ... },                     // OCR 设置
  tts: { ... },                     // 语音朗读
  privacy: { ... },                 // 隐私模式
  about: { ... },                   // 关于页面
  shortcuts: { ... },               // 快捷键
  languages: { ... },               // 语言列表
  templates: { ... },               // 翻译模板
  toolbar: { ... },                 // 工具栏
};
```

### 翻译键命名规范

```javascript
// ✅ 好的命名
translation: {
  inputPlaceholder: "输入要翻译的文本...",  // 功能_位置
  ocrSuccess: "识别成功 ({{engine}})",      // 功能_状态 + 参数
  enterText: "请输入要翻译的内容",          // 动作_对象
}

// ❌ 避免的命名
translation: {
  text1: "...",           // 无意义编号
  placeholder: "...",     // 过于笼统
  msg: "...",             // 缩写不清晰
}
```

### 参数化翻译

```javascript
// 定义（支持插值）
history: {
  deleteSelectedConfirm: "确定删除选中的 {{count}} 条记录？",
  deletedCount: "已删除 {{count}} 条",
  searchResult: "搜索 \"{{keyword}}\" 找到 {{count}} 条结果",
}

// 使用
t('history.deleteSelectedConfirm', { count: 5 })
// 输出: "确定删除选中的 5 条记录？"
```

---

## 添加新语言

### 步骤 1: 新建语言包文件并注册

```javascript
// 1. 新建 src/i18n/locales/ja.js（复制 zh.js 的完整结构逐一翻译）
export default {
  app: { name: "T-Translate" },
  nav: { translate: "翻訳", history: "履歴", /* ... */ },
  // ... 与 zh.js 键结构完全一致
};

// 2. src/i18n.js 的 resources 注册
import ja from './i18n/locales/ja.js';
resources: {
  zh: { translation: zh },
  en: { translation: en },
  ja: { translation: ja },  // 添加这行
},
```

同步动作：`scripts/check-i18n.js` 需把新语言纳入比对；`electron/shared/main-i18n.js` 和 `src/utils/ai-prompts.js` 的语言分支也要补对应文案，否则托盘/提示词会回退中文。

### 步骤 2: 更新语言选择器

```jsx
// src/components/SettingsPanel/sections/InterfaceSection.jsx

const LANGUAGES = [
  { code: 'zh', name: '简体中文', nativeName: '简体中文' },
  { code: 'en', name: 'English', nativeName: 'English' },
  { code: 'ja', name: '日本語', nativeName: '日本語' },  // 添加这行
];
```

### 步骤 3: 配置 dayjs 本地化（可选）

```javascript
// src/components/HistoryPanel/index.jsx

import 'dayjs/locale/zh-cn';
import 'dayjs/locale/en';
import 'dayjs/locale/ja';  // 添加这行

// 在组件中根据语言切换
useEffect(() => {
  dayjs.locale(i18n.language === 'zh' ? 'zh-cn' : i18n.language);
}, [i18n.language]);
```

### 语言包模板

```javascript
const newLanguage = {
  // ===== 全局 =====
  app: { name: "T-Translate", version: "" },
  nav: { translate: "", history: "", favorites: "", documents: "", settings: "" },
  status: { ready: "", today: "", online: "", offline: "" },
  screenshot: { failed: "" },
  notify: { unknownError: "", networkError: "" },

  // ===== 设置导航 =====
  settingsNav: {
    searchPlaceholder: "", groupTranslation: "", groupSystem: "",
    providers: "", translation: "", selection: "", floatingWindow: "", document: "",
    ocr: "", tts: "", interface: "", connection: "", privacy: "", about: "",
    export: "", import: "", reset: "", noMatch: "",
    unsavedChanges: "", saving: "", saveChanges: ""
  },

  // ===== 翻译源设置 =====
  providerSettings: {
    title: "", description: "", priorityHint: "",
    configDetails: "", testConnection: "", testing: "", connected: "",
    connectionFailed: "", notTested: "", noConfig: "", saved: "", saveFailed: "",
    typeLabels: { llm: "", api: "", traditional: "" }
  },

  // ===== 翻译设置 =====
  translationSettings: {
    title: "", description: "",
    autoTranslate: "", autoTranslateOn: "", autoTranslateOff: "",
    // ... 完整复制 zh 或 en 的结构
  },

  // ... 继续其他命名空间
};
```

---

## 在代码中使用翻译

### 基本用法

```jsx
import { useTranslation } from 'react-i18next';

const MyComponent = () => {
  const { t } = useTranslation();
  
  return (
    <div>
      <h1>{t('nav.translate')}</h1>
      <p>{t('translation.inputPlaceholder')}</p>
    </div>
  );
};
```

### 带参数的翻译

```jsx
// 定义
// deleteSelectedConfirm: "确定删除选中的 {{count}} 条记录？"

// 使用（弹窗一律走 shared/ConfirmDialog 的 useConfirm，项目禁用 window.confirm）
const confirm = useConfirm();

<button onClick={async () => {
  if (await confirm(t('history.deleteSelectedConfirm', { count: selectedIds.size }))) {
    // ...
  }
}}>
  {t('history.deleteSelected', { count: selectedIds.size })}
</button>
```

### 条件翻译

```jsx
// 根据状态选择不同的翻译键
notify(isFav ? t('history.unfavorited') : t('history.favorited'), 'success');

// 或使用三元表达式
<span>{isEnabled ? t('status.online') : t('status.offline')}</span>
```

### 嵌套键访问

```jsx
// 定义
settings: {
  tabs: { general: "通用", providers: "翻译源" },
  general: {
    themes: { default: "默认", dark: "暗色" }
  }
}

// 使用
t('settings.tabs.general')           // "通用"
t('settings.general.themes.default') // "默认"
```

### 在回调函数中使用

```jsx
const handleCopy = useCallback((text) => {
  navigator.clipboard.writeText(text);
  notify(t('history.copied'), 'success');
}, [notify, t]);  // 注意：t 需要加入依赖数组
```

### 切换语言

```jsx
import { useTranslation } from 'react-i18next';

const LanguageSwitcher = () => {
  const { i18n } = useTranslation();

  const changeLanguage = async (lang) => {
    i18n.changeLanguage(lang);
    // 持久化到 electron-store（真实实现见 InterfaceSection.switchLanguage）——
    // 主进程托盘/菜单和三个窗口都从这个键读语言
    await window.electron?.store?.set('settings.interface.language', lang);
  };

  return (
    <select value={i18n.language} onChange={(e) => changeLanguage(e.target.value)}>
      <option value="zh">中文</option>
      <option value="en">English</option>
    </select>
  );
};
```

### 在非 React 代码中使用

```javascript
// 直接导入 i18n 实例
import i18n from '../i18n.js';

// 获取当前语言
const currentLang = i18n.language;

// 获取翻译
const text = i18n.t('translation.ocrSuccess', { engine: 'RapidOCR' });

// 切换语言
i18n.changeLanguage('en');
```

---

## 最佳实践

### 1. 翻译键提取

```jsx
// ❌ 硬编码
<button title="复制译文">Copy</button>
notify('已复制', 'success');

// ✅ 使用翻译键
<button title={t('favorites.copyTarget')}>Copy</button>
notify(t('history.copied'), 'success');
```

### 2. 保持翻译键结构一致

```javascript
// 所有语言包必须有相同的键结构
const zh = { nav: { translate: "翻译" } };
const en = { nav: { translate: "Translate" } };
const ja = { nav: { translate: "翻訳" } };  // ✅ 结构一致
```

### 3. 避免在翻译中包含 HTML

```jsx
// ❌ 不推荐
translation: {
  welcome: "<strong>欢迎</strong>使用"
}

// ✅ 推荐：在组件中处理样式
translation: {
  welcome: "欢迎使用"
}
<p><strong>{t('welcome').split('使用')[0]}</strong>使用</p>
```

### 4. 处理复数形式

```javascript
// 定义（使用 i18next 复数语法）
items: "{{count}} 条记录",
items_plural: "{{count}} 条记录",  // 英语需要

// 或使用简单方案
items: "{{count}} 条",  // 中文不区分单复数
```

### 5. 日期本地化

```jsx
import dayjs from 'dayjs';
import i18n from '../i18n.js';

// 根据语言格式化日期
const formatDate = (date) => {
  const lang = i18n.language;
  if (lang === 'zh') {
    return dayjs(date).format('YYYY年MM月DD日');
  } else if (lang === 'ja') {
    return dayjs(date).format('YYYY年MM月DD日');
  } else {
    return dayjs(date).format('MMMM D, YYYY');
  }
};
```

### 6. 系统文件夹名称翻译

```jsx
// 定义默认文件夹（保留 name 用于用户自定义）
const DEFAULT_FOLDERS = [
  { id: 'work', name: '工作', color: '#3b82f6' },
  { id: 'glossary', name: '术语库', isSystem: true },
];

// 获取显示名称时使用翻译
const getFolderName = (folder) => {
  if (folder.isSystem) {
    const key = `favorites.folders.${folder.id.replace('_', '')}`;
    return t(key) || folder.name;
  }
  return folder.name;  // 用户自定义文件夹保持原名
};
```

---

## 常见问题

### Q1: 翻译键不存在时显示什么？

```javascript
// i18n.js 配置
i18n.init({
  fallbackLng: 'zh',           // 回退语言
  returnEmptyString: false,    // 空字符串返回键名
  // 自定义缺失处理
  missingKeyHandler: (lng, ns, key) => {
    console.warn(`Missing translation: ${key} [${lng}]`);
  }
});
```

### Q2: 如何调试翻译问题？

```javascript
// 开启调试模式
i18n.init({
  debug: process.env.NODE_ENV === 'development',
});

// 检查当前语言
console.log('Current language:', i18n.language);

// 检查翻译是否存在
console.log('Translation exists:', i18n.exists('nav.translate'));
```

### Q3: 如何处理长文本？

```javascript
// 使用 Trans 组件处理复杂格式
import { Trans } from 'react-i18next';

<Trans i18nKey="welcome.message">
  欢迎使用 <strong>T-Translate</strong>，
  您的智能翻译助手。
</Trans>
```

### Q4: 语言切换后组件不更新？

```jsx
// 确保组件使用了 useTranslation hook
const { t, i18n } = useTranslation();

// 或使用 withTranslation HOC
export default withTranslation()(MyComponent);
```

### Q5: 如何验证翻译完整性？

项目自带三道检查，改动文案后提交前必过：

```bash
npm run check:i18n         # zh/en 键结构同步比对（缺键/多键直接列出）
npm run check:i18n:strict  # 严格模式（额外检查空值等）
npm run check:hardcoded    # 扫描组件里硬编码的中文字符串
```

`main-i18n.js` 的双表不在脚本覆盖范围内——新增键时人工保证 zh/en 两个块都加。

---

## 翻译键清单

键的命名空间和数量以 `npm run check:i18n` 的实时输出为准（本文档不再维护手工计数表）。词表实体共三处：

1. `src/i18n/locales/zh.js` + `en.js` —— 渲染端与主进程栈共用的主词表
2. `electron/shared/main-i18n.js` —— 主进程原生 UI 双语表（托盘/菜单/IPC 错误串）
3. `src/utils/ai-prompts.js` —— AI 提示词双语模板（isZh 分支）

---

## 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| v1.0 | 2026-01-22 | 初始国际化实现，支持中文/英文 |
| v2.0 | 2026-07-10 | 补三层 i18n 体系（渲染端/栈/main-i18n）、locales 拆分文件现实、check 工具链；示例改用 ConfirmDialog 与 electron-store 持久化 |

---

**文档维护者**: T-Translate 开发团队
**最后更新**: 2026-07-10
