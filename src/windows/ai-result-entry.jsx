import React from 'react';
import ReactDOM from 'react-dom/client';
import AiResultWindow from '../components/AiResultWindow';
import ErrorBoundary from '../components/ErrorBoundary';
import { initGlobalErrorHandler } from '../utils/global-error-handler.js';

initGlobalErrorHandler();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary minimal windowName="AI Result">
      <AiResultWindow />
    </ErrorBoundary>
  </React.StrictMode>
);
