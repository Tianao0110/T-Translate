# T-Translate M-V-S-P 架构文档

## 版本：v94 - 架构重构

---

## 一、架构概述

采用 **M-V-S-P** (Model-View-Service-Provider) 四层架构：

```
┌─────────────────────────────────────────────────────────────┐
│ Component 层 (View) - 显示器/遥控器                          │
│ 监听 Store + 触发 Service，禁绝业务逻辑                      │
├─────────────────────────────────────────────────────────────┤
│ Service 层 - 指挥官/大脑                                     │
│ 业务逻辑、组合工具、决策、Fallback                           │
├─────────────────────────────────────────────────────────────┤
│ Store 层 (Model) - 记忆体/账本                              │
│ 唯一真实数据源，只存数据，无业务逻辑                         │
├─────────────────────────────────────────────────────────────┤
│ Provider 层 - 工具箱/雇佣兵                                  │
│ 无脑执行单一技术动作，统一接口                               │
└─────────────────────────────────────────────────────────────┘
```

### 核心原则

1. **控制反转 (IoC)**: UI 发号施令，Service 调度指挥，Provider 干苦力，Store 记账
2. **单一职责 (SRP)**: 每层只做自己的事
3. **依赖方向**: Component → Service → Provider/Store

---

## 二、目录结构

```
src/
├── components/            # View - 只画图
│   ├── GlassTranslator/   # ✅ 调用 Service (pipeline)
│   ├── TranslationPanel.jsx
│   ├── SelectionTranslator.jsx  # ✅ 已重构，使用 translationService
│   ├── ProviderSettings.jsx
│   └── SettingsPanel.jsx

├── providers/             # Provider - 工具箱
│   ├── registry.js        # ★ 注册表 + 实例管理
│   ├── base.js            # 基类
│   ├── local-llm/
│   ├── openai/
│   ├── gemini/
│   ├── deepseek/
│   ├── deepl/
│   ├── google-translate/
│   └── ocr/
│       ├── index.js       # OCR 管理器
│       ├── rapid.js
│       └── llm-vision.js

├── services/              # Service - 指挥官
│   ├── index.js           # 统一导出
│   ├── translation.js     # ★ 核心翻译调度 (含 Fallback)
│   ├── translator.js      # 模板 + 缓存封装
│   ├── cache.js           # 翻译缓存
│   ├── pipeline.js        # 玻璃窗流水线
│   └── translation-service.js  # 兼容层

├── stores/                # Store - 只存数据
│   ├── config.js          # ✅ 配置（持久化）
│   ├── session.js         # ✅ 会话状态（非持久化）
│   └── translation-store.js  # ⚠️ 待进一步优化

└── utils/                 # 纯工具
    ├── text.js
    ├── image.js
    └── ...
```

---

## 三、各层详解

### 3.1 Provider 层

**职责**：无脑执行单一技术动作

**规则**：
- 不知道谁在调用
- 统一接口 (translate, testConnection, isConfigured)
- 无状态，不调用 Store

**文件**：

| 文件 | 说明 |
|------|------|
| `registry.js` | 实例管理、配置管理、元信息查询 |
| `base.js` | Provider 基类 |
| `local-llm/` | 本地 LLM (LM Studio) |
| `openai/` | OpenAI API |
| `gemini/` | Google Gemini |
| `deepseek/` | DeepSeek |
| `deepl/` | DeepL |
| `google-translate/` | Google 翻译 |

**registry.js 关键方法**：

```javascript
// 获取 Provider 实例
getProvider(id)

// 检查是否已配置
isProviderConfigured(id)

// 更新配置
updateProviderConfig(id, config)

// 初始化配置
initConfigs(allConfigs)

// 获取所有状态
getAllProvidersStatus()
```

### 3.2 Service 层

**职责**：业务逻辑、组合工具、决策

**规则**：
- 不操作 UI
- 不直接存数据（通过 Store）
- 负责调度 Provider

**文件**：

| 文件 | 说明 |
|------|------|
| `translation.js` | ★ 核心翻译调度，含 Fallback |
| `translator.js` | 模板 + 缓存封装 |
| `cache.js` | 翻译缓存服务 |
| `pipeline.js` | 玻璃窗流水线 (截图→OCR→翻译) |

**translation.js 关键方法**：

```javascript
// 翻译（带 Fallback）
translate(text, { sourceLang, targetLang, mode })

// 流式翻译
translateStream(text, options, onChunk)

// 测试连接
testProvider(providerId)

// 设置模式
setMode('normal' | 'subtitle')
```

### 3.3 Store 层

**职责**：唯一真实数据源

**规则**：
- 只存数据
- 只有 `setXXX` 方法
- 无业务逻辑

**文件**：

| 文件 | 说明 |
|------|------|
| `config.js` | ✅ 用户配置（持久化） |
| `session.js` | ✅ 会话状态（非持久化） |
| `translation-store.js` | ⚠️ 仍含业务逻辑，待优化 |

### 3.4 Component 层

**职责**：显示 + 触发

**规则**：
- 监听 Store 状态
- 调用 Service 方法
- 禁绝业务逻辑

**调用关系**：

```
GlassTranslator → pipeline.js → translationService → registry
TranslationPanel → translation-store → translator → translationService
SelectionTranslator → translationService → registry
ProviderSettings → registry (直接创建临时实例测试)
SettingsPanel → translationService
```

---

## 四、数据流

### 场景A：玻璃窗自动翻译

```
定时器触发
    ↓
GlassTranslator.handleCapture()
    ↓
pipeline.runFromCapture()
    ├── 截图 (electron API)
    ├── Hash 去重
    ├── ocrManager.recognize()
    └── translationService.translate()
            ├── 按优先级尝试 Provider
            ├── Fallback 处理
            └── 返回结果
    ↓
session.setResult()
    ↓
UI 自动更新
```

### 场景B：划词翻译

```
用户选中文字
    ↓
SelectionTranslator.handleTriggerClick()
    ↓
translationService.translate()
    ├── 按优先级尝试 Provider
    └── Fallback 处理
    ↓
显示翻译结果
```

---

## 五、重构记录

### v94 变更

1. **删除 `manager.js`**
   - Fallback 逻辑移到 `translation.js`
   - 实例管理合并到 `registry.js`

2. **新建 `translation.js`**
   - 核心翻译调度服务
   - 包含 Fallback、模式管理、初始化

3. **新建 `cache.js`**
   - 独立的翻译缓存服务
   - 从 `translator.js` 拆分出来

4. **重写 `translator.js`**
   - 简化为模板 + 缓存封装
   - 核心翻译委托给 `translation.js`

5. **重写 `SelectionTranslator.jsx`**
   - 移除直接 fetch 调用
   - 使用 `translationService`

6. **新建 `main-translation.js`**
   - 主窗口翻译业务逻辑
   - 从 `translation-store.js` 移出

7. **重构 `translation-store.js`**
   - 移除业务逻辑（translate, streamTranslate, batchTranslate, recognizeImage）
   - 业务方法委托给 `main-translation` service
   - 从 823 行减少到 512 行

8. **重构 `TranslationPanel.jsx`**
   - 移除直接导入 `ocrManager`
   - OCR 调用改为通过 store 的 `recognizeImage` 方法

9. **重构 `ProviderSettings.jsx`**
   - 移除直接导入 `createProvider`
   - 测试连接改为通过 `translationService.testProviderWithConfig`

10. **translation.js 添加 `testProviderWithConfig`**
    - 支持使用自定义配置测试连接
    - 供设置面板使用（测试未保存的配置）

---

## 六、架构完整性

✅ **所有层级均符合 M-V-S-P 规范**

| 层 | 目录 | 状态 |
|---|------|------|
| **M** (Model) | `stores/` | ✅ 纯数据，业务委托 Service |
| **V** (View) | `components/` | ✅ 只调用 Service/Store |
| **S** (Service) | `services/` | ✅ 业务逻辑集中 |
| **P** (Provider) | `providers/` | ✅ 纯工具，无业务逻辑 |

---

## 七、添加新翻译源

1. 在 `providers/` 下创建文件夹
2. 创建 `index.js` 和 `icon.svg`
3. 继承 `BaseProvider`
4. 添加 `static metadata`
5. 在 `registry.js` 中注册

```javascript
// providers/my-provider/index.js
import BaseProvider from '../base.js';
import icon from './icon.svg';

class MyProvider extends BaseProvider {
  static metadata = {
    id: 'my-provider',
    name: 'My Provider',
    description: '描述',
    icon: icon,
    color: '#xxx',
    type: 'api',
    configSchema: { ... }
  };

  async translate(text, from, to) {
    // 实现翻译
  }
}

export default MyProvider;
```

```javascript
// registry.js
import MyProvider from './my-provider';

const providerClasses = {
  // ...
  'my-provider': MyProvider,
};
```

---

## 八、核心理念

> "UI 发号施令，Service 调度指挥，Provider 干苦力，Store 记账"

保持这个原则，代码结构就会清晰、易维护。
