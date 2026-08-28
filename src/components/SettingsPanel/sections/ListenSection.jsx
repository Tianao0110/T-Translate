// Listen-mode model packs. This is the ONLY download entry point for ASR
// models (user's call, 2026-08-28): the floating window's listen button stays
// visible but disabled and points here, so the download flow lives in one
// place instead of two windows.
//
// Pack row markup reuses the OCR pack classes (styles/ocr.css) — same rows,
// same badges, same progress bar. When TTS voice packs become the third
// consumer (v0.4.x), rename those classes to model-pack-* and share properly.

import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, RefreshCw, Trash2, AlertTriangle } from 'lucide-react';
import createLogger from '../../../utils/logger.js';
const logger = createLogger('ListenSection');

const ListenSection = ({ notify, confirm }) => {
  const { t } = useTranslation();

  const [info, setInfo] = useState(null); // { modelName, streamingPresent, modelsDir, ... }
  const [packs, setPacks] = useState([]);
  const [manifestError, setManifestError] = useState(null);
  const [packsLoading, setPacksLoading] = useState(false);
  const [busyPackId, setBusyPackId] = useState(null);
  const [packProgress, setPackProgress] = useState(null); // { packId, progress, phase }

  const loadInfo = useCallback(async () => {
    try {
      setInfo(await window.electron?.audioPacks?.getInfo?.());
    } catch (e) {
      logger.debug('audio info failed:', e.message);
      setInfo(null);
    }
  }, []);

  const loadPacks = useCallback(async (refresh = false) => {
    if (!window.electron?.audioPacks?.listPacks) return;
    setPacksLoading(true);
    try {
      const res = await window.electron.audioPacks.listPacks({ refresh });
      if (res?.success) {
        setPacks(res.packs || []);
        setManifestError(res.manifestError || null);
      } else {
        setManifestError(res?.error || 'unknown');
      }
    } catch (e) {
      logger.debug('pack list failed:', e.message);
      setManifestError(e.message);
    } finally {
      setPacksLoading(false);
    }
  }, []);

  useEffect(() => {
    loadInfo();
    loadPacks(false);
    const cleanup = window.electron?.audioPacks?.onPackProgress?.((data) => {
      setPackProgress(data.progress >= 100 || data.progress < 0 ? null : data);
    });
    return () => cleanup?.();
  }, [loadInfo, loadPacks]);

  // The floating window caches "is listen available" — tell it to re-ask, or a
  // freshly downloaded model leaves the button grey until the window reopens.
  const notifyWindows = useCallback(() => {
    window.electron?.floatingWindow?.notifySettingsChanged?.();
  }, []);

  const handleDownload = useCallback(async (packId) => {
    setBusyPackId(packId);
    try {
      const result = await window.electron?.audioPacks?.downloadPack?.(packId);
      if (result?.success) {
        notify(t('listen.packs.downloaded'), 'success');
        await Promise.all([loadPacks(false), loadInfo()]);
        notifyWindows();
      } else if (result?.errorCode === 'OFFLINE_BLOCKED') {
        notify(t('listen.packs.offlineBlocked'), 'warning');
      } else {
        notify(result?.error || t('listen.packs.downloadFailed'), 'error');
      }
    } catch (e) {
      notify(t('listen.packs.downloadFailed') + ': ' + e.message, 'error');
    } finally {
      setBusyPackId(null);
      setPackProgress(null);
    }
  }, [notify, t, loadPacks, loadInfo, notifyWindows]);

  const handleRemove = useCallback(async (packId) => {
    if (!(await confirm(t('listen.packs.removeConfirm')))) return;
    try {
      const result = await window.electron?.audioPacks?.removePack?.(packId);
      if (result?.success) {
        notify(t('listen.packs.removed'), 'success');
        await Promise.all([loadPacks(false), loadInfo()]);
        notifyWindows();
      } else {
        notify(result?.error || t('listen.packs.removeFailed'), 'error');
      }
    } catch (e) {
      notify(t('listen.packs.removeFailed') + ': ' + e.message, 'error');
    }
  }, [notify, t, confirm, loadPacks, loadInfo, notifyWindows]);

  const statusBadge = (status) => {
    switch (status) {
      case 'installed':
      case 'orphaned':
        return <span className="engine-badge installed">{t('listen.packs.installed')}</span>;
      case 'update-available':
        return <span className="engine-badge download">{t('listen.packs.updateAvailable')}</span>;
      default:
        return <span className="engine-badge unavailable">{t('listen.packs.notInstalled')}</span>;
    }
  };

  const renderPackRow = (pack) => {
    const busy = busyPackId === pack.id;
    const progress = packProgress?.packId === pack.id ? packProgress : null;
    const sizeMB = pack.size ? (pack.size / 1024 / 1024).toFixed(1) : null;
    const installed = ['installed', 'update-available', 'orphaned'].includes(pack.status);

    return (
      <div key={pack.id} className="ocr-pack-row">
        <div className="pack-info">
          <div className="pack-header">
            <span className="pack-name">{t(`listen.packs.names.${pack.id}`, pack.model || pack.id)}</span>
            {statusBadge(pack.status)}
            {sizeMB && <span className="engine-size">{sizeMB} MB</span>}
          </div>
          <p className="setting-hint">{t(`listen.packs.desc.${pack.type}`, '')}</p>
          {progress && (
            <div className="engine-download-progress" style={{ marginTop: 6 }}>
              <div className="download-progress-bar">
                <div className="download-progress-fill" style={{ width: `${Math.max(progress.progress, 2)}%` }} />
              </div>
              <span className="download-progress-text">
                {progress.progress}% {t(`listen.packs.phase.${progress.phase}`, '')}
              </span>
            </div>
          )}
        </div>
        <div className="pack-actions">
          {(pack.status === 'not-installed' || pack.status === 'update-available') && (
            <button
              className="btn-small download"
              disabled={busyPackId !== null}
              onClick={() => handleDownload(pack.id)}
              title={pack.status === 'update-available' ? t('listen.packs.update') : t('listen.packs.download')}
            >
              {busy
                ? <RefreshCw size={12} className="spinning" />
                : <><Download size={12} /> {pack.status === 'update-available' ? t('listen.packs.update') : t('listen.packs.download')}</>}
            </button>
          )}
          {installed && (
            <button
              className="btn-small uninstall"
              disabled={busyPackId !== null}
              onClick={() => handleRemove(pack.id)}
              title={t('listen.packs.uninstall')}
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
      </div>
    );
  };

  const ready = !!info?.modelName;

  return (
    <div className="setting-content">
      <h3>{t('settings.listen.title')}</h3>
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

      <div className="setting-group">
        {/* .ocr-pack-section-header is the flex row only; .pack-section-title
            is deliberately NOT reused — it carries the OCR list's disclosure
            chevron, and this list does not fold. */}
        <div className="ocr-pack-section-header">
          <h4 className="listen-packs-title">{t('listen.packs.title')}</h4>
          <button
            className="btn-small"
            onClick={() => loadPacks(true)}
            disabled={packsLoading || busyPackId !== null}
            title={t('listen.packs.refresh')}
          >
            <RefreshCw size={12} className={packsLoading ? 'spinning' : ''} />
            <span style={{ marginLeft: 4 }}>{t('listen.packs.refresh')}</span>
          </button>
        </div>

        {manifestError && (
          <p className="pack-manifest-error">
            <AlertTriangle size={13} />
            {t('listen.packs.manifestError')}
          </p>
        )}

        {packs.length === 0
          ? <p className="setting-hint">{packsLoading ? t('listen.packs.loading') : t('listen.packs.empty')}</p>
          : packs.map(renderPackRow)}

        <p className="setting-hint">{t('listen.packs.location', { dir: info?.modelsDir || '' })}</p>
      </div>
    </div>
  );
};

export default ListenSection;
