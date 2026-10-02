// Pinned screenshot: shows the captured image, recognizes and translates it
// (pipeline.js), then lays the translation over it — block by block over the
// original spots when the engine gave boxes, as one panel otherwise. A click
// switches between translation and original, a drag moves the window. Close
// gestures are in windows/pin-entry.jsx (via closePinWindow); the window
// itself is electron/screenshot/pin-windows.js.

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, AlertCircle } from 'lucide-react';
import { recognizeAndTranslate } from './pipeline.js';
import { patchColors } from './patch-colors.js';
import './styles.css';

const CLICK_SLOP = 3;
const PATCH_PAD = 2; // CSS px a patch reaches past its OCR box
const COLOR_BAND = 3; // source px sampled around a box for its background
const MIN_FONT = 8;
const FONT_TO_LINE = 0.85;

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

// Background / text color per block, sampled from the loaded image.
function sampleColors(img, blocks) {
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  return blocks.map(({ bbox }) => {
    const x0 = Math.max(0, Math.floor(bbox.x) - COLOR_BAND);
    const y0 = Math.max(0, Math.floor(bbox.y) - COLOR_BAND);
    const x1 = Math.min(canvas.width, Math.ceil(bbox.x + bbox.width) + COLOR_BAND);
    const y1 = Math.min(canvas.height, Math.ceil(bbox.y + bbox.height) + COLOR_BAND);
    if (x1 <= x0 || y1 <= y0) return null;
    const region = ctx.getImageData(x0, y0, x1 - x0, y1 - y0);
    return patchColors(region, {
      x: Math.floor(bbox.x) - x0,
      y: Math.floor(bbox.y) - y0,
      width: Math.ceil(bbox.width),
      height: Math.ceil(bbox.height),
    });
  });
}

// One translated block over its source box: the largest font up to the
// source line height that fits. It never leaves its box; what MIN_FONT
// cannot fit is clipped and shown in full on hover.
const Patch = ({ text, rect, colors, lineHeight }) => {
  const boxRef = useRef(null);
  const textRef = useRef(null);
  const [clipped, setClipped] = useState(false);

  useLayoutEffect(() => {
    const box = boxRef.current;
    const span = textRef.current;
    if (!box || !span) return;
    const maxFont = Math.max(MIN_FONT, Math.min(rect.height, lineHeight || rect.height) * FONT_TO_LINE);
    const fits = (size) => {
      span.style.fontSize = `${size}px`;
      return span.offsetHeight <= box.clientHeight && span.scrollWidth <= box.clientWidth;
    };
    if (fits(maxFont)) return;
    let lo = MIN_FONT;
    let hi = maxFont;
    while (hi - lo > 0.25) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) lo = mid;
      else hi = mid;
    }
    setClipped(!fits(lo));
  }, [text, rect, lineHeight]);

  return (
    <div
      ref={boxRef}
      className={`pin-patch${clipped ? ' is-clipped' : ''}`}
      title={clipped ? text : undefined}
      style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height, ...colors }}
    >
      <span ref={textRef}>{text}</span>
    </div>
  );
};

const PinWindow = () => {
  const { t } = useTranslation();
  const [image, setImage] = useState(null);
  // CSS size of the image at one image pixel per device pixel, plus the scale used.
  const [size, setSize] = useState(null);
  const [theme, setTheme] = useState('light');
  // null while recognizing / translating; then the pipeline result.
  const [result, setResult] = useState(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const initRef = useRef(null);
  const startedRef = useRef(false);
  const frameRef = useRef(null);
  const imgRef = useRef(null);

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

  const handleLoad = (e) => {
    const img = e.currentTarget;
    const scale = window.devicePixelRatio || 1;
    setSize({ width: img.naturalWidth / scale, height: img.naturalHeight / scale, scale });
  };

  // Once painted: show the window, then recognize + translate (once).
  useEffect(() => {
    if (!size || !image || startedRef.current) return;
    startedRef.current = true;
    window.electron?.pin?.ready?.();
    const frame = { width: size.width * size.scale, height: size.height * size.scale };
    recognizeAndTranslate(image, initRef.current || {}, frame).then((r) => {
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

  // Patch geometry in CSS px, colors from the image.
  const patches = useMemo(() => {
    if (result?.mode !== 'blocks' || !size || !imgRef.current) return null;
    const colors = sampleColors(imgRef.current, result.blocks);
    const s = size.scale;
    return result.blocks
      .map((b, i) => {
        // Untranslated blocks keep the original pixels.
        if (!b.translatedText || b.passthrough) return null;
        const x = Math.max(0, b.bbox.x / s - PATCH_PAD);
        const y = Math.max(0, b.bbox.y / s - PATCH_PAD);
        const right = Math.min(size.width, (b.bbox.x + b.bbox.width) / s + PATCH_PAD);
        const bottom = Math.min(size.height, (b.bbox.y + b.bbox.height) / s + PATCH_PAD);
        return { id: i, text: b.translatedText, colors: colors[i] || {}, rect: { x, y, width: right - x, height: bottom - y } };
      })
      .filter(Boolean);
  }, [result, size]);

  const lineHeight = result?.lineHeight && size ? result.lineHeight / size.scale : null;

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

  const sizeStyle = size ? { width: size.width, height: size.height } : { visibility: 'hidden' };

  return (
    <div className="pin-root" data-theme={theme} onMouseDown={handleMouseDown}>
      {image && (
        <div className="pin-frame" ref={frameRef} style={sizeStyle}>
          <img ref={imgRef} className="pin-image" src={image} alt="" draggable={false} onLoad={handleLoad} />
          {patches && (
            <div className={`pin-patches${showOriginal ? ' is-hidden' : ''}`}>
              {patches.map((p) => (
                <Patch key={p.id} text={p.text} rect={p.rect} colors={p.colors} lineHeight={lineHeight} />
              ))}
            </div>
          )}
          {result && result.mode !== 'blocks' && !showOriginal && (
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
