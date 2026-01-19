// src/components/TitleBar.jsx
import React, { useState, useEffect } from 'react';
import { Minus, Maximize2, Minimize2, X } from 'lucide-react';
import './styles.css';

const TitleBar = () => {
  const [isMaximized, setIsMaximized] = useState(false);

  // 监听窗口最大化状态变化
  useEffect(() => {
    // 初始获取状态
    window.electron?.window?.isMaximized?.().then(setIsMaximized);
    
    // 监听状态变化
    const handleMaximizeChange = (maximized) => {
      setIsMaximized(maximized);
    };
    
    window.electron?.window?.onMaximizeChange?.(handleMaximizeChange);
    
    return () => {
      window.electron?.window?.offMaximizeChange?.(handleMaximizeChange);
    };
  }, []);

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
          title={isMaximized ? "还原" : "最大化"}
        >
          {isMaximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
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