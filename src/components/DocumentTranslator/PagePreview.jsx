// Original-page preview for PDF documents: renders one page of the source
// file and outlines the located segment (segment.loc from the PDF parser).
// Opened from a segment's locate button in the document panel (index.jsx).

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, X, Loader } from 'lucide-react';
import { openPdf, clampedPdfScale } from '../../document/document-parser.js';

// A loc box ([left, top, right, bottom] as page fractions) → overlay position.
export function highlightStyle([left, top, right, bottom]) {
  const pct = (value) => `${(value * 100).toFixed(2)}%`;
  return { left: pct(left), top: pct(top), width: pct(right - left), height: pct(bottom - top) };
}

const PagePreview = ({ file, password, target, onClose }) => {
  const { t } = useTranslation();
  const [pdf, setPdf] = useState(null);
  const [status, setStatus] = useState('loading');
  const [page, setPage] = useState(target?.page || 1);
  const [drawn, setDrawn] = useState(0);
  const bodyRef = useRef(null);
  const canvasRef = useRef(null);
  const stageRef = useRef(null);

  // One open per file, released when the panel closes or the file changes.
  useEffect(() => {
    let alive = true;
    let doc = null;
    setStatus('loading');
    setPdf(null);
    openPdf(file, password)
      .then((opened) => {
        doc = opened;
        if (!alive) return opened.destroy();
        setPdf(opened);
        setStatus('ready');
      })
      .catch(() => { if (alive) setStatus('failed'); });
    return () => {
      alive = false;
      doc?.destroy();
    };
  }, [file, password]);

  useEffect(() => {
    if (target?.page) setPage(target.page);
  }, [target]);

  // Draw the current page at the panel's width.
  useEffect(() => {
    if (!pdf) return undefined;
    let cancelled = false;
    let task = null;
    (async () => {
      const current = await pdf.getPage(Math.min(Math.max(1, page), pdf.numPages));
      if (cancelled) return;
      const base = current.getViewport({ scale: 1 });
      const width = bodyRef.current?.clientWidth || 400;
      const desired = (width / base.width) * (window.devicePixelRatio || 1);
      const viewport = current.getViewport({ scale: clampedPdfScale(base.width, base.height, desired) });
      const canvas = canvasRef.current;
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      task = current.render({ canvasContext: canvas.getContext('2d'), viewport });
      await task.promise;
      if (!cancelled) setDrawn(page);
    })().catch(() => { /* cancelled by a newer page */ });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [pdf, page]);

  // Scroll the outline into view once its page is on screen.
  useEffect(() => {
    if (!target || drawn !== target.page) return;
    stageRef.current?.querySelector('.pp-highlight')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [drawn, target]);

  const boxes = drawn === page ? (target?.loc || []).filter((part) => part.page === page && part.box) : [];
  const total = pdf?.numPages || 0;

  return (
    <div className="dt-page-preview">
      <div className="pp-header">
        <span className="pp-title">{t('documentTranslator.preview.title')}</span>
        {total > 0 && <span className="pp-page">{t('documentTranslator.preview.page', { page, total })}</span>}
        <div className="pp-actions">
          <button className="pp-btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} title={t('documentTranslator.preview.prev')}>
            <ChevronLeft size={14} />
          </button>
          <button className="pp-btn" disabled={!total || page >= total} onClick={() => setPage((p) => p + 1)} title={t('documentTranslator.preview.next')}>
            <ChevronRight size={14} />
          </button>
          <button className="pp-btn" onClick={onClose} title={t('documentTranslator.preview.close')}>
            <X size={14} />
          </button>
        </div>
      </div>
      <div className="pp-body" ref={bodyRef}>
        {status === 'loading' && <div className="pp-status"><Loader size={16} className="spinning" /></div>}
        {status === 'failed' && <div className="pp-status">{t('documentTranslator.preview.failed')}</div>}
        <div className="pp-stage" ref={stageRef} hidden={status !== 'ready'}>
          <canvas ref={canvasRef} />
          {boxes.map((part, i) => <div key={i} className="pp-highlight" style={highlightStyle(part.box)} />)}
        </div>
      </div>
    </div>
  );
};

export default PagePreview;
