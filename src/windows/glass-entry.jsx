// src/windows/glass-entry.jsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import GlassTranslator from '../components/GlassTranslator';
import ErrorBoundary from '../components/ErrorBoundary';
import { initGlobalErrorHandler } from '../utils/global-error-handler.js';
import i18n from '../i18n.js';

// 初始化全局错误处理
initGlobalErrorHandler();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary windowName={i18n.t('glass.title', 'Glass Window')}>
      <GlassTranslator />
    </ErrorBoundary>
  </React.StrictMode>
);
