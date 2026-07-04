// Translation service facade. Owns preprocessing (do-not-translate filters),
// two-level cache (L1 memory + L2 disk), template selection, provider routing
// with fallback, privacy-mode gating, and glossary post-processing.
//
// Call graph: UI -> Store -> MainTranslation -> this -> Providers

import createLogger from '../utils/logger.js';
import i18n from '../i18n.js';

const _t = (key, fallback) => {
  try { const r = i18n.t(key); return r === key ? fallback : r; } catch { return fallback; }
};

import {
  getProvider,
  createProvider,
  isProviderConfigured,
  getMissingConfig,
  getAllProviderIds,
  getAllProvidersStatus,
  initConfigs,
  updateProviderConfig,
  DEFAULT_PRIORITY,
} from '../providers/registry.js';

import { isProviderAllowed, PRIVACY_MODE_IDS } from '../config/privacy-modes.js';
import { getEnabledFilters, DEFAULT_FILTERS } from '../config/filters.js';
import { getSystemPrompt, LANGUAGE_NAMES } from '../config/templates.js';
import { detectTemplateFromModel } from '../config/model-template-mapping.js';

// MT detection cache. Keyed by model name — re-runs only when the active
// provider's `config.model` changes (e.g. user picks a different LM Studio
// model). Effectively "detect once at startup, re-detect when model changes",
// which is what we want without subscribing to store events.
let _mtCache = { model: null, isMT: false };
function isMTActiveModel(modelName) {
  if (!modelName) return false;
  if (modelName === _mtCache.model) return _mtCache.isMT;
  const isMT = !!detectTemplateFromModel(modelName);
  _mtCache = { model: modelName, isMT };
  return isMT;
}

// Short prompt for translation-only small models. Their chat templates don't
// expect system role and long instructions get translated by mistake. Tone hint
// preserved so the user's tone selection (natural/precise/formal) still applies.
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

function resolveSystemPrompt(provider, template, targetLang) {
  return isMTActiveModel(provider.config?.model)
    ? buildMTPrompt(template, targetLang)
    : getSystemPrompt(template, targetLang);
}
import translationCache from './cache.js';
import { createStreamThrottle } from '../utils/stream-throttle.js';

const logger = createLogger('Translation');

const secureStorage = {
  async get(key) {
    if (window.electron?.secureStorage) {
      // Stack boot/reload sweeps every enabled provider's keys in all three
      // windows — tagged so the main-process access audit logs but doesn't
      // count them as a suspicious burst.
      return await window.electron.secureStorage.decrypt(key, { context: 'stack-reload' });
    }
    // Browser-mode fallback: base64-wrapped (no real encryption)
    const encoded = localStorage.getItem(`__secure_${key}`);
    if (encoded) {
      try {
        return decodeURIComponent(atob(encoded));
      } catch {
        return null;
      }
    }
    return null;
  },
};

class TranslationService {
  constructor() {
    this._initialized = false;
    this._mode = 'normal'; // 'normal' | 'subtitle'
    this._userPriority = null;
    this._failureCount = {};
    this._skipThreshold = 3; // consecutive failures before a provider is skipped

    this._filters = [];
    this._filtersInitialized = false;

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

      // Floating window calls into main which returns already-decrypted configs.
      // An empty answer must fall through — {} is truthy and used to truncate
      // the chain here, leaving the floating window with zero providers.
      if (!providerConfigs && window.electron?.floatingWindow?.getProviderConfigs) {
        const fwConfigs = await window.electron.floatingWindow.getProviderConfigs();
        if (fwConfigs?.list?.length || Object.keys(fwConfigs?.configs || {}).length > 0) {
          providerList = fwConfigs.list;
          providerConfigs = fwConfigs.configs;
          logger.debug('Loaded configs from floating-window API');
        }
      }

      if (!providerConfigs && window.electron?.store) {
        const saved = await window.electron.store.get('settings');

        if (saved?.translation?.providers) {
          providerList = saved.translation.providers;
          providerConfigs = await this._decryptConfigs(saved.translation.providerConfigs || {});
          logger.debug('Loaded from store (new format)');
        } else if (saved?.providers?.list) {
          providerList = saved.providers.list;
          providerConfigs = await this._decryptConfigs(saved.providers.configs || {});
          logger.debug('Loaded from store (old format)');
        }
      }

      // Even with no settings, pull encrypted fields from secure storage
      if (!providerConfigs) {
        providerConfigs = await this._decryptConfigs({});
        logger.debug('Recovered configs from secure storage');
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
      const saved = localStorage.getItem('translation.customFilters');
      if (saved) {
        const parsed = JSON.parse(saved);
        // Persisted regex source -> rehydrated RegExp with /g
        userFilters = parsed.map(f => ({
          ...f,
          pattern: new RegExp(f.patternStr || f.pattern.source, 'g'),
        }));
      }
    } catch (e) {
      logger.warn('Failed to load custom filters:', e);
    }

    this._filters = getEnabledFilters(userFilters);
    this._filtersInitialized = true;

    logger.debug('Filters initialized:', this._filters.map(f => f.name));
  }

  async _decryptConfigs(configs) {
    const { getAllProviderMetadata } = await import('../providers/registry.js');
    const allMeta = getAllProviderMetadata();
    const decrypted = {};
    const tasks = [];

    for (const meta of allMeta) {
      const providerId = meta.id;
      decrypted[providerId] = { ...(configs[providerId] || {}) };

      if (!meta.configSchema) continue;
      for (const [key, field] of Object.entries(meta.configSchema)) {
        if (!field.encrypted) continue;
        const currentValue = decrypted[providerId][key];
        if (currentValue && currentValue !== '***encrypted***') continue;

        // Independent IPC roundtrips — run in parallel to cut window cold-start.
        // Audit alerting counts decrypts per time window, so the burst shape
        // (serial vs parallel) doesn't change what it sees.
        tasks.push(
          secureStorage.get(`provider_${providerId}_${key}`).then((stored) => {
            if (stored) decrypted[providerId][key] = stored;
          })
        );
      }
    }

    await Promise.all(tasks);
    return decrypted;
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
        // Unicode brackets ⟦⟧ — unlikely to appear in user text or be mangled by LLMs
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

  // Glossary applied to the *translated* text — for cases where the LLM left
  // a source term as-is. Longer terms first so "API" doesn't pre-empt "API Key".
  _applyGlossary(translatedText, glossaryTerms) {
    if (!translatedText || !glossaryTerms || glossaryTerms.length === 0) {
      return { text: translatedText, replacements: [] };
    }

    let result = translatedText;
    const replacements = [];

    const sorted = [...glossaryTerms].sort((a, b) => b.source.length - a.source.length);

    for (const term of sorted) {
      if (!term.source || !term.target) continue;
      if (term.source.length < 2) continue;

      const sourceEscaped = term.source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const sourceRegex = new RegExp(sourceEscaped, 'gi');

      if (sourceRegex.test(result)) {
        result = result.replace(sourceRegex, term.target);
        replacements.push({ from: term.source, to: term.target });
        logger.debug(`Glossary replaced: "${term.source}" → "${term.target}"`);
      }
    }

    return { text: result, replacements };
  }

  // ===== Two-level cache =====

  // djb2 dual-hash for short, collision-resistant cache keys.
  // Same scheme as L2 cache so a key generated here matches a key stored on disk.
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
    // model is part of the key: same provider id can serve different local
    // models (LM Studio model swap) with very different output
    return `${targetLang}-${template}-${providerId}-${model}-${hash}`;
  }

  _checkCache(key, options = {}) {
    const { useCache = true, privacyMode = PRIVACY_MODE_IDS.STANDARD } = options;

    if (!useCache) return null;

    if (this._l1Cache.has(key)) {
      this._cacheStats.l1Hits++;
      logger.debug('[Cache] L1 HIT (memory)');

      // LRU bump: re-insert at the end
      const value = this._l1Cache.get(key);
      this._l1Cache.delete(key);
      this._l1Cache.set(key, value);

      return { value, source: 'l1' };
    }

    // Secure mode skips disk cache entirely (no persistence of translations)
    if (privacyMode !== PRIVACY_MODE_IDS.SECURE) {
      const l2Result = translationCache.get(key);
      if (l2Result) {
        this._cacheStats.l2Hits++;
        logger.debug('[Cache] L2 HIT (disk)');

        // Promote into L1 so subsequent hits avoid disk
        this._setL1Cache(key, l2Result);

        return { value: l2Result, source: 'l2' };
      }
    }

    this._cacheStats.misses++;
    return null;
  }

  _saveCache(key, result, options = {}) {
    const { useCache = true, privacyMode = PRIVACY_MODE_IDS.STANDARD } = options;

    if (!useCache) return;

    this._setL1Cache(key, result);

    if (privacyMode !== PRIVACY_MODE_IDS.SECURE) {
      const cacheEntry = {
        success: true,
        translated: result.text || result,
        from: result.from,
        to: result.to,
        timestamp: Date.now(),
      };
      translationCache.set(key, cacheEntry);
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
    if (level === 'l2' || level === 'all') {
      translationCache.clear();
      logger.debug('[Cache] L2 cleared');
    }
    this._cacheStats = { l1Hits: 0, l2Hits: 0, misses: 0 };
  }

  getCacheStats() {
    const total = this._cacheStats.l1Hits + this._cacheStats.l2Hits + this._cacheStats.misses;
    return {
      ...this._cacheStats,
      l1Size: this._l1Cache.size,
      l2Stats: translationCache.getStats(),
      hitRate: total > 0
        ? ((this._cacheStats.l1Hits + this._cacheStats.l2Hits) / total * 100).toFixed(1) + '%'
        : '0%',
    };
  }

  // ===== Mode / priority =====

  setMode(mode) {
    this._mode = mode;
    logger.debug(`Mode set to: ${mode}`);
  }

  getMode() {
    return this._mode;
  }

  setPriority(priority) {
    this._userPriority = priority;
    logger.debug('Priority set to:', priority);
  }

  getPriority() {
    // null = never configured -> defaults. [] = user explicitly disabled
    // every provider -> respect that, don't silently call cloud providers.
    if (this._userPriority) {
      return this._userPriority;
    }
    return DEFAULT_PRIORITY[this._mode] || DEFAULT_PRIORITY.normal;
  }

  resetFailureCount(providerId = null) {
    if (providerId) {
      this._failureCount[providerId] = 0;
      logger.debug(`Reset failure count for: ${providerId}`);
    } else {
      this._failureCount = {};
      logger.debug('Reset all failure counts');
    }
  }

  getFailureStatus() {
    return { ...this._failureCount };
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
      mode = this._mode,
      enableFallback = true,
      privacyMode = PRIVACY_MODE_IDS.STANDARD,
      useCache = true,
      glossaryTerms = [],
    } = options;

    const { processed, protectedMap } = this._preProcess(text);

    // Filter to providers usable right now (privacy / configured / not failing)
    const priority = this.getPriority();
    let firstAvailableId = '';
    let firstModel = '';
    const usableProviders = [];
    for (const id of priority) {
      if (!isProviderAllowed(id, privacyMode)) continue;
      if (!isProviderConfigured(id)) continue;
      if (this._failureCount[id] >= this._skipThreshold) continue;
      if (!firstAvailableId) {
        firstAvailableId = id;
        firstModel = getProvider(id)?.config?.model || '';
      }
      usableProviders.push(id);
    }

    // Cache key bound to the first available provider + model so switching
    // either invalidates the cache
    const cacheKey = this._getCacheKey(processed, { targetLang, template, providerId: firstAvailableId, model: firstModel });
    const cached = this._checkCache(cacheKey, { useCache, privacyMode });

    if (cached) {
      const cachedText = cached.value?.translated || cached.value?.text || cached.value;
      return {
        success: true,
        text: this._postProcess(cachedText, protectedMap),
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
        });

        if (result.success) {
          this._failureCount[id] = 0;

          let finalText = this._postProcess(result.text, protectedMap);

          let glossaryReplacements = [];
          if (glossaryTerms.length > 0) {
            const glossaryResult = this._applyGlossary(finalText, glossaryTerms);
            finalText = glossaryResult.text;
            glossaryReplacements = glossaryResult.replacements;
          }

          // Cache the raw provider output so glossary changes don't need re-translation
          this._saveCache(cacheKey, {
            text: result.text,
            from: sourceLang,
            to: targetLang
          }, { useCache, privacyMode });

          return {
            success: true,
            text: finalText,
            originalText: glossaryReplacements.length > 0 ? this._postProcess(result.text, protectedMap) : null,
            glossaryReplacements,
            provider: id,
            fromCache: false,
          };
        }

        // skipFailureCount: a deterministic "can't do this input" (e.g. DeepL
        // asked for an unsupported language) — counting it would bench the
        // provider for every other language too.
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

    // Total wipeout: every provider was either tried or skipped. Clear the
    // skip-list and retry once so a transient outage doesn't trap us forever.
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
      mode = this._mode,
      enableFallback = true,
      privacyMode = PRIVACY_MODE_IDS.STANDARD,
      useCache = true,
      glossaryTerms = [],
    } = options;

    const { processed, protectedMap } = this._preProcess(text);

    const priority = this.getPriority();
    let firstAvailableId = '';
    let firstModel = '';
    const usableProviders = [];
    for (const id of priority) {
      if (!isProviderAllowed(id, privacyMode)) continue;
      if (!isProviderConfigured(id)) continue;
      if (this._failureCount[id] >= this._skipThreshold) continue;
      if (!firstAvailableId) {
        firstAvailableId = id;
        firstModel = getProvider(id)?.config?.model || '';
      }
      usableProviders.push(id);
    }

    const cacheKey = this._getCacheKey(processed, { targetLang, template, providerId: firstAvailableId, model: firstModel });
    const cached = this._checkCache(cacheKey, { useCache, privacyMode });

    if (cached) {
      const cachedText = cached.value?.translated || cached.value?.text || cached.value;
      const finalText = this._postProcess(cachedText, protectedMap);

      // Replay cached result as a single chunk so the caller's stream-handling code path runs
      if (onChunk) {
        onChunk(finalText);
      }

      return {
        success: true,
        text: finalText,
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

          // Frame-aligned flush: placeholder restore + UI update run once per
          // frame instead of per token. Placeholders still resolve visibly
          // mid-stream; the per-chunk work is just string concat.
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
              { systemPrompt, template }
            );
          } finally {
            // A flush firing after the final setState downstream would
            // overwrite glossary-applied text with a stale partial.
            throttle.cancel();
          }

          if (result.success) {
            this._failureCount[id] = 0;

            let finalText = this._postProcess(result.text || fullText, protectedMap);
            let glossaryReplacements = [];
            if (glossaryTerms.length > 0) {
              const glossaryResult = this._applyGlossary(finalText, glossaryTerms);
              finalText = glossaryResult.text;
              glossaryReplacements = glossaryResult.replacements;
            }

            this._saveCache(cacheKey, {
              text: result.text || fullText,
              from: sourceLang,
              to: targetLang
            }, { useCache, privacyMode });

            return {
              success: true,
              text: finalText,
              originalText: glossaryReplacements.length > 0 ? this._postProcess(result.text || fullText, protectedMap) : null,
              glossaryReplacements,
              provider: id,
              fromCache: false,
            };
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
          });

          if (result.success) {
            this._failureCount[id] = 0;

            let finalText = this._postProcess(result.text, protectedMap);
            let glossaryReplacements = [];
            if (glossaryTerms.length > 0) {
              const glossaryResult = this._applyGlossary(finalText, glossaryTerms);
              finalText = glossaryResult.text;
              glossaryReplacements = glossaryResult.replacements;
            }

            if (onChunk) {
              onChunk(finalText);
            }

            this._saveCache(cacheKey, {
              text: result.text,
              from: sourceLang,
              to: targetLang
            }, { useCache, privacyMode });

            return {
              success: true,
              text: finalText,
              originalText: glossaryReplacements.length > 0 ? this._postProcess(result.text, protectedMap) : null,
              glossaryReplacements,
              provider: id,
              fromCache: false,
            };
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

    // Mirror translate(): if providers were actually tried, surface that (with
    // the last real error) instead of the misleading "no providers available".
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

  // Generic chat completion for AI features (analysis, rewriting).
  // Falls back to translating the user message if no provider has chat().
  async chatCompletion(messages, options = {}) {
    if (!this._initialized) {
      await this.init();
    }

    // Same provider routing as translate(): first usable one wins
    const { privacyMode = PRIVACY_MODE_IDS.STANDARD } = options;
    for (const id of this.getPriority()) {
      if (!isProviderAllowed(id, privacyMode)) continue;
      if (!isProviderConfigured(id)) continue;
      const provider = getProvider(id);
      if (provider && typeof provider.chat === 'function') {
        return provider.chat(messages, options);
      }
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

  async testProvider(providerId) {
    const provider = getProvider(providerId);
    if (!provider) {
      return { success: false, message: _t('svc.providerNotFound', '翻译源不存在') };
    }

    if (!provider.isConfigured()) {
      const missing = getMissingConfig(providerId);
      return { success: false, message: _t('svc.missingConfig', '缺少配置') + ': ' + missing.join(', ') };
    }

    return provider.testConnection();
  }

  // Used by settings UI to verify an unsaved config without committing it.
  // privacyMode must come from the caller — offline mode blocks tests against
  // disallowed providers (even a probe request is network traffic).
  async testProviderWithConfig(providerId, config, privacyMode = PRIVACY_MODE_IDS.STANDARD) {
    if (!isProviderAllowed(providerId, privacyMode)) {
      return { success: false, message: _t('svc.testBlockedByPrivacy', '当前隐私模式已禁用该翻译源') };
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

  updateProviderConfig(providerId, config) {
    updateProviderConfig(providerId, config);
  }

  get initialized() {
    return this._initialized;
  }

  registerFilter(filter) {
    if (filter && filter.name && filter.pattern) {
      this._filters.push(filter);
      logger.debug(`Filter registered: ${filter.name}`);
    }
  }

  getFilters() {
    return [...this._filters];
  }
}

const translationService = new TranslationService();

export default translationService;
export { TranslationService };
