// Listen-mode models: the ASR packs (PackList, shared with the voice packs on
// the TTS page, the only download entry point for them) and the
// high-accuracy tier's speech models (SpeechPacks, placed by hand).
// Last group: T-Caption's local channel (docs/design/listen.md §11).

import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Plug, KeyRound, FolderOpen } from 'lucide-react';
import PackList from './PackList.jsx';
import SpeechPacks from './SpeechPacks.jsx';
import { Seg, Switch } from './shared.jsx';
import createLogger from '../../../core/logger.js';
const logger = createLogger('ListenSection');

// The old high-accuracy pack: listed only while it is still on disk, to be removed.
const LEGACY_HQ_TYPE = 'asr-hq';
const INSTALLED_STATES = ['installed', 'update-available', 'orphaned'];
const showPack = (p) => p.type !== LEGACY_HQ_TYPE || INSTALLED_STATES.includes(p.status);

// The switch is a store key the main process watches; status comes from the
// channel itself. The token never reaches this page.
const CompanionGroup = ({ notify, confirm }) => {
  const { t } = useTranslation();
  const [bridge] = useState(() => window.electron?.companion || null);
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState(null);
  const [folderMissing, setFolderMissing] = useState(false);

  useEffect(() => {
    window.electron?.store?.get?.('settings.companion.enabled')
      .then((v) => setEnabled(v === true))
      .catch(() => {});
    if (!bridge) return undefined;
    bridge.getStatus?.().then(setStatus).catch((e) => logger.debug('companion status failed:', e.message));
    return bridge.onStatus?.(setStatus);
  }, [bridge]);

  const handleEnable = async (next) => {
    setEnabled(next);
    await window.electron?.store?.set?.('settings.companion.enabled', next);
  };

  const handlePair = async () => {
    try {
      setStatus(await bridge.openPairing());
    } catch (e) {
      logger.warn('companion pairing failed:', e.message);
    }
  };

  const handleOpenFolder = async () => {
    try {
      const r = await bridge.openExtensionFolder();
      setFolderMissing(r?.error === 'missing');
      if (!r?.ok && r?.error !== 'missing') logger.warn('extension folder open failed:', r?.error);
    } catch (e) {
      logger.warn('extension folder open failed:', e.message);
    }
  };

  const handleRegenerate = async () => {
    if (!(await confirm(t('listen.companion.regenerateConfirm')))) return;
    try {
      setStatus(await bridge.regenerateToken());
      notify(t('listen.companion.regenerated'), 'success');
    } catch (e) {
      logger.warn('companion token regenerate failed:', e.message);
    }
  };

  let statusText = t('listen.companion.unavailable');
  if (bridge && !enabled) statusText = t('listen.companion.statusOff');
  else if (bridge && !status?.running) statusText = t('listen.companion.statusStarting');
  else if (bridge) {
    statusText = t('listen.companion.statusListening', { port: status.port });
    if (status.session?.active) statusText += ` · ${t('listen.companion.statusSession')}`;
  }

  const waiting = !!status?.pairingOpen;
  const needEnable = bridge && !enabled ? t('listen.companion.pairNeedEnable') : undefined;

  return (
    <div className="setting-group">
      <label className="setting-label">{t('listen.companion.title')}</label>
      <p className="setting-hint" style={{ marginTop: 0, marginBottom: 10 }}>{t('listen.companion.intro')}</p>
      <div style={{ marginBottom: 12 }}>
        <button className="btn-small" onClick={handleOpenFolder} disabled={!bridge?.openExtensionFolder}>
          <FolderOpen size={12} /> {t('listen.companion.openFolder')}
        </button>
        <p className="setting-hint">
          {t('listen.companion.installChrome')}
          <br />
          {t('listen.companion.installEdge')}
          <br />
          {t('listen.companion.installNote')}
        </p>
        {folderMissing && <p className="setting-hint">{t('listen.companion.folderMissing')}</p>}
      </div>
      <Switch checked={enabled} onChange={handleEnable} label={t('listen.companion.enable')} />
      <p className="setting-hint">{statusText}</p>
      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
        <button
          className="btn-small"
          onClick={handlePair}
          disabled={!bridge || !enabled || !status?.running || waiting}
          title={needEnable}
        >
          <Plug size={12} /> {t(waiting ? 'listen.companion.pairWaiting' : 'listen.companion.pair')}
        </button>
        <button
          className="btn-small"
          onClick={handleRegenerate}
          disabled={!bridge || !enabled}
          title={needEnable}
        >
          <KeyRound size={12} /> {t('listen.companion.regenerate')}
        </button>
      </div>
    </div>
  );
};

// embedded: rendered inside the audio sub-page, which owns the heading.
const ListenSection = ({ notify, confirm, embedded = false }) => {
  const { t } = useTranslation();

  const [info, setInfo] = useState(null); // { modelName, streamingPresent, hqPresent, modelsDir, ... }
  const [tier, setTier] = useState('standard');
  const [autosave, setAutosave] = useState(true);
  const [llm, setLlm] = useState(null); // llm:status, for the speech models
  const [rescanning, setRescanning] = useState(false);

  const loadInfo = useCallback(async () => {
    try {
      setInfo(await window.electron?.audioPacks?.getInfo?.());
    } catch (e) {
      logger.debug('audio info failed:', e.message);
      setInfo(null);
    }
  }, []);

  const loadLlm = useCallback(async () => {
    try {
      setLlm((await window.electron?.llm?.status?.()) || null);
    } catch (e) {
      logger.debug('model status failed:', e.message);
      setLlm(null);
    }
  }, []);

  useEffect(() => {
    loadInfo();
    loadLlm();
    window.electron?.store?.get?.('settings.listen.tier')
      .then((v) => setTier(v === 'high' ? 'high' : 'standard'))
      .catch(() => {});
    window.electron?.store?.get?.('settings.listen.autosave')
      .then((v) => setAutosave(v !== false))
      .catch(() => {});
  }, [loadInfo, loadLlm]);

  const handleAutosaveChange = async (next) => {
    setAutosave(next);
    await window.electron?.store?.set?.('settings.listen.autosave', next);
  };

  // The floating window caches "is listen available": tell it to re-ask.
  const handleChanged = useCallback(() => {
    loadInfo();
    window.electron?.floatingWindow?.notifySettingsChanged?.();
  }, [loadInfo]);

  const rescanSpeech = async () => {
    setRescanning(true);
    try {
      const s = await window.electron?.llm?.rescan?.();
      if (s) setLlm(s);
    } catch (e) {
      logger.debug('model rescan failed:', e.message);
    } finally {
      setRescanning(false);
    }
  };

  const hqReady = !!llm?.asr?.usable;

  const handleTierChange = async (next) => {
    if (next === tier) return;
    if (next === 'high' && !hqReady) {
      notify(t('listen.hq.needPack'), 'warning');
      return;
    }
    setTier(next);
    await window.electron?.store?.set?.('settings.listen.tier', next);
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
            { value: 'standard', label: t('listen.tier.standard') },
            { value: 'high', label: t('listen.tier.high'), disabled: !ready },
          ]}
        />
        <p className="setting-hint">{t('listen.tier.hint')}</p>
        {tier === 'high' && llm && !hqReady && <p className="setting-hint">{t('listen.hq.inactive')}</p>}
        {/* The high tier's models belong to the tier choice, right under it. */}
        {llm && <SpeechPacks nested status={llm} busy={rescanning} onRescan={rescanSpeech} />}
      </div>

      <div className="setting-group">
        <Switch checked={autosave} onChange={handleAutosaveChange} label={t('listen.autosave.label')} />
        <p className="setting-hint">{t('listen.autosave.hint')}</p>
      </div>

      <PackList
        bridge={window.electron?.audioPacks}
        prefix="listen.packs"
        notify={notify}
        confirm={confirm}
        onChanged={handleChanged}
        filter={showPack}
      >
        {/* Where the models actually are (an older root may still hold some). */}
        <p className="setting-hint">
          {t('listen.packs.location', { dir: info?.activeDir || info?.modelsDir || '' })}
        </p>
      </PackList>

      <CompanionGroup notify={notify} confirm={confirm} />
    </div>
  );
};

export default ListenSection;
