// Pinned screenshot: shows the captured image, recognizes and translates it
// (pipeline.js), then lays the translation over it — block by block over the
// original spots when the engine gave boxes, as one panel otherwise. Text is
// selectable for copying: the translation itself, and a transparent layer of
// the recognized lines over the original. A click switches between
// translation and original; a drag selects on text and moves the window
// elsewhere. The wheel and the window edges zoom the whole pin. Close
// gestures are in windows/pin-entry.jsx (via closePinWindow); the window
// itself is electron/screenshot/pin-windows.js.

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, AlertCircle } from 'lucide-react';
import { recognizeAndTranslate } from './pipeline.js';
import { patchColors } from './patch-colors.js';
import { edgeAt as edgeIn, zoomFromEdge, placeAround } from './zoom.js';
import './styles.css';

const CLICK_SLOP = 3;
const CLICK_DELAY = 250; // ms a click waits to rule out a double-click
const EDGE = 6; // px along the window edge that resize instead of drag
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const ZOOM_PER_WHEEL = 0.0015; // zoom factor = exp(-deltaY * this)
const MIN_SIDE = 16; // px the zoomed pin never goes below
const EDGE_CURSORS = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize' };
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
      className={`pin-patch pin-selectable${clipped ? ' is-clipped' : ''}`}
      title={clipped ? text : undefined}
      style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height, ...colors }}
    >
      <span ref={textRef}>{text}</span>
    </div>
  );
};

// A recognized line as transparent, selectable text over its box, stretched
// to the box width.
const TextLine = ({ text, rect }) => {
  const ref = useRef(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.transform = 'none';
    const natural = el.scrollWidth;
    if (natural > 0) el.style.transform = `scaleX(${rect.width / natural})`;
  }, [text, rect]);

  return (
    <span
      ref={ref}
      className="pin-line pin-selectable"
      style={{ left: rect.x, top: rect.y, height: rect.height, fontSize: rect.height }}
    >
      {text}
    </span>
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
  const clickTimerRef = useRef(0);
  const rootRef = useRef(null);
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  // Last window bounds asked of main (DIP); window.screenX lags behind a burst of wheel steps.
  const boundsRef = useRef(null);
  const [edge, setEdge] = useState(null);

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
    boundsRef.current = { x: window.screenX, y: window.screenY, width: size.width, height: size.height };
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
        return { id: i, bbox: b.bbox, text: b.translatedText, colors: colors[i] || {}, rect: { x, y, width: right - x, height: bottom - y } };
      })
      .filter(Boolean);
  }, [result, size]);

  const lineHeight = result?.lineHeight && size ? result.lineHeight / size.scale : null;

  // Recognized lines in CSS px, each with the block it belongs to (the
  // engine's reading order) and whether a translation patch covers it.
  const lines = useMemo(() => {
    if (result?.mode !== 'blocks' || !size) return [];
    const s = size.scale;
    const patched = new Set((patches || []).map((p) => p.id));
    return result.lines.map((l, i) => {
      const cx = l.bbox.x + l.bbox.width / 2;
      const cy = l.bbox.y + l.bbox.height / 2;
      const block = result.blocks.findIndex(({ bbox: b }) => cx >= b.x && cx <= b.x + b.width && cy >= b.y && cy <= b.y + b.height);
      return {
        id: i,
        text: l.text,
        block: block < 0 ? Infinity : block,
        covered: patched.has(block),
        rect: { x: l.bbox.x / s, y: l.bbox.y / s, width: l.bbox.width / s, height: l.bbox.height / s },
      };
    });
  }, [result, size, patches]);

  // What sits over the image, in reading order so a drag selects that way:
  // block by block, top to bottom inside a block. The original shows every
  // line; the translation shows the patches plus the lines no patch covers.
  const items = useMemo(() => {
    const list = showOriginal
      ? lines.map((l) => ({ kind: 'line', ...l }))
      : [
          ...(patches || []).map((p) => ({ kind: 'patch', block: p.id, ...p })),
          ...lines.filter((l) => !l.covered).map((l) => ({ kind: 'line', ...l })),
        ];
    return list.sort((a, b) => a.block - b.block || a.rect.y - b.rect.y || a.rect.x - b.rect.x);
  }, [lines, patches, showOriginal]);

  // A copy puts one selected item per line: absolutely placed text
  // serializes without breaks.
  useEffect(() => {
    const onCopy = (e) => {
      const sel = window.getSelection();
      if (!sel?.rangeCount || sel.isCollapsed) return;
      const range = sel.getRangeAt(0);
      const parts = [];
      for (const el of document.querySelectorAll('.pin-items > *, .pin-overlay')) {
        if (!range.intersectsNode(el)) continue;
        const part = document.createRange();
        part.selectNodeContents(el);
        if (range.compareBoundaryPoints(Range.START_TO_START, part) > 0) part.setStart(range.startContainer, range.startOffset);
        if (range.compareBoundaryPoints(Range.END_TO_END, part) < 0) part.setEnd(range.endContainer, range.endOffset);
        const text = part.toString();
        if (text) parts.push(text);
      }
      if (!parts.length) return;
      e.clipboardData.setData('text/plain', parts.join('\n'));
      e.preventDefault();
    };
    document.addEventListener('copy', onCopy);
    return () => document.removeEventListener('copy', onCopy);
  }, []);

  useEffect(() => () => clearTimeout(clickTimerRef.current), []);

  const zoomLimits = () => {
    const minSide = Math.min(size.width, size.height);
    return [Math.max(MIN_ZOOM, MIN_SIDE / minSide), MAX_ZOOM];
  };

  // New zoom with the window placed so the anchor (window CSS px, or a fixed
  // corner) stays put; main resizes the window to match.
  const applyZoom = (next, place) => {
    const [lo, hi] = zoomLimits();
    const z = Math.min(hi, Math.max(lo, next));
    const width = size.width * z;
    const height = size.height * z;
    const { x, y } = place(width, height, z);
    zoomRef.current = z;
    setZoom(z);
    boundsRef.current = { x, y, width, height };
    window.electron?.pin?.setBounds?.(Math.round(x), Math.round(y), Math.round(width), Math.round(height));
  };

  // Wheel zooms around the pointer.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !size) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      const b = boundsRef.current;
      if (!b) return;
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      const z = zoomRef.current;
      const k = Math.exp(-delta * ZOOM_PER_WHEEL);
      applyZoom(z * k, (w, h, next) => placeAround(b, e.clientX, e.clientY, next / z));
    };
    root.addEventListener('wheel', onWheel, { passive: false });
    return () => root.removeEventListener('wheel', onWheel);
  });

  // Which window edge (or corner) a point is on, if any.
  const edgeAt = (x, y) => {
    if (!size) return null;
    return edgeIn(x, y, size.width * zoomRef.current, size.height * zoomRef.current, EDGE) || null;
  };

  const handleHover = (e) => {
    if (e.buttons) return;
    const next = edgeAt(e.clientX, e.clientY);
    if (next !== edge) setEdge(next);
  };

  // Edge drag: aspect-locked zoom with the opposite side or corner fixed.
  const startResize = (e, side) => {
    e.preventDefault();
    const start = { ...boundsRef.current };
    const startX = e.screenX;
    const startY = e.screenY;
    let pending = null;
    let raf = 0;
    const onMove = (ev) => {
      pending = { dx: ev.screenX - startX, dy: ev.screenY - startY };
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const { zoom: next, place } = zoomFromEdge(side, start, pending.dx, pending.dy, size);
        applyZoom(next, place);
      });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (raf) cancelAnimationFrame(raf);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  useEffect(() => {
    frameEl = frameRef.current;
    copyTarget = result && !result.error && !showOriginal ? 'view' : 'image';
  }, [result, showOriginal, size]);

  // A press that stays within CLICK_SLOP is a click: it switches the view
  // after CLICK_DELAY unless a second press follows. Past the slop, a press on
  // text selects (native) and anywhere else the window follows the pointer
  // (DIP, like setBounds).
  const handleMouseDown = (e) => {
    if (e.button !== 0) return;
    // Presses on the overlay's scrollbar scroll.
    if (e.target.classList?.contains('pin-overlay') && e.nativeEvent.offsetX >= e.target.clientWidth) return;
    clearTimeout(clickTimerRef.current);
    // Second press of a double-click: no word selection, no view switch.
    if (e.detail >= 2) {
      e.preventDefault();
      return;
    }
    const side = edgeAt(e.clientX, e.clientY);
    if (side && boundsRef.current) {
      startResize(e, side);
      return;
    }
    const onText = !!e.target.closest?.('.pin-selectable');
    if (!onText) e.preventDefault();

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
      if (onText) return;
      pending = { x: ev.screenX - offsetX, y: ev.screenY - offsetY };
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (boundsRef.current) Object.assign(boundsRef.current, pending);
        window.electron?.pin?.moveTo?.(pending.x, pending.y);
      });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (raf) cancelAnimationFrame(raf);
      if (!dragging && result) {
        clickTimerRef.current = setTimeout(() => setShowOriginal((v) => !v), CLICK_DELAY);
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const sizeStyle = size
    ? { width: size.width, height: size.height, transform: `scale(${zoom})`, '--pin-zoom': zoom }
    : { visibility: 'hidden' };

  return (
    <div
      ref={rootRef}
      className={`pin-root${edge ? ' is-edge' : ''}`}
      data-theme={theme}
      style={edge ? { cursor: EDGE_CURSORS[edge] } : undefined}
      onMouseDown={handleMouseDown}
      onMouseMove={handleHover}
      onMouseLeave={() => setEdge(null)}
    >
      {image && (
        <div className="pin-frame" ref={frameRef} style={sizeStyle}>
          <img ref={imgRef} className="pin-image" src={image} alt="" draggable={false} onLoad={handleLoad} />
          {items.length > 0 && (
            <div className="pin-items">
              {items.map((it) => (it.kind === 'patch'
                ? <Patch key={`p${it.id}`} text={it.text} rect={it.rect} colors={it.colors} lineHeight={lineHeight} />
                : <TextLine key={`l${it.id}`} text={it.text} rect={it.rect} />
              ))}
            </div>
          )}
          {result && result.mode !== 'blocks' && !showOriginal && (
            <div className={`pin-overlay${result.error ? ' is-error' : ' pin-selectable'}`}>
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
