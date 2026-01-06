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
   * 
   * 分层策略（The Tiered Strategy）：
   * 1. 主力先锋：本地 OCR (RapidOCR) - 处理 95% 的请求，毫秒级响应
   * 2. 特种部队：视觉大模型 (LLM Vision) - "深度识别"模式，处理复杂排版/手写/模糊
   * 3. 最终防线：在线 OCR API - 高精度模式或无显卡时的兜底
   */
  registerEngines() {
    // ========== 第一梯队：本地 OCR（主力先锋）==========
    // RapidOCR - 默认首选，毫秒级响应
    this.registerEngine(OCR_ENGINES.RAPID_OCR, {
      name: 'RapidOCR',
      description: '本地 OCR，基于 PP-OCRv4，速度快',
      type: 'local',
      tier: 1,  // 第一梯队
      isOnline: false,
      init: this.initRapidOCR.bind(this),
      recognize: this.recognizeWithRapidOCR.bind(this),
      isAvailable: true,
      priority: 1,  // 最高优先级
      requirements: ['需下载 ~60MB'],
    });

    // ========== 第二梯队：视觉大模型（特种部队）==========
    // LLM Vision - 深度识别模式，处理复杂场景
    this.registerEngine(OCR_ENGINES.LLM_VISION, {
      name: 'LLM Vision',
      description: '视觉大模型，处理复杂排版/手写/模糊',
      type: 'local-llm',
      tier: 2,  // 第二梯队
      isOnline: false,
      init: this.initLLMVision.bind(this),
      recognize: this.recognizeWithLLMVision.bind(this),
      isAvailable: true,
      priority: 2,
      requirements: ['LM Studio', '视觉模型'],
    });

    // ========== 第三梯队：在线 OCR API（最终防线）==========

    // OCR.space（免费额度最高）
    this.registerEngine(OCR_ENGINES.OCRSPACE, {
      name: 'OCR.space',
      description: '在线 OCR，免费 25000次/月',
      type: 'online',
      tier: 3,  // 第三梯队
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
      tier: 3,
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
      tier: 3,
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
      tier: 3,
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
      try {
        this.platform = await window.electron.getPlatform();
      } catch (e) {
        console.warn('[OCR] getPlatform failed:', e);
      }
    }
    
    // 备选方案
    if (!this.platform && typeof navigator !== 'undefined') {
      // 从 userAgent 检测
      const ua = navigator.userAgent.toLowerCase();
      if (ua.includes('win')) {
        this.platform = 'win32';
      } else if (ua.includes('mac')) {
        this.platform = 'darwin';
      } else if (ua.includes('linux')) {
        this.platform = 'linux';
      }
    }

    console.log('[OCR] 检测到平台:', this.platform);

    // 更新 Windows OCR 可用性
    if (this.platform === 'win32') {
      const windowsOCR = this.engines.get(OCR_ENGINES.WINDOWS_OCR);
      if (windowsOCR) {
        windowsOCR.isAvailable = true;
        console.log('[OCR] Windows OCR 已标记为可用');
      }
    } else {
      console.log('[OCR] 非 Windows 平台，Windows OCR 不可用');
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
   * 语言代码映射表
   */
  static LANGUAGE_MAP = {
    // 翻译语言代码 -> OCR 语言代码
    'zh': 'zh-Hans',
    'zh-CN': 'zh-Hans',
    'zh-TW': 'zh-Hant',
    'zh-HK': 'zh-Hant',
    'en': 'en',
    'ja': 'ja',
    'ko': 'ko',
    'fr': 'fr',
    'de': 'de',
    'es': 'es',
    'ru': 'ru',
    'ar': 'ar',
    'hi': 'hi',
    'vi': 'vi',
    'th': 'th',
    'auto': 'zh-Hans',  // 自动检测时默认中文
  };

  /**
   * 获取 OCR 识别语言
   * @param {object} options - 选项
   * @returns {string} OCR 语言代码
   */
  getOcrLanguage(options = {}) {
    // 如果明确指定了语言，使用指定的
    if (options.language && options.language !== 'auto') {
      return options.language;
    }
    
    // 从设置中获取
    const settings = options.settings || {};
    const recognitionLanguage = settings.recognitionLanguage || 'auto';
    
    if (recognitionLanguage !== 'auto') {
      return recognitionLanguage;
    }
    
    // 自动模式：根据翻译原文语言确定
    const sourceLanguage = settings.sourceLanguage || options.sourceLanguage || 'auto';
    
    if (sourceLanguage && sourceLanguage !== 'auto') {
      return OCRManager.LANGUAGE_MAP[sourceLanguage] || sourceLanguage;
    }
    
    // 默认中文
    return 'zh-Hans';
  }

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

    // 获取 OCR 识别语言
    const ocrLanguage = this.getOcrLanguage(options);
    const recognizeOptions = { ...options, language: ocrLanguage };

    console.log(`[OCR] 使用 ${engine.name} 进行识别，语言: ${ocrLanguage}`);
    
    try {
      const startTime = Date.now();
      const result = await engine.recognize(input, recognizeOptions);
      const duration = Date.now() - startTime;
      
      console.log(`[OCR] 识别完成，耗时: ${duration}ms`);
      
      return {
        success: true,
        text: result.text,
        confidence: result.confidence,
        engine: engine.name,
        language: ocrLanguage,
        duration,
        ...result
      };
    } catch (error) {
      console.error(`[OCR] ${engine.name} 识别失败:`, error);
      
      // 如果允许降级，尝试备用引擎
      if (options.fallback !== false) {
        return await this.recognizeWithFallback(input, recognizeOptions, engineName);
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

    // 调用主进程的 PaddleOCR/RapidOCR
    if (!window.electron?.ocr?.recognizeWithPaddleOCR) {
      throw new Error('RapidOCR IPC 接口未就绪，请检查是否已安装');
    }

    console.log('[OCR] Calling RapidOCR via IPC...');
    const result = await window.electron.ocr.recognizeWithPaddleOCR(imageData, options);

    if (result.success) {
      return {
        text: result.text,
        confidence: result.confidence || 0.9,
        lines: result.lines,
      };
    } else {
      throw new Error(result.error || 'RapidOCR 识别失败');
    }
  }

  /**
   * 使用 RapidOCR 识别
   */
  async recognizeWithRapidOCR(input, options = {}) {
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

    // 调用主进程的 RapidOCR（使用 paddle-ocr IPC 通道）
    if (!window.electron?.ocr?.recognizeWithPaddleOCR) {
      throw new Error('RapidOCR IPC 接口未就绪，请检查是否已安装');
    }

    console.log('[OCR] Calling RapidOCR via IPC...');
    const result = await window.electron.ocr.recognizeWithPaddleOCR(imageData, options);

    if (result.success) {
      return {
        text: result.text,
        confidence: result.confidence || 0.9,
        lines: result.lines,
      };
    } else {
      throw new Error(result.error || 'RapidOCR 识别失败');
    }
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
   * 从存储读取设置（支持 electron store 和 localStorage）
   */
  async getSettingsFromStorage() {
    try {
      // 优先从 electron store 读取
      if (window.electron?.store?.get) {
        const settings = await window.electron.store.get('settings');
        if (settings) {
          console.log('[OCR] Settings loaded from electron store');
          return settings;
        }
      }
      
      // 回退到 localStorage
      const savedSettings = localStorage.getItem('settings');
      if (savedSettings) {
        console.log('[OCR] Settings loaded from localStorage');
        return JSON.parse(savedSettings);
      }
    } catch (e) {
      console.warn('[OCR] Failed to read settings from storage:', e);
    }
    return null;
  }

  /**
   * 使用 OCR.space 识别
   */
  async recognizeWithOCRSpace(input, options = {}) {
    const imageData = await this.prepareImageData(input);
    
    if (!window.electron?.ocr?.recognizeWithOCRSpace) {
      throw new Error('OCR.space IPC 接口未就绪');
    }

    // 从设置中读取 API Key（如果没有在 options 中传递）
    let apiKey = options.apiKey;
    if (!apiKey) {
      const settings = await this.getSettingsFromStorage();
      apiKey = settings?.ocr?.ocrspaceKey;
      console.log('[OCR] OCR.space API Key from settings:', apiKey ? '已配置' : '未配置');
    }
    
    if (!apiKey) {
      throw new Error('未配置 OCR.space API Key，请在设置中配置');
    }

    console.log('[OCR] Calling OCR.space API...');
    const result = await window.electron.ocr.recognizeWithOCRSpace(imageData, {
      apiKey: apiKey,
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

    // 从设置中读取 API Key
    let apiKey = options.apiKey;
    if (!apiKey) {
      const settings = await this.getSettingsFromStorage();
      apiKey = settings?.ocr?.googleVisionKey;
    }
    
    if (!apiKey) {
      throw new Error('未配置 Google Vision API Key，请在设置中配置');
    }

    console.log('[OCR] Calling Google Vision API...');
    const result = await window.electron.ocr.recognizeWithGoogleVision(imageData, {
      apiKey: apiKey,
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

    // 从设置中读取 API Key
    let apiKey = options.apiKey;
    if (!apiKey) {
      const settings = await this.getSettingsFromStorage();
      apiKey = settings?.ocr?.azureKey;
    }
    
    if (!apiKey) {
      throw new Error('未配置 Azure OCR API Key，请在设置中配置');
    }

    console.log('[OCR] Calling Azure OCR API...');
    const result = await window.electron.ocr.recognizeWithAzureOCR(imageData, {
      apiKey: apiKey,
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

    // 从设置中读取 API Key
    let apiKey = options.apiKey;
    let secretKey = options.secretKey;
    if (!apiKey || !secretKey) {
      const settings = await this.getSettingsFromStorage();
      apiKey = apiKey || settings?.ocr?.baiduApiKey;
      secretKey = secretKey || settings?.ocr?.baiduSecretKey;
    }
    
    if (!apiKey) {
      throw new Error('未配置百度 OCR API Key，请在设置中配置');
    }

    console.log('[OCR] Calling Baidu OCR API...');
    const result = await window.electron.ocr.recognizeWithBaiduOCR(imageData, {
      apiKey: apiKey,
      secretKey: secretKey,
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
   * 检查引擎是否配置了 API Key
   */
  async checkEngineApiKey(engineName) {
    const settings = await this.getSettingsFromStorage();
    if (!settings?.ocr) return false;
    
    switch (engineName) {
      case OCR_ENGINES.OCRSPACE:
        return !!settings.ocr.ocrspaceKey;
      case OCR_ENGINES.GOOGLE_VISION:
        return !!settings.ocr.googleVisionKey;
      case OCR_ENGINES.AZURE_OCR:
        return !!settings.ocr.azureKey;
      case OCR_ENGINES.BAIDU_OCR:
        return !!settings.ocr.baiduApiKey;
      default:
        return true;  // 本地引擎不需要 API Key
    }
  }

  /**
   * 备用引擎识别（分层策略）
   * 
   * 回退顺序：
   * 1. 如果本地 OCR 失败 → 尝试 LLM Vision（第二梯队）
   * 2. 如果 LLM Vision 也失败 → 尝试在线 OCR API（第三梯队）
   * 3. 如果用户开启了隐私模式，跳过在线 API
   */
  async recognizeWithFallback(input, options, failedEngine) {
    const settings = await this.getSettingsFromStorage();
    const privacyMode = settings?.privacy?.enabled;
    
    // 获取所有引擎
    const allEngines = Array.from(this.engines.entries());
    
    // 过滤可用引擎（异步检查 API Key）
    const availableEngines = [];
    for (const [name, engine] of allEngines) {
      // 排除已失败的引擎
      if (name === failedEngine) continue;
      // 排除不可用的引擎
      if (!engine.isAvailable) continue;
      // 隐私模式下排除在线引擎
      if (privacyMode && engine.isOnline) continue;
      // 检查 API Key（在线引擎需要配置）
      if (engine.isOnline) {
        const hasApiKey = await this.checkEngineApiKey(name);
        if (!hasApiKey) {
          console.log(`[OCR] 跳过 ${engine.name}：未配置 API Key`);
          continue;
        }
      }
      availableEngines.push([name, engine]);
    }
    
    // 按 tier 和 priority 排序
    availableEngines.sort((a, b) => {
      const tierA = a[1].tier || 99;
      const tierB = b[1].tier || 99;
      if (tierA !== tierB) return tierA - tierB;
      return a[1].priority - b[1].priority;
    });

    for (const [name, engine] of availableEngines) {
      console.log(`[OCR] 尝试备用引擎: ${engine.name} (Tier ${engine.tier || '?'})`);
      try {
        const result = await engine.recognize(input, options);
        return {
          success: true,
          text: result.text,
          confidence: result.confidence,
          engine: engine.name,
          fallback: true,
          tier: engine.tier,
          ...result
        };
      } catch (error) {
        console.error(`[OCR] 备用引擎 ${engine.name} 也失败:`, error.message);
      }
    }

    return {
      success: false,
      error: '所有 OCR 引擎都失败了',
      engines: availableEngines.map(e => e[0])
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
