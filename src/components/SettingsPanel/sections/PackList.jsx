// Downloadable model pack list shared by the listen (ASR) and TTS (voice)
// settings sections: one manifest-backed list, one download/update/remove
// flow, one progress bar. `bridge` is the preload surface for the domain
// (window.electron.audioPacks / ttsPacks) and `prefix` the i18n namespace.
//
// Row markup reuses the OCR pack classes (styles/ocr.css) — same rows, same
// badges, same progress bar.

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, RefreshCw, Trash2, AlertTriangle } from 'lucide-react';
import createLogger from '../../../utils/logger.js';
const logger = createLogger('PackList');

const PackList = ({ bridge, prefix, notify, confirm, onChanged, children }) => {
  const { t } = useTranslation();
  const [packs, setPacks] = useState([]);
  const [manifestError, setManifestError] = useState(null);
  const [packsLoading, setPacksLoading] = useState(false);
  const [busyPackId, setBusyPackId] = useState(null);
  const [packProgress, setPackProgress] = useState(null); // { packId, progress, phase }
  const packsRef = useRef([]);
  packsRef.current = packs;

  const loadPacks = useCallback(async (refresh = false) => {
    if (!bridge?.listPacks) return;
    setPacksLoading(true);
    try {
      const res = await bridge.listPacks({ refresh });
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
  }, [bridge]);

  useEffect(() => {
    loadPacks(false);
    // The progress channel is shared by both domains; only our own ids count.
    const cleanup = bridge?.onPackProgress?.((data) => {
      if (!packsRef.current.some((p) => p.id === data.packId)) return;
      setPackProgress(data.progress >= 100 || data.progress < 0 ? null : data);
    });
    return () => cleanup?.();
  }, [bridge, loadPacks]);

  const handleDownload = useCallback(async (packId) => {
    setBusyPackId(packId);
    try {
      const result = await bridge?.downloadPack?.(packId);
      if (result?.success) {
        notify(t(`${prefix}.downloaded`), 'success');
        await loadPacks(false);
        onChanged?.();
      } else if (result?.errorCode === 'OFFLINE_BLOCKED') {
        notify(t(`${prefix}.offlineBlocked`), 'warning');
      } else {
        notify(result?.error || t(`${prefix}.downloadFailed`), 'error');
      }
    } catch (e) {
      notify(t(`${prefix}.downloadFailed`) + ': ' + e.message, 'error');
    } finally {
      setBusyPackId(null);
      setPackProgress(null);
    }
  }, [bridge, prefix, notify, t, loadPacks, onChanged]);

  const handleRemove = useCallback(async (packId) => {
    if (!(await confirm(t(`${prefix}.removeConfirm`)))) return;
    try {
      const result = await bridge?.removePack?.(packId);
      if (result?.success) {
        notify(t(`${prefix}.removed`), 'success');
        await loadPacks(false);
        onChanged?.();
      } else {
        notify(result?.error || t(`${prefix}.removeFailed`), 'error');
      }
    } catch (e) {
      notify(t(`${prefix}.removeFailed`) + ': ' + e.message, 'error');
    }
  }, [bridge, prefix, notify, t, confirm, loadPacks, onChanged]);

  const statusBadge = (status) => {
    switch (status) {
      case 'installed':
      case 'orphaned':
        return <span className="engine-badge installed">{t(`${prefix}.installed`)}</span>;
      case 'update-available':
        return <span className="engine-badge download">{t(`${prefix}.updateAvailable`)}</span>;
      default:
        return <span className="engine-badge unavailable">{t(`${prefix}.notInstalled`)}</span>;
    }
  };

  const renderPackRow = (pack) => {
    const busy = busyPackId === pack.id;
    const progress = packProgress?.packId === pack.id ? packProgress : null;
    const sizeMB = pack.size ? (pack.size / 1024 / 1024).toFixed(1) : null;
    const installed = ['installed', 'update-available', 'orphaned'].includes(pack.status);
    // Per-pack description first (voice packs differ by pack), type-level as
    // the fallback (ASR packs are described by role).
    const desc = t(`${prefix}.desc.${pack.id}`, t(`${prefix}.desc.${pack.type}`, ''));

    return (
      <div key={pack.id} className="ocr-pack-row">
        <div className="pack-info">
          <div className="pack-header">
            <span className="pack-name">{t(`${prefix}.names.${pack.id}`, pack.model || pack.id)}</span>
            {statusBadge(pack.status)}
            {sizeMB && <span className="engine-size">{sizeMB} MB</span>}
          </div>
          {desc && <p className="setting-hint">{desc}</p>}
          {progress && (
            <div className="engine-download-progress" style={{ marginTop: 6 }}>
              <div className="download-progress-bar">
                <div className="download-progress-fill" style={{ width: `${Math.max(progress.progress, 2)}%` }} />
              </div>
              <span className="download-progress-text">
                {progress.progress}% {t(`${prefix}.phase.${progress.phase}`, '')}
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
              title={pack.status === 'update-available' ? t(`${prefix}.update`) : t(`${prefix}.download`)}
            >
              {busy
                ? <RefreshCw size={12} className="spinning" />
                : <><Download size={12} /> {pack.status === 'update-available' ? t(`${prefix}.update`) : t(`${prefix}.download`)}</>}
            </button>
          )}
          {installed && (
            <button
              className="btn-small uninstall"
              disabled={busyPackId !== null}
              onClick={() => handleRemove(pack.id)}
              title={t(`${prefix}.uninstall`)}
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="setting-group">
      {/* .ocr-pack-section-header is the flex row only; .pack-section-title
          is deliberately NOT reused — it carries the OCR list's disclosure
          chevron, and this list does not fold. */}
      <div className="ocr-pack-section-header">
        <h4 className="listen-packs-title">{t(`${prefix}.title`)}</h4>
        <button
          className="btn-small"
          onClick={() => loadPacks(true)}
          disabled={packsLoading || busyPackId !== null}
          title={t(`${prefix}.refresh`)}
        >
          <RefreshCw size={12} className={packsLoading ? 'spinning' : ''} />
          <span style={{ marginLeft: 4 }}>{t(`${prefix}.refresh`)}</span>
        </button>
      </div>

      {manifestError && (
        <p className="pack-manifest-error">
          <AlertTriangle size={13} />
          {manifestError === 'OFFLINE_BLOCKED'
            ? t(`${prefix}.manifestOffline`)
            : t(`${prefix}.manifestError`)}
        </p>
      )}

      {packs.length === 0
        ? <p className="setting-hint">{packsLoading ? t(`${prefix}.loading`) : t(`${prefix}.empty`)}</p>
        : packs.map(renderPackRow)}

      {children}
    </div>
  );
};

export default PackList;
