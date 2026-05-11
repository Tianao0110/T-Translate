import React from 'react';
import ReactDOM from 'react-dom/client';
import SelectionTranslator from '../components/SelectionTranslator';
import ErrorBoundary from '../components/ErrorBoundary';
import { initGlobalErrorHandler } from '../utils/global-error-handler.js';

initGlobalErrorHandler();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary minimal windowName="Selection Translator">
      <SelectionTranslator />
    </ErrorBoundary>
  </React.StrictMode>
);
