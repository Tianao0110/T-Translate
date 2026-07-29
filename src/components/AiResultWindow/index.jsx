// Standalone window holding one AI action result. Deliberately read-only: the
// content is a snapshot taken when the action ran, so a later translation in
// the card that spawned it never rewrites what the user is reading.

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Check, X } from 'lucide-react';
import createLogger from '../../utils/logger.js';
import './styles.css';

const logger = createLogger('AiResultWindow');

const AiResultWindow = () => {
  const { t } = useTranslation();
  const [payload, setPayload] = useState(null);
  const [theme, setTheme] = useState('light');
  const [copied, setCopied] = useState(false);

  const rootRef = useRef(null);
  const contentRef = useRef(null);
  const bodyRef = useRef(null);

  const windowId = new URLSearchParams(window.location.search).get('id') || '';

  useEffect(() => {
    let cancelled = false;
    window.electron?.aiResult?.getPayload?.(windowId)
      .then((data) => {
        if (cancelled || !data) return;
        setPayload(data);
        if (data.theme) setTheme(data.theme);
      })
      .catch((e) => logger.error('Failed to load payload:', e));
    return () => { cancelled = true; };
  }, [windowId]);

  // Theme also arrives with the payload; this keeps an open window in step when
  // the user switches theme while reading.
  useEffect(() => {
    const off = window.electron?.theme?.onChanged?.((next) => setTheme(next));
    return () => { if (off) off(); };
  }, []);

  // The page background lives on <html> so there is no flash of the wrong
  // surface before React mounts.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // The window sizes itself to the text once, after it has been laid out — a
  // fixed box leaves a three-line summary swimming in empty space. Reported
  // once only, so a window the user has resized by hand stays put.
  useEffect(() => {
    if (!payload) return undefined;
    const frame = requestAnimationFrame(() => {
      const root = rootRef.current;
      const content = contentRef.current;
      const body = bodyRef.current;
      if (!root || !content || !body) return;
      // Everything that is not the scrolling area: header, footer, borders.
      const chrome = root.offsetHeight - content.offsetHeight;
      window.electron?.aiResult?.reportHeight?.(windowId, chrome + body.offsetHeight);
    });
    return () => cancelAnimationFrame(frame);
  }, [payload, windowId]);

  const handleClose = useCallback(() => {
    window.electron?.aiResult?.close?.(windowId);
  }, [windowId]);

  const handleCopy = useCallback(() => {
    if (!payload?.content) return;
    window.electron?.clipboard?.writeText?.(payload.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [payload]);

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleClose]);

  return (
    <div className="ai-result-root" data-theme={theme} ref={rootRef}>
      <div className="ai-result-header">
        <span className="ai-result-title">{payload?.title || t('aiActions.resultTitle', 'AI 结果')}</span>
        <div className="ai-result-actions">
          <button
            className={`ai-result-btn ${copied ? 'success' : ''}`}
            onClick={handleCopy}
            disabled={!payload?.content}
            title={t('translation.copy', '复制')}
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </button>
          <button className="ai-result-btn close" onClick={handleClose} title={t('selection.close', '关闭')}>
            <X size={13} />
          </button>
        </div>
      </div>

      <div className="ai-result-content" ref={contentRef}>
        {/* Padding lives on this inner box, not the scroll container, so its
            height is exactly what the window needs to show everything. */}
        <div className="ai-result-body" ref={bodyRef}>
          {payload?.content
            ? <pre className="ai-result-text">{payload.content}</pre>
            : <div className="ai-result-empty">{t('aiActions.emptyResult', 'AI 未返回内容')}</div>}
        </div>
      </div>

      {payload?.provider && (
        <div className="ai-result-footer">
          {t('aiActions.generatedBy', '由 {{provider}} 生成').replace('{{provider}}', payload.provider)}
        </div>
      )}
    </div>
  );
};

export default AiResultWindow;
