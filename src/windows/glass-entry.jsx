// src/windows/glass-entry.jsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import GlassTranslator from '../components/GlassTranslator';
import ErrorBoundary from '../components/ErrorBoundary';
import { initGlobalErrorHandler } from '../utils/global-error-handler.js';

// 初始化全局错误处理
initGlobalErrorHandler();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary windowName="玻璃窗口">
      <GlassTranslator />
    </ErrorBoundary>
  </React.StrictMode>
);
