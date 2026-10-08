// Where the app keeps its data and models, and what an older build left in
// userData. Sits at the top of the privacy page's data-management group, next
// to the sizes of what is stored there. Refreshed after a move or a clean so
// the rows reflect it.

import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, FolderOpen, HardDrive, Trash2 } from 'lucide-react';

const formatSize = (bytes) => {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
};

const StorageLocations = ({ confirm }) => {
  const { t } = useTranslation();
  const [storage, setStorage] = useState(null);
  const [migrate, setMigrate] = useState({ state: 'idle', progress: null, error: '' });
  const [clean, setClean] = useState({ state: 'idle', error: '' });

  const loadStorage = useCallback(async () => {
    try {
      const info = await window.electron?.models?.storageInfo?.();
      if (info) setStorage(info);
    } catch {
      // no bridge (older preload) — the rows simply stay hidden
    }
  }, []);

  useEffect(() => {
    loadStorage();
    const off = window.electron?.models?.onMigrateProgress?.((p) => {
      setMigrate((m) => ({ ...m, progress: p }));
    });
    return () => off?.();
  }, [loadStorage]);

  const moveModels = async () => {
    setMigrate({ state: 'running', progress: null, error: '' });
    const result = await window.electron?.models?.migrate?.();
    if (result?.success) {
      setMigrate({ state: 'done', progress: null, error: '' });
    } else {
      setMigrate({ state: 'failed', progress: null, error: result?.error || '' });
    }
    loadStorage();
  };

  const cleanLegacy = async () => {
    if (!(await confirm(t('privacy.storage.cleanConfirm', { path: storage.legacyDataRoot })))) return;
    setClean({ state: 'running', error: '' });
    const result = await window.electron?.models?.cleanLegacy?.();
    setClean(result?.success ? { state: 'done', error: '' } : { state: 'failed', error: result?.error || '' });
    loadStorage();
  };

  if (!storage) return null;

  // Packs still in the old folder come first; the clear button only shows
  // once they are moved.
  const showMovePacks = storage.legacyPacks > 0 && !storage.fallback;

  return (
    <div className="storage-locations">
      <div className="storage-grid">
        <span className="storage-label">{t('privacy.storage.dataDir')}</span>
        <span className="storage-value">
          <span className={`engine-badge ${storage.dataFallback ? 'unavailable' : 'installed'}`}>
            {storage.dataFallback ? t('privacy.storage.inUserDir') : t('privacy.storage.inProgramDir')}
          </span>
          <span className="storage-path" title={storage.dataRoot}>{storage.dataRoot}</span>
          <button className="link-button" onClick={() => window.electron?.models?.openFolder?.('data')}>
            <FolderOpen size={14} /> {t('privacy.storage.openFolder')}
          </button>
        </span>
        <span className="storage-label">{t('privacy.storage.modelsDir')}</span>
        <span className="storage-value">
          <span className={`engine-badge ${storage.fallback ? 'unavailable' : 'installed'}`}>
            {storage.fallback ? t('privacy.storage.inUserDir') : t('privacy.storage.inProgramDir')}
          </span>
          <span className="storage-path" title={storage.root}>{storage.root}</span>
          <button className="link-button" onClick={() => window.electron?.models?.openFolder?.('models')}>
            <FolderOpen size={14} /> {t('privacy.storage.openFolder')}
          </button>
        </span>
        {(showMovePacks || storage.legacyDataRoot) && (
          <>
            <span className="storage-label">{t('privacy.storage.legacyLabel')}</span>
            <span className="storage-value">
              {showMovePacks ? (
                <>
                  <span>{t('privacy.storage.legacyFound', { count: storage.legacyPacks, size: formatSize(storage.legacyBytes) })}</span>
                  <button
                    className="link-button"
                    disabled={migrate.state === 'running'}
                    onClick={moveModels}
                  >
                    {migrate.state === 'running'
                      ? <><RefreshCw size={14} className="spinning" /> {t('privacy.storage.moving')}</>
                      : <><HardDrive size={14} /> {t('privacy.storage.moveButton')}</>}
                  </button>
                </>
              ) : (
                <>
                  <span className="storage-path" title={storage.legacyDataRoot}>{storage.legacyDataRoot}</span>
                  <button
                    className="link-button"
                    disabled={clean.state === 'running'}
                    onClick={cleanLegacy}
                  >
                    {clean.state === 'running'
                      ? <><RefreshCw size={14} className="spinning" /> {t('privacy.storage.cleaning')}</>
                      : <><Trash2 size={14} /> {t('privacy.storage.cleanButton')}</>}
                  </button>
                </>
              )}
            </span>
          </>
        )}
      </div>
      {migrate.state === 'running' && migrate.progress && (
        <div className="engine-download-progress">
          <div className="download-progress-bar">
            <div className="download-progress-fill" style={{ width: `${migrate.progress.total ? Math.max(2, Math.round(migrate.progress.done / migrate.progress.total * 100)) : 2}%` }} />
          </div>
          <span className="download-progress-text">{migrate.progress.pack}</span>
        </div>
      )}
      {migrate.state === 'done' && <p className="storage-note">{t('privacy.storage.moved')}</p>}
      {migrate.state === 'failed' && <p className="storage-note error">{t('privacy.storage.moveFailed', { error: migrate.error })}</p>}
      {clean.state === 'done' && <p className="storage-note">{t('privacy.storage.cleaned')}</p>}
      {clean.state === 'failed' && <p className="storage-note error">{t('privacy.storage.cleanFailed', { error: clean.error })}</p>}
    </div>
  );
};

export default StorageLocations;
