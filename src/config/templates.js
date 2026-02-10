// src/config/templates.js
// 翻译模板配置
//
// 模板定义了发送给 LLM 的 system prompt
// 不同场景使用不同模板可以获得更好的翻译效果

/**
 * 语言名称映射
 */
export const LANGUAGE_NAMES = {
  'auto': 'the same language as the source',
  'zh': 'Chinese (Simplified)',
  'zh-TW': 'Chinese (Traditional)',
  'en': 'English',
  'ja': 'Japanese',
  'ko': 'Korean',
  'es': 'Spanish',
  'fr': 'French',
  'de': 'German',
  'ru': 'Russian',
  'pt': 'Portuguese',
  'it': 'Italian',
  'ar': 'Arabic',
  'hi': 'Hindi',
  'th': 'Thai',
  'vi': 'Vietnamese',
};

/**
 * 翻译模板定义
 */
export const TEMPLATES = {
  // 自然/日常翻译
  natural: {
    id: 'natural',
    name: '自然',
    description: '日常对话、口语化表达',
    icon: 'FileText',
    systemPrompt: `You are a professional translator. Translate the following text into {targetLang}.

Requirements:
- Use natural, conversational tone
- Maintain the original meaning and nuance
- Output ONLY the translation, no explanations or notes
- Do NOT translate content inside special markers like ⟦...⟧`,
  },

  // 精确/技术翻译
  precise: {
    id: 'precise',
    name: '精确',
    description: '技术文档、学术论文',
    icon: 'Zap',
    systemPrompt: `You are a professional technical translator. Translate the following text into {targetLang}.

Requirements:
- Maintain technical accuracy and terminology consistency
- Preserve code snippets, variable names, and technical terms
- Use formal, precise language
- Output ONLY the translation, no explanations
- Do NOT translate content inside special markers like ⟦...⟧`,
  },

  // 正式/商务翻译
  formal: {
    id: 'formal',
    name: '正式',
    description: '商务邮件、官方文档',
    icon: 'Sparkles',
    systemPrompt: `You are a professional business translator. Translate the following text into {targetLang}.

Requirements:
- Use formal, professional language appropriate for business contexts
- Maintain proper honorifics and formal expressions
- Ensure clarity and professionalism
- Output ONLY the translation, no explanations
- Do NOT translate content inside special markers like ⟦...⟧`,
  },

  // OCR 纠错翻译
  ocr: {
    id: 'ocr',
    name: 'OCR纠错',
    description: 'OCR识别文本，自动纠正识别错误',
    icon: 'Camera',
    systemPrompt: `You are a professional translator with OCR post-processing expertise. The following text was extracted via OCR and may contain recognition errors.

Your task:
1. First, identify and mentally correct any obvious OCR errors (misrecognized characters, spacing issues, etc.)
2. Then translate the corrected text into {targetLang}

Requirements:
- Fix common OCR errors: l/1/I confusion, O/0 confusion, rn/m confusion, etc.
- Maintain the original meaning after error correction
- Use natural, appropriate language for the content type
- Output ONLY the final translation, no explanations or intermediate steps
- Do NOT translate content inside special markers like ⟦...⟧`,
  },

  // 创意/文学翻译
  creative: {
    id: 'creative',
    name: '创意',
    description: '文学作品、创意内容',
    icon: 'Palette',
    systemPrompt: `You are a literary translator. Translate the following text into {targetLang}.

Requirements:
- Preserve the artistic style, tone, and literary devices
- Adapt cultural references appropriately
- Maintain the emotional impact and aesthetic quality
- Use creative expression while staying true to the original meaning
- Output ONLY the translation, no explanations
- Do NOT translate content inside special markers like ⟦...⟧`,
  },
};

/**
 * 获取模板列表（用于 UI 显示）
 */
export function getTemplateList() {
  return Object.values(TEMPLATES).map(t => ({
    id: t.id,
    name: t.name,
    description: t.description,
    icon: t.icon,
  }));
}

/**
 * 获取模板的 system prompt
 * @param {string} templateId - 模板 ID
 * @param {string} targetLang - 目标语言代码
 * @returns {string} 替换后的 system prompt
 */
export function getSystemPrompt(templateId, targetLang) {
  const template = TEMPLATES[templateId] || TEMPLATES.natural;
  const langName = LANGUAGE_NAMES[targetLang] || targetLang;
  
  return template.systemPrompt.replace(/{targetLang}/g, langName);
}

/**
 * 检查模板是否存在
 */
export function hasTemplate(templateId) {
  return templateId in TEMPLATES;
}

export default {
  TEMPLATES,
  LANGUAGE_NAMES,
  getTemplateList,
  getSystemPrompt,
  hasTemplate,
};
