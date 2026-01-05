// src/services/ocr-manager.js
// OCR 管理器 v2 - 重构版
// 支持：LLM Vision、Windows OCR、PaddleOCR（预留）、RapidOCR（预留）

import llmClient from '../utils/llm-client.js';
import config from '../config/default.js';

/**
 * OCR 引擎类型
 */
const OCR_ENGINES = {
  LLM_VISION: 'llm-vision',      // LLM 视觉模型（需要 LM Studio）
  WINDOWS_OCR: 'windows-ocr',    // Windows 系统 OCR
  PADDLE_OCR: 'paddle-ocr',      // PaddleOCR（本地）
  RAPID_OCR: 'rapid-ocr',        // RapidOCR（本地）
  // 在线 OCR API
  OCRSPACE: 'ocrspace',          // OCR.space（免费额度高）
  GOOGLE_VISION: 'google-vision',// Google Cloud Vision
  AZURE_OCR: 'azure-ocr',        // Microsoft Azure OCR
  BAIDU_OCR: 'baidu-ocr',        // 百度 OCR
};

/**
 * 隐私模式
 */
const PRIVACY_MODES = {
  OFFLINE: 'offline',           // 完全离线
  LOCAL_FIRST: 'local-first',   // 本地优先
  ALLOW_ONLINE: 'allow-online', // 允许在线
};

/**
 * OCR 管理器 - 统一的文字识别接口
 */
class OCRManager {
  constructor() {
    this.engines = new Map();
    this.currentEngine = config.ocr.defaultEngine || OCR_ENGINES.LLM_VISION;
    this.privacyMode = PRIVACY_MODES.ALLOW_ONLINE;
    this.isInitialized = false;
    this.platform = null;
    
    // 注册引擎
    this.registerEngines();
  }

  /**
   * 注册所有 OCR 引擎
   */
  registerEngines() {
    // LLM Vision 引擎（使用 LM Studio 的视觉模型）
    this.registerEngine(OCR_ENGINES.LLM_VISION, {
      name: 'LLM Vision',
      description: '使用本地 LLM 视觉模型识别（如 Qwen-VL）',
      type: 'local-llm',
      isOnline: false,  // 本地 LLM 不算在线
      init: this.initLLMVision.bind(this),
      recognize: this.recognizeWithLLMVision.bind(this),
      isAvailable: true,
      priority: 1,
      requirements: ['LM Studio', '视觉模型'],
    });

    // Windows OCR 引擎（系统内置）
    this.registerEngine(OCR_ENGINES.WINDOWS_OCR, {
      name: 'Windows OCR',
      description: 'Windows 系统内置 OCR，无需安装',
      type: 'system',
      isOnline: false,
      init: this.initWindowsOCR.bind(this),
      recognize: this.recognizeWithWindowsOCR.bind(this),
      isAvailable: false,  // 需要检测平台
      priority: 2,
      requirements: ['Windows 10+'],
    });

    // PaddleOCR 引擎（通过 @gutenye/ocr-node 实现，与 RapidOCR 合并）
    // 注意：PaddleOCR 和 RapidOCR 底层都是 PaddleOCR 模型，这里合并为一个
    this.registerEngine(OCR_ENGINES.PADDLE_OCR, {
      name: 'PaddleOCR',
      description: '基于 PaddleOCR 的本地 OCR，中文识别强',
      type: 'local',
      isOnline: false,
      init: this.initPaddleOCR.bind(this),
      recognize: this.recognizeWithPaddleOCR.bind(this),
      isAvailable: true,  // 已实现
      priority: 3,
      requirements: [],
    });

    // RapidOCR 作为 PaddleOCR 的别名（底层相同）
    this.registerEngine(OCR_ENGINES.RAPID_OCR, {
      name: 'RapidOCR',
      description: '轻量级本地 OCR（基于 PaddleOCR）',
      type: 'local',
      isOnline: false,
      init: this.initRapidOCR.bind(this),
      recognize: this.recognizeWithRapidOCR.bind(this),
      isAvailable: true,  // 已实现
      priority: 4,
      requirements: [],
    });

    // ========== 在线 OCR API ==========

    // OCR.space（免费额度最高）
    this.registerEngine(OCR_ENGINES.OCRSPACE, {
      name: 'OCR.space',
      description: '免费在线 OCR，25000次/月',
      type: 'online',
      isOnline: true,
      init: this.initOnlineOCR.bind(this),
      recognize: this.recognizeWithOCRSpace.bind(this),
      isAvailable: true,
      priority: 10,
      requirements: ['API Key'],
    });

    // Google Cloud Vision
    this.registerEngine(OCR_ENGINES.GOOGLE_VISION, {
      name: 'Google Cloud Vision',
      description: '识别效果最好，200+ 语言',
      type: 'online',
      isOnline: true,
      init: this.initOnlineOCR.bind(this),
      recognize: this.recognizeWithGoogleVision.bind(this),
      isAvailable: true,
      priority: 11,
      requirements: ['API Key'],
    });

    // Microsoft Azure OCR
    this.registerEngine(OCR_ENGINES.AZURE_OCR, {
      name: 'Azure OCR',
      description: '免费额度高，5000次/月',
      type: 'online',
      isOnline: true,
      init: this.initOnlineOCR.bind(this),
      recognize: this.recognizeWithAzureOCR.bind(this),
      isAvailable: true,
      priority: 12,
      requirements: ['API Key', 'Region'],
    });

    // 百度 OCR
    this.registerEngine(OCR_ENGINES.BAIDU_OCR, {
      name: '百度 OCR',
      description: '中文识别最强，国内快',
      type: 'online',
      isOnline: true,
      init: this.initOnlineOCR.bind(this),
      recognize: this.recognizeWithBaiduOCR.bind(this),
      isAvailable: true,
      priority: 13,
      requirements: ['API Key', 'Secret Key'],
    });
  }

  /**
   * 注册 OCR 引擎
   */
  registerEngine(name, engine) {
    this.engines.set(name, engine);
    console.log(`[OCR] 注册引擎: ${name} (${engine.name})`);
  }

  /**
   * 检测平台并更新引擎可用性
   */
  async detectPlatform() {
    // 检测运行平台
    if (typeof window !== 'undefined' && window.electron?.getPlatform) {
      this.platform = await window.electron.getPlatform();
    } else if (typeof process !== 'undefined') {
      this.platform = process.platform;
    }

    console.log('[OCR] 检测到平台:', this.platform);

    // 更新 Windows OCR 可用性
    if (this.platform === 'win32') {
      const windowsOCR = this.engines.get(OCR_ENGINES.WINDOWS_OCR);
      if (windowsOCR) {
        windowsOCR.isAvailable = true;
        console.log('[OCR] Windows OCR 可用');
      }
    }

    return this.platform;
  }

  /**
   * 初始化 OCR 管理器
   */
  async init(engineName = null) {
    // 先检测平台
    await this.detectPlatform();

    if (engineName) {
      this.currentEngine = engineName;
    }

    // 检查隐私模式限制
    const engine = this.engines.get(this.currentEngine);
    if (!engine) {
      throw new Error(`OCR 引擎 ${this.currentEngine} 未找到`);
    }

    if (!this.isEngineAllowedByPrivacy(engine)) {
      // 自动切换到允许的引擎
      const fallbackEngine = this.findAllowedEngine();
      if (fallbackEngine) {
        console.log(`[OCR] 隐私模式限制，切换到 ${fallbackEngine}`);
        this.currentEngine = fallbackEngine;
      } else {
        throw new Error('没有可用的 OCR 引擎符合当前隐私设置');
      }
    }

    const currentEngine = this.engines.get(this.currentEngine);
    
    try {
      await currentEngine.init();
      this.isInitialized = true;
      console.log(`[OCR] ${currentEngine.name} 初始化成功`);
      return true;
    } catch (error) {
      console.error(`[OCR] ${currentEngine.name} 初始化失败:`, error);
      throw error;
    }
  }

  /**
   * 检查引擎是否符合隐私模式
   */
  isEngineAllowedByPrivacy(engine) {
    if (this.privacyMode === PRIVACY_MODES.ALLOW_ONLINE) {
      return true;
    }
    
    if (this.privacyMode === PRIVACY_MODES.OFFLINE) {
      return !engine.isOnline;
    }
    
    if (this.privacyMode === PRIVACY_MODES.LOCAL_FIRST) {
      return true;  // 允许所有，但优先使用本地
    }
    
    return true;
  }

  /**
   * 查找符合隐私设置的可用引擎
   */
  findAllowedEngine() {
    const engines = Array.from(this.engines.entries())
      .filter(([name, engine]) => 
        engine.isAvailable && this.isEngineAllowedByPrivacy(engine)
      )
      .sort((a, b) => a[1].priority - b[1].priority);

    return engines.length > 0 ? engines[0][0] : null;
  }

  /**
   * 设置隐私模式
   */
  setPrivacyMode(mode) {
    if (!Object.values(PRIVACY_MODES).includes(mode)) {
      throw new Error(`无效的隐私模式: ${mode}`);
    }
    
    this.privacyMode = mode;
    console.log(`[OCR] 隐私模式设置为: ${mode}`);
    
    // 检查当前引擎是否仍然允许
    const currentEngine = this.engines.get(this.currentEngine);
    if (currentEngine && !this.isEngineAllowedByPrivacy(currentEngine)) {
      const fallback = this.findAllowedEngine();
      if (fallback) {
        this.currentEngine = fallback;
        this.isInitialized = false;
        console.log(`[OCR] 自动切换到符合隐私设置的引擎: ${fallback}`);
      }
    }
  }

  // ========== 引擎初始化 ==========

  /**
   * 初始化 LLM Vision
   */
  async initLLMVision() {
    const result = await llmClient.testConnection();
    if (!result.success) {
      throw new Error(`LM Studio 连接失败: ${result.message}`);
    }
    
    const models = result.models;
    const visionModel = models.find(m => 
      m.id && (
        m.id.toLowerCase().includes('llava') || 
        m.id.toLowerCase().includes('vision') || 
        m.id.toLowerCase().includes('qwen') ||
        m.id.toLowerCase().includes('vl')
      )
    );
    
    if (!visionModel) {
      console.warn('[OCR] 未找到视觉模型，请加载支持视觉的模型（如 Qwen-VL、LLaVA）');
    } else {
      console.log('[OCR] 找到视觉模型:', visionModel.id);
    }
  }

  /**
   * 初始化 Windows OCR
   */
  async initWindowsOCR() {
    if (this.platform !== 'win32') {
      throw new Error('Windows OCR 仅在 Windows 系统上可用');
    }
    
    // 检查 Windows OCR 是否可用（通过主进程）
    if (window.electron?.ocr?.checkWindowsOCR) {
      const available = await window.electron.ocr.checkWindowsOCR();
      if (!available) {
        throw new Error('Windows OCR 不可用，请确保系统版本为 Windows 10 或更高');
      }
    }
    
    console.log('[OCR] Windows OCR 初始化成功');
  }

  /**
   * 初始化 PaddleOCR
   */
  async initPaddleOCR() {
    // 通过 IPC 检查主进程中的 PaddleOCR 是否可用
    if (window.electron?.ocr?.checkPaddleOCR) {
      const available = await window.electron.ocr.checkPaddleOCR();
      if (!available) {
        throw new Error('PaddleOCR 初始化失败，请检查依赖是否安装');
      }
    }
    console.log('[OCR] PaddleOCR 初始化成功');
  }

  /**
   * 初始化 RapidOCR（与 PaddleOCR 相同）
   */
  async initRapidOCR() {
    // RapidOCR 底层使用相同的实现
    return this.initPaddleOCR();
  }

  // ========== 文字识别 ==========

  /**
   * 识别图片中的文字 - 主接口
   */
  async recognize(input, options = {}) {
    if (!this.isInitialized) {
      await this.init();
    }

    const engineName = options.engine || this.currentEngine;
    const engine = this.engines.get(engineName);
    
    if (!engine) {
      throw new Error(`OCR 引擎 ${engineName} 未找到`);
    }

    if (!engine.isAvailable) {
      throw new Error(`OCR 引擎 ${engine.name} 当前不可用`);
    }

    if (!this.isEngineAllowedByPrivacy(engine)) {
      throw new Error(`OCR 引擎 ${engine.name} 不符合当前隐私设置`);
    }

    console.log(`[OCR] 使用 ${engine.name} 进行识别...`);
    
    try {
      const startTime = Date.now();
      const result = await engine.recognize(input, options);
      const duration = Date.now() - startTime;
      
      console.log(`[OCR] 识别完成，耗时: ${duration}ms`);
      
      return {
        success: true,
        text: result.text,
        confidence: result.confidence,
        engine: engine.name,
        duration,
        ...result
      };
    } catch (error) {
      console.error(`[OCR] ${engine.name} 识别失败:`, error);
      
      // 如果允许降级，尝试备用引擎
      if (options.fallback !== false) {
        return await this.recognizeWithFallback(input, options, engineName);
      }
      
      return {
        success: false,
        error: error.message,
        engine: engine.name
      };
    }
  }

  /**
   * 使用 LLM Vision 识别
   */
  async recognizeWithLLMVision(input, options = {}) {
    let base64Image;
    
    // 处理不同类型的输入
    if (typeof input === 'string' && input.startsWith('data:image')) {
      base64Image = input.split(',')[1];
    } else if (input instanceof Blob || input instanceof File) {
      base64Image = await this.blobToBase64(input);
    } else if (typeof input === 'string') {
      base64Image = input;
    } else {
      throw new Error('不支持的图片格式');
    }

    const result = await llmClient.visionOCR(base64Image, {
      prompt: options.prompt || config.ocr.visionPrompt,
      model: options.model
    });

    if (result.success) {
      return {
        text: result.text,
        confidence: 0.95
      };
    } else {
      throw new Error(result.error);
    }
  }

  /**
   * 使用 Windows OCR 识别
   */
  async recognizeWithWindowsOCR(input, options = {}) {
    let imageData;
    
    // 处理输入
    if (typeof input === 'string' && input.startsWith('data:image')) {
      imageData = input;
    } else if (input instanceof Blob || input instanceof File) {
      imageData = await this.blobToDataURL(input);
    } else if (typeof input === 'string') {
      imageData = `data:image/png;base64,${input}`;
    } else {
      throw new Error('不支持的图片格式');
    }

    // 调用主进程的 Windows OCR
    if (!window.electron?.ocr?.recognizeWithWindowsOCR) {
      throw new Error('Windows OCR IPC 接口未就绪');
    }

    const result = await window.electron.ocr.recognizeWithWindowsOCR(imageData, {
      language: options.language || 'zh-Hans',  // 默认简体中文
    });

    if (result.success) {
      return {
        text: result.text,
        confidence: result.confidence || 0.9,
        words: result.words,
        lines: result.lines,
      };
    } else {
      throw new Error(result.error || 'Windows OCR 识别失败');
    }
  }

  /**
   * 使用 PaddleOCR 识别
   */
  async recognizeWithPaddleOCR(input, options = {}) {
    let imageData;
    
    // 处理输入
    if (typeof input === 'string' && input.startsWith('data:image')) {
      imageData = input;
    } else if (input instanceof Blob || input instanceof File) {
      imageData = await this.blobToDataURL(input);
    } else if (typeof input === 'string') {
      imageData = `data:image/png;base64,${input}`;
    } else {
      throw new Error('不支持的图片格式');
    }

    // 调用主进程的 PaddleOCR
    if (!window.electron?.ocr?.recognizeWithPaddleOCR) {
      throw new Error('PaddleOCR IPC 接口未就绪');
    }

    const result = await window.electron.ocr.recognizeWithPaddleOCR(imageData, options);

    if (result.success) {
      return {
        text: result.text,
        confidence: result.confidence || 0.9,
        lines: result.lines,
      };
    } else {
      throw new Error(result.error || 'PaddleOCR 识别失败');
    }
  }

  /**
   * 使用 RapidOCR 识别（与 PaddleOCR 相同实现）
   */
  async recognizeWithRapidOCR(input, options = {}) {
    // RapidOCR 底层使用相同的实现
    return this.recognizeWithPaddleOCR(input, options);
  }

  // ========== 在线 OCR API ==========

  /**
   * 初始化在线 OCR（通用）
   */
  async initOnlineOCR() {
    // 在线 OCR 不需要特殊初始化
    console.log('[OCR] Online OCR ready');
  }

  /**
   * 准备图片数据（通用）
   */
  async prepareImageData(input) {
    if (typeof input === 'string' && input.startsWith('data:image')) {
      return input;
    } else if (input instanceof Blob || input instanceof File) {
      return await this.blobToDataURL(input);
    } else if (typeof input === 'string') {
      return `data:image/png;base64,${input}`;
    } else {
      throw new Error('不支持的图片格式');
    }
  }

  /**
   * 使用 OCR.space 识别
   */
  async recognizeWithOCRSpace(input, options = {}) {
    const imageData = await this.prepareImageData(input);
    
    if (!window.electron?.ocr?.recognizeWithOCRSpace) {
      throw new Error('OCR.space IPC 接口未就绪');
    }

    const result = await window.electron.ocr.recognizeWithOCRSpace(imageData, {
      apiKey: options.apiKey,
      language: options.language || 'chs',
    });

    if (result.success) {
      return {
        text: result.text,
        confidence: result.confidence || 0.95,
      };
    } else {
      throw new Error(result.error || 'OCR.space 识别失败');
    }
  }

  /**
   * 使用 Google Cloud Vision 识别
   */
  async recognizeWithGoogleVision(input, options = {}) {
    const imageData = await this.prepareImageData(input);
    
    if (!window.electron?.ocr?.recognizeWithGoogleVision) {
      throw new Error('Google Vision IPC 接口未就绪');
    }

    const result = await window.electron.ocr.recognizeWithGoogleVision(imageData, {
      apiKey: options.apiKey,
      languages: options.languages || ['zh', 'en'],
    });

    if (result.success) {
      return {
        text: result.text,
        confidence: result.confidence || 0.98,
      };
    } else {
      throw new Error(result.error || 'Google Vision 识别失败');
    }
  }

  /**
   * 使用 Azure OCR 识别
   */
  async recognizeWithAzureOCR(input, options = {}) {
    const imageData = await this.prepareImageData(input);
    
    if (!window.electron?.ocr?.recognizeWithAzureOCR) {
      throw new Error('Azure OCR IPC 接口未就绪');
    }

    const result = await window.electron.ocr.recognizeWithAzureOCR(imageData, {
      apiKey: options.apiKey,
      region: options.region || 'eastus',
      language: options.language || 'zh-Hans',
    });

    if (result.success) {
      return {
        text: result.text,
        confidence: result.confidence || 0.95,
      };
    } else {
      throw new Error(result.error || 'Azure OCR 识别失败');
    }
  }

  /**
   * 使用百度 OCR 识别
   */
  async recognizeWithBaiduOCR(input, options = {}) {
    const imageData = await this.prepareImageData(input);
    
    if (!window.electron?.ocr?.recognizeWithBaiduOCR) {
      throw new Error('百度 OCR IPC 接口未就绪');
    }

    const result = await window.electron.ocr.recognizeWithBaiduOCR(imageData, {
      apiKey: options.apiKey,
      secretKey: options.secretKey,
      language: options.language || 'CHN_ENG',
    });

    if (result.success) {
      return {
        text: result.text,
        confidence: result.confidence || 0.96,
      };
    } else {
      throw new Error(result.error || '百度 OCR 识别失败');
    }
  }

  /**
   * 备用引擎识别
   */
  async recognizeWithFallback(input, options, failedEngine) {
    const engines = Array.from(this.engines.entries())
      .filter(([name, engine]) => 
        name !== failedEngine && 
        engine.isAvailable && 
        this.isEngineAllowedByPrivacy(engine)
      )
      .sort((a, b) => a[1].priority - b[1].priority);

    for (const [name, engine] of engines) {
      console.log(`[OCR] 尝试备用引擎: ${engine.name}`);
      try {
        const result = await engine.recognize(input, options);
        return {
          success: true,
          text: result.text,
          confidence: result.confidence,
          engine: engine.name,
          fallback: true,
          ...result
        };
      } catch (error) {
        console.error(`[OCR] 备用引擎 ${engine.name} 也失败:`, error);
      }
    }

    return {
      success: false,
      error: '所有 OCR 引擎都失败了',
      engines: engines.map(e => e[0])
    };
  }

  // ========== 工具函数 ==========

  /**
   * Blob 转 Base64
   */
  async blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Blob 转 Data URL
   */
  async blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  // ========== 状态管理 ==========

  /**
   * 获取所有引擎状态
   */
  getEngineStatus() {
    const status = {};
    for (const [name, engine] of this.engines) {
      status[name] = {
        id: name,
        name: engine.name,
        description: engine.description,
        type: engine.type,
        available: engine.isAvailable,
        isOnline: engine.isOnline,
        priority: engine.priority,
        current: name === this.currentEngine,
        allowedByPrivacy: this.isEngineAllowedByPrivacy(engine),
        requirements: engine.requirements,
      };
    }
    return status;
  }

  /**
   * 获取可用引擎列表
   */
  getAvailableEngines() {
    return Array.from(this.engines.entries())
      .filter(([name, engine]) => engine.isAvailable && this.isEngineAllowedByPrivacy(engine))
      .map(([name, engine]) => ({
        id: name,
        name: engine.name,
        description: engine.description,
        current: name === this.currentEngine,
      }));
  }

  /**
   * 切换引擎
   */
  async switchEngine(engineName) {
    if (!this.engines.has(engineName)) {
      throw new Error(`引擎 ${engineName} 不存在`);
    }

    const engine = this.engines.get(engineName);
    if (!engine.isAvailable) {
      throw new Error(`引擎 ${engine.name} 不可用`);
    }

    if (!this.isEngineAllowedByPrivacy(engine)) {
      throw new Error(`引擎 ${engine.name} 不符合当前隐私设置`);
    }
    
    this.currentEngine = engineName;
    this.isInitialized = false;
    await this.init();
    
    console.log(`[OCR] 切换到引擎: ${engineName}`);
    return true;
  }

  /**
   * 获取当前引擎
   */
  getCurrentEngine() {
    return this.currentEngine;
  }

  /**
   * 获取当前隐私模式
   */
  getPrivacyMode() {
    return this.privacyMode;
  }

  /**
   * 清理资源
   */
  async cleanup() {
    this.isInitialized = false;
    console.log('[OCR] 资源已清理');
  }
}

// 创建单例实例
const ocrManager = new OCRManager();

// 导出
export default ocrManager;
export { OCRManager, OCR_ENGINES, PRIVACY_MODES };
