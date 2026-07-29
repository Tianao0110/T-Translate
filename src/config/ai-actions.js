// Data-driven AI action catalog. An action is a prompt config, NOT code: these
// fields tell the framework where an entry may appear, whether the current
// provider can run it, how the prompt is built, and where the result may be
// stored. Adding an action means adding data — imported actions (validated by
// normalizeActionConfig) travel the exact same path as the built-ins below.

export const AI_ACTION_SCHEMA_VERSION = 1;

// Placeholders a prompt template may use. Validated at import time so a typo
// fails loudly instead of shipping a literal "{{sorceText}}" to the model.
export const AI_ACTION_VARS = ['sourceText', 'translatedText', 'sourceLanguage', 'outputLanguage'];

// 'text' = any chat-capable LLM; 'vision' = needs a vision model (path B).
export const AI_ACTION_CAPABILITIES = ['text', 'vision'];

// Where the result may live. 'attach' = rides on the translation entry it was
// derived from; 'none' = never touches the main history (module-owned actions
// keep their own record, if any). Secure mode drops both.
export const AI_ACTION_HISTORY_MODES = ['attach', 'none'];

// Entry points an action may be offered on.
export const AI_ACTION_SURFACES = ['selection', 'screenshot', 'floating'];

// 'target'/'source' follow the translation's languages, 'ui' follows the app
// language; anything else is taken as a literal language code.
export const AI_ACTION_OUTPUT_LANGUAGES = ['target', 'source', 'ui'];

// Long-form gate for summary-shaped actions. CJK characters and Latin words are
// counted separately because 150 Chinese characters and 150 English words are
// nowhere near the same amount of content. These numbers are a starting point —
// the design leaves the final values to measurement on real documents.
export const LONG_FORM_GATE = { cjk: 150, latin: 120 };

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
    // Scattered content is a handful of disconnected labels; there is nothing
    // to summarize, so the entry stays hidden there.
    displayModes: ['unified'],
    minLength: LONG_FORM_GATE,
  },
  // The model reads the source side and answers in the output language in one
  // step — a summary of the translation would compound its errors.
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
  // Path B. Carrying these is what marks an action as runnable straight off the
  // capture; the wording has to change because there is no {{sourceText}} to
  // paste — the model is looking at the page, layout and all.
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

// Default action of the floating window's understanding toggle. The toggle
// itself decides nothing — it only reveals actions marked understandOnly, and
// what any of them does is its prompt config. That is what keeps the switch
// neutral while still letting an imported config do something else entirely.
const EXPLAIN = {
  id: 'explain',
  schemaVersion: AI_ACTION_SCHEMA_VERSION,
  builtin: true,
  icon: 'Lightbulb',
  nameKey: 'aiActions.explain.name',
  descKey: 'aiActions.explain.desc',
  capability: 'text',
  outputLanguage: 'target',
  history: 'attach',
  trigger: {
    surfaces: ['floating'],
    // No display-mode or length gate: the user turned the mode on, which is
    // the trigger. Summaries need length to be worth anything; an explanation
    // of two dense lines does not.
    displayModes: null,
    minLength: null,
    understandOnly: true,
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

export const BUILTIN_AI_ACTIONS = [SUMMARIZE, EXPLAIN];

export function getAiAction(id, extraActions = []) {
  return [...BUILTIN_AI_ACTIONS, ...extraActions].find(a => a.id === id) || null;
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

// Import gate for third-party action configs: everything the runtime later
// trusts is checked once, here, and unknown fields are dropped rather than
// carried along. Returns { ok, action } or { ok: false, error }.
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

  // Imported actions have no i18n keys of their own, so they must carry their
  // own display text.
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
  if (typeof outputLanguage !== 'string' || !outputLanguage.trim()) {
    return { ok: false, error: 'outputLanguage must be a string' };
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
  // Imported actions that only make sense behind the understanding toggle say
  // so here; nothing else about them changes.
  const understandOnly = rawTrigger.understandOnly === true;

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
        understandOnly,
      },
      prompts: raw.prompts,
      visionPrompts: raw.visionPrompts || null,
    },
  };
}
