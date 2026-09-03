// 「读 · 朗读」 tab (rendered inside AudioSection). Compact layout per the
// batch-4 design: enable switch, engine segmented control, one "speaking
// with" status line that says local vs API and carries the preview button,
// the engine's own block underneath (per-language voices for neural, a
// default voice for system voices, the server form for the endpoint), and
// the three sliders in one row.

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Play, Square, RefreshCw, Zap } from 'lucide-react';
import ttsManager, { DEFAULT_TTS_CONFIG, TTS_STATUS } from '../../../services/tts/index.js';
import stackClient from '../../../services/stack-client.js';
import VoicePicker from './VoicePicker.jsx';
import createLogger from '../../../utils/logger.js';
const logger = createLogger('TTSSection');

const ENGINE_ORDER = ['web-speech', 'neural', 'endpoint'];

function hostOf(url) {
  try {
    const u = new URL(String(url || '').trim());
    return u.host || u.hostname;
  } catch {
    return String(url || '').trim();
  }
}

const TTSSection = ({ settings, updateSetting, notify }) => {
  const { t } = useTranslation();
  const [voices, setVoices] = useState([]);
  const [isLoadingVoices, setIsLoadingVoices] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testingLang, setTestingLang] = useState('');
  const [ttsStatus, setTtsStatus] = useState(TTS_STATUS.IDLE);
  const [availableEngines, setAvailableEngines] = useState(['web-speech']);
  const [packCount, setPackCount] = useState(0);
  const [endpointCap, setEndpointCap] = useState(null);
  // Typed but not yet vaulted; cleared once encrypted.
  const [draftKey, setDraftKey] = useState('');
  const [endpointTesting, setEndpointTesting] = useState(false);
  // Last test outcome for the status row: null | { success, ms, kb, error }
  const [endpointTest, setEndpointTest] = useState(null);

  const ttsConfig = { ...DEFAULT_TTS_CONFIG, ...(settings?.tts || {}) };
  const voiceByLang = ttsConfig.voiceByLang || {};
  const endpointCfg = { ...DEFAULT_TTS_CONFIG.endpoint, ...(ttsConfig.endpoint || {}) };
  const hasEndpointBridge = !!window.electron?.stack?.ttsSpeak;
  const chosen = ttsConfig.engine || 'web-speech';
  // What actually speaks: the choice when its engine is usable, else system voices.
  const effective = availableEngines.includes(chosen) ? chosen : 'web-speech';
  const isNeural = effective === 'neural';
  const isEndpoint = effective === 'endpoint';
  // sherpa voices and the OpenAI speech route have no pitch input.
  const noPitch = isNeural || isEndpoint;

  const loadVoices = useCallback(async () => {
    setIsLoadingVoices(true);
    try {
      await ttsManager.init();
      setVoices(await ttsManager.getVoices());
    } catch (e) {
      logger.error('Failed to load voices:', e);
      notify?.(t('tts.loadVoicesFailed'), 'error');
    } finally {
      setIsLoadingVoices(false);
    }
  }, [notify, t]);

  const loadEngines = useCallback(async () => {
    try {
      const [list, status, cap] = await Promise.all([
        ttsManager.listEngines(),
        window.electron?.audioEngine?.ttsStatus?.(),
        hasEndpointBridge ? stackClient.getTtsCapability() : null,
      ]);
      setAvailableEngines(list.filter((e) => e.available).map((e) => e.id));
      setPackCount(status?.packs?.length || 0);
      setEndpointCap(cap);
    } catch (e) {
      logger.debug('engine probe failed:', e.message);
    }
  }, [hasEndpointBridge]);

  useEffect(() => {
    loadVoices();
    loadEngines();
    const unsub = ttsManager.onStatusChange((status) => {
      setTtsStatus(status);
      if (status === TTS_STATUS.IDLE) {
        setIsTesting(false);
        setTestingLang('');
      }
    });
    // Return the slot on unmount (and stop any test playback), or the main
    // panel's status callback stays evicted after visiting this page.
    return () => {
      unsub();
      ttsManager.stop();
    };
  }, [loadVoices, loadEngines]);

  // Engine switch takes effect on the live manager at once (preview uses it
  // immediately); the voice list is engine-specific, so reload it.
  const handleEngineChange = useCallback(async (engineId) => {
    updateSetting('tts', 'engine', engineId, true);
    await ttsManager.updateConfig({ engine: engineId });
    await loadEngines();
    loadVoices();
  }, [updateSetting, loadEngines, loadVoices]);

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
        const error = res?.code === 'OFFLINE_BLOCKED' ? t('ttsEndpoint.offline') : (res?.error || t('tts.testFailed'));
        setEndpointTest({ success: false, error });
        notify?.(error, 'error');
        return;
      }
      setEndpointTest({ success: true, ms: res.ms, kb: (res.bytes / 1024).toFixed(0) });
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
      setEndpointTest({ success: false, error: e.message });
      notify?.(t('tts.testFailed') + ': ' + e.message, 'error');
    } finally {
      setEndpointTesting(false);
    }
  }, [endpointCfg.baseUrl, endpointCfg.model, endpointCfg.voice, draftKey, ttsConfig.volume, notify, t]);

  // Maps thrown error strings to localized UI messages.
  const getTTSErrorMessage = (e) => {
    const msg = e.message || '';
    if (msg === 'NO_VOICES') return { text: t('tts.noVoicesInstalled'), type: 'warning' };
    if (msg.startsWith('NO_VOICE_FOR_LANG:')) {
      const langCode = msg.split(':')[1];
      const langName = t(`tts.langNames.${langCode}`, { defaultValue: langCode });
      return { text: t('tts.noVoiceForLang', { lang: langName }), type: 'warning' };
    }
    return { text: t('tts.testFailed') + ': ' + e.message, type: 'error' };
  };

  const testTextFor = (lang) => {
    if (lang === 'en') return t('tts.testTextEnglish');
    if (lang === 'zh') return t('tts.testTextChinese');
    return isNeural || isEndpoint || ttsConfig.voiceId ? t('tts.testTextMixed') : t('tts.testTextChinese');
  };

  // lang = 'zh' | 'en' previews that language's own voice; '' is the status
  // row's preview. overrides lets a picker chip play before it is chosen.
  const handleTest = async (lang = '', overrides = {}) => {
    if (isTesting || ttsStatus === TTS_STATUS.SPEAKING) {
      ttsManager.stop();
      setIsTesting(false);
      setTestingLang('');
      if (!overrides.voiceId && !overrides.voiceByLang) return;
    }
    setIsTesting(true);
    setTestingLang(lang);
    try {
      await ttsManager.speak(testTextFor(lang), {
        lang: lang || 'zh',
        // Neural voices are chosen per language, not through the single id.
        voiceId: isNeural ? '' : ttsConfig.voiceId,
        voiceByLang,
        rate: ttsConfig.rate,
        pitch: ttsConfig.pitch,
        volume: ttsConfig.volume,
        ...overrides,
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

  // Per-language rows (neural): voices native to the language, or, for a pack
  // with one speaker covering both (MeloTTS), the ones that can read it.
  const voicesFor = useCallback((lang) => {
    const native = voices.filter((v) => v.lang === lang);
    if (native.length) return native;
    return voices.filter((v) => Array.isArray(v.languages) && v.languages.includes(lang));
  }, [voices]);

  const voiceName = (id) => voices.find((v) => v.id === id)?.name || t('audio.now.auto');

  const endpointStatusText = endpointTest === null
    ? t('audio.now.untested')
    : endpointTest.success
      ? t('audio.now.lastTest', { ms: endpointTest.ms })
      : t('audio.now.lastFail', { error: endpointTest.error });

  // The status line: what speaks right now and why.
  const nowLine = useMemo(() => {
    if (chosen === 'endpoint') {
      if (isEndpoint) {
        return {
          warn: endpointTest?.success === false,
          value: `${t('audio.now.api')} · ${hostOf(endpointCfg.baseUrl)}`,
          sub: t('audio.now.endpointSub', {
            model: endpointCfg.model || 'tts-1',
            voice: endpointCfg.voice || 'alloy',
            test: endpointStatusText,
          }),
        };
      }
      return {
        warn: true,
        value: t('tts.engineNames.endpoint'),
        sub: endpointCap?.code === 'OFFLINE_BLOCKED' ? t('audio.now.endpointBlocked') : t('ttsEndpoint.notConfigured'),
      };
    }
    if (isNeural) {
      return {
        warn: false,
        value: `${t('audio.now.local')} · ${t('tts.engineNames.neural')}`,
        sub: t('audio.now.neuralSub', { zh: voiceName(voiceByLang.zh), en: voiceName(voiceByLang.en) }),
      };
    }
    return {
      warn: chosen === 'neural',
      value: `${t('audio.now.local')} · ${t('tts.engineNames.web-speech')}`,
      sub: t('audio.now.webSub'),
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosen, isEndpoint, isNeural, endpointTest, endpointCfg.baseUrl, endpointCfg.model, endpointCfg.voice, endpointCap, voices, voiceByLang.zh, voiceByLang.en, t]);

  const engineSub = (id) => {
    if (id === 'neural') return packCount ? t('audio.engine.packs', { count: packCount }) : t('audio.engine.noPacks');
    if (id === 'endpoint') return endpointCfg.baseUrl.trim() ? hostOf(endpointCfg.baseUrl) : t('audio.engine.endpointUnset');
    return '';
  };
  const engineDisabled = (id) => (id === 'neural' ? !availableEngines.includes('neural') : false);
  const engines = ENGINE_ORDER.filter((id) => id !== 'endpoint' || hasEndpointBridge);

  const playing = (lang) => isTesting && testingLang === lang;

  return (
    <div>
      <div className="setting-group">
        <label className="setting-switch">
          <input
            type="checkbox"
            checked={ttsConfig.enabled}
            onChange={(e) => updateTTSConfig('enabled', e.target.checked)}
          />
          <span className="switch-slider"></span>
          <span className="switch-label">{t('tts.enableTTS')}</span>
          <span className="setting-hint" style={{ margin: '0 0 0 10px' }}>{t('tts.enableHint')}</span>
        </label>
      </div>

      {ttsConfig.enabled && (
        <>
          <div className="setting-group">
            <label className="setting-label">{t('audio.engine.label')}</label>
            <div className="seg">
              {engines.map((id) => (
                <button
                  key={id}
                  type="button"
                  className={chosen === id ? 'on' : ''}
                  disabled={engineDisabled(id)}
                  onClick={() => handleEngineChange(id)}
                >
                  {t(`tts.engineNames.${id}`)}
                  {engineSub(id) && <span className="n">{engineSub(id)}</span>}
                </button>
              ))}
            </div>
            <div className="tts-now">
              <span className={`dot ${nowLine.warn ? 'warn' : ''}`}></span>
              <span className="k">{t('audio.now.label')}</span>
              <span className="v">{nowLine.value}</span>
              <span className="sub">{nowLine.sub}</span>
              <button
                className="btn-small"
                onClick={() => handleTest('')}
                disabled={!isEndpoint && voices.length === 0 && !isLoadingVoices}
              >
                {playing('') ? <Square size={12} /> : <Play size={12} />}
                <span style={{ marginLeft: 4 }}>{playing('') ? t('tts.stop') : t('audio.now.preview')}</span>
              </button>
            </div>
          </div>

          {/* engine-specific block */}
          {chosen === 'endpoint' && (
            <div className="setting-group">
              <div className="ps-config-form">
                <div className="ps-field">
                  <label className="ps-label">{t('tts.endpoint.baseUrl')}<span className="ps-required">*</span></label>
                  <input
                    type="text"
                    className="ps-input"
                    placeholder={t('tts.endpoint.baseUrlPlaceholder')}
                    value={endpointCfg.baseUrl}
                    onChange={(e) => updateEndpoint({ baseUrl: e.target.value })}
                  />
                </div>
                <div className="ps-field">
                  <label className="ps-label">{t('tts.endpoint.apiKey')}</label>
                  <div className="ps-input-group">
                    <input
                      type="password"
                      className="ps-input"
                      placeholder={endpointCfg.hasKey ? t('tts.endpoint.keySaved') : t('tts.endpoint.apiKeyPlaceholder')}
                      value={draftKey}
                      onChange={(e) => setDraftKey(e.target.value)}
                      onBlur={saveEndpointKey}
                      autoComplete="off"
                    />
                    {endpointCfg.hasKey && (
                      <button type="button" className="ps-input-btn" onClick={clearEndpointKey} title={t('tts.endpoint.clearKey')}>
                        {t('tts.endpoint.clearKey')}
                      </button>
                    )}
                  </div>
                </div>
                <div className="ps-field">
                  <label className="ps-label">{t('tts.endpoint.model')}</label>
                  <input
                    type="text"
                    className="ps-input"
                    placeholder={t('tts.endpoint.modelPlaceholder')}
                    value={endpointCfg.model}
                    onChange={(e) => updateEndpoint({ model: e.target.value })}
                  />
                </div>
                <div className="ps-field">
                  <label className="ps-label">{t('tts.endpoint.voice')}</label>
                  <input
                    type="text"
                    className="ps-input"
                    placeholder={t('tts.endpoint.voicePlaceholder')}
                    value={endpointCfg.voice}
                    onChange={(e) => updateEndpoint({ voice: e.target.value })}
                  />
                </div>
                <div className="ps-test-row">
                  <button
                    className={`ps-test-btn ${endpointTest?.success ? 'success' : endpointTest?.success === false ? 'error' : ''}`}
                    onClick={testEndpoint}
                    disabled={endpointTesting || !endpointCfg.baseUrl.trim()}
                  >
                    {endpointTesting ? <RefreshCw size={14} className="spinning" /> : <Zap size={14} />}
                    <span>{endpointTesting ? t('tts.endpoint.testing') : t('tts.endpoint.test')}</span>
                  </button>
                  <div className="ps-status">
                    <span className="ps-status-dot" style={{ background: endpointTest === null ? 'var(--text-tertiary)' : endpointTest.success ? 'var(--success)' : 'var(--error)' }}></span>
                    <span>{endpointTest === null ? t('tts.endpoint.notTested') : endpointTest.success ? t('tts.endpoint.testOk', { ms: endpointTest.ms, kb: endpointTest.kb }) : `${t('tts.endpoint.testFailedShort')}: ${endpointTest.error}`}</span>
                  </div>
                </div>
              </div>
              <p className="setting-hint">{t('tts.endpoint.hint')}</p>
            </div>
          )}

          {chosen !== 'endpoint' && isNeural && (
            <div className="setting-group">
              <div className="tts-voices-head">
                <label className="setting-label">{t('audio.voices.label')}</label>
                <span className="tts-voice-count">{t('audio.voices.count', { count: voices.length })}</span>
                <button className="setting-btn-icon" style={{ width: 26, height: 26 }} onClick={loadVoices} disabled={isLoadingVoices} title={t('tts.refreshVoices')}>
                  <RefreshCw size={13} className={isLoadingVoices ? 'spinning' : ''} />
                </button>
              </div>
              <div className="tts-voices">
                {['zh', 'en'].map((lang) => (
                  <React.Fragment key={lang}>
                    <span className="lbl">{t(`audio.voices.${lang}`)}</span>
                    <VoicePicker
                      mode="neural"
                      voices={voicesFor(lang)}
                      value={voiceByLang[lang] || ''}
                      placeholder={t('audio.now.auto')}
                      onChange={(id) => updateTTSConfig('voiceByLang', { ...voiceByLang, [lang]: id })}
                      onPreview={(v) => handleTest(lang, { voiceByLang: { ...voiceByLang, [lang]: v.id } })}
                    />
                    <button
                      className="setting-btn-icon"
                      onClick={() => handleTest(lang)}
                      disabled={voicesFor(lang).length === 0}
                      title={playing(lang) ? t('tts.stop') : t('tts.play')}
                    >
                      {playing(lang) ? <Square size={13} /> : <Play size={13} />}
                    </button>
                  </React.Fragment>
                ))}
              </div>
              <p className="setting-hint">{t('audio.voices.neuralHint')}</p>
            </div>
          )}

          {chosen !== 'endpoint' && !isNeural && (
            <div className="setting-group">
              <div className="tts-voices-head">
                <label className="setting-label">{t('audio.voices.label')}</label>
                <span className={`tts-voice-count ${voices.length ? '' : 'empty'}`}>
                  {voices.length ? t('audio.voices.systemCount', { count: voices.length }) : t('tts.noVoicesInstalled')}
                </span>
                <button className="setting-btn-icon" style={{ width: 26, height: 26 }} onClick={loadVoices} disabled={isLoadingVoices} title={t('tts.refreshVoices')}>
                  <RefreshCw size={13} className={isLoadingVoices ? 'spinning' : ''} />
                </button>
              </div>
              <div className="tts-voices">
                <span className="lbl">{t('audio.voices.default')}</span>
                <VoicePicker
                  mode="system"
                  voices={voices}
                  value={ttsConfig.voiceId || ''}
                  autoLabel={t('audio.voices.auto')}
                  onChange={(id) => updateTTSConfig('voiceId', id)}
                  onPreview={(v) => handleTest('', { voiceId: v.id, lang: (v.lang || 'zh').split('-')[0] })}
                />
                <button
                  className="setting-btn-icon"
                  onClick={() => handleTest('')}
                  disabled={voices.length === 0}
                  title={playing('') ? t('tts.stop') : t('tts.play')}
                >
                  {playing('') ? <Square size={13} /> : <Play size={13} />}
                </button>
              </div>
              <p className="setting-hint">{voices.length ? t('audio.voices.webHint') : t('tts.installVoiceHint')}</p>
            </div>
          )}

          <div className="setting-group">
            <label className="setting-label">{t('audio.sliders.label')}</label>
            <div className="tts-sliders">
              <div className="sl">
                <div className="sl-head"><span>{t('tts.rate')}</span><span className="tts-slider-value">{ttsConfig.rate.toFixed(1)}x</span></div>
                <input type="range" className="setting-range" min="0.5" max="2" step="0.1"
                  value={ttsConfig.rate}
                  onChange={(e) => updateTTSConfig('rate', parseFloat(e.target.value))}
                />
              </div>
              <div className={`sl ${noPitch ? 'off' : ''}`}>
                <div className="sl-head"><span>{t('tts.pitch')}</span><span className="tts-slider-value">{noPitch ? t('audio.sliders.pitchUnsupported') : ttsConfig.pitch.toFixed(1)}</span></div>
                <input type="range" className="setting-range" min="0.5" max="2" step="0.1"
                  value={ttsConfig.pitch}
                  disabled={noPitch}
                  onChange={(e) => updateTTSConfig('pitch', parseFloat(e.target.value))}
                />
              </div>
              <div className="sl">
                <div className="sl-head"><span>{t('tts.volume')}</span><span className="tts-slider-value">{Math.round(ttsConfig.volume * 100)}%</span></div>
                <input type="range" className="setting-range" min="0" max="1" step="0.1"
                  value={ttsConfig.volume}
                  onChange={(e) => updateTTSConfig('volume', parseFloat(e.target.value))}
                />
              </div>
            </div>
            <p className="setting-hint">{t('audio.sliders.pitchHint')}</p>
          </div>
        </>
      )}
    </div>
  );
};

export default TTSSection;
