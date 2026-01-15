// src/windows/selection-entry.jsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import SelectionTranslator from '../components/SelectionTranslator';
// CSS 已在 SelectionTranslator 组件内部导入

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <SelectionTranslator />
  </React.StrictMode>
);
