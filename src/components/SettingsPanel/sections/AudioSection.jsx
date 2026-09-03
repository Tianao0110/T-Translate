// 「音频」 section: two entry cards (听 = recognition models, 读 = read-aloud)
// that open their own sub-page, with a back button. Replaces the separate
// 听译模型 and 朗读设置 nav items (user's call 2026-09-03). Every visit from
// the sidebar starts on the cards; a settings search that matched listen or
// speech keywords lands on the matching sub-page directly (initialView).

import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { AudioLines, Volume2, ChevronLeft, ChevronRight } from 'lucide-react';
import ttsManager, { DEFAULT_TTS_CONFIG } from '../../../services/tts/index.js';
import ListenSection from './ListenSection.jsx';
import TTSSection from './TTSSection.jsx';
import PackList from './PackList.jsx';
import createLogger from '../../../utils/logger.js';
const logger = createLogger('AudioSection');

const AudioSection = ({ settings, updateSetting, notify, confirm, initialView }) => {
  const { t } = useTranslation();
  const [view, setView] = useState(initialView || 'home'); // home | listen | speak
  const [tab, setTab] = useState('read'); // read | packs
  const [listenInfo, setListenInfo] = useState(null);
  const [asrPacks, setAsrPacks] = useState([]);
  const [ttsPacks, setTtsPacks] = useState([]);
  const [engineId, setEngineId] = useState('web-speech');
  const [voiceNames, setVoiceNames] = useState({});

  useEffect(() => {
    if (initialView) setView(initialView);
  }, [initialView]);

  const ttsConfig = { ...DEFAULT_TTS_CONFIG, ...(settings?.tts || {}) };

  // Card summaries: what is installed and what speaks right now. Read-only;
  // the sub-pages own every action.
  const loadSummary = useCallback(async () => {
    try {
      const [info, packs, status, engines] = await Promise.all([
        window.electron?.audioPacks?.getInfo?.(),
        window.electron?.audioPacks?.listPacks?.({ refresh: false }),
        window.electron?.audioEngine?.ttsStatus?.(),
        ttsManager.listEngines(),
      ]);
      setListenInfo(info || null);
      setAsrPacks((packs?.packs || []).filter((p) => ['installed', 'update-available', 'orphaned'].includes(p.status)));
      setTtsPacks(status?.packs || []);
      const available = (engines || []).filter((e) => e.available).map((e) => e.id);
      const wanted = ttsConfig.engine || 'web-speech';
      const effective = available.includes(wanted) ? wanted : 'web-speech';
      setEngineId(effective);
      if (effective === 'neural') {
        await ttsManager.init();
        const voices = await ttsManager.getVoices();
        const byLang = ttsConfig.voiceByLang || {};
        const name = (lang) => voices.find((v) => v.id === byLang[lang])?.name || t('audio.now.auto');
        setVoiceNames({ zh: name('zh'), en: name('en') });
      }
    } catch (e) {
      logger.debug('summary failed:', e.message);
    }
  }, [ttsConfig.engine, ttsConfig.voiceByLang, t]);

  useEffect(() => {
    if (view === 'home') loadSummary();
  }, [view, loadSummary]);

  const listenReady = !!listenInfo?.modelName;
  const asrMb = asrPacks.reduce((s, p) => s + (p.size || 0), 0) / 1024 / 1024;
  const endpointSet = !!(ttsConfig.endpoint?.baseUrl || '').trim();

  const speakLine = () => {
    if (engineId === 'neural') return `${t('audio.voices.zh')} ${voiceNames.zh || t('audio.now.auto')} / ${t('audio.voices.en')} ${voiceNames.en || t('audio.now.auto')}`;
    if (engineId === 'endpoint') return `${t('audio.now.api')} · ${ttsConfig.endpoint?.baseUrl || ''}`;
    return t('audio.speak.lineWeb');
  };

  const renderHome = () => (
    <div className="setting-content">
      <h3>{t('settingsNav.audio')}</h3>
      <p className="setting-description">{t('audio.description')}</p>
      <div className="audio-home">
        <button type="button" className={`audio-card ${listenReady ? '' : 'warn'}`} onClick={() => setView('listen')}>
          <ChevronRight size={18} className="audio-card-chev" />
          <div className="audio-card-icon"><AudioLines size={22} /></div>
          <div className="audio-card-title">
            {t('audio.cards.listen')}
            <span className={`engine-badge ${listenReady ? 'installed' : 'unavailable'}`}>
              {listenReady ? t('audio.listen.ready') : t('audio.listen.notReady')}
            </span>
          </div>
          <div className="audio-card-line">
            {listenReady
              ? (listenInfo?.streamingPresent ? t('audio.listen.readyDraft') : t('audio.listen.readyBase'))
              : t('audio.listen.notReadyLine')}
          </div>
          <div className="audio-card-meta">
            {asrPacks.length
              ? t('audio.listen.meta', { count: asrPacks.length, mb: asrMb.toFixed(0) })
              : t('audio.listen.metaNone')}
          </div>
        </button>
        <button type="button" className="audio-card" onClick={() => { setTab('read'); setView('speak'); }}>
          <ChevronRight size={18} className="audio-card-chev" />
          <div className="audio-card-icon"><Volume2 size={22} /></div>
          <div className="audio-card-title">
            {t('audio.cards.speak')}
            <span className={`engine-badge ${engineId === 'web-speech' ? '' : 'installed'}`}>
              {t(`tts.engineNames.${engineId}`)}
            </span>
          </div>
          <div className="audio-card-line">{speakLine()}</div>
          <div className="audio-card-meta">
            {ttsPacks.length ? t('audio.speak.metaPacks', { count: ttsPacks.length }) : t('audio.speak.metaNoPacks')}
            {' · '}
            {endpointSet ? t('audio.speak.metaEndpoint') : t('audio.speak.metaNoEndpoint')}
          </div>
        </button>
      </div>
    </div>
  );

  const subhead = (title, extra) => (
    <div className="audio-subhead">
      <button type="button" className="audio-back" onClick={() => setView('home')}>
        <ChevronLeft size={14} />{t('audio.back')}
      </button>
      <h3>{title}</h3>
      {extra}
    </div>
  );

  if (view === 'listen') {
    return (
      <div className="setting-content">
        {subhead(
          t('audio.cards.listen'),
          <>
            <span className={`engine-badge ${listenReady ? 'installed' : 'unavailable'}`}>
              {listenReady ? t('audio.listen.ready') : t('audio.listen.notReady')}
            </span>
            {listenReady && <span className="audio-subhead-note">{listenInfo.modelName}</span>}
          </>
        )}
        <ListenSection embedded notify={notify} confirm={confirm} />
      </div>
    );
  }

  if (view === 'speak') {
    return (
      <div className="setting-content">
        {subhead(
          t('audio.cards.speak'),
          <span className={`engine-badge ${engineId === 'web-speech' ? '' : 'installed'}`}>{t(`tts.engineNames.${engineId}`)}</span>
        )}
        <div className="seg audio-tabs">
          <button type="button" className={tab === 'read' ? 'on' : ''} onClick={() => setTab('read')}>{t('audio.tabs.read')}</button>
          <button type="button" className={tab === 'packs' ? 'on' : ''} onClick={() => setTab('packs')}>
            {t('audio.tabs.packs')}<span className="n">{ttsPacks.length}</span>
          </button>
        </div>
        {tab === 'read'
          ? <TTSSection embedded settings={settings} updateSetting={updateSetting} notify={notify} confirm={confirm} />
          : (
            <PackList
              bridge={window.electron?.ttsPacks}
              prefix="tts.packs"
              notify={notify}
              confirm={confirm}
              onChanged={loadSummary}
            >
              <p className="setting-hint">{t('tts.packs.hint')}</p>
            </PackList>
          )}
      </div>
    );
  }

  return renderHome();
};

export default AudioSection;
