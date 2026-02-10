// src/windows/selection-entry.jsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import SelectionTranslator from '../components/SelectionTranslator';
import ErrorBoundary from '../components/ErrorBoundary';
import { initGlobalErrorHandler } from '../utils/global-error-handler.js';

// 初始化全局错误处理
initGlobalErrorHandler();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary minimal windowName="划词翻译">
      <SelectionTranslator />
    </ErrorBoundary>
  </React.StrictMode>
);
