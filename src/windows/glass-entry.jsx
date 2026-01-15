// src/windows/glass-entry.jsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import GlassTranslator from '../components/GlassTranslator';
// CSS 已在 GlassTranslator 组件内部导入

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <GlassTranslator />
  </React.StrictMode>
);
