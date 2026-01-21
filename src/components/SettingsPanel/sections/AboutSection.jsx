// src/components/SettingsPanel/sections/AboutSection.jsx
// 关于页面区块组件 - 从 SettingsPanel 拆分

import React from 'react';
import { GitBranch, RefreshCw, FolderOpen } from 'lucide-react';

/**
 * 关于页面区块
 */
const AboutSection = ({ notify }) => {
  // 打开 GitHub
  const openGitHub = () => {
    window.electron?.shell?.openExternal?.('https://github.com/your-repo/t-translate');
  };

  // 检查更新
  const checkUpdate = () => {
    notify('检查更新功能开发中', 'info');
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

  return (
    <div className="setting-content about-section">
      <div className="app-info">
        <div className="app-logo-text">T</div>
        <h2>T-Translate</h2>
        <p className="version-tag">v1.0.0</p>
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
        <button className="link-button" onClick={checkUpdate}>
          <RefreshCw size={16}/> 检查更新
        </button>
        <button className="link-button" onClick={openLogDirectory}>
          <FolderOpen size={16}/> 打开日志目录
        </button>
      </div>
      
      <div className="about-footer">
        <p>Made with ❤️ for translators</p>
        <p className="copyright">© 2024-2025 T-Translate</p>
      </div>
    </div>
  );
};

export default AboutSection;
