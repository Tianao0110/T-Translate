// src/components/SettingsPanel/sections/AboutSection.jsx
// 关于页面区块组件 - 包含检查更新功能

import React, { useState, useEffect } from 'react';
import { GitBranch, RefreshCw, FolderOpen, Download, X, Loader2 } from 'lucide-react';

/**
 * 关于页面区块
 */
const AboutSection = ({ notify }) => {
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
        notify('检查更新功能不可用', 'error');
        return;
      }
      
      if (!result.success) {
        notify(result.error || '检查更新失败', 'error');
        return;
      }
      
      // 暂无发布版本
      if (result.latestVersion === null) {
        notify('暂无发布版本，已是最新 ✓', 'success');
        return;
      }
      
      if (result.hasUpdate) {
        setUpdateInfo(result);
        setShowUpdateModal(true);
      } else {
        notify('已是最新版本 ✓', 'success');
      }
      
    } catch (e) {
      notify('检查更新失败: ' + (e.message || '网络错误'), 'error');
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
        notify('已打开日志目录', 'success');
      } else {
        notify(result?.message || '无法打开日志目录', 'error');
      }
    } catch (e) {
      notify('打开日志目录失败', 'error');
    }
  };

  // 格式化日期
  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString('zh-CN', {
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
        <p className="app-desc">智能离线翻译工具</p>
      </div>
      
      <div className="info-cards">
        <div className="info-card">
          <h4>🚀 核心特性</h4>
          <ul>
            <li>本地 LLM 翻译，数据不出设备</li>
            <li>多引擎 OCR 文字识别</li>
            <li>PDF/DOCX/EPUB 文档翻译</li>
            <li>划词翻译 + 玻璃窗口</li>
          </ul>
        </div>
        <div className="info-card">
          <h4>⚙️ 技术栈</h4>
          <ul>
            <li>Electron + React 18</li>
            <li>Zustand 状态管理</li>
            <li>LM Studio / Ollama 后端</li>
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
              <Loader2 size={16} className="spinning" /> 检查中...
            </>
          ) : (
            <>
              <RefreshCw size={16}/> 检查更新
            </>
          )}
        </button>
        <button className="link-button" onClick={openLogDirectory}>
          <FolderOpen size={16}/> 打开日志目录
        </button>
      </div>
      
      <div className="about-footer">
        <p>Made with ❤️ for translators</p>
        <p className="copyright">© 2026 T-Translate</p>
      </div>

      {/* 更新弹窗 */}
      {showUpdateModal && updateInfo && (
        <div className="update-modal-overlay" onClick={() => setShowUpdateModal(false)}>
          <div className="update-modal" onClick={e => e.stopPropagation()}>
            <div className="update-modal-header">
              <h3>🎉 发现新版本</h3>
              <button className="close-btn" onClick={() => setShowUpdateModal(false)}>
                <X size={18} />
              </button>
            </div>
            
            <div className="update-modal-body">
              <div className="version-compare">
                <div className="version-item current">
                  <span className="label">当前版本</span>
                  <span className="value">v{updateInfo.currentVersion}</span>
                </div>
                <div className="version-arrow">→</div>
                <div className="version-item latest">
                  <span className="label">最新版本</span>
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
                  发布日期: {formatDate(updateInfo.publishedAt)}
                </div>
              )}
              
              {updateInfo.releaseNotes && (
                <div className="release-notes">
                  <h4>更新内容</h4>
                  <div className="notes-content">
                    {updateInfo.releaseNotes}
                  </div>
                </div>
              )}
            </div>
            
            <div className="update-modal-footer">
              <button className="btn-secondary" onClick={() => setShowUpdateModal(false)}>
                稍后再说
              </button>
              <button className="btn-primary" onClick={openDownloadPage}>
                <Download size={16} /> 前往下载
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AboutSection;
