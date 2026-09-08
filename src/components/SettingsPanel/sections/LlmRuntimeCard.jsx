// The local model's runtime block inside the built-in provider's card on
// the providers page: backend, residency and speed as the same label/value
// grid the About page uses, plus self-test / unload in the card's own
// button style. Self-contained: needs only notify.

import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, Cpu, Zap, Power } from 'lucide-react';

const SLOW_TOK_PER_SEC = 8;

const LlmRuntimeCard = ({ notify }) => {
  const { t } = useTranslation();
  const bridge = window.electron?.llm;
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(null); // 'test' | 'unload'

  const load = useCallback(async () => {
    try {
      const s = await bridge?.status?.();
      if (s) setStatus(s);
    } catch {
      // no bridge in this window
    }
  }, [bridge]);

  useEffect(() => {
    load();
    const off = window.electron?.tengine?.onEvent?.((evt) => {
      if (evt?.engine === 'llm') load();
    });
    return () => off?.();
  }, [load]);

  const run = async (key, fn) => {
    setBusy(key);
    try {
      await fn();
    } finally {
      setBusy(null);
      load();
    }
  };

  const selfTest = () => run('test', async () => {
    const r = await bridge?.selfTest?.();
    if (r?.pending) notify?.(t('llm.run.testPending'), 'warning');
    else if (r?.success && r.ok) notify?.(t('llm.run.testOk', { n: r.tokPerSec ?? '?' }), 'success');
    else notify?.(t('llm.run.testFail', { reason: r?.fallback || r?.error || '' }), 'warning');
  });

  const unload = () => run('unload', async () => {
    await bridge?.unload?.();
    notify?.(t('llm.run.unloaded'), 'success');
  });

  if (!status?.ready) return null;

  const speed = status.lastHealth?.tokPerSec ?? status.lastRequest?.tokPerSec ?? null;
  const installed = status.selected?.status === 'ready';
  const backendText = () => {
    if (status.resident?.provider === 'gpu') return t('llm.run.gpu', { device: status.resident.device || 'GPU' });
    if (status.provider === 'gpu' && !status.resident) return t('llm.run.gpu', { device: 'Vulkan' });
    return t('llm.run.cpu');
  };

  return (
    <div className="ps-config-form">
      <div className="storage-grid">
        <span className="storage-label">{t('llm.run.backend')}</span>
        <span className="storage-value">{status.provider === 'gpu' ? <Zap size={13} /> : <Cpu size={13} />} {backendText()}</span>
        <span className="storage-label">{t('llm.run.state')}</span>
        <span className="storage-value">{status.resident ? t('llm.run.loaded', { file: status.resident.file }) : t('llm.run.idle')}</span>
        <span className="storage-label">{t('llm.run.speed')}</span>
        <span className="storage-value">
          {speed === null ? t('llm.run.speedUnknown') : t('llm.run.speedValue', { n: speed })}
          {speed !== null && speed < SLOW_TOK_PER_SEC && <span className="engine-badge unavailable" style={{ marginLeft: 6 }}>{t('llm.run.slowHint')}</span>}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="ps-test-btn" onClick={selfTest} disabled={busy !== null || !installed}>
          <RefreshCw size={14} className={busy === 'test' ? 'spinning' : ''} />
          <span>{busy === 'test' ? t('llm.run.testing') : t('llm.run.selfTest')}</span>
        </button>
        <button className="ps-test-btn" onClick={unload} disabled={busy !== null || !status.resident}>
          <Power size={14} />
          <span>{t('llm.run.unload')}</span>
        </button>
      </div>
    </div>
  );
};

export default LlmRuntimeCard;
