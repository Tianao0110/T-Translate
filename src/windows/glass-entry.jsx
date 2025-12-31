// src/windows/glass-entry.jsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import GlassTranslator from '../components/GlassTranslator';
import '../styles/glass.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <GlassTranslator />
  </React.StrictMode>
);
