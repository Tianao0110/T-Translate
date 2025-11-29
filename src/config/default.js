// src/config/default.js
const config = {
  // LM Studio 配置
  llm: {
    // LM Studio 默认端点
    endpoint: 'http://localhost:1234/v1/',
    
    // API 超时设置（毫秒）
    timeout: 60000,
    
    // 默认模型参数
    defaultParams: {
      temperature: 0.7,
      max_tokens: 2000,
      stream: false
    },
    
    // 模型选择（可以在设置中修改）
    models: {
      chat: 'local-model',  // 对话模型
      vision: 'llava-v1.5-7b'  // 视觉模型（如果有）
    }
  },
  
  // OCR 配置
  ocr: {
    // 默认引擎：'tesseract' | 'llm-vision' | 'rapid'
    defaultEngine: 'tesseract',
    
    // LLM 视觉识别提示词
    visionPrompt: '请识别图片中的所有文字内容，保持原始格式和换行。如果有多列，请按照阅读顺序输出。',
    
    // Tesseract 配置
    tesseract: {
      language: 'chi_sim+eng',  // 中文简体+英文
      psm: 3  // Page segmentation mode
    }
  },
  
  // 翻译配置
  translation: {
    // 默认目标语言
    targetLanguage: 'Chinese',
    
    // 默认源语言（auto = 自动检测）
    sourceLanguage: 'auto',
    
    // 系统提示词模板
    systemPrompt: `你是一个专业的翻译助手。请将以下内容翻译成{targetLanguage}。
要求：
1. 保持原文的语气和风格
2. 确保翻译准确、流畅
3. 专业术语请保留原文并在括号中说明
4. 如果原文有格式，请保持格式不变`,
    
    // 批量翻译设置
    batch: {
      maxLength: 5000,  // 单次最大字符数
      delimiter: '\n---\n'  // 分隔符
    }
  },
  
  // 快捷键配置
  shortcuts: {
    capture: 'CommandOrControl+Shift+T',  // 截图翻译
    quickTranslate: 'CommandOrControl+Q',  // 快速翻译
    toggleWindow: 'CommandOrControl+Shift+W',  // 显示/隐藏窗口
    settings: 'CommandOrControl+,'  // 打开设置
  },
  
  // UI 配置
  ui: {
    theme: 'light',  // 'light' | 'dark' | 'auto'
    language: 'zh-CN',  // 界面语言
    fontSize: 14,
    
    // 窗口设置
    window: {
      width: 1200,
      height: 800,
      minWidth: 800,
      minHeight: 600,
      alwaysOnTop: false
    },
    
    // 翻译面板设置
    translationPanel: {
      autoScroll: true,
      showLineNumbers: false,
      wrapText: true
    }
  },
  
  // 存储配置
  storage: {
    // 历史记录设置
    history: {
      maxItems: 1000,  // 最大保存条数
      autoSave: true,   // 自动保存
      saveInterval: 5000  // 保存间隔（毫秒）
    },
    
    // 缓存设置
    cache: {
      enabled: true,
      maxSize: 100,  // MB
      ttl: 7 * 24 * 60 * 60 * 1000  // 7天
    }
  },
  
  // 插件系统配置
  plugins: {
    enabled: true,
    autoLoad: true,
    directory: 'plugins',
    
    // 内置插件
    builtin: {
      pdfSupport: true,
      wordSupport: true,
      excelSupport: false
    }
  },
  
  // 日志配置
  logging: {
    level: 'info',  // 'debug' | 'info' | 'warn' | 'error'
    file: true,
    console: true,
    maxFiles: 5,
    maxSize: '10m'
  },
  
  // 开发配置
  dev: {
    debugMode: process.env.NODE_ENV === 'development',
    mockData: false,
    apiDelay: 0
  }
};

// 导出配置
export default config;

// 配置验证函数
export function validateConfig(userConfig) {
  // 合并用户配置和默认配置
  return {
    ...config,
    ...userConfig,
    llm: { ...config.llm, ...userConfig?.llm },
    ocr: { ...config.ocr, ...userConfig?.ocr },
    translation: { ...config.translation, ...userConfig?.translation },
    ui: { ...config.ui, ...userConfig?.ui },
    storage: { ...config.storage, ...userConfig?.storage }
  };
}

// 获取 LM Studio 端点
export function getLLMEndpoint(path = '/chat/completions') {
  return config.llm.endpoint + path;
}