// Audio section: two tabs — listen (recognition models) and speak (read-aloud,
// its voice packs listed under the settings, as listen lists its models).
// Each tab carries a one-word status. A settings search that matched one side
// opens that tab (initialView).

import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { AudioLines, Volume2 } from 'lucide-react';
import ttsManager, { DEFAULT_TTS_CONFIG } from '../../../tts/index.js';
import ListenSection from './ListenSection.jsx';
import TTSSection from './TTSSection.jsx';
import PackList from './PackList.jsx';
import createLogger from '../../../core/logger.js';
const logger = createLogger('AudioSection');

const tabFor = (view) => (view === 'speak' ? 'speak' : 'listen');

const AudioSection = ({ settings, updateSetting, notify, confirm, initialView }) => {
  const { t } = useTranslation();
  const [view, setView] = useState(tabFor(initialView));
  const [listenReady, setListenReady] = useState(false);
  const [engineId, setEngineId] = useState('web-speech');

  useEffect(() => {
    if (initialView) setView(tabFor(initialView));
  }, [initialView]);

  const wantedEngine = settings?.tts?.engine || DEFAULT_TTS_CONFIG.engine || 'web-speech';

  // Tab status: is recognition ready, which engine actually speaks.
  const loadSummary = useCallback(async () => {
    try {
      const [info, engines] = await Promise.all([
        window.electron?.audioPacks?.getInfo?.(),
        ttsManager.listEngines(),
      ]);
      setListenReady(!!info?.modelName);
      const available = (engines || []).filter((e) => e.available).map((e) => e.id);
      setEngineId(available.includes(wantedEngine) ? wantedEngine : 'web-speech');
    } catch (e) {
      logger.debug('summary failed:', e.message);
    }
  }, [wantedEngine]);

  // Re-read on every tab switch: installs on one tab show up on the other.
  useEffect(() => {
    loadSummary();
  }, [view, loadSummary]);

  return (
    <div className="setting-content">
      <h3>{t('settingsNav.audio')}</h3>

      <div className="seg tabs audio-tabs">
        <button type="button" className={view === 'listen' ? 'on' : ''} onClick={() => setView('listen')}>
          <AudioLines size={14} />
          {t('audio.cards.listen')}
          <span className={`engine-badge ${listenReady ? 'installed' : 'unavailable'}`}>
            {listenReady ? t('audio.listen.ready') : t('audio.listen.notReady')}
          </span>
        </button>
        <button type="button" className={view === 'speak' ? 'on' : ''} onClick={() => setView('speak')}>
          <Volume2 size={14} />
          {t('audio.cards.speak')}
          <span className={`engine-badge ${engineId === 'web-speech' ? '' : 'installed'}`}>
            {t(`tts.engineNames.${engineId}`)}
          </span>
        </button>
      </div>

      {view === 'listen' ? (
        <ListenSection embedded notify={notify} confirm={confirm} />
      ) : (
        <div>
          <TTSSection embedded settings={settings} updateSetting={updateSetting} notify={notify} confirm={confirm} />
          <div className="audio-packs">
            <PackList
              bridge={window.electron?.ttsPacks}
              prefix="tts.packs"
              notify={notify}
              confirm={confirm}
              onChanged={loadSummary}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default AudioSection;
