// Listen-mode model packs. This is the ONLY download entry point for ASR
// models (user's call, 2026-08-28): the floating window's listen button stays
// visible but disabled and points here, so the download flow lives in one
// place instead of two windows. The list itself is PackList, shared with the
// voice packs on the TTS page.

import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import PackList from './PackList.jsx';
import { Seg, Switch } from './shared.jsx';
import createLogger from '../../../utils/logger.js';
const logger = createLogger('ListenSection');

// Final-pass tier (v0.4.8). Picking "high" without the pack on disk
// downloads it first, like the OCR tier; the engine reads the stored tier at
// the next session start, so there is nothing to hot-swap here.
const HQ_PACK_ID = 'asr-hq-qwen3-0.6b';
const INSTALLED_STATES = ['installed', 'update-available', 'orphaned'];

// embedded: rendered inside the 「音频」 sub-page, which owns the heading.
const ListenSection = ({ notify, confirm, embedded = false }) => {
  const { t } = useTranslation();

  const [info, setInfo] = useState(null); // { modelName, streamingPresent, hqPresent, modelsDir, ... }
  const [tier, setTier] = useState('standard');
  const [tierBusy, setTierBusy] = useState(false);
  const [autosave, setAutosave] = useState(true);
  const [hqInstalled, setHqInstalled] = useState(false);
  const [listKey, setListKey] = useState(0); // remounts PackList after a download it did not start

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
    window.electron?.store?.get?.('settings.listen.tier')
      .then((v) => setTier(v === 'high' ? 'high' : 'standard'))
      .catch(() => {});
    window.electron?.store?.get?.('settings.listen.autosave')
      .then((v) => setAutosave(v !== false))
      .catch(() => {});
  }, [loadInfo]);

  const handleAutosaveChange = async (next) => {
    setAutosave(next);
    await window.electron?.store?.set?.('settings.listen.autosave', next);
  };

  // The floating window caches "is listen available" — tell it to re-ask, or a
  // freshly downloaded model leaves the button grey until the window reopens.
  const handleChanged = useCallback(() => {
    loadInfo();
    window.electron?.floatingWindow?.notifySettingsChanged?.();
  }, [loadInfo]);

  const applyTier = useCallback(async (next) => {
    setTier(next);
    await window.electron?.store?.set?.('settings.listen.tier', next);
  }, []);

  // Removing the pack from the list below must not leave the tier pointing
  // at an engine that is gone: the manager would fall back silently, the
  // control would lie.
  const handlePacks = useCallback((packs) => {
    const hq = packs.find((p) => p.id === HQ_PACK_ID);
    const present = !!hq && INSTALLED_STATES.includes(hq.status);
    setHqInstalled(present);
    if (!present) {
      window.electron?.store?.get?.('settings.listen.tier')
        .then((v) => { if (v === 'high') applyTier('standard'); })
        .catch(() => {});
    }
  }, [applyTier]);

  const handleTierChange = async (next) => {
    if (next === tier || tierBusy) return;
    if (next === 'high' && !hqInstalled) {
      setTierBusy(true);
      try {
        const res = await window.electron?.audioPacks?.downloadPack?.(HQ_PACK_ID);
        if (res?.success) {
          await applyTier('high');
          notify(t('listen.tier.enabled'), 'success');
          setListKey((k) => k + 1);
          handleChanged();
        } else if (res?.errorCode === 'OFFLINE_BLOCKED') {
          notify(t('listen.packs.offlineBlocked'), 'warning');
        } else {
          notify(res?.error || t('listen.packs.downloadFailed'), 'error');
        }
      } catch (e) {
        notify(t('listen.packs.downloadFailed') + ': ' + e.message, 'error');
      } finally {
        setTierBusy(false);
      }
      return;
    }
    await applyTier(next);
    notify(t(next === 'high' ? 'listen.tier.enabled' : 'listen.tier.disabled'), 'success');
  };

  const ready = !!info?.modelName;

  return (
    <div className={embedded ? '' : 'setting-content'}>
      {!embedded && <h3>{t('settings.listen.title')}</h3>}
      {!embedded && <p className="setting-description">{t('listen.description')}</p>}

      {/* Embedded: the sub-page header already carries the ready badge. */}
      {!embedded && (
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
      )}

      <div className="setting-group">
        <label className="setting-label">{t('listen.tier.label')}</label>
        <Seg
          size="small"
          value={tier}
          onChange={handleTierChange}
          options={[
            { value: 'standard', label: t('listen.tier.standard'), disabled: tierBusy },
            { value: 'high', label: t('listen.tier.high'), disabled: tierBusy || !ready },
          ]}
        />
        <p className="setting-hint">{t('listen.tier.hint')}</p>
      </div>

      <div className="setting-group">
        <Switch checked={autosave} onChange={handleAutosaveChange} label={t('listen.autosave.label')} />
        <p className="setting-hint">{t('listen.autosave.hint')}</p>
      </div>

      <PackList
        key={listKey}
        bridge={window.electron?.audioPacks}
        prefix="listen.packs"
        notify={notify}
        confirm={confirm}
        onChanged={handleChanged}
        onPacks={handlePacks}
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
