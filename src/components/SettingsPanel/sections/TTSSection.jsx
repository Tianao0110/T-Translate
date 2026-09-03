// TTS settings section. Replaces the native <select> with a custom dropdown
// because Electron's native select stutters when the option list is long.

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Play, Square, RefreshCw, AlertTriangle, ChevronDown, Check } from 'lucide-react';
import ttsManager, { DEFAULT_TTS_CONFIG, TTS_STATUS } from '../../../services/tts/index.js';
import stackClient from '../../../services/stack-client.js';
import PackList from './PackList.jsx';
import createLogger from '../../../utils/logger.js';
const logger = createLogger('TTSSection');

const VoiceDropdown = ({ value, onChange, groupedVoices, noVoices, isLoading, autoLabel, emptyLabel }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const selectedName = useMemo(() => {
    if (!value) return noVoices ? emptyLabel : autoLabel;
    for (const voices of Object.values(groupedVoices)) {
      const found = voices.find(v => v.id === value);
      if (found) return found.name;
    }
    return autoLabel;
  }, [value, groupedVoices, noVoices, autoLabel, emptyLabel]);

  const handleSelect = (id) => {
    onChange(id);
    setOpen(false);
  };

  return (
    <div className="tts-dropdown" ref={ref}>
      <button
        className={`tts-dropdown-trigger ${open ? 'open' : ''}`}
        onClick={() => !isLoading && !noVoices && setOpen(!open)}
        disabled={isLoading || noVoices}
        type="button"
      >
        <span className="tts-dropdown-text">{selectedName}</span>
        <ChevronDown size={14} className={`tts-dropdown-arrow ${open ? 'rotated' : ''}`} />
      </button>

      {open && (
        <div className="tts-dropdown-menu">
          <div
            className={`tts-dropdown-item ${!value ? 'selected' : ''}`}
            onClick={() => handleSelect('')}
          >
            <span>{autoLabel}</span>
            {!value && <Check size={12} />}
          </div>

          {Object.entries(groupedVoices).map(([lang, voices]) => (
            <div key={lang}>
              <div className="tts-dropdown-group">{lang}</div>
              {voices.map(voice => (
                <div
                  key={voice.id}
                  className={`tts-dropdown-item ${value === voice.id ? 'selected' : ''}`}
                  onClick={() => handleSelect(voice.id)}
                >
                  <span className="tts-dropdown-voice-name">{voice.name}</span>
                  {value === voice.id && <Check size={12} />}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const TTSSection = ({ settings, updateSetting, notify, confirm }) => {
  const { t } = useTranslation();
  const [voices, setVoices] = useState([]);
  const [isLoadingVoices, setIsLoadingVoices] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [ttsStatus, setTtsStatus] = useState(TTS_STATUS.IDLE);
  // Engines whose isAvailable() answered true. The picker renders only when
  // there is an actual choice (neural shows up once its voice pack exists) —
  // a one-option dropdown would be noise and a claim we can't back.
  const [availableEngines, setAvailableEngines] = useState([]);
  // Neural packs carry a hundred speakers; the picker opens on the featured
  // few and unfolds the rest on request.
  const [showAllVoices, setShowAllVoices] = useState(false);
  // Which per-language preview button is playing ('' = the main one).
  const [testingLang, setTestingLang] = useState('');

  const ttsConfig = {
    ...DEFAULT_TTS_CONFIG,
    ...(settings?.tts || {}),
  };
  const voiceByLang = ttsConfig.voiceByLang || {};
  const isNeural = ttsConfig.engine === 'neural' && availableEngines.includes('neural');
  const isEndpoint = ttsConfig.engine === 'endpoint' && availableEngines.includes('endpoint');
  // sherpa voices and the OpenAI speech route have no pitch input.
  const noPitch = isNeural || isEndpoint;
  const endpointCfg = { ...DEFAULT_TTS_CONFIG.endpoint, ...(ttsConfig.endpoint || {}) };
  // Typed but not yet vaulted; cleared once encrypted.
  const [draftKey, setDraftKey] = useState('');
  const [endpointTesting, setEndpointTesting] = useState(false);

  const loadVoices = useCallback(async () => {
    setIsLoadingVoices(true);
    try {
      await ttsManager.init();
      const voiceList = await ttsManager.getVoices();
      setVoices(voiceList);
    } catch (e) {
      logger.error('Failed to load voices:', e);
      notify?.(t('tts.loadVoicesFailed'), 'error');
    } finally {
      setIsLoadingVoices(false);
    }
  }, [notify, t]);

  const loadEngines = useCallback(() => {
    return ttsManager.listEngines()
      .then((list) => setAvailableEngines(list.filter((e) => e.available).map((e) => e.id)))
      .catch(() => {});
  }, []);

  // A voice pack landed or left: the engine list and the voice list change.
  const handlePacksChanged = useCallback(async () => {
    await loadEngines();
    await loadVoices();
  }, [loadEngines, loadVoices]);

  useEffect(() => {
    loadVoices();
    let cancelled = false;
    ttsManager.listEngines()
      .then((list) => {
        if (!cancelled) setAvailableEngines(list.filter((e) => e.available).map((e) => e.id));
      })
      .catch(() => {});
    const unsub = ttsManager.onStatusChange((status) => {
      setTtsStatus(status);
      if (status === TTS_STATUS.IDLE) setIsTesting(false);
    });
    // Return the slot on unmount (and stop any test playback), or the main
    // panel's status callback stays evicted after visiting this page.
    return () => {
      cancelled = true;
      unsub();
      ttsManager.stop();
    };
  }, [loadVoices]);

  // Engine switch takes effect on the live manager at once (test button uses
  // it immediately); the voice list is engine-specific, so reload it.
  const handleEngineChange = useCallback(async (engineId) => {
    updateSetting('tts', 'engine', engineId, true);
    await ttsManager.updateConfig({ engine: engineId });
    loadVoices();
  }, [updateSetting, loadVoices]);

  // ttsManager.updateConfig persists to the store immediately, so the React
  // update is silent — otherwise the panel would flag "unsaved changes" for a
  // change that's already saved.
  const updateTTSConfig = useCallback((key, value) => {
    updateSetting('tts', key, value, true);
    ttsManager.updateConfig({ [key]: value });
  }, [updateSetting]);

  // Plain endpoint fields persist like any tts setting; the address decides
  // whether the engine is offered, so the engine list follows.
  const updateEndpoint = useCallback(async (patch) => {
    const next = { ...endpointCfg, ...patch };
    updateSetting('tts', 'endpoint', next, true);
    await ttsManager.updateConfig({ endpoint: next });
    if ('baseUrl' in patch) loadEngines();
  }, [endpointCfg, updateSetting, loadEngines]);

  // The key goes straight to the DPAPI vault (tts_endpoint_ prefix: offline
  // mode blocks its decryption) and is never written into settings.
  const saveEndpointKey = useCallback(async () => {
    const value = draftKey.trim();
    if (!value) return;
    const ss = window.electron?.secureStorage;
    let ok = false;
    try {
      const res = await ss?.encrypt?.('tts_endpoint_apiKey', value);
      ok = !!res && res.success !== false;
    } catch {
      ok = false;
    }
    if (!ok) {
      notify?.(t('tts.endpoint.keySaveFailed'), 'error');
      return;
    }
    setDraftKey('');
    updateEndpoint({ hasKey: true });
  }, [draftKey, notify, t, updateEndpoint]);

  const clearEndpointKey = useCallback(async () => {
    try {
      await window.electron?.secureStorage?.delete?.('tts_endpoint_apiKey');
    } catch {
      // nothing to clear
    }
    setDraftKey('');
    updateEndpoint({ hasKey: false });
  }, [updateEndpoint]);

  // One real synthesis is the only honest connectivity test; the sample is
  // played so the user hears the server's actual voice.
  const testEndpoint = useCallback(async () => {
    setEndpointTesting(true);
    try {
      const res = await stackClient.ttsTest({
        baseUrl: endpointCfg.baseUrl,
        model: endpointCfg.model,
        voice: endpointCfg.voice,
        ...(draftKey.trim() ? { apiKey: draftKey.trim() } : {}),
        sampleText: t('tts.testTextMixed'),
      });
      if (!res?.success) {
        notify?.(res?.code === 'OFFLINE_BLOCKED' ? t('ttsEndpoint.offline') : (res?.error || t('tts.testFailed')), 'error');
        return;
      }
      notify?.(t('tts.endpoint.testOk', { ms: res.ms, kb: (res.bytes / 1024).toFixed(0) }), 'success');
      const ctx = new AudioContext();
      const buffer = await ctx.decodeAudioData(res.audio);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const gain = ctx.createGain();
      gain.gain.value = ttsConfig.volume;
      source.connect(gain);
      gain.connect(ctx.destination);
      source.onended = () => ctx.close().catch(() => {});
      source.start();
    } catch (e) {
      notify?.(t('tts.testFailed') + ': ' + e.message, 'error');
    } finally {
      setEndpointTesting(false);
    }
  }, [endpointCfg.baseUrl, endpointCfg.model, endpointCfg.voice, draftKey, ttsConfig.volume, notify, t]);

  // Maps thrown error strings (from web-speech.speak()) to localized UI messages.
  // NO_VOICES = OS has no speech voices installed at all; NO_VOICE_FOR_LANG = none match the target lang.
  const getTTSErrorMessage = (e) => {
    const msg = e.message || '';
    if (msg === 'NO_VOICES') {
      return { text: t('tts.noVoicesInstalled'), type: 'warning' };
    }
    if (msg.startsWith('NO_VOICE_FOR_LANG:')) {
      const langCode = msg.split(':')[1];
      const langName = t(`tts.langNames.${langCode}`, { defaultValue: langCode });
      return { text: t('tts.noVoiceForLang', { lang: langName }), type: 'warning' };
    }
    return { text: t('tts.testFailed') + ': ' + e.message, type: 'error' };
  };

  // lang = 'zh' | 'en' previews that language's own voice; '' is the main
  // button (mixed text once a specific voice or the neural engine is chosen).
  const handleTest = async (lang = '') => {
    // Same button toggles play and stop
    if (isTesting || ttsStatus === TTS_STATUS.SPEAKING) {
      ttsManager.stop();
      setIsTesting(false);
      setTestingLang('');
      return;
    }
    setIsTesting(true);
    setTestingLang(lang);
    try {
      const testText = lang === 'en'
        ? t('tts.testTextEnglish')
        : lang === 'zh' || (!isNeural && !ttsConfig.voiceId)
          ? t('tts.testTextChinese')
          : t('tts.testTextMixed');
      await ttsManager.speak(testText, {
        lang: lang || 'zh',
        // Neural voices are chosen per language, not through the single id.
        voiceId: isNeural ? '' : ttsConfig.voiceId,
        voiceByLang,
        rate: ttsConfig.rate,
        pitch: ttsConfig.pitch,
        volume: ttsConfig.volume,
      });
    } catch (e) {
      logger.error('TTS test failed:', e);
      const { text, type } = getTTSErrorMessage(e);
      notify?.(text, type);
    } finally {
      setIsTesting(false);
      setTestingLang('');
    }
  };

  const hasHiddenVoices = voices.some((v) => v.featured === false);
  const visibleVoices = useMemo(() => {
    if (showAllVoices || !hasHiddenVoices) return voices;
    const chosen = new Set([ttsConfig.voiceId, ...Object.values(voiceByLang)]);
    return voices.filter((v) => v.featured !== false || chosen.has(v.id));
  }, [voices, showAllVoices, hasHiddenVoices, ttsConfig.voiceId, voiceByLang]);

  // Per-language rows (neural): voices native to the language, or, for a pack
  // with one speaker covering both (MeloTTS), the ones that can read it.
  const voicesFor = useCallback((lang) => {
    const native = visibleVoices.filter((v) => v.lang === lang);
    if (native.length) return native;
    return visibleVoices.filter((v) => Array.isArray(v.languages) && v.languages.includes(lang));
  }, [visibleVoices]);

  const groupedVoices = useMemo(() => {
    return visibleVoices.reduce((groups, voice) => {
      const langCode = voice.lang.split('-')[0];
      const langNames = {
        'zh': t('tts.langNames.zh'), 'en': t('tts.langNames.en'),
        'ja': t('tts.langNames.ja'), 'ko': t('tts.langNames.ko'),
        'fr': t('tts.langNames.fr'), 'de': t('tts.langNames.de'),
        'es': t('tts.langNames.es'), 'ru': t('tts.langNames.ru'),
        'pt': t('tts.langNames.pt'), 'it': t('tts.langNames.it'),
      };
      const groupName = langNames[langCode] || voice.lang;
      if (!groups[groupName]) groups[groupName] = [];
      groups[groupName].push(voice);
      return groups;
    }, {});
  }, [visibleVoices, t]);

  const noVoices = !isLoadingVoices && voices.length === 0;

  return (
    <div className="setting-content">
      <h3>{t('settings.tts.title')}</h3>
      <p className="setting-description">{t('tts.description')}</p>

      <div className="setting-group">
        <label className="setting-switch">
          <input
            type="checkbox"
            checked={ttsConfig.enabled}
            onChange={(e) => updateTTSConfig('enabled', e.target.checked)}
          />
          <span className="switch-slider"></span>
          <span className="switch-label">{t('tts.enableTTS')}</span>
        </label>
        <p className="setting-hint">{t('tts.enableHint')}</p>
      </div>

      {ttsConfig.enabled && (
        <>
          {availableEngines.length > 1 && (
            <div className="setting-group">
              <label className="setting-label">{t('tts.engine')}</label>
              <div className="setting-row">
                <select
                  className="setting-select"
                  value={availableEngines.includes(ttsConfig.engine) ? ttsConfig.engine : 'web-speech'}
                  onChange={(e) => handleEngineChange(e.target.value)}
                >
                  {availableEngines.map((id) => (
                    <option key={id} value={id}>{t(`tts.engineNames.${id}`)}</option>
                  ))}
                </select>
              </div>
              <p className="setting-hint">{t('tts.engineHint')}</p>
            </div>
          )}

          {/* Voice packs download here (the only entry point), same list
              component as the listen page. System voices stay the
              zero-download floor whether or not a pack is installed. */}
          {window.electron?.ttsPacks && (
            <PackList
              bridge={window.electron.ttsPacks}
              prefix="tts.packs"
              notify={notify}
              confirm={confirm}
              onChanged={handlePacksChanged}
            >
              <p className="setting-hint">{t('tts.packs.hint')}</p>
            </PackList>
          )}

          {/* External OpenAI-compatible server. Fields persist like any tts
              setting; the key goes to the vault via saveEndpointKey. */}
          {window.electron?.stack?.ttsSpeak && (
            <div className="setting-group">
              <label className="setting-label">{t('tts.endpoint.title')}</label>
              <div className="setting-row">
                <input
                  type="text"
                  className="setting-input compact"
                  placeholder={t('tts.endpoint.baseUrlPlaceholder')}
                  title={t('tts.endpoint.baseUrl')}
                  value={endpointCfg.baseUrl}
                  onChange={(e) => updateEndpoint({ baseUrl: e.target.value })}
                />
              </div>
              <div className="setting-row">
                <input
                  type="password"
                  className="setting-input compact"
                  placeholder={endpointCfg.hasKey ? t('tts.endpoint.keySaved') : t('tts.endpoint.apiKeyPlaceholder')}
                  title={t('tts.endpoint.apiKey')}
                  value={draftKey}
                  onChange={(e) => setDraftKey(e.target.value)}
                  onBlur={saveEndpointKey}
                  autoComplete="off"
                />
                {endpointCfg.hasKey && (
                  <button className="btn-small" onClick={clearEndpointKey} title={t('tts.endpoint.clearKey')}>
                    {t('tts.endpoint.clearKey')}
                  </button>
                )}
              </div>
              <div className="setting-row">
                <input
                  type="text"
                  className="setting-input compact"
                  placeholder={t('tts.endpoint.modelPlaceholder')}
                  title={t('tts.endpoint.model')}
                  value={endpointCfg.model}
                  onChange={(e) => updateEndpoint({ model: e.target.value })}
                />
                <input
                  type="text"
                  className="setting-input compact"
                  placeholder={t('tts.endpoint.voicePlaceholder')}
                  title={t('tts.endpoint.voice')}
                  value={endpointCfg.voice}
                  onChange={(e) => updateEndpoint({ voice: e.target.value })}
                />
                <button
                  className="btn-small"
                  onClick={testEndpoint}
                  disabled={endpointTesting || !endpointCfg.baseUrl.trim()}
                >
                  {endpointTesting ? <RefreshCw size={12} className="spinning" /> : <Play size={12} />}
                  <span style={{ marginLeft: 4 }}>{endpointTesting ? t('tts.endpoint.testing') : t('tts.endpoint.test')}</span>
                </button>
              </div>
              <p className="setting-hint">{t('tts.endpoint.hint')}</p>
            </div>
          )}

          {!isEndpoint && (
          <div className="setting-group">
            <div className="tts-slider-header">
              <label className="setting-label">{t('tts.defaultVoice')}</label>
              <span className={`tts-voice-count ${noVoices ? 'empty' : ''}`}>
                {isLoadingVoices ? '...' : voices.length > 0
                  ? t('tts.voicesLoaded', { count: voices.length })
                  : t('tts.noVoicesInstalled')}
              </span>
            </div>

            {isNeural
              ? ['zh', 'en'].map((lang) => {
                const langVoices = voicesFor(lang);
                return (
                  <div className="setting-row" key={lang}>
                    <label className="setting-label" style={{ minWidth: 72 }}>
                      {t('tts.voiceFor', { lang: t(`tts.langNames.${lang}`) })}
                    </label>
                    <VoiceDropdown
                      value={voiceByLang[lang] || ''}
                      onChange={(id) => updateTTSConfig('voiceByLang', { ...voiceByLang, [lang]: id })}
                      groupedVoices={{ [t(`tts.langNames.${lang}`)]: langVoices }}
                      noVoices={langVoices.length === 0}
                      isLoading={isLoadingVoices}
                      autoLabel={t('tts.autoVoice')}
                      emptyLabel="—"
                    />
                    <button
                      className="setting-btn-icon"
                      onClick={() => handleTest(lang)}
                      disabled={langVoices.length === 0}
                      title={isTesting && testingLang === lang ? t('tts.stop') : t('tts.play')}
                    >
                      {isTesting && testingLang === lang ? <Square size={14} /> : <Play size={14} />}
                    </button>
                  </div>
                );
              })
              : (
                <div className="setting-row">
                  <VoiceDropdown
                    value={ttsConfig.voiceId || ''}
                    onChange={(id) => updateTTSConfig('voiceId', id)}
                    groupedVoices={groupedVoices}
                    noVoices={noVoices}
                    isLoading={isLoadingVoices}
                    autoLabel={t('tts.autoSelect')}
                    emptyLabel="—"
                  />
                </div>
              )}

            <div className="setting-row">
              <button
                className="setting-btn-icon"
                onClick={loadVoices}
                disabled={isLoadingVoices}
                title={t('tts.refreshVoices')}
              >
                <RefreshCw size={14} className={isLoadingVoices ? 'spinning' : ''} />
              </button>
              {hasHiddenVoices && (
                <button
                  className="btn-small"
                  onClick={() => setShowAllVoices((v) => !v)}
                  disabled={isLoadingVoices}
                >
                  {showAllVoices ? t('tts.showFeaturedVoices') : t('tts.showAllVoices', { count: voices.length })}
                </button>
              )}
            </div>

            {noVoices && (
              <div className="tts-voice-warning">
                <AlertTriangle size={14} className="tts-voice-warning-icon" />
                <div className="tts-voice-warning-text">
                  <div className="tts-voice-warning-title">{t('tts.noVoicesInstalled')}</div>
                  <div className="tts-voice-warning-hint">{t('tts.installVoiceHint')}</div>
                </div>
              </div>
            )}

            {!noVoices && !isLoadingVoices && (
              <p className="setting-hint">{isNeural ? t('tts.voiceByLangHint') : t('tts.autoSelectHint')}</p>
            )}
          </div>
          )}

          <div className="tts-slider-group">
            <div className="setting-group tts-slider-item">
              <div className="tts-slider-header">
                <label className="setting-label">{t('tts.rate')}</label>
                <span className="tts-slider-value">{ttsConfig.rate.toFixed(1)}x</span>
              </div>
              <input type="range" className="setting-range" min="0.5" max="2" step="0.1"
                value={ttsConfig.rate}
                onChange={(e) => updateTTSConfig('rate', parseFloat(e.target.value))}
              />
              <p className="setting-hint">{t('tts.rateHint')}</p>
            </div>

            <div className="setting-group tts-slider-item">
              <div className="tts-slider-header">
                <label className="setting-label">{t('tts.pitch')}</label>
                <span className="tts-slider-value">{ttsConfig.pitch.toFixed(1)}</span>
              </div>
              {/* sherpa voices have no pitch input; the slider stays for system voices */}
              <input type="range" className="setting-range" min="0.5" max="2" step="0.1"
                value={ttsConfig.pitch}
                disabled={noPitch}
                onChange={(e) => updateTTSConfig('pitch', parseFloat(e.target.value))}
              />
              <p className="setting-hint">{noPitch ? t('tts.pitchUnsupported') : t('tts.pitchHint')}</p>
            </div>

            <div className="setting-group tts-slider-item">
              <div className="tts-slider-header">
                <label className="setting-label">{t('tts.volume')}</label>
                <span className="tts-slider-value">{Math.round(ttsConfig.volume * 100)}%</span>
              </div>
              <input type="range" className="setting-range" min="0" max="1" step="0.1"
                value={ttsConfig.volume}
                onChange={(e) => updateTTSConfig('volume', parseFloat(e.target.value))}
              />
              <p className="setting-hint">{t('tts.volumeHint')}</p>
            </div>
          </div>

          <div className="tts-preview">
            <button
              className={`tts-preview-btn ${isTesting ? 'stop' : 'play'}`}
              onClick={() => handleTest('')}
              disabled={noVoices && !isEndpoint}
            >
              {isTesting ? <><Square size={14} />{t('tts.stop')}</> : <><Play size={14} />{t('tts.play')}</>}
            </button>
            {noVoices && !isEndpoint && <span className="tts-preview-status">{t('tts.noVoicesInstalled')}</span>}
          </div>
        </>
      )}
    </div>
  );
};

export default TTSSection;
