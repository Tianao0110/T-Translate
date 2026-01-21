# TTS 引擎开发指南

本文档介绍如何为 T-Translate 开发自定义 TTS（文本转语音）引擎。

---

## 📁 目录结构

```
src/services/tts/
├── base.js           # TTS 引擎基类（接口定义）
├── index.js          # TTS 管理器
├── web-speech.js     # Web Speech API 引擎（内置）
└── [your-engine].js  # 自定义引擎
```

---

## 🔌 创建自定义 TTS 引擎

### 步骤 1：继承基类

```javascript
// src/services/tts/my-tts.js

import { BaseTTSEngine, TTS_STATUS } from './base.js';

/**
 * 自定义 TTS 引擎示例
 */
export class MyTTSEngine extends BaseTTSEngine {
  
  // ========== 静态元信息（必需）==========
  static metadata = {
    id: 'my-tts',                // 唯一标识符
    name: '我的 TTS',            // 显示名称
    description: '自定义 TTS 引擎描述',
    type: 'cloud',               // 类型：'local' | 'cloud'
    isOnline: true,              // 是否需要联网
    supportedLanguages: ['zh', 'en', 'ja'],  // 支持的语言
    
    // 配置字段（用于设置界面）
    configSchema: {
      apiKey: {
        type: 'password',
        label: 'API Key',
        required: true,
        placeholder: 'xxx...',
      },
      voiceId: {
        type: 'select',
        label: '默认语音',
        options: [
          { value: 'voice-1', label: '语音 1' },
          { value: 'voice-2', label: '语音 2' },
        ],
      },
    },
  };

  // ========== 构造函数 ==========
  constructor(config = {}) {
    super({
      apiKey: '',
      voiceId: 'voice-1',
      ...config,
    });
    
    this._audioElement = null;
  }

  // ========== 必须实现的方法 ==========

  /**
   * 检查引擎是否可用
   * @returns {Promise<boolean>}
   */
  async isAvailable() {
    return !!this.config.apiKey;
  }

  /**
   * 获取可用语音列表
   * @returns {Promise<Array<{ id: string, name: string, lang: string }>>}
   */
  async getVoices() {
    // 调用 API 获取语音列表，或返回静态列表
    return [
      { id: 'voice-1', name: '标准女声', lang: 'zh-CN' },
      { id: 'voice-2', name: '标准男声', lang: 'zh-CN' },
      { id: 'voice-3', name: 'Standard Female', lang: 'en-US' },
    ];
  }

  /**
   * 朗读文本
   * @param {string} text - 要朗读的文本
   * @param {Object} options - 选项
   */
  async speak(text, options = {}) {
    if (!text?.trim()) return;
    
    const {
      lang = 'zh',
      voiceId = this.config.voiceId,
      rate = 1,
      pitch = 1,
      volume = 1,
    } = options;
    
    // 1. 停止当前播放
    this.stop();
    
    try {
      // 2. 调用 API 获取音频
      this._setStatus(TTS_STATUS.SPEAKING);
      
      const response = await fetch('https://api.my-tts.com/synthesize', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          text,
          voice: voiceId,
          language: lang,
          speed: rate,
          pitch,
        }),
      });
      
      if (!response.ok) {
        throw new Error(`TTS API error: ${response.status}`);
      }
      
      // 3. 播放音频
      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      
      this._audioElement = new Audio(audioUrl);
      this._audioElement.volume = volume;
      
      return new Promise((resolve, reject) => {
        this._audioElement.onended = () => {
          this._setStatus(TTS_STATUS.IDLE);
          URL.revokeObjectURL(audioUrl);
          resolve();
        };
        
        this._audioElement.onerror = (e) => {
          this._setStatus(TTS_STATUS.ERROR);
          URL.revokeObjectURL(audioUrl);
          reject(e);
        };
        
        this._audioElement.play();
      });
      
    } catch (error) {
      this._setStatus(TTS_STATUS.ERROR);
      throw error;
    }
  }

  /**
   * 暂停朗读
   */
  pause() {
    if (this._audioElement && !this._audioElement.paused) {
      this._audioElement.pause();
      this._setStatus(TTS_STATUS.PAUSED);
    }
  }

  /**
   * 恢复朗读
   */
  resume() {
    if (this._audioElement && this._audioElement.paused) {
      this._audioElement.play();
      this._setStatus(TTS_STATUS.SPEAKING);
    }
  }

  /**
   * 停止朗读
   */
  stop() {
    if (this._audioElement) {
      this._audioElement.pause();
      this._audioElement.currentTime = 0;
      this._audioElement = null;
    }
    this._setStatus(TTS_STATUS.IDLE);
  }

  /**
   * 释放资源
   */
  dispose() {
    this.stop();
    super.dispose();
  }
}

export default MyTTSEngine;
```

### 步骤 2：注册引擎

在 `src/services/tts/index.js` 中注册：

```javascript
import { BaseTTSEngine, TTS_STATUS } from './base.js';
import WebSpeechEngine from './web-speech.js';
import MyTTSEngine from './my-tts.js';  // 导入

// 注册引擎
const engines = {
  'web-speech': WebSpeechEngine,
  'my-tts': MyTTSEngine,  // 添加
};

// ... 其余代码
```

---

## 📋 接口规范

### TTS_STATUS 状态枚举

| 状态 | 说明 |
|------|------|
| `IDLE` | 空闲，未播放 |
| `SPEAKING` | 正在朗读 |
| `PAUSED` | 已暂停 |
| `ERROR` | 发生错误 |

### 必须实现的方法

| 方法 | 签名 | 说明 |
|------|------|------|
| `isAvailable()` | `() => Promise<boolean>` | 检查引擎是否可用 |
| `getVoices()` | `() => Promise<Voice[]>` | 获取语音列表 |
| `speak()` | `(text, options) => Promise<void>` | 朗读文本 |
| `pause()` | `() => void` | 暂停 |
| `resume()` | `() => void` | 恢复 |
| `stop()` | `() => void` | 停止 |

### speak() 方法选项

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `lang` | string | - | 语言代码（如 'zh', 'en'） |
| `voiceId` | string | - | 语音 ID |
| `rate` | number | 1 | 语速（0.1 - 10） |
| `pitch` | number | 1 | 音调（0 - 2） |
| `volume` | number | 1 | 音量（0 - 1） |

### Voice 对象结构

```typescript
interface Voice {
  id: string;       // 语音唯一标识
  name: string;     // 显示名称
  lang: string;     // 语言代码（如 'zh-CN', 'en-US'）
  localService?: boolean;  // 是否本地服务
  default?: boolean;       // 是否默认语音
}
```

---

## 🎯 使用 TTS 管理器

### 基本使用

```javascript
import ttsManager from '../services/tts/index.js';

// 初始化
await ttsManager.init();

// 朗读
await ttsManager.speak('Hello World', { lang: 'en' });

// 暂停/恢复/停止
ttsManager.pause();
ttsManager.resume();
ttsManager.stop();
```

### 切换引擎

```javascript
// 获取可用引擎列表
const engines = ttsManager.getEngineList();
// [{ id: 'web-speech', name: 'Web Speech API', ... }, ...]

// 切换引擎
await ttsManager.setEngine('my-tts');
```

### 监听状态变化

```javascript
ttsManager.onStatusChange((status) => {
  console.log('TTS status:', status);
  // TTS_STATUS.IDLE / SPEAKING / PAUSED / ERROR
});
```

### 获取语音列表

```javascript
const voices = await ttsManager.getVoices();
// [{ id: '...', name: '...', lang: '...' }, ...]
```

---

## 🔧 内置引擎

### Web Speech API (web-speech)

- **类型**: 本地
- **需要联网**: 否（使用系统语音包）
- **支持语言**: 取决于系统安装的语音包
- **特点**: 免费、无需配置、跨平台

**注意**: Web Speech API 的语音质量和可用语言取决于操作系统：
- Windows: 需要安装语言包
- macOS: 内置高质量语音
- Linux: 需要安装 espeak 或其他语音引擎

---

## 📝 最佳实践

1. **错误处理**: 始终捕获并处理 `speak()` 可能抛出的异常
2. **状态管理**: 使用 `_setStatus()` 及时更新状态
3. **资源释放**: 在 `dispose()` 中清理所有资源（音频元素、URL 对象等）
4. **取消支持**: 在新的 `speak()` 调用前，先调用 `stop()` 停止当前播放
5. **语言匹配**: 提供智能的语言-语音匹配逻辑

---

## 🌐 云端 TTS 服务推荐

以下云端服务提供高质量语音合成，可作为自定义引擎的后端：

| 服务 | 特点 | 价格 |
|------|------|------|
| Azure Speech | 多语言、高质量、SSML 支持 | 免费层 5 小时/月 |
| Google Cloud TTS | 自然流畅、WaveNet 语音 | 免费层 100 万字符/月 |
| Amazon Polly | 多种语音风格、神经网络语音 | 免费层 500 万字符/月 |
| 阿里云 TTS | 中文优化、多方言支持 | 免费试用 |
| 讯飞 TTS | 中文语音质量高、情感合成 | 免费试用 |

---

**文档更新日期**: 2025-01-21
