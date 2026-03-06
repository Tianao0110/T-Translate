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

### 架构设计

```
┌─────────────────────────────────────────────────────────┐
│                    React Components                      │
│                   useTranslation() hook                  │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│                    react-i18next                         │
│                  <I18nextProvider>                       │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│                       i18next                            │
│              语言检测 → 翻译查找 → 插值处理               │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│                   src/i18n.js                            │
│              zh: {...}, en: {...}, ...                   │
└─────────────────────────────────────────────────────────┘
```

---

## 文件结构

```
src/
├── i18n.js                 # 核心配置 + 所有语言包
├── main.jsx                # 应用入口，初始化 i18n
│
├── components/
│   ├── MainWindow/
│   │   └── index.jsx       # useTranslation() 使用示例
│   ├── TranslationPanel/
│   ├── HistoryPanel/
│   ├── FavoritesPanel/
│   └── SettingsPanel/
│       ├── index.jsx
│       └── sections/
│           ├── InterfaceSection.jsx  # 语言切换 UI
│           └── ...
│
└── stores/
    └── translation-store.js  # 可选：语言偏好持久化
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
  glassWindowSettings: { ... },     // 玻璃窗口
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

### 步骤 1: 在 i18n.js 中添加语言包

```javascript
// src/i18n.js

// 1. 定义新语言包（以日语为例）
const ja = {
  app: { name: "T-Translate", version: "バージョン" },
  nav: { translate: "翻訳", history: "履歴", favorites: "お気に入り", documents: "ドキュメント", settings: "設定" },
  status: { ready: "準備完了", today: "今日", online: "オンライン", offline: "オフライン" },
  // ... 复制 zh 或 en 的完整结构，逐一翻译
};

// 2. 添加到 i18n 初始化
i18n.use(initReactI18next).init({
  resources: {
    zh: { translation: zh },
    en: { translation: en },
    ja: { translation: ja },  // 添加这行
  },
  // ...
});
```

### 步骤 2: 更新语言选择器

```jsx
// src/components/SettingsPanel/sections/InterfaceSection.jsx

const AVAILABLE_LANGUAGES = [
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
    providers: "", translation: "", selection: "", glassWindow: "", document: "",
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

// 使用
<button onClick={() => {
  if (window.confirm(t('history.deleteSelectedConfirm', { count: selectedIds.size }))) {
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
  
  const changeLanguage = (lang) => {
    i18n.changeLanguage(lang);
    // 可选：持久化到 localStorage
    localStorage.setItem('language', lang);
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

```bash
# 可以创建脚本检查所有语言包的键是否一致
node scripts/check-i18n.js

# check-i18n.js 示例
const zh = require('../src/i18n').zh;
const en = require('../src/i18n').en;

function getKeys(obj, prefix = '') {
  return Object.keys(obj).flatMap(key => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof obj[key] === 'object' ? getKeys(obj[key], path) : path;
  });
}

const zhKeys = getKeys(zh);
const enKeys = getKeys(en);

const missingInEn = zhKeys.filter(k => !enKeys.includes(k));
const missingInZh = enKeys.filter(k => !zhKeys.includes(k));

console.log('Missing in EN:', missingInEn);
console.log('Missing in ZH:', missingInZh);
```

---

## 翻译键完整清单

当前项目包含约 **520+ 翻译键**，分布在以下命名空间：

| 命名空间 | 键数量 | 说明 |
|---------|:------:|------|
| `app` | 2 | 应用名称、版本 |
| `nav` | 5 | 导航栏标签 |
| `status` | 4 | 状态栏 |
| `screenshot` | 1 | 截图功能 |
| `notify` | 2 | 通用通知 |
| `settingsNav` | 20+ | 设置导航栏 |
| `providerSettings` | 15+ | 翻译源设置 |
| `translationSettings` | 30+ | 翻译设置 |
| `selectionSettings` | 25+ | 划词翻译 |
| `glassWindowSettings` | 25+ | 玻璃窗口 |
| `documentSettings` | 20+ | 文档翻译 |
| `connectionSettings` | 10+ | LM Studio 连接 |
| `translation` | 40+ | 翻译面板 |
| `history` | 50+ | 历史记录 |
| `favorites` | 45+ | 收藏夹 |
| `languages` | 12 | 语言列表 |
| `ocr` | 15+ | OCR 设置 |
| `tts` | 15+ | 语音朗读 |
| `privacy` | 25+ | 隐私模式 |
| `about` | 15+ | 关于页面 |
| `shortcuts` | 15+ | 快捷键 |
| `settings` | 30+ | 通用设置 |

---

## 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| v1.0 | 2026-01-22 | 初始国际化实现，支持中文/英文 |

---

**文档维护者**: Edan Zeng
**最后更新**: 2026-01-22
