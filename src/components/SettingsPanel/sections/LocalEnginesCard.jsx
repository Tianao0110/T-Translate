// Every local engine on one card: the GPU switch, then a row per engine with
// what it runs on (electron/ipc/gpu.js) and how its host is doing
// (electron/tengine). Both tables come from the same engine registry, so the
// rows line up by id. Enabling the GPU runs the engines' self-tests. While the
// card is open the host snapshot is read every second, for the working mark.

import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Switch } from './shared.jsx';

const STATUS_POLL_MS = 1000;

const LocalEnginesCard = ({ notify, confirm }) => {
  const { t } = useTranslation();

  const [gpu, setGpu] = useState(null); // { enabled, engines, supported, last }
  const [gpuBusy, setGpuBusy] = useState(false);
  const loadGpu = useCallback(async () => {
    try {
      const info = await window.electron?.gpu?.status?.();
      if (info) setGpu(info);
    } catch {
      // no bridge (older preload) — the GPU parts stay hidden
    }
  }, []);
  useEffect(() => {
    loadGpu();
  }, [loadGpu]);

  // Host snapshot, refreshed on engine events.
  const [engines, setEngines] = useState(null);
  const loadEngines = useCallback(async () => {
    try {
      const s = await window.electron?.tengine?.status?.();
      if (s?.engines) setEngines(s.engines);
    } catch {
      // older preload — the status column stays empty
    }
  }, []);
  useEffect(() => {
    loadEngines();
    const off = window.electron?.tengine?.onEvent?.(() => loadEngines());
    const timer = setInterval(loadEngines, STATUS_POLL_MS);
    return () => {
      off?.();
      clearInterval(timer);
    };
  }, [loadEngines]);

  const toggleGpu = async (next) => {
    if (gpuBusy) return;
    if (next && !(await confirm(t('llm.gpu.confirm')))) return;
    setGpuBusy(true);
    try {
      const result = await window.electron?.gpu?.setEnabled?.(next);
      if (result?.success) {
        notify(t(next ? 'llm.gpu.enabled' : 'llm.gpu.disabled'), 'success');
      } else {
        const reason = (result?.engines || []).map((e) => e.state?.fallback).find(Boolean) || '';
        notify(t('llm.gpu.failed', { reason }), 'warning');
      }
    } finally {
      setGpuBusy(false);
      loadGpu();
      loadEngines();
    }
  };

  // What it runs on right now, or why it never takes the GPU.
  const deviceBadge = (e) => {
    if (!e.gpu) return { cls: '', text: t('llm.gpu.state.cpu'), note: t(`llm.gpu.reasons.${e.reason}`) };
    if (e.state?.provider === 'webgpu') return { cls: 'installed', text: t(e.backend === 'vulkan' ? 'llm.gpu.state.gpuVulkan' : 'llm.gpu.state.gpu') };
    if (e.state?.fallback) return { cls: 'unavailable', text: t('llm.gpu.state.fallback', { reason: e.state.fallback }) };
    if (e.state?.pending) return { cls: '', text: t('llm.gpu.state.pending') };
    return { cls: '', text: t('llm.gpu.state.cpu') };
  };

  // Is the host up (the working mark stands in for it), what the last
  // self-test said, recent crashes.
  const hostLine = (e) => {
    const parts = [];
    const host = e.host || null;
    if (host?.backoffUntil) parts.push(t('llm.tengine.backoff'));
    else if (!e.working) parts.push(host?.running ? (host.ready ? t('llm.tengine.ready') : t('llm.tengine.running')) : t('llm.tengine.idle'));
    if (e.lastHealth) {
      parts.push(e.lastHealth.ok
        ? `${t('llm.tengine.healthOk')}${e.lastHealth.tokPerSec ? ` · ${t('llm.tengine.speed', { n: e.lastHealth.tokPerSec })}` : ''}`
        : t('llm.tengine.healthFail', { reason: e.lastHealth.fallback || e.lastHealth.code || '' }));
    }
    if (host?.crashesInWindow) parts.push(t('llm.tengine.crashes', { n: host.crashesInWindow }));
    return parts.join(' · ');
  };

  const showGpu = !!gpu?.supported;
  const gpuById = new Map((showGpu ? gpu.engines || [] : []).map((e) => [e.id, e]));
  const hostById = new Map((engines || []).map((e) => [e.id, e]));
  const ids = [...new Set([...gpuById.keys(), ...hostById.keys()])];
  if (!showGpu && ids.length === 0) return null;

  return (
    <div className="setting-group wide">
      <label className="setting-label">{t('llm.tengine.title')}</label>
      <div className={`storage-grid engines-grid ${showGpu ? 'with-device' : ''}`.trim()}>
        {showGpu && (
          <>
            <span className="storage-label">{t('llm.gpu.switchLabel')}</span>
            <span className="storage-value engines-span">
              <Switch checked={!!gpu.enabled} onChange={toggleGpu} disabled={gpuBusy} label="" />
              {gpuBusy && <span className="engine-badge">{t('llm.gpu.testing')}</span>}
            </span>
          </>
        )}
        {ids.map((id) => {
          const g = gpuById.get(id);
          const h = hostById.get(id);
          const d = g ? deviceBadge(g) : null;
          return (
            <React.Fragment key={id}>
              <span className="storage-label">{t(`llm.gpu.engineNames.${id}`)}</span>
              {showGpu && (
                <span className="storage-value">
                  {d && <span className={`engine-badge ${d.cls}`}>{d.text}</span>}
                </span>
              )}
              <span className="storage-value">
                {h?.working && <span className="engine-working">{t('llm.tengine.working')}</span>}
                {h?.working && hostLine(h) ? ' · ' : ''}
                {h ? hostLine(h) : ''}
              </span>
              {d?.note && <span className="engines-span engines-note">{d.note}</span>}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};

export default LocalEnginesCard;
