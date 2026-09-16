// Data-driven AI action catalog. An action is a prompt config, not code;
// imported actions (validated by normalizeActionConfig) travel the same
// path as the built-ins below. Design notes: docs/design/renderer.md §6.

export const AI_ACTION_SCHEMA_VERSION = 1;

// Placeholders a prompt template may use; validated at import time.
export const AI_ACTION_VARS = ['sourceText', 'translatedText', 'sourceLanguage', 'outputLanguage'];

// 'text' = any chat-capable LLM; 'vision' = needs a vision model (path B).
const AI_ACTION_CAPABILITIES = ['text', 'vision'];

// Where the result may live. 'attach' = rides on the translation entry it was
// derived from; 'none' = never touches the main history (module-owned actions
// keep their own record, if any). Secure mode drops both.
const AI_ACTION_HISTORY_MODES = ['attach', 'none'];

// Entry points an action may be offered on.
const AI_ACTION_SURFACES = ['selection', 'screenshot', 'floating', 'document'];

// The reading / understanding split as the floating window's toggle sees
// it: 'translate' = toggle off, 'understand' = toggle on, 'any' = both.
// Surfaces without the toggle behave as if it were off.
const AI_ACTION_MODES = ['translate', 'understand', 'any'];

// 'target'/'source' follow the translation's languages, 'ui' follows the app
// language; anything else is taken as a literal language code.
const AI_ACTION_OUTPUT_LANGUAGES = ['target', 'source', 'ui'];

// Long-form gate for summary-shaped actions; CJK characters and Latin
// words are counted separately.
export const LONG_FORM_GATE = { cjk: 150, latin: 120 };

// The Latin bar tracks the CJK one at a fixed ratio; the user tunes one number.
export function longFormGate(cjkChars) {
  const cjk = Number(cjkChars);
  if (!Number.isFinite(cjk) || cjk <= 0) return LONG_FORM_GATE;
  return { cjk, latin: Math.max(1, Math.round(cjk * 0.8)) };
}

const SUMMARIZE = {
  id: 'summarize',
  schemaVersion: AI_ACTION_SCHEMA_VERSION,
  builtin: true,
  icon: 'ScrollText',
  nameKey: 'aiActions.summarize.name',
  descKey: 'aiActions.summarize.desc',
  capability: 'text',
  outputLanguage: 'target',
  history: 'attach',
  trigger: {
    surfaces: ['selection', 'screenshot', 'floating'],
    // Nothing to summarize in scattered content.
    displayModes: ['unified'],
    minLength: LONG_FORM_GATE,
    // Reading side only.
    mode: 'translate',
  },
  // The model reads the source side and answers in the output language.
  prompts: {
    zh: {
      system: '你是一个阅读助手。用户会给你一段内容，请基于原文理解它，然后用{{outputLanguage}}写总结。只输出总结正文，不要复述原文，不要说明你在做什么。',
      user: '请阅读下面的内容，并用{{outputLanguage}}总结要点。\n\n内容：\n{{sourceText}}\n\n要求：\n- 3-5 条要点，每条一行\n- 保留关键的数字、名称和术语\n- 原文没写的不要补充推测',
    },
    en: {
      system: 'You are a reading assistant. The user gives you a passage; understand it from the original text, then write the summary in {{outputLanguage}}. Output only the summary — do not restate the passage or describe what you are doing.',
      user: 'Read the following content and summarize its key points in {{outputLanguage}}.\n\nContent:\n{{sourceText}}\n\nRequirements:\n- 3-5 bullet points, one per line\n- Keep key numbers, names, and terminology\n- Do not add anything the source does not state',
    },
  },
  // Path B prompts: carrying these marks an action as runnable straight off
  // the capture.
  visionPrompts: {
    zh: {
      system: '你是一个阅读助手。用户会给你一张截图，请读懂图里的内容，然后用{{outputLanguage}}写总结。只输出总结正文，不要描述画面，不要说明你在做什么。',
      user: '请读懂这张截图里的内容，并用{{outputLanguage}}总结要点。\n\n要求：\n- 3-5 条要点，每条一行\n- 保留关键的数字、名称和术语\n- 图里没有的不要补充推测',
    },
    en: {
      system: 'You are a reading assistant. The user gives you a screenshot; read what it says, then write the summary in {{outputLanguage}}. Output only the summary — do not describe the image or explain what you are doing.',
      user: 'Read this screenshot and summarize its key points in {{outputLanguage}}.\n\nRequirements:\n- 3-5 bullet points, one per line\n- Keep key numbers, names, and terminology\n- Do not add anything the image does not show',
    },
  },
};

// Default action of the floating window's understanding toggle; an
// imported 'understand' action replaces it.
const EXPLAIN = {
  id: 'explain',
  schemaVersion: AI_ACTION_SCHEMA_VERSION,
  builtin: true,
  icon: 'ai',
  nameKey: 'aiActions.explain.name',
  descKey: 'aiActions.explain.desc',
  capability: 'text',
  outputLanguage: 'target',
  history: 'attach',
  trigger: {
    // The document surface passes understandMode itself.
    surfaces: ['floating', 'document'],
    // No display-mode or length gate.
    displayModes: null,
    minLength: null,
    mode: 'understand',
  },
  prompts: {
    zh: {
      system: '你是一个讲解助手。用户会给你一段内容，请基于原文理解它，然后用{{outputLanguage}}讲清楚它在说什么。只输出讲解正文，不要复述原文。',
      user: '请讲解下面这段内容，用{{outputLanguage}}回答。\n\n内容：\n{{sourceText}}\n\n要求：\n- 先用一两句说清整体在讲什么\n- 再解释其中的关键概念、术语或符号\n- 原文没写的不要编造',
    },
    en: {
      system: 'You are an explaining assistant. The user gives you a passage; understand it from the original text, then explain in {{outputLanguage}} what it is saying. Output only the explanation — do not restate the passage.',
      user: 'Explain the following content in {{outputLanguage}}.\n\nContent:\n{{sourceText}}\n\nRequirements:\n- Start with one or two sentences on what it is about overall\n- Then explain the key concepts, terms, or symbols in it\n- Do not invent anything the source does not state',
    },
  },
  visionPrompts: {
    zh: {
      system: '你是一个讲解助手。用户会给你一张截图，请读懂图里的内容，然后用{{outputLanguage}}讲清楚它在说什么。只输出讲解正文，不要描述画面。',
      user: '请讲解这张截图里的内容，用{{outputLanguage}}回答。\n\n要求：\n- 先用一两句说清整体在讲什么\n- 再解释其中的关键概念、术语或符号\n- 图里没有的不要编造',
    },
    en: {
      system: 'You are an explaining assistant. The user gives you a screenshot; read what it says, then explain in {{outputLanguage}} what it is about. Output only the explanation — do not describe the image.',
      user: 'Explain what this screenshot says, in {{outputLanguage}}.\n\nRequirements:\n- Start with one or two sentences on what it is about overall\n- Then explain the key concepts, terms, or symbols in it\n- Do not invent anything the image does not show',
    },
  },
};

// Collects the explanations the reader has already asked for into one note
// (not a whole-document summary; docs/design/renderer.md §6).
const DIGEST = {
  id: 'digest',
  schemaVersion: AI_ACTION_SCHEMA_VERSION,
  builtin: true,
  icon: 'ClipboardList',
  nameKey: 'aiActions.digest.name',
  descKey: 'aiActions.digest.desc',
  capability: 'text',
  outputLanguage: 'target',
  // Documents never touch the history store.
  history: 'none',
  trigger: {
    surfaces: ['document'],
    displayModes: null,
    minLength: null,
    mode: 'understand',
  },
  prompts: {
    zh: {
      system: '你在帮读者整理阅读笔记。用户会给你若干段讲解，请用{{outputLanguage}}把它们整理成一份连贯的笔记。只输出笔记正文。',
      user: '下面是我在读一份文档时，对其中若干段落的讲解记录。请用{{outputLanguage}}把它们整理成一份连贯的阅读笔记。\n\n讲解记录：\n{{sourceText}}\n\n要求：\n- 按主题归拢，不要逐条复述\n- 指出这些段落之间的关联\n- 这些只是文档的一部分，不要假装概括了全文\n- 记录里没有的不要编造',
    },
    en: {
      system: 'You are helping a reader consolidate their notes. The user gives you several explanations; organise them into one coherent note in {{outputLanguage}}. Output only the note.',
      user: 'Below are explanations I collected while reading parts of a document. Organise them into one coherent reading note, in {{outputLanguage}}.\n\nExplanations:\n{{sourceText}}\n\nRequirements:\n- Group by theme rather than restating each one in turn\n- Point out how these parts relate to each other\n- These are only parts of the document — do not present this as covering the whole\n- Do not invent anything the notes do not contain',
    },
  },
};

export const BUILTIN_AI_ACTIONS = [SUMMARIZE, EXPLAIN, DIGEST];

export function getAiAction(id, extraActions = []) {
  return [...BUILTIN_AI_ACTIONS, ...extraActions].find(a => a.id === id) || null;
}

// What the understanding toggle runs on a capture; imported actions win
// over the built-in.
export function getUnderstandAction(extraActions = []) {
  return [...extraActions, ...BUILTIN_AI_ACTIONS].find(a => a.trigger?.mode === 'understand') || null;
}

function templateVars(template) {
  return [...String(template).matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map(m => m[1]);
}

function checkPrompts(prompts) {
  if (!prompts || typeof prompts !== 'object') return 'prompts missing';
  const langs = Object.keys(prompts);
  if (!langs.length) return 'prompts has no language';
  for (const lang of langs) {
    const p = prompts[lang];
    if (!p || typeof p.system !== 'string' || typeof p.user !== 'string') {
      return `prompts.${lang} needs string system and user`;
    }
    if (!p.user.trim()) return `prompts.${lang}.user is empty`;
    for (const v of [...templateVars(p.system), ...templateVars(p.user)]) {
      if (!AI_ACTION_VARS.includes(v)) return `unknown variable {{${v}}} in prompts.${lang}`;
    }
  }
  return null;
}

// Import gate for third-party action configs; unknown fields are dropped.
// Returns { ok, action } or { ok: false, error }.
export function normalizeActionConfig(raw) {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'not an object' };

  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(id)) {
    return { ok: false, error: 'id must be 2-40 chars of a-z, 0-9 and dashes' };
  }
  if (raw.schemaVersion !== AI_ACTION_SCHEMA_VERSION) {
    return { ok: false, error: `schemaVersion must be ${AI_ACTION_SCHEMA_VERSION}` };
  }

  const promptError = checkPrompts(raw.prompts);
  if (promptError) return { ok: false, error: promptError };

  if (raw.visionPrompts != null) {
    const visionError = checkPrompts(raw.visionPrompts);
    if (visionError) return { ok: false, error: `visionPrompts: ${visionError}` };
  }

  // Imported actions carry their own display text.
  const labels = raw.labels && typeof raw.labels === 'object' ? raw.labels : null;
  if (!labels || !Object.values(labels).some(v => typeof v === 'string' && v.trim())) {
    return { ok: false, error: 'labels must hold at least one non-empty display name' };
  }

  const capability = raw.capability || 'text';
  if (!AI_ACTION_CAPABILITIES.includes(capability)) {
    return { ok: false, error: `capability must be one of ${AI_ACTION_CAPABILITIES.join(', ')}` };
  }

  const history = raw.history || 'none';
  if (!AI_ACTION_HISTORY_MODES.includes(history)) {
    return { ok: false, error: `history must be one of ${AI_ACTION_HISTORY_MODES.join(', ')}` };
  }

  const outputLanguage = raw.outputLanguage || 'target';
  // One of the follow-the-translation keywords or a plain language code.
  if (typeof outputLanguage !== 'string' || !/^[a-zA-Z][\w-]*$/.test(outputLanguage)) {
    return { ok: false, error: `outputLanguage must be ${AI_ACTION_OUTPUT_LANGUAGES.join('/')} or a language code` };
  }

  const rawTrigger = raw.trigger && typeof raw.trigger === 'object' ? raw.trigger : {};
  const surfaces = Array.isArray(rawTrigger.surfaces)
    ? rawTrigger.surfaces.filter(s => AI_ACTION_SURFACES.includes(s))
    : [];
  if (!surfaces.length) {
    return { ok: false, error: `trigger.surfaces must name at least one of ${AI_ACTION_SURFACES.join(', ')}` };
  }
  const displayModes = Array.isArray(rawTrigger.displayModes)
    ? rawTrigger.displayModes.filter(m => m === 'unified' || m === 'scattered')
    : null;
  const minLength = rawTrigger.minLength && typeof rawTrigger.minLength === 'object'
    ? {
      cjk: Number(rawTrigger.minLength.cjk) || 0,
      latin: Number(rawTrigger.minLength.latin) || 0,
    }
    : null;
  // Which side of the reading/understanding split this action lives on.
  const mode = AI_ACTION_MODES.includes(rawTrigger.mode) ? rawTrigger.mode : 'any';

  return {
    ok: true,
    action: {
      id,
      schemaVersion: AI_ACTION_SCHEMA_VERSION,
      builtin: false,
      icon: typeof raw.icon === 'string' ? raw.icon : 'Sparkles',
      labels,
      descriptions: raw.descriptions && typeof raw.descriptions === 'object' ? raw.descriptions : null,
      capability,
      outputLanguage,
      history,
      trigger: {
        surfaces,
        displayModes: displayModes && displayModes.length ? displayModes : null,
        minLength,
        mode,
      },
      prompts: raw.prompts,
      visionPrompts: raw.visionPrompts || null,
    },
  };
}
