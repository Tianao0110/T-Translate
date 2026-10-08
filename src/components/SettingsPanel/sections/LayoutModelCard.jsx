// The PDF layout model: an OCR pack the document panel uses to keep formula,
// figure, header and footer text out of the translation. It lives on the
// document page because nothing else uses it.

import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { LayoutPanelTop, RefreshCw, Trash2 } from 'lucide-react';

// Must match electron/shared/ocr-packs.js LAYOUT_PACK_ID.
const LAYOUT_PACK_ID = 'layout-v3';
const INSTALLED_STATES = ['installed', 'update-available', 'orphaned'];

const LayoutModelCard = ({ notify, confirm }) => {
  const { t } = useTranslation();
  const [pack, setPack] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null); // { progress, phase }
  // The model runs only while GPU acceleration is on.
  const [gpu, setGpu] = useState(null);

  const refresh = useCallback(async () => {
    if (!window.electron?.ocr?.listPacks) return;
    try {
      const res = await window.electron.ocr.listPacks({ refresh: false });
      if (res?.success) setPack((res.packs || []).find((p) => p.id === LAYOUT_PACK_ID) || null);
    } catch {
      // the group stays hidden until the next visit
    }
  }, []);

  useEffect(() => {
    refresh();
    Promise.resolve(window.electron?.ocr?.layoutStatus?.())
      .then((s) => setGpu(s ? !!s.gpu : null))
      .catch(() => setGpu(null));
    const cleanup = window.electron?.ocr?.onPackProgress?.((data) => {
      if (data.packId !== LAYOUT_PACK_ID) return;
      setProgress(data.progress >= 100 || data.progress < 0 ? null : data);
    });
    return () => cleanup?.();
  }, [refresh]);

  const handleDownload = async () => {
    setBusy(true);
    try {
      const result = await window.electron?.ocr?.downloadPack?.(LAYOUT_PACK_ID);
      if (result?.success) {
        notify(t('documentSettings.layout.downloaded'), 'success');
        await refresh();
      } else if (result?.errorCode === 'OFFLINE_BLOCKED') {
        notify(t('ocr.packs.offlineBlocked'), 'warning');
      } else {
        notify(result?.error || t('ocr.packs.downloadFailed'), 'error');
      }
    } catch (e) {
      notify(t('ocr.packs.downloadFailed') + ': ' + e.message, 'error');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const handleRemove = async () => {
    if (!(await confirm(t('documentSettings.layout.removeConfirm')))) return;
    try {
      const result = await window.electron?.ocr?.removePack?.(LAYOUT_PACK_ID);
      if (result?.success) {
        notify(t('documentSettings.layout.removed'), 'success');
        await refresh();
      } else {
        notify(result?.error || t('ocr.packs.removeFailed'), 'error');
      }
    } catch (e) {
      notify(t('ocr.packs.removeFailed') + ': ' + e.message, 'error');
    }
  };

  // Not in the manifest and not on disk (e.g. offline): nothing to offer.
  if (!pack) return null;

  const installed = INSTALLED_STATES.includes(pack.status);
  const canDownload = !!pack.file && ['not-installed', 'update-available'].includes(pack.status);
  const sizeMB = pack.size ? (pack.size / 1024 / 1024).toFixed(1) : null;

  return (
    <div className="setting-group layout-model">
      {/* Name, state, size and the buttons on one line, like a pack row. */}
      <div className="layout-model-head">
        <label className="setting-label">
          <LayoutPanelTop size={16} /> {t('documentSettings.layout.name')}
        </label>
        {pack.status === 'update-available'
          ? <span className="engine-badge download">{t('ocr.packs.updateAvailable')}</span>
          : installed
            ? <span className="engine-badge installed">{t('ocr.installed')}</span>
            : <span className="engine-badge unavailable">{t('ocr.packs.notInstalled')}</span>}
        {sizeMB && <span className="engine-size">{sizeMB} MB</span>}
        <div className="engine-actions">
          {canDownload && (
            <button className="btn download" disabled={busy} onClick={handleDownload}>
              {busy
                ? <><RefreshCw size={13} className="spinning" /> {t('ocr.packs.downloadingShort')}</>
                : pack.status === 'update-available' ? t('ocr.packs.update') : t('ocr.download')}
            </button>
          )}
          {installed && (
            <button
              className="btn-small uninstall"
              disabled={busy}
              onClick={handleRemove}
              title={t('ocr.uninstall')}
              style={{ padding: '4px 8px' }}
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
      </div>
      <p className="setting-hint">{t('documentSettings.layout.desc')}</p>
      {installed && gpu === false && <p className="setting-hint">{t('documentSettings.layout.needsGpu')}</p>}
      {progress && (
        <div className="engine-download-progress">
          <div className="download-progress-bar">
            <div className="download-progress-fill" style={{ width: `${Math.max(progress.progress, 2)}%` }} />
          </div>
          <span className="download-progress-text">
            {progress.progress}% {t(`ocr.packs.phase.${progress.phase}`, '')}
          </span>
        </div>
      )}
    </div>
  );
};

export default LayoutModelCard;
