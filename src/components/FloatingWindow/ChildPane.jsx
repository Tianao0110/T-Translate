// Single OCR text block's translation overlay. Drag to move, double-click to
// promote into an independent BrowserWindow (handled by parent's onFreeze).

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Copy, Check, Loader2 } from 'lucide-react';
import { CHILD_PANE_STATUS } from '../../stores/session.js';

const ChildPane = ({
  pane,
  parentBounds,
  onPositionChange,
  onFreeze,
  onClose,
  theme = 'light',
}) => {
  const { t } = useTranslation();
  const [isDragging, setIsDragging] = useState(false);
  const [renderPos, setRenderPos] = useState({ x: 0, y: 0 });
  const [copied, setCopied] = useState(false);
  const [showControls, setShowControls] = useState(false);

  const paneRef = useRef(null);
  const controlsTimerRef = useRef(null);

  // Mirrors of drag state — global mousemove/mouseup handlers close over
  // these via ref, which avoids stale state when React batches updates
  const dragStateRef = useRef({
    isDragging: false,
    startX: 0,
    startY: 0,
    offsetX: 0,
    offsetY: 0,
    currentX: 0,
    currentY: 0,
  });

  const { id, sourceText, translatedText, bbox, status, isFrozen, error } = pane;

  const handleDoubleClick = useCallback((e) => {
    // Only finished translations can be promoted; already-frozen ones are ignored
    if (status !== CHILD_PANE_STATUS.DONE) return;
    if (isFrozen) return;

    e.preventDefault();
    e.stopPropagation();

    const rect = paneRef.current?.getBoundingClientRect();
    if (!rect) return;

    onFreeze?.(id, { viewportX: rect.left, viewportY: rect.top });
  }, [id, status, isFrozen, onFreeze]);

  const handleMouseDown = useCallback((e) => {
    // Clicks on toolbar buttons shouldn't start a drag
    if (e.target.closest('.child-pane-btn')) return;

    e.preventDefault();
    e.stopPropagation();

    const rect = paneRef.current?.getBoundingClientRect();
    if (!rect) return;

    dragStateRef.current = {
      isDragging: true,
      startX: e.clientX,
      startY: e.clientY,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      currentX: rect.left,
      currentY: rect.top,
    };

    setRenderPos({ x: rect.left, y: rect.top });
    setIsDragging(true);
  }, []);

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!dragStateRef.current.isDragging) return;

      let newX = e.clientX - dragStateRef.current.offsetX;
      let newY = e.clientY - dragStateRef.current.offsetY;

      // Web content can't render outside the BrowserWindow — clamp to the
      // viewport so panes can't be "lost" past an edge. Double-click detach
      // is the way to move a pane out of the window.
      const rect = paneRef.current?.getBoundingClientRect();
      const maxX = window.innerWidth - (rect?.width ?? 80);
      const maxY = window.innerHeight - (rect?.height ?? 32);
      newX = Math.min(Math.max(newX, 0), Math.max(maxX, 0));
      newY = Math.min(Math.max(newY, 0), Math.max(maxY, 0));

      dragStateRef.current.currentX = newX;
      dragStateRef.current.currentY = newY;

      setRenderPos({ x: newX, y: newY });
    };

    const handleMouseUp = () => {
      if (!dragStateRef.current.isDragging) return;

      const finalX = dragStateRef.current.currentX;
      const finalY = dragStateRef.current.currentY;

      dragStateRef.current.isDragging = false;
      setIsDragging(false);

      // Coordinate convention differs by state: un-frozen panes store
      // parent-relative coords; frozen panes store viewport coords (they're
      // detached from the parent layout)
      if (!isFrozen && parentBounds) {
        const relativeX = finalX - parentBounds.x;
        const relativeY = finalY - parentBounds.y;
        onPositionChange?.(id, { x: relativeX, y: relativeY });
      } else if (isFrozen) {
        onPositionChange?.(id, { x: finalX, y: finalY });
      }
    };

    // Listen unconditionally; dragStateRef gates whether we react
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [id, isFrozen, parentBounds, onPositionChange]);

  const handleCopy = useCallback((e) => {
    e.stopPropagation();
    if (!translatedText) return;

    navigator.clipboard?.writeText(translatedText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [translatedText]);

  const handleMouseEnter = useCallback(() => {
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    setShowControls(true);
  }, []);

  const handleMouseLeave = useCallback(() => {
    controlsTimerRef.current = setTimeout(() => setShowControls(false), 300);
  }, []);

  useEffect(() => {
    return () => {
      if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    };
  }, []);

  const [fixedSize, setFixedSize] = useState(null);

  // Lock dimensions once translation completes — prevents layout shift if the
  // user later hovers, and stops the pane from flickering when content updates
  useEffect(() => {
    if (status === CHILD_PANE_STATUS.DONE && !fixedSize && paneRef.current) {
      const rect = paneRef.current.getBoundingClientRect();
      setFixedSize({
        width: rect.width,
        height: rect.height,
      });
    }
  }, [status, fixedSize]);

  const paneStyle = {
    // Frozen panes need `fixed` (viewport coords); regular panes use `absolute` (parent-relative)
    position: isDragging ? 'fixed' : (isFrozen ? 'fixed' : 'absolute'),
    left: isDragging ? `${renderPos.x}px` : `${bbox.x}px`,
    top: isDragging ? `${renderPos.y}px` : `${bbox.y}px`,
    ...(fixedSize ? {
      width: `${fixedSize.width}px`,
      height: `${fixedSize.height}px`,
    } : {
      minWidth: '80px',
      maxWidth: isFrozen ? '400px' : 'calc(100% - 20px)',
    }),
    // Drag z must beat both frozen and regular; frozen beats regular when stacked
    zIndex: isDragging ? 9999 : (isFrozen ? 1100 : 1050),
  };

  const statusClass = {
    [CHILD_PANE_STATUS.PENDING]: 'pending',
    [CHILD_PANE_STATUS.TRANSLATING]: 'translating',
    [CHILD_PANE_STATUS.DONE]: 'done',
    [CHILD_PANE_STATUS.ERROR]: 'error',
  }[status] || '';

  return (
    <div
      ref={paneRef}
      className={`floating-child-pane ${statusClass} ${isFrozen ? 'frozen' : ''} ${isDragging ? 'dragging' : ''}`}
      style={paneStyle}
      data-theme={theme}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
      title={status === CHILD_PANE_STATUS.DONE && !isFrozen ? t('floatingWindow.doubleClickFreeze', '双击固定为独立窗口') : ''}
    >
      <div className="child-pane-content">
        {status === CHILD_PANE_STATUS.TRANSLATING ? (
          <div className="child-pane-loading">
            <Loader2 className="spin" size={14} />
          </div>
        ) : status === CHILD_PANE_STATUS.ERROR ? (
          <div className="child-pane-error">{error || t('selection.translateFailed', '翻译失败')}</div>
        ) : (
          <div className="child-pane-text">{translatedText || sourceText}</div>
        )}
      </div>

      {showControls && (status === CHILD_PANE_STATUS.DONE || isFrozen) && (
        <div className="child-pane-controls">
          <button
            className="child-pane-btn"
            onClick={handleCopy}
            title={t('selection.copyTarget', '复制译文')}
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
          </button>
          {isFrozen && onClose && (
            <button
              className="child-pane-btn close"
              onClick={(e) => {
                e.stopPropagation();
                onClose(id);
              }}
              title={t('titleBar.close', '关闭')}
            >
              <X size={12} />
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default ChildPane;
