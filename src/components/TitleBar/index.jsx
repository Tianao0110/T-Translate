// src/components/TitleBar.jsx
import React from 'react';
import { Minus, Square, X } from 'lucide-react';
import './styles.css'; // 我们稍后会创建这个简单的 CSS

const TitleBar = () => {
  // 安全地调用 Electron API
  const handleMinimize = () => {
    if (window.electron && window.electron.window) {
      window.electron.window.minimize();
    }
  };

  const handleMaximize = () => {
    if (window.electron && window.electron.window) {
      window.electron.window.maximize();
    }
  };

  const handleClose = () => {
    if (window.electron && window.electron.window) {
      window.electron.window.close();
    }
  };

  return (
    <div className="titlebar">
      <div className="title-drag-region">
        <span className="window-icon-text">T</span>
        <span className="window-title">T-Translate</span>
      </div>
      
      <div className="window-controls">
        <button 
          className="window-control-btn" 
          onClick={handleMinimize} 
          title="最小化"
        >
          <Minus size={14} />
        </button>
        <button 
          className="window-control-btn" 
          onClick={handleMaximize} 
          title="最大化"
        >
          <Square size={12} />
        </button>
        <button 
          className="window-control-btn close" 
          onClick={handleClose} 
          title="关闭"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
};

export default TitleBar;