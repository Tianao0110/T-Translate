import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Minus, Maximize2, Minimize2, X } from 'lucide-react';
import './styles.css';

const TitleBar = () => {
  const { t } = useTranslation();
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    window.electron?.window?.isMaximized?.().then(setIsMaximized);

    const handleMaximizeChange = (maximized) => {
      setIsMaximized(maximized);
    };

    window.electron?.window?.onMaximizeChange?.(handleMaximizeChange);

    return () => {
      window.electron?.window?.offMaximizeChange?.(handleMaximizeChange);
    };
  }, []);

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
          title={t('titleBar.minimize', 'Minimize')}
        >
          <Minus size={14} />
        </button>
        <button
          className="window-control-btn"
          onClick={handleMaximize}
          title={isMaximized ? t('titleBar.restore', 'Restore') : t('titleBar.maximize', 'Maximize')}
        >
          {isMaximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
        </button>
        <button
          className="window-control-btn close"
          onClick={handleClose}
          title={t('titleBar.close', 'Close')}
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
};

export default TitleBar;
