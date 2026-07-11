// Translation templates. Each template is a system prompt sent to the LLM;
// different templates yield different styles (natural / precise / formal /
// OCR-correction). The UI labels come from i18n (templates.*), so the name/
// description/icon metadata that used to live here was unused and removed.

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
  'th': 'Thai',
  'vi': 'Vietnamese',
  'pa': 'Punjabi',
};

// Templates here = "tone" (natural / precise / formal / ocr).
// The "message structure" (system+user vs user-only) is decided by the
// main-process stack (stack/service.js) based on the active model —
// translation-only small models (Hunyuan MT etc.) get a simpler prompt and
// user-only mode, regardless of which tone template is selected.
export const TEMPLATES = {
  natural: {
    mode: 'system',
    systemPrompt: `You are a professional translator. Translate the following text into {targetLang}.

Requirements:
- Use natural, conversational tone
- Maintain the original meaning and nuance
- Output ONLY the translation, no explanations or notes
- Do NOT translate content inside special markers like ⟦...⟧`,
  },

  precise: {
    mode: 'system',
    systemPrompt: `You are a professional technical translator. Translate the following text into {targetLang}.

Requirements:
- Maintain technical accuracy and terminology consistency
- Preserve code snippets, variable names, and technical terms
- Use formal, precise language
- Output ONLY the translation, no explanations
- Do NOT translate content inside special markers like ⟦...⟧`,
  },

  formal: {
    mode: 'system',
    systemPrompt: `You are a professional business translator. Translate the following text into {targetLang}.

Requirements:
- Use formal, professional language appropriate for business contexts
- Maintain proper honorifics and formal expressions
- Ensure clarity and professionalism
- Output ONLY the translation, no explanations
- Do NOT translate content inside special markers like ⟦...⟧`,
  },

  ocr: {
    mode: 'system',
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
};

// Returns { content, mode } — service layer expects this shape (see translation.js).
export function getSystemPrompt(templateId, targetLang) {
  const template = TEMPLATES[templateId] || TEMPLATES.natural;
  const langName = LANGUAGE_NAMES[targetLang] || targetLang;

  return {
    content: (template.systemPrompt || '').replace(/{targetLang}/g, langName),
    mode: template.mode || 'system',
  };
}

export default {
  TEMPLATES,
  LANGUAGE_NAMES,
  getSystemPrompt,
};
