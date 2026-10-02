import React from 'react';
import ReactDOM from 'react-dom/client';
import PinWindow from '../components/PinWindow';
import ErrorBoundary from '../components/ErrorBoundary';
import { initGlobalErrorHandler } from '../core/global-error-handler.js';

initGlobalErrorHandler();

// Close gestures, kept outside React: right-click copies the image, Esc does
// not (main side: electron/screenshot/pin-windows.js).
window.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  window.electron?.pin?.close?.(true);
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.electron?.pin?.close?.(false);
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary minimal windowName="Pin">
      <PinWindow />
    </ErrorBoundary>
  </React.StrictMode>
);
