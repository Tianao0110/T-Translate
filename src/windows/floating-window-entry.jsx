import React from 'react';
import ReactDOM from 'react-dom/client';
import FloatingWindow from '../components/FloatingWindow';
import ErrorBoundary from '../components/ErrorBoundary';
import { initGlobalErrorHandler } from '../utils/global-error-handler.js';
import i18n from '../i18n.js';

initGlobalErrorHandler();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary windowName={i18n.t('floatingWindow.title', 'Floating Window')}>
      <FloatingWindow />
    </ErrorBoundary>
  </React.StrictMode>
);
