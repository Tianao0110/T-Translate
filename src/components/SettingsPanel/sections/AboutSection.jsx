// src/components/SettingsPanel/sections/AboutSection.jsx
// 关于页面区块组件 - 包含应用内自动更新

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { GitBranch, RefreshCw, FolderOpen, Download, X, Loader2, CheckCircle, AlertCircle, ExternalLink } from 'lucide-react';

// 更新阶段
const UPDATE_STAGE = {
  IDLE: 'idle',
  CHECKING: 'checking',
  DOWNLOADING: 'downloading',
  READY: 'ready',
  INSTALLING: 'installing',
  ERROR: 'error',
};

const AboutSection = ({ notify, resetSettings }) => {
  const { t, i18n } = useTranslation();
  const [version, setVersion] = useState('');
  const [updateStage, setUpdateStage] = useState(UPDATE_STAGE.IDLE);
  const [updateInfo, setUpdateInfo] = useState(null);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState({ percent: 0, downloaded: 0, total: 0 });
  const [downloadedPath, setDownloadedPath] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const cleanupRef = useRef(null);

  // 获取版本号
  useEffect(() => {
    const fetchVersion = async () => {
      try {
        const ver = await window.electron?.app?.getVersion?.();
        setVersion(ver || '0.0.0');
      } catch {
        setVersion('0.0.0');
      }
    };
    fetchVersion();
  }, []);

  // 监听下载进度
  useEffect(() => {
    const cleanup = window.electron?.app?.onDownloadProgress?.((progress) => {
      setDownloadProgress(progress);
    });
    cleanupRef.current = cleanup;
    return () => cleanup?.();
  }, []);

  const openGitHub = () => {
    window.electron?.shell?.openExternal?.('https://github.com/Tianao0110/T-Translate');
  };

  const formatSize = (bytes) => {
    if (!bytes || bytes <= 0) return '';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString(i18n.language === 'zh' ? 'zh-CN' : 'en-US', {
        year: 'numeric', month: 'long', day: 'numeric'
      });
    } catch {
      return dateStr;
    }
  };

  // ========== 更新流程 ==========

  const checkUpdate = useCallback(async () => {
    if (updateStage === UPDATE_STAGE.CHECKING || updateStage === UPDATE_STAGE.DOWNLOADING) return;

    setUpdateStage(UPDATE_STAGE.CHECKING);
    setErrorMsg('');

    try {
      const result = await window.electron?.app?.checkUpdate?.();

      if (!result) {
        setUpdateStage(UPDATE_STAGE.IDLE);
        notify(t('about.updateUnavailable'), 'error');
        return;
      }

      if (!result.success) {
        setUpdateStage(UPDATE_STAGE.ERROR);
        setErrorMsg(result.error || t('about.updateFailed'));
        return;
      }

      if (result.latestVersion === null) {
        setUpdateStage(UPDATE_STAGE.IDLE);
        notify(t('about.noReleases'), 'success');
        return;
      }

      if (result.hasUpdate) {
        setUpdateInfo(result);
        setShowUpdateModal(true);
        setUpdateStage(UPDATE_STAGE.IDLE);
      } else {
        setUpdateStage(UPDATE_STAGE.IDLE);
        notify(t('settings.about.upToDate') + ' ✓', 'success');
      }
    } catch (e) {
      setUpdateStage(UPDATE_STAGE.ERROR);
      setErrorMsg(e.message || t('notify.networkError'));
    }
  }, [updateStage, notify, t]);

  const startDownload = useCallback(async () => {
    if (!updateInfo?.downloadUrl) {
      if (updateInfo?.releaseUrl) {
        window.electron?.shell?.openExternal?.(updateInfo.releaseUrl);
      }
      return;
    }

    setUpdateStage(UPDATE_STAGE.DOWNLOADING);
    setDownloadProgress({ percent: 0, downloaded: 0, total: updateInfo.downloadSize || 0 });

    try {
      const result = await window.electron?.app?.downloadUpdate?.({
        downloadUrl: updateInfo.downloadUrl,
        downloadName: updateInfo.downloadName,
      });

      if (result?.success) {
        setDownloadedPath(result.filePath);
        setUpdateStage(UPDATE_STAGE.READY);
      } else {
        setUpdateStage(UPDATE_STAGE.ERROR);
        setErrorMsg(result?.error || t('about.updateFailed'));
      }
    } catch (e) {
      setUpdateStage(UPDATE_STAGE.ERROR);
      setErrorMsg(e.message || t('about.updateFailed'));
    }
  }, [updateInfo, t]);

  const installNow = useCallback(async () => {
    if (!downloadedPath) return;
    setUpdateStage(UPDATE_STAGE.INSTALLING);
    try {
      await window.electron?.app?.installUpdate?.({ filePath: downloadedPath });
    } catch (e) {
      setUpdateStage(UPDATE_STAGE.ERROR);
      setErrorMsg(e.message || t('about.installFailed'));
    }
  }, [downloadedPath]);

  const openDownloadPage = () => {
    if (updateInfo?.releaseUrl) {
      window.electron?.shell?.openExternal?.(updateInfo.releaseUrl);
    }
  };

  const closeModal = () => {
    if (updateStage === UPDATE_STAGE.DOWNLOADING) return;
    setShowUpdateModal(false);
    if (updateStage === UPDATE_STAGE.ERROR) setUpdateStage(UPDATE_STAGE.IDLE);
  };

  const openLogDirectory = async () => {
    try {
      const result = await window.electron?.logs?.openDirectory?.();
      if (result?.success) {
        notify(t('about.logDirOpened'), 'success');
      } else {
        notify(result?.message || t('about.logDirFailed'), 'error');
      }
    } catch {
      notify(t('about.logDirFailed'), 'error');
    }
  };

  // ========== 弹窗内容 ==========

  const renderModalBody = () => {
    if (updateStage === UPDATE_STAGE.DOWNLOADING) {
      return (
        <div className="update-download-progress">
          <div className="progress-info">
            <span className="progress-label">
              {t('about.downloading')}
            </span>
            <span className="progress-percent">
              {downloadProgress.percent >= 0 ? `${downloadProgress.percent}%` : ''}
            </span>
          </div>
          <div className="progress-bar-track">
            <div
              className="progress-bar-fill"
              style={{ width: `${Math.max(0, downloadProgress.percent)}%` }}
            />
          </div>
          <div className="progress-detail">
            {formatSize(downloadProgress.downloaded)}
            {downloadProgress.total > 0 && ` / ${formatSize(downloadProgress.total)}`}
          </div>
        </div>
      );
    }

    if (updateStage === UPDATE_STAGE.READY) {
      return (
        <div className="update-ready">
          <CheckCircle size={40} className="ready-icon" />
          <p className="ready-text">
            {t('about.downloadReady')}
          </p>
          <p className="ready-hint">
            {t('about.installHint')}
          </p>
        </div>
      );
    }

    if (updateStage === UPDATE_STAGE.INSTALLING) {
      return (
        <div className="update-installing">
          <Loader2 size={40} className="spinning" />
          <p>{t('about.launching')}</p>
        </div>
      );
    }

    if (updateStage === UPDATE_STAGE.ERROR) {
      return (
        <div className="update-error">
          <AlertCircle size={40} className="error-icon" />
          <p className="error-text">{errorMsg}</p>
          <p className="error-hint">
            {t('about.githubHint')}
          </p>
        </div>
      );
    }

    // 默认：更新信息
    return (
      <>
        <div className="version-compare">
          <div className="version-item current">
            <span className="label">{t('about.currentVersion')}</span>
            <span className="value">v{updateInfo?.currentVersion}</span>
          </div>
          <div className="version-arrow">→</div>
          <div className="version-item latest">
            <span className="label">{t('about.latestVersion')}</span>
            <span className="value">v{updateInfo?.latestVersion}</span>
          </div>
        </div>

        {updateInfo?.releaseName && (
          <div className="release-name">{updateInfo.releaseName}</div>
        )}

        {updateInfo?.publishedAt && (
          <div className="release-date">
            {t('settings.about.publishedAt')}: {formatDate(updateInfo.publishedAt)}
          </div>
        )}

        {updateInfo?.downloadName && (
          <div className="download-info">
            📦 {updateInfo.downloadName}
            {updateInfo.downloadSize > 0 && ` (${formatSize(updateInfo.downloadSize)})`}
          </div>
        )}

        {updateInfo?.releaseNotes && (
          <div className="release-notes">
            <h4>{t('settings.about.releaseNotes')}</h4>
            <div className="notes-content">{updateInfo.releaseNotes}</div>
          </div>
        )}
      </>
    );
  };

  const renderModalFooter = () => {
    if (updateStage === UPDATE_STAGE.DOWNLOADING || updateStage === UPDATE_STAGE.INSTALLING) {
      return null;
    }

    if (updateStage === UPDATE_STAGE.READY) {
      return (
        <>
          <button className="btn-secondary" onClick={closeModal}>
            {t('settings.about.later')}
          </button>
          <button className="btn-primary" onClick={installNow}>
            <Download size={16} />
            {t('about.installNow')}
          </button>
        </>
      );
    }

    if (updateStage === UPDATE_STAGE.ERROR) {
      return (
        <>
          <button className="btn-secondary" onClick={closeModal}>
            {t('titleBar.close')}
          </button>
          <button className="btn-primary" onClick={openDownloadPage}>
            <ExternalLink size={16} />
            {t('about.manualDownload')}
          </button>
        </>
      );
    }

    return (
      <>
        <button className="btn-secondary" onClick={closeModal}>
          {t('settings.about.later')}
        </button>
        {updateInfo?.downloadUrl ? (
          <button className="btn-primary" onClick={startDownload}>
            <Download size={16} />
            {t('about.downloadInstall')}
          </button>
        ) : (
          <button className="btn-primary" onClick={openDownloadPage}>
            <ExternalLink size={16} />
            {t('settings.about.download')}
          </button>
        )}
      </>
    );
  };

  // ========== 渲染 ==========

  return (
    <div className="setting-content about-section">
      <div className="app-info">
        <img src="./icon.png" alt="T-Translate" className="app-logo-img" />
        <h2>T-Translate</h2>
        <p className="version-tag">v{version}</p>
        <p className="app-desc">{t('about.desc')}</p>
      </div>

      <div className="info-cards">
        <div className="info-card">
          <h4>🚀 {t('about.features')}</h4>
          <ul>
            <li>{t('about.feature1')}</li>
            <li>{t('about.feature2')}</li>
            <li>{t('about.feature3')}</li>
            <li>{t('about.feature4')}</li>
          </ul>
        </div>
        <div className="info-card">
          <h4>⚙️ {t('about.techStack')}</h4>
          <ul>
            <li>Electron + React 18</li>
            <li>Zustand State Management</li>
            <li>LM Studio / Ollama</li>
            <li>RapidOCR / LLM Vision</li>
          </ul>
        </div>
      </div>

      <div className="about-actions">
        <button className="link-button" onClick={openGitHub}>
          <GitBranch size={16}/> GitHub
        </button>
        <button
          className={`link-button ${updateStage === UPDATE_STAGE.CHECKING ? 'checking' : ''}`}
          onClick={checkUpdate}
          disabled={updateStage === UPDATE_STAGE.CHECKING || updateStage === UPDATE_STAGE.DOWNLOADING}
        >
          {updateStage === UPDATE_STAGE.CHECKING ? (
            <><Loader2 size={16} className="spinning" /> {t('settings.about.checking')}</>
          ) : (
            <><RefreshCw size={16}/> {t('settings.about.checkUpdate')}</>
          )}
        </button>
        <button className="link-button" onClick={openLogDirectory}>
          <FolderOpen size={16}/> {t('about.openLogs')}
        </button>
        {resetSettings && (
          <button className="link-button danger" onClick={() => resetSettings()}>
            <RefreshCw size={16}/> {t('settingsNav.reset')}
          </button>
        )}
      </div>

      <div className="about-footer">
        <p>Made with ❤️ for translators</p>
        <p className="copyright">{t('settings.about.copyright')}</p>
      </div>

      {/* 更新弹窗 */}
      {showUpdateModal && updateInfo && (
        <div className="update-modal-overlay" onClick={closeModal}>
          <div className="update-modal" onClick={e => e.stopPropagation()}>
            <div className="update-modal-header">
              <h3>
                {updateStage === UPDATE_STAGE.READY ? '✅ ' :
                 updateStage === UPDATE_STAGE.ERROR ? '⚠️ ' :
                 updateStage === UPDATE_STAGE.DOWNLOADING ? '⬇️ ' : '🎉 '}
                {updateStage === UPDATE_STAGE.READY
                  ? t('about.downloadComplete')
                  : updateStage === UPDATE_STAGE.ERROR
                    ? t('about.updateFailed')
                    : t('settings.about.newVersion')
                }
              </h3>
              {updateStage !== UPDATE_STAGE.DOWNLOADING && updateStage !== UPDATE_STAGE.INSTALLING && (
                <button className="close-btn" onClick={closeModal}>
                  <X size={18} />
                </button>
              )}
            </div>

            <div className="update-modal-body">
              {renderModalBody()}
            </div>

            <div className="update-modal-footer">
              {renderModalFooter()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AboutSection;
