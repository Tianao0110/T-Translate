// src/services/ocr-manager.js
import llmClient from '../utils/llm-client.js';
import config from '../config/default.js';

/**
 * OCR 管理器 - 统一的文字识别接口
 * 支持多种OCR引擎：Tesseract.js、LLM Vision、RapidOCR等
 */
class OCRManager {
  constructor() {
    this.engines = new Map();
    this.currentEngine = config.ocr.defaultEngine || 'tesseract';
    this.isInitialized = false;
    
    // 注册默认引擎
    this.registerDefaultEngines();
  }

  /**
   * 注册默认OCR引擎
   */
  registerDefaultEngines() {
    // Tesseract.js 引擎（浏览器端OCR）
    this.registerEngine('tesseract', {
      name: 'Tesseract.js',
      init: this.initTesseract.bind(this),
      recognize: this.recognizeWithTesseract.bind(this),
      isAvailable: true,
      priority: 1
    });

    // LLM Vision 引擎（使用LM Studio的视觉模型）
    this.registerEngine('llm-vision', {
      name: 'LLM Vision OCR',
      init: this.initLLMVision.bind(this),
      recognize: this.recognizeWithLLMVision.bind(this),
      isAvailable: true,
      priority: 2
    });

    // RapidOCR 引擎（预留接口）
    this.registerEngine('rapid', {
      name: 'RapidOCR',
      init: this.initRapidOCR.bind(this),
      recognize: this.recognizeWithRapidOCR.bind(this),
      isAvailable: false, // 暂未实现
      priority: 3
    });
  }

  /**
   * 注册OCR引擎
   */
  registerEngine(name, engine) {
    this.engines.set(name, engine);
    console.log(`[OCR] 注册引擎: ${name}`);
  }

  /**
   * 初始化OCR管理器
   */
  async init(engineName = null) {
    if (engineName) {
      this.currentEngine = engineName;
    }

    const engine = this.engines.get(this.currentEngine);
    if (!engine) {
      throw new Error(`OCR引擎 ${this.currentEngine} 未找到`);
    }

    try {
      await engine.init();
      this.isInitialized = true;
      console.log(`[OCR] ${engine.name} 初始化成功`);
      return true;
    } catch (error) {
      console.error(`[OCR] ${engine.name} 初始化失败:`, error);
      throw error;
    }
  }

/**
   * 初始化 Tesseract.js
   */
  async initTesseract() {
    // 动态导入 Tesseract.js
    if (typeof window !== 'undefined') {
      const Tesseract = await import('tesseract.js');
      
      // 1. 先获取语言配置
      const lang = config.ocr.tesseract.language || 'chi_sim+eng';

      // 2.使用 (语言, OEM, 配置对象) 的参数顺序
      // 这样写，Tesseract 会直接用 CDN 地址启动，不会去碰本地坏掉的文件
      this.tesseractWorker = await Tesseract.createWorker(
        lang, // 参数1: 语言
        1,    // 参数2: OEM (1 代表神经网络模式)
        {     // 参数3: 核心路径配置
          workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js',
          corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5/tesseract-core.wasm.js',
          logger: m => {} // 空函数，防止克隆报错
        }
      );
      
      
      await this.tesseractWorker.setParameters({
        tessedit_pageseg_mode: config.ocr.tesseract.psm || 3
      });
      
      console.log("Tesseract initialized successfully!");
    }
  }
  /**
   * 初始化 LLM Vision
   */
  async initLLMVision() {
    // 测试 LM Studio 连接
    const result = await llmClient.testConnection();
    if (!result.success) {
      throw new Error(`LM Studio 连接失败: ${result.message}`);
    }
    
    // 检查是否有视觉模型
    const models = await llmClient.getModels();
    const visionModel = models.find(m => 
      m.id && (m.id.includes('llava') || m.id.includes('vision'))
    );
    
    if (!visionModel) {
      console.warn('[OCR] 未找到视觉模型，请在 LM Studio 中加载 llava 或其他视觉模型');
    }
  }

  /**
   * 初始化 RapidOCR（预留）
   */
  async initRapidOCR() {
    throw new Error('RapidOCR 尚未实现，请使用其他引擎');
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
      throw new Error(`OCR引擎 ${engineName} 未找到`);
    }

    if (!engine.isAvailable) {
      throw new Error(`OCR引擎 ${engine.name} 当前不可用`);
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
      
      // 如果有备用引擎，尝试使用备用引擎
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
   * 使用 Tesseract.js 识别
   */
  async recognizeWithTesseract(input, options = {}) {
    if (!this.tesseractWorker) {
      await this.initTesseract();
    }

    const result = await this.tesseractWorker.recognize(input);
    
    return {
      text: result.data.text,
      confidence: result.data.confidence,
      words: result.data.words,
      lines: result.data.lines,
      paragraphs: result.data.paragraphs
    };
  }

  /**
   * 使用 LLM Vision 识别
   */
  async recognizeWithLLMVision(input, options = {}) {
    let base64Image;
    
    // 处理不同类型的输入
    if (typeof input === 'string' && input.startsWith('data:image')) {
      // Data URL
      base64Image = input.split(',')[1];
    } else if (input instanceof Blob || input instanceof File) {
      // Blob 或 File
      base64Image = await this.blobToBase64(input);
    } else if (typeof input === 'string') {
      // 假设是 base64
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
        confidence: 0.95 // LLM 通常置信度较高
      };
    } else {
      throw new Error(result.error);
    }
  }

  /**
   * 使用 RapidOCR 识别（预留）
   */
  async recognizeWithRapidOCR(input, options = {}) {
    throw new Error('RapidOCR 尚未实现');
  }

  /**
   * 备用引擎识别
   */
  async recognizeWithFallback(input, options, failedEngine) {
    const engines = Array.from(this.engines.entries())
      .filter(([name, engine]) => 
        name !== failedEngine && engine.isAvailable
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
      error: '所有OCR引擎都失败了',
      engines: engines.map(e => e[0])
    };
  }

  /**
   * 智能选择引擎
   */
  async selectBestEngine(input, requirements = {}) {
    const scores = new Map();

    for (const [name, engine] of this.engines) {
      if (!engine.isAvailable) continue;

      let score = 0;
      
      // 基础优先级分数
      score += (4 - engine.priority) * 10;
      
      // 根据需求调整分数
      if (requirements.speed && name === 'tesseract') {
        score += 20; // Tesseract 速度快
      }
      if (requirements.accuracy && name === 'llm-vision') {
        score += 20; // LLM 准确度高
      }
      if (requirements.complex && name === 'llm-vision') {
        score += 30; // LLM 处理复杂布局好
      }
      if (requirements.handwriting && name === 'llm-vision') {
        score += 25; // LLM 识别手写好
      }
      
      scores.set(name, score);
    }

    // 选择得分最高的引擎
    const bestEngine = Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1])[0];

    return bestEngine ? bestEngine[0] : this.currentEngine;
  }

  /**
   * 批量识别
   */
  async batchRecognize(inputs, options = {}) {
    const results = [];
    
    for (let i = 0; i < inputs.length; i++) {
      console.log(`[OCR] 批量识别进度: ${i + 1}/${inputs.length}`);
      
      try {
        const result = await this.recognize(inputs[i], options);
        results.push(result);
      } catch (error) {
        results.push({
          success: false,
          error: error.message,
          index: i
        });
      }
    }
    
    return results;
  }

  /**
   * 工具函数：Blob 转 Base64
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
   * 获取引擎状态
   */
  getEngineStatus() {
    const status = {};
    for (const [name, engine] of this.engines) {
      status[name] = {
        name: engine.name,
        available: engine.isAvailable,
        priority: engine.priority,
        current: name === this.currentEngine
      };
    }
    return status;
  }

  /**
   * 切换引擎
   */
  async switchEngine(engineName) {
    if (!this.engines.has(engineName)) {
      throw new Error(`引擎 ${engineName} 不存在`);
    }
    
    this.currentEngine = engineName;
    this.isInitialized = false;
    await this.init();
    
    console.log(`[OCR] 切换到引擎: ${engineName}`);
    return true;
  }

  /**
   * 清理资源
   */
  async cleanup() {
    if (this.tesseractWorker) {
      await this.tesseractWorker.terminate();
      this.tesseractWorker = null;
    }
    this.isInitialized = false;
    console.log('[OCR] 资源已清理');
  }
}

// 创建单例实例
const ocrManager = new OCRManager();

export default ocrManager;
export { OCRManager };