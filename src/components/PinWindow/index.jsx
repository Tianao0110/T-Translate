// Pinned screenshot: shows the captured image, recognizes and translates it
// (pipeline.js), then lays the translation over it. A click switches between
// translation and original, a drag moves the window. Close gestures are in
// windows/pin-entry.jsx (via closePinWindow); the window itself is
// electron/screenshot/pin-windows.js.

import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, AlertCircle } from 'lucide-react';
import { recognizeAndTranslate } from './pipeline.js';
import './styles.css';

const CLICK_SLOP = 3;

// What a right-click copies: the captured image, or the frame as shown.
let copyTarget = 'image';
let frameEl = null;

export function closePinWindow() {
  if (copyTarget !== 'view' || !frameEl) {
    window.electron?.pin?.close?.('image');
    return;
  }
  const r = frameEl.getBoundingClientRect();
  const rect = { x: 0, y: 0, width: Math.round(r.width), height: Math.round(r.height) };
  // The ring and badges stay out of the copy.
  document.documentElement.classList.add('pin-capturing');
  requestAnimationFrame(() => requestAnimationFrame(() => window.electron?.pin?.close?.('view', rect)));
}

const PinWindow = () => {
  const { t } = useTranslation();
  const [image, setImage] = useState(null);
  const [size, setSize] = useState(null);
  const [theme, setTheme] = useState('light');
  // null while recognizing / translating; then the pipeline result.
  const [result, setResult] = useState(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const initRef = useRef(null);
  const startedRef = useRef(false);
  const frameRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    window.electron?.pin?.getInit?.().then((init) => {
      if (cancelled || !init) return;
      initRef.current = init;
      setTheme(init.theme || 'light');
      setImage(init.image);
    });
    const unsubscribeTheme = window.electron?.theme?.onChanged?.((next) => setTheme(next));
    return () => {
      cancelled = true;
      unsubscribeTheme?.();
    };
  }, []);

  // One image pixel per device pixel at the capture's scale.
  const handleLoad = (e) => {
    const img = e.currentTarget;
    const dpr = window.devicePixelRatio || 1;
    setSize({ width: img.naturalWidth / dpr, height: img.naturalHeight / dpr });
  };

  // Once painted: show the window, then recognize + translate (once).
  useEffect(() => {
    if (!size || !image || startedRef.current) return;
    startedRef.current = true;
    window.electron?.pin?.ready?.();
    recognizeAndTranslate(image, initRef.current || {}).then((r) => {
      setResult(r);
      setShowOriginal(!!r.error);
      if (!r.error && !r.passthrough) {
        window.electron?.pin?.addToHistory?.({
          source: r.sourceText,
          result: r.translatedText,
          sourceLanguage: r.sourceLanguage,
          targetLanguage: r.targetLanguage,
          timestamp: Date.now(),
          from: 'screenshot',
        });
      }
    });
  }, [size, image]);

  useEffect(() => {
    frameEl = frameRef.current;
    copyTarget = result && !result.error && !showOriginal ? 'view' : 'image';
  }, [result, showOriginal, size]);

  // A press that stays within CLICK_SLOP switches the view; past it, the
  // window follows the pointer (DIP, like setBounds).
  const handleMouseDown = (e) => {
    if (e.button !== 0) return;
    // Presses on the overlay's scrollbar scroll.
    if (e.target.classList?.contains('pin-overlay') && e.nativeEvent.offsetX >= e.target.clientWidth) return;
    e.preventDefault();

    const startX = e.screenX;
    const startY = e.screenY;
    const offsetX = e.screenX - window.screenX;
    const offsetY = e.screenY - window.screenY;

    let dragging = false;
    let pending = null;
    let raf = 0;
    const onMove = (ev) => {
      if (!dragging && Math.hypot(ev.screenX - startX, ev.screenY - startY) <= CLICK_SLOP) return;
      dragging = true;
      pending = { x: ev.screenX - offsetX, y: ev.screenY - offsetY };
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        window.electron?.pin?.moveTo?.(pending.x, pending.y);
      });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (raf) cancelAnimationFrame(raf);
      if (!dragging && result) setShowOriginal((v) => !v);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div className="pin-root" data-theme={theme} onMouseDown={handleMouseDown}>
      {image && (
        <div className="pin-frame" ref={frameRef} style={size || { visibility: 'hidden' }}>
          <img className="pin-image" src={image} alt="" draggable={false} onLoad={handleLoad} />
          {result && !showOriginal && (
            <div className={`pin-overlay${result.error ? ' is-error' : ''}`}>
              {result.error || result.translatedText}
            </div>
          )}
          {!result && (
            <span className="pin-badge" title={t('pin.working')}>
              <Loader2 size={12} className="pin-spin" />
            </span>
          )}
          {result?.error && showOriginal && (
            <span className="pin-badge is-error" title={result.error}>
              <AlertCircle size={12} />
            </span>
          )}
        </div>
      )}
    </div>
  );
};

export default PinWindow;
