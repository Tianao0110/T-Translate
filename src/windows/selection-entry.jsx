// src/windows/selection-entry.jsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import SelectionTranslator from '../components/SelectionTranslator';
import '../styles/selection.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <SelectionTranslator />
  </React.StrictMode>
);
