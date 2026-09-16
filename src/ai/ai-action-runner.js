// Runtime for the data-driven AI actions in config/ai-actions.js: measures the
// text against an action's trigger, builds its prompt, and runs it through the
// same main-process chat path translation uses (privacy is injected there).
//
// Everything above runAiAction is pure so the gating rules can be unit-tested
// without a provider.

import translationService from '../translation/stack-client.js';
import { AI_ACTION_VARS } from '../config/ai-actions.js';
import { LANGUAGES } from '../config/languages.js';
import { detectLanguage } from '../core/text.js';
import createLogger from '../core/logger.js';
import i18n from '../i18n.js';

const logger = createLogger('AIAction');

const _t = (key, fallback) => {
  try { const r = i18n.t(key); return r === key ? fallback : r; } catch { return fallback; }
};

const CJK = /[぀-ヿ㐀-䶿一-鿿가-힯豈-﫿]/;

// CJK characters and Latin-ish words are counted on their own scales.
export function measureText(text) {
  const s = typeof text === 'string' ? text : '';
  let cjk = 0;
  for (const ch of s) {
    if (CJK.test(ch)) cjk++;
  }
  const latin = s.split(/\s+/).filter(w => /[A-Za-zÀ-ɏ]/.test(w)).length;
  return { cjk, latin };
}

// Either scale clearing its own bar counts.
export function meetsLengthGate(text, gate) {
  if (!gate) return true;
  const { cjk, latin } = measureText(text);
  return (gate.cjk > 0 && cjk >= gate.cjk) || (gate.latin > 0 && latin >= gate.latin);
}

// Which pipeline this action would run through right now, or null if
// neither is possible. Path B (the vision model reads the capture) wins.
export function resolveActionPath(action, ctx = {}) {
  if (!action) return null;
  const { capabilities = {}, hasImage = false } = ctx;
  if (action.visionPrompts && hasImage && capabilities.vision) return 'vision';
  if (capabilities[action.capability]) return 'text';
  return null;
}

// Why an action is not offered, or null when it is. ctx:
//   { surface, displayMode, text, hasImage, understandMode,
//     capabilities: { text, vision } }
export function checkActionAvailability(action, ctx = {}) {
  if (!action) return { available: false, reason: 'unknown' };
  const { surface, displayMode, text = '', understandMode = false } = ctx;
  const trigger = action.trigger || {};

  if (!resolveActionPath(action, ctx)) return { available: false, reason: 'capability' };
  // Each side of the reading / understanding split offers only its own actions.
  const mode = trigger.mode || 'any';
  if (mode !== 'any' && mode !== (understandMode ? 'understand' : 'translate')) {
    return { available: false, reason: 'understandMode' };
  }
  if (surface && trigger.surfaces && !trigger.surfaces.includes(surface)) {
    return { available: false, reason: 'surface' };
  }
  if (displayMode && trigger.displayModes && !trigger.displayModes.includes(displayMode)) {
    return { available: false, reason: 'displayMode' };
  }
  // The surface may carry the user's own long-form threshold.
  const gate = trigger.minLength && ctx.longFormGate ? ctx.longFormGate : trigger.minLength;
  if (!meetsLengthGate(text, gate)) {
    return { available: false, reason: 'tooShort' };
  }
  return { available: true, reason: null };
}

// The config half of the history rule (the secure-mode half lives in the
// store next to addToHistory): an action marked 'none' stays out of the
// main history.
export function isAttachableResult(action) {
  return !!action && action.history === 'attach';
}

export function resolveActionLabel(action, lang = 'zh') {
  if (!action) return '';
  if (action.nameKey) return _t(action.nameKey, action.id);
  const labels = action.labels || {};
  return labels[lang] || labels[lang.split('-')[0]] || Object.values(labels)[0] || action.id;
}

export function renderTemplate(template, vars = {}) {
  return String(template).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, name) => (
    AI_ACTION_VARS.includes(name) && vars[name] != null ? String(vars[name]) : match
  ));
}

// Pinned to the prompt's language rather than i18n's current one.
const LANGUAGE_BY_CODE = new Map(LANGUAGES.map((l) => [l.code, l]));

// The name the model is told to answer in, from the shared language
// catalogue. An unknown code is returned verbatim (config/custom-languages.js).
function languageName(code, lang) {
  const entry = LANGUAGE_BY_CODE.get(code);
  if (!entry) return code;
  return lang === 'en' ? entry.en : entry.name;
}

// Which language the model answers in (it always reads the source side).
function resolveOutputLanguage(action, context, uiLang) {
  const spec = action.outputLanguage || 'target';
  if (spec === 'ui') return uiLang;
  if (spec === 'source') {
    const src = context.sourceLanguage;
    return !src || src === 'auto' ? detectLanguage(context.sourceText || '') : src;
  }
  if (spec === 'target') return context.targetLanguage || uiLang;
  return spec;
}

// Each action carries both prompt languages; picked by UI language.
function pickPrompts(action, uiLang, path) {
  const prompts = (path === 'vision' ? action.visionPrompts : action.prompts) || {};
  return prompts[uiLang] || prompts[uiLang.split('-')[0]] || prompts.zh || prompts.en
    || Object.values(prompts)[0] || null;
}

export function buildActionMessages(action, context = {}, uiLang = 'zh', path = 'text') {
  const lang = uiLang.startsWith('zh') ? 'zh' : 'en';
  const prompts = pickPrompts(action, lang, path);
  if (!prompts) return null;

  const vars = {
    sourceText: context.sourceText || '',
    translatedText: context.translatedText || '',
    sourceLanguage: languageName(context.sourceLanguage || 'auto', lang),
    outputLanguage: languageName(resolveOutputLanguage(action, context, lang), lang),
  };

  const messages = [];
  const system = renderTemplate(prompts.system || '', vars).trim();
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: renderTemplate(prompts.user, vars) });
  return messages;
}

// Models like to wrap prose in fences or quotes despite being told not to.
function unwrap(content) {
  let out = content.trim();
  out = out.replace(/^```[a-z]*\s*\n?/i, '').replace(/\n?```\s*$/, '');
  return out.trim();
}

function normalizeReply(action, result, path) {
  if (!result?.success) {
    return { success: false, error: result?.error || _t('aiActions.failed', 'AI 动作失败') };
  }
  const content = unwrap(result.content || '');
  if (!content) {
    return { success: false, error: _t('aiActions.emptyResult', 'AI 未返回内容') };
  }
  return { success: true, actionId: action.id, content, path, provider: result.provider || null };
}

// requireChat keeps AI actions off the translate-the-prompt fallback.
async function runTextPath(action, context) {
  const messages = buildActionMessages(action, context, i18n.language || 'zh', 'text');
  if (!messages) return { success: false, error: _t('aiActions.badConfig', '动作配置无效') };
  const result = await translationService.chatCompletion(messages, { requireChat: true });
  return normalizeReply(action, result, 'text');
}

async function runVisionPath(action, context) {
  const messages = buildActionMessages(action, context, i18n.language || 'zh', 'vision');
  if (!messages) return { success: false, error: _t('aiActions.badConfig', '动作配置无效') };
  const result = await translationService.visionChat(messages, context.imageData);
  const reply = normalizeReply(action, result, 'vision');
  // Shown in the result window: which model looked at the screen.
  if (reply.success) {
    reply.provider = result.model ? `LLM Vision (${result.model})` : 'LLM Vision';
  }
  return { ...reply, visionUnsupported: !!result?.visionUnsupported };
}

// Path B first when it applies, then path A on failure.
export async function runAiAction(action, context = {}) {
  const path = resolveActionPath(action, {
    capabilities: context.capabilities || {},
    hasImage: !!context.imageData,
  }) || 'text';

  try {
    if (path === 'vision') {
      const result = await runVisionPath(action, context);
      if (result.success) return result;
      if (!context.sourceText) return result;
      logger.info(`Vision path failed (${result.error}); falling back to text`);
      const fallback = await runTextPath(action, context);
      return fallback.success ? { ...fallback, degradedFrom: 'vision' } : result;
    }
    return await runTextPath(action, context);
  } catch (error) {
    logger.error(`Action ${action.id} failed:`, error);
    return { success: false, error: error.message };
  }
}

// What the current setup can actually run, under the live privacy mode.
export async function getActionCapabilities() {
  const [chat, vision] = await Promise.all([
    translationService.getChatCapability(),
    translationService.getVisionCapability(),
  ]);
  return {
    text: !!chat?.available,
    vision: !!vision?.available,
    providerName: chat?.providerName || null,
    visionLocal: !!vision?.local,
  };
}
