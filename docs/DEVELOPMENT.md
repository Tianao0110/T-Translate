# T-Translate 开发者指南

本文档介绍如何为 T-Translate 开发自定义翻译源（Provider）和 OCR 引擎。

---

## 📁 项目结构

```
src/
├── providers/                 # 翻译源
│   ├── base.js               # 翻译源基类
│   ├── registry.js           # 翻译源注册表
│   ├── local-llm/            # 本地 LLM 翻译源
│   │   ├── index.js
│   │   └── icon.svg
│   ├── openai/               # OpenAI 翻译源
│   ├── google-translate/     # Google 翻译源
│   └── ...
├── providers/ocr/            # OCR 引擎
│   ├── base.js               # OCR 引擎基类
│   ├── index.js              # OCR 引擎注册表
│   ├── rapid.js              # RapidOCR 引擎
│   ├── llm-vision.js         # LLM Vision 引擎
│   └── ...
├── services/                 # 服务层
│   ├── translation.js        # 翻译服务（调度）
│   └── ...
├── components/               # UI 组件
│   ├── ProviderSettings.jsx  # 翻译源设置界面
│   ├── SettingsPanel.jsx     # 设置面板
│   └── ...
└── styles/                   # 样式文件
    └── components/
        └── ProviderSettings.css
```

---

## 🔌 自定义翻译源（Provider）

### 1. 基本结构

每个翻译源是一个独立目录，包含：

```
src/providers/my-provider/
├── index.js      # 主文件（必需）
└── icon.svg      # 图标（可选，推荐 24x24）
```

### 2. 创建翻译源类

继承 `BaseProvider` 并实现必要方法：

```javascript
// src/providers/my-provider/index.js

import { BaseProvider, LANGUAGE_CODES } from '../base.js';
import icon from './icon.svg';

/**
 * 自定义翻译源示例
 */
class MyProvider extends BaseProvider {
  
  // ========== 静态元信息（必需）==========
  static metadata = {
    id: 'my-provider',           // 唯一标识符（kebab-case）
    name: '我的翻译源',           // 显示名称
    description: '这是一个示例翻译源', // 简短描述
    icon: icon,                  // 图标（SVG 或图片路径）
    color: '#3b82f6',            // 主题色（用于 UI 高亮）
    type: 'llm',                 // 类型：'llm' | 'api' | 'traditional'
    helpUrl: 'https://...',      // 帮助链接（获取 API Key 等）
    
    // 配置字段声明（用于自动生成设置界面）
    configSchema: {
      apiKey: {
        type: 'password',        // 字段类型
        label: 'API Key',        // 显示标签
        required: true,          // 是否必填
        placeholder: 'sk-...',   // 占位符
        encrypted: true,         // 是否加密存储
      },
      baseUrl: {
        type: 'text',
        label: 'API 地址',
        default: 'https://api.example.com/v1',
        required: false,
        placeholder: 'https://api.example.com/v1',
      },
      model: {
        type: 'select',          // 下拉选择
        label: '模型',
        default: 'model-a',
        options: [
          { value: 'model-a', label: 'Model A' },
          { value: 'model-b', label: 'Model B' },
        ],
      },
      enableCache: {
        type: 'checkbox',        // 复选框
        label: '启用缓存',
        default: true,
      },
    },
  };

  // ========== 构造函数 ==========
  constructor(config = {}) {
    super({
      // 默认配置
      apiKey: '',
      baseUrl: 'https://api.example.com/v1',
      model: 'model-a',
      timeout: 15000,
      ...config,  // 合并传入的配置
    });
  }

  // ========== 属性（可选覆盖）==========
  
  /**
   * 预估延迟等级
   * 'fast' - <500ms（在线 API）
   * 'medium' - 500ms-2s
   * 'slow' - >2s（本地大模型）
   */
  get latencyLevel() {
    return 'fast';
  }

  /**
   * 是否需要外网
   */
  get requiresNetwork() {
    return true;
  }

  /**
   * 是否支持流式输出
   */
  get supportsStreaming() {
    return false;
  }

  // ========== 核心方法（必须实现）==========

  /**
   * 翻译文本
   * @param {string} text - 要翻译的文本
   * @param {string} sourceLang - 源语言代码（'auto' 表示自动检测）
   * @param {string} targetLang - 目标语言代码
   * @returns {Promise<{success: boolean, text?: string, error?: string}>}
   */
  async translate(text, sourceLang = 'auto', targetLang = 'zh') {
    // 1. 参数验证
    if (!text?.trim()) {
      return { success: false, error: '文本为空' };
    }

    if (!this.config.apiKey) {
      return { success: false, error: '未配置 API Key' };
    }

    try {
      // 2. 获取语言名称（用于 prompt）
      const targetName = LANGUAGE_CODES[targetLang]?.name || targetLang;

      // 3. 调用 API
      const response = await fetch(`${this.config.baseUrl}/translate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          text,
          source: sourceLang,
          target: targetLang,
          model: this.config.model,
        }),
        signal: AbortSignal.timeout(this.config.timeout),
      });

      // 4. 处理错误响应
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return { 
          success: false, 
          error: errorData.message || `HTTP ${response.status}` 
        };
      }

      // 5. 解析响应
      const data = await response.json();
      const translatedText = data.translation || data.text;

      if (!translatedText) {
        return { success: false, error: '翻译结果为空' };
      }

      // 6. 返回成功结果
      return {
        success: true,
        text: translatedText,
        detectedLang: data.detected_language,  // 可选
      };

    } catch (error) {
      // 7. 错误处理
      this._lastError = error;
      
      if (error.name === 'AbortError') {
        return { success: false, error: '请求超时' };
      }
      
      return { success: false, error: error.message || '未知错误' };
    }
  }

  // ========== 可选方法 ==========

  /**
   * 流式翻译（支持流式输出时实现）
   * @param {string} text - 要翻译的文本
   * @param {string} sourceLang - 源语言代码
   * @param {string} targetLang - 目标语言代码
   * @param {function} onChunk - 接收每个文本块的回调
   * @returns {Promise<{success: boolean, text?: string, error?: string}>}
   */
  async translateStream(text, sourceLang, targetLang, onChunk) {
    // 如果不支持流式，调用普通翻译
    if (!this.supportsStreaming) {
      const result = await this.translate(text, sourceLang, targetLang);
      if (result.success && onChunk) {
        onChunk(result.text);
      }
      return result;
    }

    // 流式实现示例
    try {
      const response = await fetch(`${this.config.baseUrl}/translate/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({ text, source: sourceLang, target: targetLang }),
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        fullText += chunk;
        
        if (onChunk) {
          onChunk(chunk);
        }
      }

      return { success: true, text: fullText };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * 测试连接
   * @returns {Promise<{success: boolean, message?: string}>}
   */
  async testConnection() {
    if (!this.config.apiKey) {
      return { success: false, message: '未配置 API Key' };
    }

    try {
      // 方式 1: 调用专门的测试接口
      const response = await fetch(`${this.config.baseUrl}/health`, {
        headers: { 'Authorization': `Bearer ${this.config.apiKey}` },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        return { success: false, message: `连接失败: ${response.status}` };
      }

      return { success: true, message: '连接成功' };

    } catch (error) {
      return { success: false, message: error.message || '连接失败' };
    }
  }

  /**
   * 获取可用模型列表（LLM 类型用）
   * @returns {Promise<string[]>}
   */
  async getModels() {
    try {
      const response = await fetch(`${this.config.baseUrl}/models`, {
        headers: { 'Authorization': `Bearer ${this.config.apiKey}` },
      });
      const data = await response.json();
      return data.models || [];
    } catch {
      return [];
    }
  }
}

export default MyProvider;
```

### 3. 注册翻译源

在 `src/providers/registry.js` 中注册：

```javascript
// 1. 导入
import MyProvider from './my-provider/index.js';

// 2. 添加到 providerClasses
const providerClasses = {
  'local-llm': LocalLLMProvider,
  'openai': OpenAIProvider,
  // ... 其他
  'my-provider': MyProvider,  // 添加这行
};

// 3. 添加到 DEFAULT_PRIORITY（可选）
export const DEFAULT_PRIORITY = {
  normal: ['local-llm', 'openai', 'my-provider', ...],
};
```

### 4. 配置字段类型参考

| 类型 | 说明 | 配置示例 |
|------|------|----------|
| `text` | 普通文本输入 | `{ type: 'text', label: '地址', placeholder: 'https://...' }` |
| `password` | 密码输入（可切换显示） | `{ type: 'password', label: 'API Key', encrypted: true }` |
| `select` | 下拉选择 | `{ type: 'select', options: [{value, label}] }` |
| `checkbox` | 复选框 | `{ type: 'checkbox', label: '启用', default: true }` |
| `number` | 数字输入 | `{ type: 'number', min: 0, max: 100 }` |

### 5. 语言代码参考

使用 `LANGUAGE_CODES` 获取标准语言信息：

```javascript
import { LANGUAGE_CODES } from '../base.js';

// LANGUAGE_CODES 结构
{
  'zh': { code: 'zh', name: '中文', nativeName: '中文' },
  'en': { code: 'en', name: 'English', nativeName: 'English' },
  'ja': { code: 'ja', name: '日语', nativeName: '日本語' },
  // ...
}
```

---

## 👁️ 自定义 OCR 引擎

### 1. 基本结构

```javascript
// src/providers/ocr/my-ocr.js

import { BaseOCREngine } from './base.js';

/**
 * 自定义 OCR 引擎示例
 */
class MyOCREngine extends BaseOCREngine {
  
  // ========== 静态元信息（必需）==========
  static metadata = {
    id: 'my-ocr',                // 唯一标识符
    name: '我的 OCR',            // 显示名称
    description: '自定义 OCR 引擎', // 描述
    type: 'online',              // 'local' | 'online'
    tier: 3,                     // 梯队：1=本地首选, 2=视觉模型, 3=在线API
    priority: 40,                // 优先级数值（越小越优先）
    isOnline: true,              // 是否需要联网
    
    // 配置字段
    configSchema: {
      apiKey: {
        type: 'password',
        label: 'API Key',
        required: true,
        placeholder: 'xxx...',
        encrypted: true,
      },
      language: {
        type: 'select',
        label: '识别语言',
        default: 'auto',
        options: [
          { value: 'auto', label: '自动检测' },
          { value: 'zh', label: '中文' },
          { value: 'en', label: 'English' },
          { value: 'ja', label: '日本語' },
        ],
      },
    },
    
    helpUrl: 'https://...',  // 帮助链接
  };

  // ========== 构造函数 ==========
  constructor(config = {}) {
    super({
      apiKey: '',
      language: 'auto',
      ...config,
    });
  }

  // ========== 核心方法 ==========

  /**
   * 检查引擎是否可用
   * @returns {Promise<boolean>}
   */
  async isAvailable() {
    // 检查必要配置是否存在
    return !!this.config.apiKey;
  }

  /**
   * 识别图片中的文字
   * @param {string|Uint8Array} input - base64 图片或二进制数据
   * @param {object} options - 识别选项
   * @returns {Promise<{success: boolean, text?: string, error?: string}>}
   */
  async recognize(input, options = {}) {
    const { apiKey, language } = this.config;
    
    // 1. 验证配置
    if (!apiKey) {
      return { success: false, error: '请配置 API Key' };
    }

    try {
      // 2. 确保输入是 base64 格式
      const base64Data = this.ensureBase64(input);
      
      // 3. 移除 data URL 前缀（如果 API 不需要）
      const pureBase64 = base64Data.replace(/^data:image\/\w+;base64,/, '');

      // 4. 调用 OCR API
      const response = await fetch('https://api.my-ocr.com/recognize', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          image: pureBase64,
          language: options.language || language,
        }),
      });

      // 5. 处理错误
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `HTTP ${response.status}`);
      }

      // 6. 解析结果
      const data = await response.json();
      const text = data.text || data.result;

      if (!text) {
        return { success: false, error: '未识别到文字' };
      }

      // 7. 返回结果（使用 cleanText 清理文本）
      return {
        success: true,
        text: this.cleanText(text),
        engine: 'my-ocr',
        confidence: data.confidence,  // 可选：置信度
        language: data.language,      // 可选：检测到的语言
      };

    } catch (error) {
      console.error('[MyOCR] Error:', error);
      return { success: false, error: error.message };
    }
  }
}

export default MyOCREngine;
```

### 2. 注册 OCR 引擎

在 `src/providers/ocr/index.js` 中注册：

```javascript
// 1. 导入
import MyOCREngine from './my-ocr.js';

// 2. 添加到 engines
const engines = {
  'rapid-ocr': RapidOCREngine,
  'llm-vision': LLMVisionEngine,
  // ... 其他
  'my-ocr': MyOCREngine,  // 添加这行
};

// 3. 添加到默认优先级（可选）
export const DEFAULT_OCR_PRIORITY = [
  'rapid-ocr',
  'llm-vision',
  'my-ocr',  // 添加这行
  // ...
];
```

### 3. 添加 UI 配置

在 `src/components/SettingsPanel.jsx` 的 OCR 设置部分添加：

```jsx
{/* 我的 OCR */}
<div className={`ocr-engine-item ${settings.ocr.engine === 'my-ocr' ? 'active' : ''}`}>
  <div className="engine-info">
    <div className="engine-header">
      <span className="engine-name">我的 OCR</span>
      <span className="engine-badge">在线</span>
    </div>
    <p className="engine-desc">自定义 OCR 引擎描述</p>
    <div className="api-key-input-wrapper">
      <input 
        type={showApiKeys.myOcr ? "text" : "password"}
        className="setting-input compact"
        placeholder="API Key"
        value={settings.ocr.myOcrKey || ''}
        onChange={(e) => updateSetting('ocr', 'myOcrKey', e.target.value)}
      />
      <button 
        type="button"
        className="api-key-toggle"
        onClick={() => setShowApiKeys(prev => ({ ...prev, myOcr: !prev.myOcr }))}
      >
        {showApiKeys.myOcr ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </div>
  </div>
  <div className="engine-actions">
    <button 
      className={`btn ${settings.ocr.engine === 'my-ocr' ? 'active' : ''}`}
      onClick={() => {
        if (settings.ocr.myOcrKey) {
          updateSetting('ocr', 'engine', 'my-ocr');
        } else {
          notify('请先配置 API Key', 'warning');
        }
      }}
    >
      {settings.ocr.engine === 'my-ocr' ? '✓ 使用中' : '使用'}
    </button>
  </div>
</div>
```

### 4. BaseOCREngine 辅助方法

| 方法 | 说明 |
|------|------|
| `this.ensureBase64(input)` | 确保输入转换为 base64 data URL |
| `this.cleanText(text)` | 清理 OCR 输出（统一换行符、去除多余空格）|
| `this.config` | 访问配置对象 |

---

## 🎨 CSS 样式规范

### 1. 命名规范

使用 BEM-like 命名或组件前缀：

```css
/* 组件前缀方式（推荐） */
.ps-container { }      /* ProviderSettings 容器 */
.ps-card { }           /* 卡片 */
.ps-card-header { }    /* 卡片头部 */
.ps-card.enabled { }   /* 状态修饰 */
.ps-card.expanded { }

/* 通用组件 */
.setting-group { }
.setting-label { }
.setting-input { }
.setting-select { }
```

### 2. CSS 变量

项目使用的主要 CSS 变量：

```css
:root {
  /* 颜色 */
  --primary-color: #3b82f6;
  --success-color: #10b981;
  --warning-color: #f59e0b;
  --error-color: #ef4444;
  
  /* 灰度 */
  --gray-50: #f9fafb;
  --gray-100: #f3f4f6;
  --gray-200: #e5e7eb;
  --gray-300: #d1d5db;
  --gray-400: #9ca3af;
  --gray-500: #6b7280;
  --gray-600: #4b5563;
  --gray-700: #374151;
  --gray-800: #1f2937;
  --gray-900: #111827;
  
  /* 间距 */
  --spacing-xs: 4px;
  --spacing-sm: 8px;
  --spacing-md: 16px;
  --spacing-lg: 24px;
  --spacing-xl: 32px;
  
  /* 圆角 */
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-full: 9999px;
  
  /* 阴影 */
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.05);
  --shadow-md: 0 4px 6px rgba(0, 0, 0, 0.1);
  --shadow-lg: 0 10px 15px rgba(0, 0, 0, 0.1);
}
```

### 3. 常用组件样式模板

#### 卡片组件

```css
.my-card {
  background: #fff;
  border: 1px solid var(--gray-200);
  border-radius: var(--radius-lg);
  padding: var(--spacing-md);
  transition: all 0.2s ease;
}

.my-card:hover {
  border-color: var(--gray-300);
  box-shadow: var(--shadow-sm);
}

.my-card.active {
  border-color: var(--primary-color);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}
```

#### 输入框

```css
.my-input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--gray-200);
  border-radius: var(--radius-md);
  font-size: 14px;
  background: #fff;
  transition: all 0.15s;
}

.my-input:focus {
  outline: none;
  border-color: var(--primary-color);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.my-input::placeholder {
  color: var(--gray-400);
}
```

#### 按钮

```css
/* 主要按钮 */
.btn-primary {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 20px;
  border: none;
  border-radius: var(--radius-md);
  background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
  color: #fff;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-primary:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.4);
}

.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* 次要按钮 */
.btn-secondary {
  padding: 8px 16px;
  border: 1px solid var(--gray-200);
  border-radius: var(--radius-md);
  background: #fff;
  color: var(--gray-700);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s;
}

.btn-secondary:hover {
  background: var(--gray-50);
  border-color: var(--gray-300);
}
```

#### 开关

```css
.toggle-switch {
  position: relative;
  width: 44px;
  height: 24px;
  background: var(--gray-200);
  border-radius: var(--radius-full);
  cursor: pointer;
  transition: background 0.2s;
}

.toggle-switch.active {
  background: var(--success-color);
}

.toggle-switch::after {
  content: '';
  position: absolute;
  width: 20px;
  height: 20px;
  background: #fff;
  border-radius: 50%;
  top: 2px;
  left: 2px;
  transition: transform 0.2s;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
}

.toggle-switch.active::after {
  transform: translateX(20px);
}
```

#### 状态徽章

```css
.badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  font-size: 11px;
  font-weight: 500;
}

.badge-success {
  background: #ecfdf5;
  color: #059669;
}

.badge-warning {
  background: #fffbeb;
  color: #d97706;
}

.badge-error {
  background: #fef2f2;
  color: #dc2626;
}

.badge-info {
  background: #eff6ff;
  color: #2563eb;
}
```

### 4. 动画

```css
/* 旋转动画（加载中） */
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.spinning {
  animation: spin 1s linear infinite;
}

/* 淡入 */
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.fade-in {
  animation: fadeIn 0.2s ease;
}

/* 滑入 */
@keyframes slideDown {
  from { 
    opacity: 0;
    transform: translateY(-10px);
  }
  to { 
    opacity: 1;
    transform: translateY(0);
  }
}

.slide-down {
  animation: slideDown 0.2s ease;
}
```

### 5. 响应式设计

```css
/* 移动端适配 */
@media (max-width: 768px) {
  .my-container {
    padding: var(--spacing-sm);
  }
  
  .my-card {
    padding: var(--spacing-sm);
  }
  
  .my-grid {
    grid-template-columns: 1fr;
  }
}

/* 小屏幕 */
@media (max-width: 480px) {
  .btn-group {
    flex-direction: column;
  }
}
```

---

## 📝 最佳实践

### 1. 翻译源开发

- ✅ 总是处理空文本和未配置的情况
- ✅ 使用 `AbortSignal.timeout()` 设置超时
- ✅ 返回有意义的错误消息
- ✅ 支持 `auto` 源语言检测
- ✅ 加密存储敏感配置（设置 `encrypted: true`）
- ❌ 不要在代码中硬编码 API Key
- ❌ 不要忽略网络错误

### 2. OCR 引擎开发

- ✅ 使用 `ensureBase64()` 处理输入格式
- ✅ 使用 `cleanText()` 清理输出
- ✅ 实现 `isAvailable()` 检查可用性
- ✅ 处理 "无文字" 的情况
- ❌ 不要假设输入格式

### 3. CSS 开发

- ✅ 使用 CSS 变量保持一致性
- ✅ 添加 hover/focus 状态
- ✅ 考虑禁用状态样式
- ✅ 使用 transition 添加过渡效果
- ❌ 不要使用 `!important`（除非必要）
- ❌ 不要使用内联样式

---

## 🔧 调试技巧

### 1. 翻译源调试

```javascript
// 在 translate() 方法中添加日志
console.log(`[${this.constructor.metadata.id}] Translating:`, { text, sourceLang, targetLang });
console.log(`[${this.constructor.metadata.id}] Response:`, data);
```

### 2. 控制台检查配置

```javascript
// 查看翻译服务状态
console.log(await window.electron?.store?.get('settings'));

// 查看安全存储
console.log(localStorage.getItem('__secure_provider_my-provider_apiKey'));
```

### 3. 网络请求调试

使用浏览器开发者工具的 Network 面板查看 API 请求和响应。

---

## 📚 相关文件

| 文件 | 说明 |
|------|------|
| `src/providers/base.js` | 翻译源基类 |
| `src/providers/registry.js` | 翻译源注册表 |
| `src/providers/ocr/base.js` | OCR 引擎基类 |
| `src/providers/ocr/index.js` | OCR 引擎注册表 |
| `src/services/translation.js` | 翻译服务（调度逻辑） |
| `src/components/ProviderSettings.jsx` | 翻译源设置 UI |
| `src/components/SettingsPanel.jsx` | 设置面板 |
| `docs/ARCHITECTURE.md` | 架构文档 |

---

## ❓ 常见问题

### Q: 新增的翻译源不显示？
A: 检查是否在 `registry.js` 中注册，并确保 `metadata` 定义正确。

### Q: 配置保存后不生效？
A: 确保调用了 `translationService.reload()` 刷新配置。

### Q: API Key 显示为 `***encrypted***`？
A: 这是正常的，加密字段会在加载时自动解密。

### Q: 测试连接失败但翻译成功？
A: 可能是测试接口和翻译接口不同，检查 `testConnection()` 实现。
