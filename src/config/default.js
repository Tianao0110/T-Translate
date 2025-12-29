// src/config/default.js
const config = {
  // LM Studio 配置
  llm: {
    // LM Studio 默认端点
    endpoint: 'http://localhost:1234/v1',
    
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
    defaultEngine: 'llm-vision',
    
    // LLM 视觉识别提示词
    visionPrompt: `Please read and extract all the text content from this image. Output only the text, nothing else.`,
    
    // Tesseract 配置（备用）
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
    
    // 默认模板
    defaultTemplate: 'natural',
    
    // 系统提示词模板（保留用于兼容）
    systemPrompt: `You are a professional translator. Translate the following text into {targetLanguage}. Output only the translation, no preamble.`,
    
    // 翻译模板 - 3种风格
    templates: {
      precise: `You are a professional translator specializing in technical and academic content.

Task: Translate the following text into {targetLanguage}.

Rules:
- Preserve all technical terms, acronyms, and jargon accurately
- Keep code snippets, commands, variable names, and URLs unchanged
- Maintain the original formatting (lists, paragraphs, headings)
- For specialized terms, provide the translation with original term in parentheses on first occurrence
- Prioritize accuracy over fluency
- Do not add explanations or notes unless necessary for clarity

Output only the translation, no preamble.`,

      natural: `You are a skilled translator focused on natural, fluent communication.

Task: Translate the following text into {targetLanguage}.

Rules:
- Use idiomatic expressions natural to native speakers
- Adapt cultural references and idioms appropriately
- Prioritize readability and flow over literal translation
- Match the original tone (casual, friendly, humorous, etc.)
- Use conversational language, contractions are acceptable
- Avoid stiff or robotic phrasing

Output only the translation, no preamble.`,

      formal: `You are an expert translator for business and official communications.

Task: Translate the following text into {targetLanguage}.

Rules:
- Use formal, professional language appropriate for business contexts
- Maintain polite and respectful tone throughout
- Preserve the structure of formal documents (greetings, closings, etc.)
- Use industry-standard terminology for business/legal terms
- Avoid colloquialisms, slang, or overly casual expressions
- Ensure clarity and precision in meaning

Output only the translation, no preamble.`
    },
    
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
