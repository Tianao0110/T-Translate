// Translation service: preprocessing (do-not-translate filters), two-level
// cache (L1 memory + L2 file-backed), template selection, provider routing
// with fallback, privacy gating and glossary post-processing. privacyMode /
// useCache stay options: the IPC facade (electron/ipc/translation-stack.js)
// injects them. Design notes: docs/design/stack.md.
//
// Call graph: renderer stack-client -> IPC facade -> this -> Providers

import { glossaryPass, pickTermsForTarget, sanitizeGlossaryItems } from './glossary.js';
import { _t } from './i18n.js';
import createLogger from './logger.js';

import {
  getProvider,
  createProvider,
  isProviderConfigured,
  getMissingConfig,
  getAllProvidersStatus,
  initConfigs,
  updateProviderConfig,
  DEFAULT_PRIORITY,
} from './registry.js';

import { isProviderAllowed, PRIVACY_MODE_IDS } from './privacy-modes.js';
import { isLoopbackUrl } from './loopback.js';
import { getEnabledFilters } from '../config/filters.js';
import { reorderForLanguage } from '../config/model-language-coverage.js';
import { getSystemPrompt, LANGUAGE_NAMES } from '../config/templates.js';
import { detectTemplateFromModel } from '../config/model-template-mapping.js';
import { createStreamThrottle } from '../core/stream-throttle.js';
import { getLocalLlm } from './runtime.js';

// An empty endpoint means the preset default (localhost for local presets).
function endpointIsLocal(config) {
  const url = config?.endpoint || config?.baseUrl || '';
  return !url || isLoopbackUrl(url);
}

const logger = createLogger('StackTranslation');

// MT detection cache, keyed by model name.
let _mtCache = { model: null, isMT: false };
function isMTActiveModel(modelName) {
  if (!modelName) return false;
  if (modelName === _mtCache.model) return _mtCache.isMT;
  const isMT = !!detectTemplateFromModel(modelName);
  _mtCache = { model: modelName, isMT };
  return isMT;
}

// Short prompt for translation-only small models (no system role); the tone
// hint is kept.
const _MT_TONE = {
  natural: 'natural and conversational',
  precise: 'precise and technically accurate',
  formal: 'formal and professional',
  ocr: 'natural and conversational',
};
function buildMTPrompt(toneTemplate, targetLang) {
  const langName = LANGUAGE_NAMES[targetLang] || targetLang;
  const tone = _MT_TONE[toneTemplate] || _MT_TONE.natural;
  return {
    content: `Translate the following text into ${langName} in a ${tone} tone. ONLY output the translated result without any explanation:`,
    mode: 'user',
  };
}

// The built-in model: the pack decides the prompt shape. A translation-only
// pack gets the short user-only prompt; a general model gets the shared
// template plus one closing line naming the output language.
function isBuiltinProvider(provider) {
  return provider?.constructor?.metadata?.id === 'tengine';
}

function withOutputLanguage(prompt, targetLang) {
  const langName = LANGUAGE_NAMES[targetLang] || targetLang;
  return { ...prompt, content: `${prompt.content}\n- Output language: ${langName}. Never answer in any other language.` };
}

function resolveSystemPrompt(provider, template, targetLang) {
  if (isBuiltinProvider(provider)) {
    const selected = getLocalLlm()?.selected?.();
    return selected?.role === 'mt'
      ? buildMTPrompt(template, targetLang)
      : withOutputLanguage(getSystemPrompt(template, targetLang), targetLang);
  }
  return isMTActiveModel(provider.config?.model)
    ? buildMTPrompt(template, targetLang)
    : getSystemPrompt(template, targetLang);
}

export class TranslationService {
  /**
   * @param {object} deps
   * @param {() => Promise<{list?: Array, configs?: object}>} [deps.loadProviderConfigs]
   *   Returns the provider list + already-decrypted configs (main process owns
   *   decryption; see ctx.secureVault).
   * @param {() => Array} [deps.getCustomFilters] Persisted custom filter defs
   *   ({ name, patternStr, description, enabled }).
   * @param {object} [deps.cache] StackTranslationCache instance (L2). Optional —
   *   without it only L1 applies.
   */
  constructor(deps = {}) {
    this._deps = deps;
    this._l2 = deps.cache || null;

    this._initialized = false;
    this._userPriority = null;
    this._failureCount = {};
    this._skipThreshold = 3; // consecutive failures before a provider is skipped

    this._filters = [];
    this._filtersInitialized = false;

    // The user's glossary, pushed by the main window (setGlossary).
    this._glossaryItems = [];

    this._l1Cache = new Map();
    this._l1MaxSize = 100;

    this._cacheStats = {
      l1Hits: 0,
      l2Hits: 0,
      misses: 0,
    };
  }

  // ===== Init =====

  async init(settings = null) {
    if (this._initialized) return;

    logger.debug('Initializing...');

    try {
      let providerList = null;
      let providerConfigs = null;

      if (settings?.providers) {
        providerList = settings.providers.list;
        providerConfigs = settings.providers.configs;
        logger.debug('Loaded from passed settings');
      }

      if (!providerConfigs && this._deps.loadProviderConfigs) {
        const loaded = await this._deps.loadProviderConfigs();
        providerList = loaded?.list ?? providerList;
        providerConfigs = loaded?.configs ?? null;
        logger.debug('Loaded configs via injected loader');
      }

      if (providerConfigs) {
        initConfigs(providerConfigs);
      }

      if (providerList) {
        this._userPriority = this._extractPriority(providerList);
        logger.debug('User priority:', this._userPriority);
      }

      this._initFilters();

      this._initialized = true;
      logger.debug('Initialized successfully');
    } catch (error) {
      logger.error('Init failed:', error);
      this._initialized = true;
    }
  }

  _initFilters() {
    if (this._filtersInitialized) return;

    let userFilters = [];
    try {
      const saved = this._deps.getCustomFilters?.();
      if (Array.isArray(saved)) {
        // Persisted regex source -> rehydrated RegExp with /g
        userFilters = saved.map(f => ({
          ...f,
          pattern: new RegExp(f.patternStr || f.pattern?.source || f.pattern, 'g'),
        }));
      }
    } catch (e) {
      logger.warn('Failed to load custom filters:', e);
    }

    this._filters = getEnabledFilters(userFilters);
    this._filtersInitialized = true;

    logger.debug('Filters initialized:', this._filters.map(f => f.name));
  }

  _extractPriority(list) {
    if (!list) return null;
    return list
      .filter(p => p.enabled)
      .sort((a, b) => a.priority - b.priority)
      .map(p => p.id);
  }

  async reload(settings) {
    this._initialized = false;
    this._failureCount = {};
    this._filtersInitialized = false;
    await this.init(settings);
  }

  // ===== Pre/post processing (do-not-translate) =====

  _preProcess(text) {
    if (!this._filters || this._filters.length === 0) {
      return { processed: text, protectedMap: new Map() };
    }

    const protectedMap = new Map();
    let processed = text;
    let index = 0;

    for (const filter of this._filters) {
      if (!filter.enabled || !filter.pattern) continue;

      // /g regex needs lastIndex reset between texts
      filter.pattern.lastIndex = 0;

      processed = processed.replace(filter.pattern, (match) => {
        // Unicode brackets ⟦⟧ as placeholders.
        const placeholder = `⟦${filter.name}_${index++}⟧`;
        protectedMap.set(placeholder, match);
        return placeholder;
      });
    }

    if (protectedMap.size > 0) {
      logger.debug(`[PreProcess] Protected ${protectedMap.size} items:`,
        Array.from(protectedMap.entries()).slice(0, 3));
    }

    return { processed, protectedMap };
  }

  _postProcess(text, protectedMap) {
    if (!protectedMap || protectedMap.size === 0) {
      return text;
    }

    let result = text;
    for (const [placeholder, original] of protectedMap) {
      // split/join avoids re-interpreting regex special chars in placeholder
      result = result.split(placeholder).join(original);
    }

    return result;
  }

  // The glossary every window translates with; a request that carries its
  // own glossaryTerms keeps them (the main window and the document page do).
  setGlossary(items) {
    this._glossaryItems = sanitizeGlossaryItems(items);
    return this._glossaryItems.length;
  }

  _termsFor(options, targetLang) {
    return Array.isArray(options.glossaryTerms)
      ? options.glossaryTerms
      : pickTermsForTarget(this._glossaryItems, targetLang);
  }

  // Thin method over glossary.js (shared with the renderer).
  _applyGlossary(translatedText, glossaryTerms, sourceText) {
    const result = glossaryPass(translatedText, glossaryTerms, sourceText);
    for (const r of result.replacements) {
      logger.debug(`Glossary replaced: "${r.from}" → "${r.to}"`);
    }
    return result;
  }

  // ===== Two-level cache =====

  // djb2 dual-hash for short, collision-resistant cache keys.
  _getCacheKey(text, options) {
    const { targetLang = 'zh', template = 'natural', providerId = '', model = '' } = options;
    let h1 = 5381;
    let h2 = 52711;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      h1 = (h1 * 33) ^ c;
      h2 = (h2 * 33) ^ c;
    }
    const hash = ((h1 >>> 0) * 4096 + (h2 >>> 0)).toString(36);
    // model is part of the key.
    return `${targetLang}-${template}-${providerId}-${model}-${hash}`;
  }

  // The one place a cached entry becomes text again: returns a string or
  // nothing (entries on disk carry two shapes, docs/design/stack.md §2).
  _cachedText(entry) {
    if (typeof entry === 'string') return entry || null;
    if (!entry || typeof entry !== 'object') return null;
    const text = typeof entry.translated === 'string' ? entry.translated
      : typeof entry.text === 'string' ? entry.text
        : null;
    return text || null;
  }

  _checkCache(key, options = {}) {
    const { useCache = true, privacyMode = PRIVACY_MODE_IDS.STANDARD } = options;

    if (!useCache) return null;

    if (this._l1Cache.has(key)) {
      const value = this._l1Cache.get(key);
      const text = this._cachedText(value);
      if (text === null) {
        // Corrupt or empty — drop it so the next translation replaces it.
        this._l1Cache.delete(key);
        logger.warn('[Cache] dropped an unusable L1 entry');
      } else {
        this._cacheStats.l1Hits++;
        logger.debug('[Cache] L1 HIT (memory)');

        // LRU bump: re-insert at the end
        this._l1Cache.delete(key);
        this._l1Cache.set(key, value);

        return { value, text, source: 'l1' };
      }
    }

    // Secure mode skips the persistent cache entirely (no disk footprint)
    if (privacyMode !== PRIVACY_MODE_IDS.SECURE && this._l2) {
      const l2Result = this._l2.get(key);
      if (l2Result) {
        const text = this._cachedText(l2Result);
        if (text === null) {
          logger.warn('[Cache] dropped an unusable L2 entry');
        } else {
          this._cacheStats.l2Hits++;
          logger.debug('[Cache] L2 HIT (disk)');

          // Promote into L1 so subsequent hits avoid the L2 lookup
          this._setL1Cache(key, l2Result);

          return { value: l2Result, text, source: 'l2' };
        }
      }
    }

    this._cacheStats.misses++;
    return null;
  }

  _saveCache(key, result, options = {}) {
    const { useCache = true, privacyMode = PRIVACY_MODE_IDS.STANDARD } = options;

    if (!useCache) return;

    // An empty answer is never cached.
    if (typeof result?.text !== 'string' || !result.text) {
      logger.debug('[Cache] skipped: empty translation');
      return;
    }

    this._setL1Cache(key, result);

    if (privacyMode !== PRIVACY_MODE_IDS.SECURE && this._l2) {
      const cacheEntry = {
        success: true,
        translated: result.text,
        from: result.from,
        to: result.to,
        timestamp: Date.now(),
      };
      this._l2.set(key, cacheEntry);
    }
  }

  _setL1Cache(key, value) {
    // Map preserves insertion order, so first key is the oldest
    if (this._l1Cache.size >= this._l1MaxSize) {
      const firstKey = this._l1Cache.keys().next().value;
      this._l1Cache.delete(firstKey);
    }
    this._l1Cache.set(key, value);
  }

  clearCache(level = 'all') {
    if (level === 'l1' || level === 'all') {
      this._l1Cache.clear();
      logger.debug('[Cache] L1 cleared');
    }
    if ((level === 'l2' || level === 'all') && this._l2) {
      this._l2.clear();
      logger.debug('[Cache] L2 cleared');
    }
    this._cacheStats = { l1Hits: 0, l2Hits: 0, misses: 0 };
  }

  getCacheStats() {
    const total = this._cacheStats.l1Hits + this._cacheStats.l2Hits + this._cacheStats.misses;
    return {
      ...this._cacheStats,
      l1Size: this._l1Cache.size,
      l2Stats: this._l2 ? this._l2.getStats() : null,
      hitRate: total > 0
        ? ((this._cacheStats.l1Hits + this._cacheStats.l2Hits) / total * 100).toFixed(1) + '%'
        : '0%',
    };
  }

  // ===== Priority =====

  getPriority() {
    // null = never configured -> defaults. [] = every provider disabled.
    if (this._userPriority) {
      return this._userPriority;
    }
    return DEFAULT_PRIORITY.normal;
  }

  // ===== Scheduling helpers (shared by translate / translateStream) =====

  // One answer to "may this provider run right now": the privacy allowlist,
  // its configuration, and (offline only) that a local provider points at
  // this machine. Returns null when usable, else the reason.
  providerGate(id, privacyMode) {
    if (!isProviderAllowed(id, privacyMode)) return 'privacy';
    if (!isProviderConfigured(id)) return 'unconfigured';
    if (privacyMode === PRIVACY_MODE_IDS.OFFLINE && !endpointIsLocal(getProvider(id)?.config)) {
      return 'offline-remote-endpoint';
    }
    return null;
  }

  // Filters the priority list to providers usable right now, then demotes
  // providers whose loaded model is documented not to cover the target
  // language. No-op when nothing is known about the loaded model.
  _selectProviders({ privacyMode, targetLang }) {
    const usable = [];
    for (const id of this.getPriority()) {
      if (this.providerGate(id, privacyMode)) continue;
      if (this._failureCount[id] >= this._skipThreshold) continue;
      usable.push(id);
    }

    const usableProviders = reorderForLanguage(
      usable,
      targetLang,
      (id) => getProvider(id)?.config?.model || ''
    );
    const firstAvailableId = usableProviders[0] || '';
    const firstModel = firstAvailableId
      ? (getProvider(firstAvailableId)?.config?.model || '')
      : '';
    return { usableProviders, firstAvailableId, firstModel };
  }

  // Success finalization shared by every scheduler exit: placeholder restore,
  // glossary pass, cache write (raw provider output), result envelope.
  // Placeholder restore plus the glossary pass: the text fields of a result,
  // for a fresh provider answer and for a cache hit alike.
  _textFields(rawText, ctx) {
    const restored = this._postProcess(rawText, ctx.protectedMap);
    if (!ctx.glossaryTerms.length) {
      return { text: restored, originalText: null, glossaryReplacements: [] };
    }
    const { text, replacements } = this._applyGlossary(restored, ctx.glossaryTerms, ctx.sourceText);
    return {
      text,
      originalText: replacements.length > 0 ? restored : null,
      glossaryReplacements: replacements,
    };
  }

  _finalize(rawText, providerId, ctx) {
    const { cacheKey, useCache, privacyMode, sourceLang, targetLang } = ctx;

    this._saveCache(cacheKey, {
      text: rawText,
      from: sourceLang,
      to: targetLang
    }, { useCache, privacyMode });

    return {
      success: true,
      ...this._textFields(rawText, ctx),
      provider: providerId,
      fromCache: false,
    };
  }

  // ===== translate() =====

  async translate(text, options = {}) {
    if (!this._initialized) {
      await this.init();
    }

    const {
      sourceLang = 'auto',
      targetLang = 'zh',
      template = 'natural',
      enableFallback = true,
      privacyMode = PRIVACY_MODE_IDS.STANDARD,
      useCache = true,
      signal = undefined,
    } = options;
    const glossaryTerms = this._termsFor(options, targetLang);

    const { processed, protectedMap } = this._preProcess(text);

    const { usableProviders, firstAvailableId, firstModel } = this._selectProviders({ privacyMode, targetLang });

    // Cache key bound to the first available provider + model.
    const cacheKey = this._getCacheKey(processed, { targetLang, template, providerId: firstAvailableId, model: firstModel });
    const cached = this._checkCache(cacheKey, { useCache, privacyMode });

    const finalizeCtx = { protectedMap, glossaryTerms, sourceText: text, cacheKey, useCache, privacyMode, sourceLang, targetLang };

    if (cached) {
      return {
        success: true,
        ...this._textFields(cached.text, finalizeCtx),
        fromCache: true,
        cacheSource: cached.source,
      };
    }

    const tried = [];

    for (const id of usableProviders) {
      const provider = getProvider(id);
      if (!provider) continue;

      tried.push(id);

      try {
        logger.debug(`Trying provider: ${id}`);

        const systemPrompt = resolveSystemPrompt(provider, template, targetLang);

        const result = await provider.translate(processed, sourceLang, targetLang, {
          systemPrompt,
          template,
          signal,
        });

        if (result.success) {
          this._failureCount[id] = 0;
          return this._finalize(result.text, id, finalizeCtx);
        }

        // skipFailureCount: a deterministic "can't do this input" is not a failure.
        if (!result.skipFailureCount) {
          this._failureCount[id] = (this._failureCount[id] || 0) + 1;
          logger.warn(`Provider ${id} failed (${this._failureCount[id]}/${this._skipThreshold})`);
        }

        if (!enableFallback) {
          return { success: false, error: result.error, provider: id };
        }

      } catch (error) {
        this._failureCount[id] = (this._failureCount[id] || 0) + 1;
        logger.error(`Provider ${id} error:`, error);

        if (!enableFallback) {
          return { success: false, error: error.message, provider: id };
        }
      }
    }

    // Every provider was tried or skipped: clear the skip-list and retry once.
    if (usableProviders.length === 0 && Object.keys(this._failureCount).length > 0) {
      logger.debug('All providers skipped, resetting failure counts...');
      this._failureCount = {};
      return this.translate(text, options);
    }

    return {
      success: false,
      error: tried.length > 0
        ? _t('svc.allFailed', '所有翻译源均失败') + ` (${tried.join(', ')})`
        : _t('svc.noProvider', '没有可用的翻译源'),
    };
  }

  // Streaming variant. Same shape as translate() but pipes chunks through
  // onChunk; falls back to non-streaming if the chosen provider lacks support.
  async translateStream(text, options = {}, onChunk) {
    if (!this._initialized) {
      await this.init();
    }

    const {
      sourceLang = 'auto',
      targetLang = 'zh',
      template = 'natural',
      enableFallback = true,
      privacyMode = PRIVACY_MODE_IDS.STANDARD,
      useCache = true,
      signal = undefined,
    } = options;
    const glossaryTerms = this._termsFor(options, targetLang);

    const { processed, protectedMap } = this._preProcess(text);

    const { usableProviders, firstAvailableId, firstModel } = this._selectProviders({ privacyMode, targetLang });

    const cacheKey = this._getCacheKey(processed, { targetLang, template, providerId: firstAvailableId, model: firstModel });
    const cached = this._checkCache(cacheKey, { useCache, privacyMode });

    const finalizeCtx = { protectedMap, glossaryTerms, sourceText: text, cacheKey, useCache, privacyMode, sourceLang, targetLang };

    if (cached) {
      const fields = this._textFields(cached.text, finalizeCtx);

      // Replay the cached result as a single chunk.
      if (onChunk) {
        onChunk(fields.text);
      }

      return {
        success: true,
        ...fields,
        fromCache: true,
      };
    }

    const tried = [];
    let lastError = null;

    for (const id of usableProviders) {

      const provider = getProvider(id);
      if (!provider) continue;

      tried.push(id);

      try {
        logger.debug(`Trying stream provider: ${id}`);

        const systemPrompt = resolveSystemPrompt(provider, template, targetLang);

        if (provider.supportsStreaming && typeof provider.translateStream === 'function') {
          let fullText = '';

          // Coalesced flush: the stack's one batching point (the IPC facade
          // forwards each emission as a frame).
          const throttle = createStreamThrottle(() => {
            onChunk(this._postProcess(fullText, protectedMap));
          });

          let result;
          try {
            result = await provider.translateStream(
              processed,
              sourceLang,
              targetLang,
              (chunk) => {
                fullText += chunk;
                if (onChunk) throttle.schedule();
              },
              { systemPrompt, template, signal }
            );
          } finally {
            // No flush after the final result has been applied.
            throttle.cancel();
          }

          if (result.success) {
            this._failureCount[id] = 0;
            return this._finalize(result.text || fullText, id, finalizeCtx);
          }
          lastError = result.error;
          if (!result.skipFailureCount) {
            this._failureCount[id] = (this._failureCount[id] || 0) + 1;
          }
          if (!enableFallback) {
            return { success: false, error: lastError || _t('svc.translateFailed', '翻译失败'), provider: id };
          }
          continue;
        } else {
          // Provider doesn't stream; do a single shot and emit it as one chunk
          const result = await provider.translate(processed, sourceLang, targetLang, {
            systemPrompt,
            template,
            signal,
          });

          if (result.success) {
            this._failureCount[id] = 0;

            const finalized = this._finalize(result.text, id, finalizeCtx);
            if (onChunk) {
              onChunk(finalized.text);
            }
            return finalized;
          }
          lastError = result.error;
          if (!result.skipFailureCount) {
            this._failureCount[id] = (this._failureCount[id] || 0) + 1;
          }
          if (!enableFallback) {
            return { success: false, error: lastError || _t('svc.translateFailed', '翻译失败'), provider: id };
          }
        }

      } catch (error) {
        lastError = error.message;
        this._failureCount[id] = (this._failureCount[id] || 0) + 1;
        logger.error(`Stream provider ${id} error:`, error);

        if (!enableFallback) {
          return { success: false, error: error.message, provider: id };
        }
      }
    }

    if (usableProviders.length === 0 && Object.keys(this._failureCount).length > 0) {
      logger.debug('All stream providers skipped, resetting...');
      this._failureCount = {};
      return this.translateStream(text, options, onChunk);
    }

    // Mirror translate(): a real last error beats "no providers available".
    return {
      success: false,
      error: tried.length > 0
        ? (lastError || _t('svc.allFailed', '所有翻译源均失败')) + ` (${tried.join(', ')})`
        : _t('svc.noProvider', '没有可用的翻译源'),
    };
  }

  // ===== Batch =====

  async translateBatch(texts, options = {}) {
    if (!texts || texts.length === 0) {
      return { success: true, translations: [] };
    }

    const translations = [];
    let lastError = null;

    for (const text of texts) {
      try {
        const result = await this.translate(text, options);
        if (result.success) {
          translations.push(result.text);
        } else {
          lastError = result.error;
          translations.push(''); // preserve index alignment with input array
        }
      } catch (error) {
        lastError = error.message;
        translations.push('');
      }
    }

    // Partial success still counts as success — caller decides per-row
    const hasAny = translations.some(t => t.length > 0);
    if (hasAny) {
      return { success: true, translations };
    }
    return { success: false, error: lastError || _t('svc.batchFailed', '批量翻译全部失败'), translations };
  }

  // ===== Misc =====

  // Which provider, if any, can run a real chat completion right now
  // (metadata `type: 'llm'` is not the answer; callers ask here).
  getChatCapability(options = {}) {
    // Same provider routing as translate(): first usable one wins
    const { privacyMode = PRIVACY_MODE_IDS.STANDARD } = options;
    for (const id of this.getPriority()) {
      if (this.providerGate(id, privacyMode)) continue;
      const provider = getProvider(id);
      if (provider && typeof provider.chat === 'function') {
        // A provider may know it cannot chat right now; the chain moves on.
        if (typeof provider.canChat === 'function' && !provider.canChat()) continue;
        return {
          available: true,
          providerId: id,
          providerName: provider?.constructor?.metadata?.name || id,
        };
      }
    }
    return { available: false, providerId: null, providerName: null };
  }

  // Generic chat completion for AI features. Falls back to translating the
  // user message unless options.requireChat.
  async chatCompletion(messages, options = {}) {
    if (!this._initialized) {
      await this.init();
    }

    const capability = this.getChatCapability(options);
    if (capability.available) {
      return getProvider(capability.providerId).chat(messages, options);
    }
    if (options.requireChat) {
      return {
        success: false,
        error: _t('svc.noChatProvider', '当前翻译源不支持 AI 对话功能，请配置一个大模型翻译源'),
      };
    }

    const userMessage = messages.find(m => m.role === 'user');
    const systemMessage = messages.find(m => m.role === 'system');

    if (!userMessage) {
      return { success: false, error: _t('svc.noUserMsg', '没有用户消息') };
    }

    // Heuristic: sniff target language from the system prompt
    let targetLang = 'zh';
    if (systemMessage?.content) {
      if (/English|英文/i.test(systemMessage.content)) targetLang = 'en';
      else if (/日本語|日文/i.test(systemMessage.content)) targetLang = 'ja';
      else if (/한국어|韩文/i.test(systemMessage.content)) targetLang = 'ko';
    }

    const result = await this.translate(userMessage.content, {
      targetLang,
      ...options,
    });

    if (result.success) {
      return {
        success: true,
        content: result.text,
        provider: result.provider,
      };
    }

    return { success: false, error: result.error || _t('svc.translateFailed', '翻译失败') };
  }

  async testProvider(providerId, privacyMode = PRIVACY_MODE_IDS.STANDARD) {
    const provider = getProvider(providerId);
    if (!provider) {
      return { success: false, message: _t('svc.providerNotFound', '翻译源不存在') };
    }
    // Same gate as translate().
    const gate = this.providerGate(providerId, privacyMode);
    if (gate === 'privacy') {
      return { success: false, message: _t('svc.testBlockedByPrivacy', '当前隐私模式已禁用该翻译源') };
    }
    if (gate === 'offline-remote-endpoint') {
      return { success: false, message: _t('svc.offlineRemoteEndpoint', '离线模式只允许本机地址的翻译源') };
    }

    if (!provider.isConfigured()) {
      const missing = getMissingConfig(providerId);
      return { success: false, message: _t('svc.missingConfig', '缺少配置') + ': ' + missing.join(', ') };
    }

    return provider.testConnection();
  }

  // Settings UI: verify an unsaved config without committing it. privacyMode
  // comes from the caller (the facade injects the real mode).
  async testProviderWithConfig(providerId, config, privacyMode = PRIVACY_MODE_IDS.STANDARD) {
    if (!isProviderAllowed(providerId, privacyMode)) {
      return { success: false, message: _t('svc.testBlockedByPrivacy', '当前隐私模式已禁用该翻译源') };
    }
    if (privacyMode === PRIVACY_MODE_IDS.OFFLINE && !endpointIsLocal(config)) {
      return { success: false, message: _t('svc.offlineRemoteEndpoint', '离线模式只允许本机地址的翻译源') };
    }
    try {
      const tempProvider = createProvider(providerId, config);
      if (!tempProvider) {
        return { success: false, message: _t('svc.providerNotFound', '翻译源不存在') };
      }

      if (typeof tempProvider.testConnection === 'function') {
        return await tempProvider.testConnection();
      }

      // No dedicated test method — exercise translate() with a trivial payload
      const result = await tempProvider.translate('test', 'en', 'zh');
      if (result.success) {
        return { success: true, message: _t('svc.connected', '连接成功') };
      }
      return { success: false, message: result.error || _t('svc.testFailed', '测试失败') };
    } catch (error) {
      return { success: false, message: error.message || _t('svc.connectFailed', '连接失败') };
    }
  }

  async testConnection() {
    if (!this._initialized) {
      await this.init();
    }

    const priority = this.getPriority();

    for (const id of priority) {
      if (isProviderConfigured(id)) {
        return this.testProvider(id);
      }
    }

    return { success: false, error: _t('svc.noProvider', '没有可用的翻译源') };
  }

  getCurrentProvider() {
    const priority = this.getPriority();

    for (const id of priority) {
      if (isProviderConfigured(id)) {
        const provider = getProvider(id);
        return {
          id,
          name: provider?.constructor?.metadata?.name,
          model: provider?.config?.model || null,
        };
      }
    }

    return null;
  }

  getProvidersStatus() {
    return getAllProvidersStatus();
  }

  /**
   * Can this app translate anything right now? Built on the same three
   * filters as the real translate path. Cloud providers count as ready with
   * a key (not probed); local providers are probed (docs/design/stack.md §2).
   *
   * @returns {Promise<{ready: boolean, reason: string, candidates: number}>}
   */
  async getTranslationReadiness(privacyMode = PRIVACY_MODE_IDS.STANDARD) {
    const gates = this.getPriority().map((id) => [id, this.providerGate(id, privacyMode)]);
    const candidates = gates.filter(([, gate]) => !gate).map(([id]) => id);
    if (candidates.length === 0) {
      // A local provider pointed off-machine is a different fix than "add one".
      const remote = gates.some(([, gate]) => gate === 'offline-remote-endpoint');
      return { ready: false, reason: remote ? 'offline-remote-endpoint' : 'no-provider', candidates: 0 };
    }

    const locals = [];
    for (const id of candidates) {
      if (getProvider(id)?.requiresNetwork === false) locals.push(id);
      else return { ready: true, reason: 'cloud', candidates: candidates.length };
    }

    for (const id of locals) {
      try {
        const result = await getProvider(id)?.testConnection?.();
        if (result?.success) return { ready: true, reason: 'local', candidates: candidates.length };
      } catch {
        // An unreachable endpoint is the answer, not an error.
      }
    }

    return { ready: false, reason: 'local-unreachable', candidates: candidates.length };
  }

  updateProviderConfig(providerId, config) {
    updateProviderConfig(providerId, config);
  }

  get initialized() {
    return this._initialized;
  }
}

export default TranslationService;
