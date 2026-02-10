// src/components/SettingsPanel/sections/AboutSection.jsx
// 关于页面区块组件 - 包含检查更新功能

import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { GitBranch, RefreshCw, FolderOpen, Download, X, Loader2 } from 'lucide-react';

/**
 * 关于页面区块
 */
const AboutSection = ({ notify }) => {
  const { t, i18n } = useTranslation();
  const [version, setVersion] = useState('');
  const [isChecking, setIsChecking] = useState(false);
  const [updateInfo, setUpdateInfo] = useState(null);
  const [showUpdateModal, setShowUpdateModal] = useState(false);

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

  // 打开 GitHub
  const openGitHub = () => {
    window.electron?.shell?.openExternal?.('https://github.com/Tianao0110/T-Translate');
  };

  // 检查更新
  const checkUpdate = async () => {
    if (isChecking) return;
    
    setIsChecking(true);
    
    try {
      const result = await window.electron?.app?.checkUpdate?.();
      
      if (!result) {
        notify(t('about.updateUnavailable'), 'error');
        return;
      }
      
      if (!result.success) {
        notify(result.error || t('about.updateFailed'), 'error');
        return;
      }
      
      // 暂无发布版本
      if (result.latestVersion === null) {
        notify(t('about.noReleases'), 'success');
        return;
      }
      
      if (result.hasUpdate) {
        setUpdateInfo(result);
        setShowUpdateModal(true);
      } else {
        notify(t('settings.about.upToDate') + ' ✓', 'success');
      }
      
    } catch (e) {
      notify(t('about.updateFailed') + ': ' + (e.message || t('notify.networkError')), 'error');
    } finally {
      setIsChecking(false);
    }
  };

  // 打开下载页面
  const openDownloadPage = () => {
    if (updateInfo?.releaseUrl) {
      window.electron?.shell?.openExternal?.(updateInfo.releaseUrl);
    }
    setShowUpdateModal(false);
  };

  // 打开日志目录
  const openLogDirectory = async () => {
    try {
      const result = await window.electron?.logs?.openDirectory?.();
      if (result?.success) {
        notify(t('about.logDirOpened'), 'success');
      } else {
        notify(result?.message || t('about.logDirFailed'), 'error');
      }
    } catch (e) {
      notify(t('about.logDirFailed'), 'error');
    }
  };

  // 格式化日期
  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString(i18n.language === 'zh' ? 'zh-CN' : 'en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    } catch {
      return dateStr;
    }
  };

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
          className={`link-button ${isChecking ? 'checking' : ''}`} 
          onClick={checkUpdate}
          disabled={isChecking}
        >
          {isChecking ? (
            <>
              <Loader2 size={16} className="spinning" /> {t('settings.about.checking')}
            </>
          ) : (
            <>
              <RefreshCw size={16}/> {t('settings.about.checkUpdate')}
            </>
          )}
        </button>
        <button className="link-button" onClick={openLogDirectory}>
          <FolderOpen size={16}/> {t('about.openLogs')}
        </button>
      </div>
      
      <div className="about-footer">
        <p>Made with ❤️ for translators</p>
        <p className="copyright">{t('settings.about.copyright')}</p>
      </div>

      {/* 更新弹窗 */}
      {showUpdateModal && updateInfo && (
        <div className="update-modal-overlay" onClick={() => setShowUpdateModal(false)}>
          <div className="update-modal" onClick={e => e.stopPropagation()}>
            <div className="update-modal-header">
              <h3>🎉 {t('settings.about.newVersion')}</h3>
              <button className="close-btn" onClick={() => setShowUpdateModal(false)}>
                <X size={18} />
              </button>
            </div>
            
            <div className="update-modal-body">
              <div className="version-compare">
                <div className="version-item current">
                  <span className="label">{t('about.currentVersion')}</span>
                  <span className="value">v{updateInfo.currentVersion}</span>
                </div>
                <div className="version-arrow">→</div>
                <div className="version-item latest">
                  <span className="label">{t('about.latestVersion')}</span>
                  <span className="value">v{updateInfo.latestVersion}</span>
                </div>
              </div>
              
              {updateInfo.releaseName && (
                <div className="release-name">
                  {updateInfo.releaseName}
                </div>
              )}
              
              {updateInfo.publishedAt && (
                <div className="release-date">
                  {t('settings.about.publishedAt')}: {formatDate(updateInfo.publishedAt)}
                </div>
              )}
              
              {updateInfo.releaseNotes && (
                <div className="release-notes">
                  <h4>{t('settings.about.releaseNotes')}</h4>
                  <div className="notes-content">
                    {updateInfo.releaseNotes}
                  </div>
                </div>
              )}
            </div>
            
            <div className="update-modal-footer">
              <button className="btn-secondary" onClick={() => setShowUpdateModal(false)}>
                {t('settings.about.later')}
              </button>
              <button className="btn-primary" onClick={openDownloadPage}>
                <Download size={16} /> {t('settings.about.download')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AboutSection;
