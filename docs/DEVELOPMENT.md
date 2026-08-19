# T-Translate 开发者指南

本文档介绍如何为 T-Translate 开发自定义翻译源（Provider）和 OCR 引擎，以及 UI/样式规范与调试方法。

> **v0.3.1 起的关键事实**：翻译源与在线 OCR 引擎全部运行在**主进程翻译栈**（`src/stack/`，经 esbuild 打包为 `electron/generated/translation-stack.cjs`），渲染进程不再包含任何翻译/在线 OCR 网络代码。开发新翻译源 = 改 `src/stack/`，不是改渲染端。

---

## 📁 开发者视角的代码分布

```
src/stack/                      # 主进程翻译栈（ESM 源码，esbuild 打包，运行时单实例）
├── index.js                    # createStack 入口（ctx 依赖注入）
├── service.js                  # 调度：provider 路由/降级/两级缓存/免译过滤器/隐私门控
├── registry.js                 # 翻译源注册表 + DEFAULT_PRIORITY
├── runtime.js                  # rtFetch（Electron net.fetch 封装，网络唯一出口）
├── i18n.js                     # 栈内 _t（复用 src/i18n/locales 词表）
├── providers/
│   ├── base.js                 # BaseProvider + _t + combineSignal
│   ├── metadata.js             # ★ 跨端共享元数据表（configSchema 驱动表单与密钥加密）
│   ├── presets-core.js         # OpenAI 兼容预设（加兼容源只需在这加条目）
│   ├── presets.js              # 预设 → Provider 类的包装
│   └── <id>.js                 # 独立翻译源类（deepl/gemini/anthropic/...）
└── ocr/
    ├── base.js                 # BaseOCREngine + _t
    ├── manager.js              # ★ OCR 引擎注册表 + 自动降级链 + vision 全局锁
    ├── local-bridge.js         # 本地引擎桥（主进程内直调 ocr-engine/windows-ocr）
    └── <id>.js                 # 在线引擎类（ocrspace/google-vision/azure/baidu/llm-vision）

src/（渲染端，只管 UI）
├── services/stack-client.js    # 栈的渲染端客户端（stack:* IPC，同名 API）
├── config/provider-icons.js    # ★ 翻译源图标 + 显示顺序（渲染端专属，svg 不进栈 bundle）
├── assets/provider-icons/      # 翻译源 svg 图标
└── components/ProviderSettings # 按 metadata.configSchema 自动渲染配置表单
```

### 栈内三条铁律（违反 = 必然出 bug）

1. **网络请求只能走 `rtFetch`**（`../runtime.js`）——它是 Electron `net.fetch`，走 Chromium 网络栈和系统代理。直接用 Node `fetch` 会绕过代理，代理用户直接断网。
2. **栈内禁止 import `electron`、`window`、`localStorage`**——栈被 esbuild 打包进主进程，环境依赖全部经 `createStack(ctx)` 注入。
3. **用户可见文案走 `_t(key, 中文fallback)`**——栈有独立 i18n 实例，词表与渲染端同源（`src/i18n/locales`），新增 key 两端词表都要加并过 `npm run check:i18n`。

---

## 🔌 新增翻译源（Provider）

### 路线 A：OpenAI 兼容 API（最常见，零类文件）

很多服务商（SiliconFlow、Moonshot、各类中转站…）都暴露 OpenAI 兼容接口。只需两步：

1. `src/stack/providers/presets-core.js` 的 `PRESET_CORE` 加一个条目：

```javascript
{
  id: 'my-service',
  defaults: {
    apiKey: '',
    model: 'default-model',
    endpoint: 'https://api.my-service.com/v1',
    timeout: 15000,
  },
  latencyLevel: 'fast',        // 'fast' | 'medium' | 'slow'
  requiresNetwork: true,
  hooks: {
    requireApiKey: true,       // 未配置 key 时直接短路报错
    // 可选：filterModels、fieldAdapter 等，参考 openai 条目
  },
},
```

2. `src/stack/providers/metadata.js` 加对应的元数据 + `configSchema`（见下文），
   再按「渲染端登记」补图标即可。

### 路线 B：独立协议的翻译源

在 `src/stack/providers/my-provider.js` 创建类（参考 `deepl.js`，它是最小的独立源）：

```javascript
import { BaseProvider, _t, combineSignal } from './base.js';
import { PROVIDER_METADATA } from './metadata.js';
import { rtFetch } from '../runtime.js';

class MyProvider extends BaseProvider {
  // 元数据不写在类里 —— 单源在 metadata.js（跨端共享）
  static metadata = PROVIDER_METADATA['my-provider'];

  constructor(config = {}) {
    super({ apiKey: '', timeout: 15000, ...config });
  }

  get latencyLevel() { return 'fast'; }      // 'fast' | 'medium' | 'slow'
  get requiresNetwork() { return true; }     // 离线模式白名单依据，必须诚实
  get supportsStreaming() { return false; }

  async translate(text, sourceLang = 'auto', targetLang = 'zh', options = {}) {
    if (!this.config.apiKey) {
      return { success: false, error: _t('providerError.notConfigured', '未配置 API Key') };
    }
    try {
      const response = await rtFetch(`${this.baseUrl}/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.config.apiKey}` },
        body: JSON.stringify({ text, source: sourceLang, target: targetLang }),
        // combineSignal 合并调用方 abort 信号与超时 —— 取消翻译真的会断请求
        signal: combineSignal(options.signal, this.config.timeout),
      });
      if (!response.ok) return { success: false, error: `HTTP ${response.status}` };
      const data = await response.json();
      return data.translation
        ? { success: true, text: data.translation }
        : { success: false, error: _t('providerError.emptyResult', '翻译结果为空') };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // 可选：translateStream(text, src, tgt, onChunk, options)、testConnection()、getModels()
}

export default MyProvider;
```

### 元数据表（两条路线都必做）

`src/stack/providers/metadata.js` 加条目。**这张表是单源**：渲染端设置表单按 `configSchema` 自动生成，主进程按 `encrypted: true` 决定哪些字段进 DPAPI 加密仓——两端不会漂移。表内必须保持纯 JSON 可序列化（会原样过 IPC）。

```javascript
'my-provider': {
  id: 'my-provider',
  name: '我的翻译源',
  description: '一句话描述',
  color: '#3b82f6',            // 卡片强调色（品牌色，数据例外可写死）
  type: 'llm',                 // 'llm' | 'api' | 'traditional'
  helpUrl: 'https://...',      // "获取 API Key" 跳转
  configSchema: {
    apiKey: { type: 'password', label: 'API Key', required: true, encrypted: true, placeholder: 'sk-...' },
    baseUrl: { type: 'text', label: 'API 地址', default: 'https://...', required: false },
    model:  { type: 'text', label: '模型', default: '...', required: false },
    timeout:{ type: 'number', label: '超时 (ms)', default: 15000, required: false },
  },
},
```

字段类型：`text` / `password`（配 `encrypted: true` 走 safeStorage）/ `select`（带 `options`）/ `checkbox` / `number`。

### 注册与渲染端登记

1. **栈注册**：`src/stack/registry.js` —— import 类 + 加进 `providerClasses` + `DEFAULT_PRIORITY.normal` 排个位置（路线 A 的预设自动注册，跳过 import）。
2. **渲染端图标**：svg 放 `src/assets/provider-icons/my-provider.svg`，在 `src/config/provider-icons.js` 的 `PROVIDER_ICONS` 和 `ORDER` 各加一行（ORDER 决定设置页显示顺序）。
3. **常量表**：`npm run check:constants` 会校验 PROVIDER_IDS 跨文件同步，报错就按提示补齐。

### 验证

```bash
npm run stack:build   # 栈必须能打包
npm test              # 单测
npm start             # 实测：设置页出卡片、填 key、测试连接、翻译
```

---

## ✨ 新增 AI 动作（总结 / 理解那一族）

**动作是数据不是代码**——正常情况下你不写 JS，只加一份配置。

内置动作加在 `src/config/ai-actions.js` 的 `BUILTIN_AI_ACTIONS`；用户侧的第三方
动作走设置页「AI 动作 → 导入配置文件」，两者字段完全一致、过同一个闸门。

```javascript
{
  id: 'explain-steps',              // 小写字母/数字/连字符，2-40 位
  schemaVersion: 1,
  icon: 'Lightbulb',                // lucide 名，见 shared/AiActionIcon.jsx 的映射
  nameKey: 'aiActions.xxx.name',    // 内置用 i18n key；导入的用 labels: { zh, en }
  capability: 'text',               // 'text' 需要能对话的源；'vision' 需要视觉模型
  outputLanguage: 'target',         // target/source/ui 或语言码——模型用哪种语言回答
  history: 'attach',                // 'attach' 挂到翻译条目下；'none' 不进主历史
  trigger: {
    surfaces: ['floating'],         // selection | screenshot | floating | document
    displayModes: ['unified'],      // null = 不限；散点内容通常没有总结价值
    minLength: { cjk: 150, latin: 120 },  // null = 不卡长度
    mode: 'understand',             // translate=看的一侧 / understand=懂的一侧 / any
  },
  prompts:       { zh: { system, user }, en: { ... } },   // 路径 A：喂识别出的文本
  visionPrompts: { zh: { system, user }, en: { ... } },   // 路径 B：喂截图本身（可省）
}
```

要点：

- **模板变量只有四个**：`{{sourceText}}` `{{translatedText}}` `{{sourceLanguage}}`
  `{{outputLanguage}}`。写错的变量名会在导入时被拒收，不会被当字面量发给模型
- **提示词必须双语**：中文包裹的指令会把弱模型带偏成中文回答（和 `utils/ai-prompts`
  同一个理由）
- **带了 `visionPrompts` 才算支持路径 B**。措辞得换——图里没有 `{{sourceText}}`
  可以贴，模型是在看版面
- **`mode: 'understand'` 的动作会接管悬浮窗的理解模式**，导入的优先于内置：装一份
  就换掉默认的「讲解」，主程序不用改

改完跑 `npm test`——`tests/unit/ai-actions.test.js` 覆盖触发判定与导入校验。

---

## 🌐 新增语言

语言目录是**一张共享表**：`src/config/languages.js`，渲染端（选择器）和主进程栈
（提示词里的语言名）共用同一份。加一种语言：

1. `LANGUAGES` 加一条 `{ code, name, nativeName, en }`
2. 如果它的中文名首字不在 `PINYIN_INITIALS` 里，补一个字→拼音首字母的映射
   （中文界面的字母索引靠它，缺了会静默落进 `#` 组）
3. `npm run check:languages` —— 校验目录无重复码、具名枚举是子集、各 provider
   映射不含目录外的语言
4. `node scripts/verify-google-languages.mjs` —— 逐个向谷歌实际请求一次翻译，
   报出被拒绝或原样返回的码。**别靠肉眼保证码是对的**：错的码不会抛错，只会
   静默返回未翻译的原文。这个脚本不进 check:all（一种语言一次网络请求）

传统翻译源的映射按需补：Google/微软吃 ISO 码、未映射直传；百度那套是自定义码
（jp/kor/fra/vie），漏了会发出它不认识的码；DeepL 未映射即报"不支持"，是刻意的。

## 👁️ 新增 OCR 引擎

在线 OCR 引擎同样活在栈里：`src/stack/ocr/my-ocr.js`（参考 `ocrspace.js`，最小样板）：

```javascript
import { BaseOCREngine, _t } from './base.js';
import { rtFetch } from '../runtime.js';

class MyOCREngine extends BaseOCREngine {
  static metadata = {
    id: 'my-ocr',
    name: '我的 OCR',
    description: '一句话描述',
    type: 'online',            // OCR 元数据独立于翻译源表，直接写在类上
    tier: 3,                   // 1=本地首选 2=视觉模型 3=在线 API
    priority: 40,              // 降级链内排序（越小越优先）
    isOnline: true,            // 离线模式白名单依据，必须诚实
    configSchema: { apiKey: { type: 'password', label: 'API Key', required: true, encrypted: true } },
    helpUrl: 'https://...',
  };

  constructor(config = {}) { super({ apiKey: '', ...config }); }

  async isAvailable() { return !!this.config.apiKey; }

  async recognize(input, options = {}) {
    const base64 = this.ensureBase64(input).replace(/^data:image\/\w+;base64,/, '');
    const response = await rtFetch('https://api.my-ocr.com/recognize', { /* ... */ });
    const data = await response.json();
    return data.text
      ? { success: true, text: this.cleanText(data.text), engine: 'my-ocr' }
      : { success: false, error: _t('ocr.noText', '未识别到文字') };
  }
}

export default MyOCREngine;
```

登记三处：

1. `src/stack/ocr/manager.js` —— import + `engines` 表 + `DEFAULT_OCR_PRIORITY`（决定自动降级链位置）。
2. `src/config/constants.js` 与 `electron/shared/constants.js` 的 `OCR_ENGINES` 常量表（`check:constants` 锁同步）。
3. 设置页 UI：`src/components/SettingsPanel/sections/OcrSection.jsx` 加引擎卡片（参考现有在线引擎块；密钥输入走统一的 OCR 密钥仓，保存时自动 DPAPI 加密）。

注意：非标准隐私模式下引擎走 `allowedEngines` 白名单（`src/stack/privacy-modes.js`），新在线引擎默认**不在**离线白名单——这是设计，不要绕。

---

## 🎨 UI 与样式规范

样式令牌的完整说明在 [THEME_CUSTOMIZATION.md](THEME_CUSTOMIZATION.md)，开发时只需记住这几条硬规则：

- **颜色一律主题令牌**：`var(--accent-primary)`、`var(--bg-*)`、`var(--text-*)`；透明变体用 `color-mix(in srgb, var(--accent-primary) 12%, transparent)`。**禁止写死 rgba/hex 蓝色**——项目有 light/dark/fresh 三主题，写死=另外两个主题破相。（provider 品牌色 `metadata.color` 是唯一数据例外。）
- **强调色底上的文字**用 `--text-on-accent`（深色主题是琥珀金底，白字不可读）。
- **悬浮窗/划词窗不加载 App.css 令牌表**：这两个独立窗口只能用各自的局部变量（`--floating-*` / `--sel-*`），引用 `--accent-*` 会静默失效。
- **图标一律 [lucide-react](https://lucide.dev/)**，不用 emoji。
- **弹窗用 `shared/ConfirmDialog`**（`useConfirm()` Promise 式），禁止 `window.confirm`。
- **常驻面板（display:none 挂载）的 window 级快捷键**必须走 `hooks/use-visible-hotkey`，否则隐藏页签也会响应按键。
- 类名用组件前缀（`.ps-card`、`.setting-group`），不用内联样式堆布局。

---

## 🔧 调试技巧

```javascript
// 渲染端 DevTools（F12）里：

// 看设置（密钥字段已剥离，密文在主进程 __encrypted_* 键，不落明文）
await window.electron.store.get('settings')

// 手动触发栈重载（设置保存后会自动 reload 并广播 stack:changed）
await window.electron.stack.reload()

// 栈缓存统计 / 清空
await window.electron.stack.cacheStats()
await window.electron.stack.clearCache('all')
```

- **主进程/栈日志**：设置 → 关于 → 打开日志目录（`%APPDATA%/t-translate/logs/app-*.log`），翻译栈与 OCR 管线日志都在这。
- **划词链路探针**：`npm run start:debug`（`TT_SELECTION_DEBUG=1`）输出选区检测各层判定。
- **网络请求**：主进程栈的请求不经过渲染端 DevTools Network 面板，看日志或在 provider 里临时加 log。

## ✅ 提交前检查

```bash
npx eslint . --quiet     # 0 error（全仓已归零，不许回退）
npm test                 # vitest
npm run stack:build      # 栈可打包
npx vite build           # 渲染端可构建
npm run check:all        # 常量表 + i18n + 硬编码中文
```

---

## 📚 相关文件

| 文件 | 说明 |
|------|------|
| `src/stack/providers/metadata.js` | 翻译源元数据单源（configSchema 驱动表单+加密） |
| `src/stack/registry.js` | 翻译源注册表 + 默认优先级 |
| `src/stack/ocr/manager.js` | OCR 引擎注册表 + 降级链 |
| `src/stack/runtime.js` | rtFetch（网络唯一出口） |
| `src/config/provider-icons.js` | 渲染端图标 + 显示顺序 |
| `src/services/stack-client.js` | 渲染端栈客户端 |
| `electron/ipc/translation-stack.js` | 栈 IPC facade（隐私注入/abort/流帧） |
| `docs/ARCHITECTURE.md` | 架构文档 |

---

## ❓ 常见问题

**Q: 新增的翻译源不显示？**
A: 四处检查：stack/registry.js 注册、metadata.js 表项、provider-icons.js 的 ICONS+ORDER、`npm run stack:build` 是否重新打包（dev 启动会自动打包）。

**Q: 配置保存后不生效？**
A: 设置页保存会自动触发栈 reload 并广播三窗，无需手动处理；自己写的调试路径可以调 `window.electron.stack.reload()`。

**Q: API Key 在设置里显示为密文/空？**
A: 正常。密钥经 Windows DPAPI 加密存主进程，设置页加载时经审计通道解密回填，明文永不落盘。

**Q: 翻译源在离线模式下不可用？**
A: 设计如此：`requiresNetwork: true` 的源在 OFFLINE 模式被主进程强制排除，渲染端无法绕过。
