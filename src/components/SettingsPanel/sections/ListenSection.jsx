// Listen-mode model packs. This is the ONLY download entry point for ASR
// models (user's call, 2026-08-28): the floating window's listen button stays
// visible but disabled and points here, so the download flow lives in one
// place instead of two windows. The list itself is PackList, shared with the
// voice packs on the TTS page.

import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import PackList from './PackList.jsx';
import createLogger from '../../../utils/logger.js';
const logger = createLogger('ListenSection');

// embedded: rendered inside the 「音频」 sub-page, which owns the heading.
const ListenSection = ({ notify, confirm, embedded = false }) => {
  const { t } = useTranslation();

  const [info, setInfo] = useState(null); // { modelName, streamingPresent, modelsDir, ... }

  const loadInfo = useCallback(async () => {
    try {
      setInfo(await window.electron?.audioPacks?.getInfo?.());
    } catch (e) {
      logger.debug('audio info failed:', e.message);
      setInfo(null);
    }
  }, []);

  useEffect(() => {
    loadInfo();
  }, [loadInfo]);

  // The floating window caches "is listen available" — tell it to re-ask, or a
  // freshly downloaded model leaves the button grey until the window reopens.
  const handleChanged = useCallback(() => {
    loadInfo();
    window.electron?.floatingWindow?.notifySettingsChanged?.();
  }, [loadInfo]);

  const ready = !!info?.modelName;

  return (
    <div className={embedded ? '' : 'setting-content'}>
      {!embedded && <h3>{t('settings.listen.title')}</h3>}
      <p className="setting-description">{t('listen.description')}</p>

      <div className="setting-group">
        <div className="pack-header">
          <span className={`engine-badge ${ready ? 'installed' : 'unavailable'}`}>
            {ready ? t('listen.ready') : t('listen.notReady')}
          </span>
          <span className="listen-status-text">
            {ready ? info.modelName : t('listen.notReadyHint')}
          </span>
        </div>
        <p className="setting-hint">
          {ready && info.streamingPresent ? t('listen.draftOn') : t('listen.draftOff')}
        </p>
      </div>

      <PackList
        bridge={window.electron?.audioPacks}
        prefix="listen.packs"
        notify={notify}
        confirm={confirm}
        onChanged={handleChanged}
      >
        {/* Where the models actually are, which is not always where the next
            download will land: packs installed before v0.4.0 still sit in the
            old userData folder and keep working from there. */}
        <p className="setting-hint">
          {t('listen.packs.location', { dir: info?.activeDir || info?.modelsDir || '' })}
        </p>
      </PackList>
    </div>
  );
};

export default ListenSection;
