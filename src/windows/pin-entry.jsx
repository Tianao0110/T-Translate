import React from 'react';
import ReactDOM from 'react-dom/client';
import PinWindow, { closePinWindow } from '../components/PinWindow';
import ErrorBoundary from '../components/ErrorBoundary';
import { initGlobalErrorHandler } from '../core/global-error-handler.js';
import '../i18n.js';

initGlobalErrorHandler();

// Close gestures, kept outside React: right-click copies what is shown, Esc
// copies nothing (main side: electron/screenshot/pin-windows.js).
window.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  closePinWindow();
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.electron?.pin?.close?.(null);
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary minimal windowName="Pin">
      <PinWindow />
    </ErrorBoundary>
  </React.StrictMode>
);
