// The local model's runtime block inside the built-in provider's card on
// the providers page: backend, residency, speed, and the self-test /
// unload buttons, laid out with the card's own form classes so it sits
// like any other provider's fields. Self-contained: needs only notify.

import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, Cpu, Zap } from 'lucide-react';

const SLOW_TOK_PER_SEC = 8;
const valueStyle = { fontSize: 13, color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 6 };

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
      <div className="ps-field">
        <label className="ps-label">{t('llm.run.backend')}</label>
        <span style={valueStyle}>{status.provider === 'gpu' ? <Zap size={13} /> : <Cpu size={13} />}{backendText()}</span>
      </div>
      <div className="ps-field">
        <label className="ps-label">{t('llm.run.state')}</label>
        <span style={valueStyle}>{status.resident ? t('llm.run.loaded', { file: status.resident.file }) : t('llm.run.idle')}</span>
      </div>
      <div className="ps-field">
        <label className="ps-label">{t('llm.run.speed')}</label>
        <span style={valueStyle}>
          {speed === null ? t('llm.run.speedUnknown') : t('llm.run.speedValue', { n: speed })}
          {speed !== null && speed < SLOW_TOK_PER_SEC && <span className="engine-badge unavailable">{t('llm.run.slowHint')}</span>}
        </span>
      </div>
      <div className="ps-field" style={{ flexDirection: 'row', gap: 8 }}>
        <button className="btn-small" onClick={selfTest} disabled={busy !== null || !installed}>
          {busy === 'test' ? <><RefreshCw size={12} className="spinning" /> {t('llm.run.testing')}</> : t('llm.run.selfTest')}
        </button>
        <button className="btn-small uninstall" onClick={unload} disabled={busy !== null || !status.resident}>
          {t('llm.run.unload')}
        </button>
      </div>
    </div>
  );
};

export default LlmRuntimeCard;
