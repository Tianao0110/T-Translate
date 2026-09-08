// Local model settings, laid out like the OCR page: a group per concern
// (which model, the model file card, the developer door), all built from
// the panel's existing pieces. The runtime block (backend / residency /
// speed, self-test, unload) lives in the provider's card on the providers
// page (LlmRuntimeCard).

import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, RefreshCw, ExternalLink } from 'lucide-react';
import { Seg, Switch } from './shared';

const GB = 1024 * 1024 * 1024;
const formatSize = (bytes) => (bytes >= GB ? `${(bytes / GB).toFixed(1)} GB` : `${Math.round(bytes / 1048576)} MB`);

const LlmSection = ({ settings, updateSetting, notify }) => {
  const { t } = useTranslation();
  const bridge = window.electron?.llm;
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(null); // 'scan' | 'test' | 'unload' | `probe:${file}` | `report:${file}`
  const [probes, setProbes] = useState({});
  const [reports, setReports] = useState({});

  const load = useCallback(async () => {
    try {
      const s = await bridge?.status?.();
      if (s) setStatus(s);
    } catch {
      // no bridge — the page shows its description only
    }
  }, [bridge]);

  useEffect(() => {
    load();
    const off = window.electron?.tengine?.onEvent?.((evt) => {
      if (evt?.engine === 'llm') load();
    });
    return () => off?.();
  }, [load]);

  const llm = settings.llm || {};
  const packs = status?.packs?.packs || [];
  const selectedId = packs.some((p) => p.id === llm.pack) ? llm.pack : packs[0]?.id;
  const selected = packs.find((p) => p.id === selectedId) || null;
  const unlisted = status?.packs?.unlisted || [];

  const persist = (key, value) => {
    updateSetting('llm', key, value, true);
    window.electron?.store?.set?.(`settings.llm.${key}`, value);
  };

  const choosePack = (id) => {
    if (id === selectedId) return;
    persist('pack', id);
    const p = packs.find((x) => x.id === id);
    notify(t('llm.packChanged', { name: p ? p.name : id }), 'success');
  };

  const run = async (key, fn) => {
    setBusy(key);
    try {
      await fn();
    } finally {
      setBusy(null);
      load();
    }
  };

  const rescan = () => run('scan', async () => {
    const s = await bridge?.rescan?.();
    if (s) setStatus(s);
    notify(t('llm.scanned'), 'success');
  });

  const probe = (file) => run(`probe:${file}`, async () => {
    const r = await bridge?.probe?.(file);
    setProbes((prev) => ({ ...prev, [file]: r?.success ? r.report : { verdict: 'unusable', steps: [], error: r?.error } }));
  });

  const report = (file) => run(`report:${file}`, async () => {
    const r = await bridge?.trialReport?.(file);
    setReports((prev) => ({ ...prev, [file]: r || null }));
  });

  const badge = (row) => {
    if (!row) return null;
    if (status?.scanning || busy === 'scan') {
      return (
        <span className="engine-badge checking">
          <RefreshCw size={11} className="spinning" style={{ marginRight: 3 }} />
          {t('llm.checking')}
        </span>
      );
    }
    if (row.status === 'ready') return <span className="engine-badge installed">{t('llm.installed')}</span>;
    if (row.status === 'mismatch') {
      return (
        <span className="engine-badge error">
          <AlertTriangle size={11} style={{ marginRight: 3 }} />
          {t('llm.mismatch')}
        </span>
      );
    }
    return <span className="engine-badge download">{t('llm.notInstalled')}</span>;
  };

  return (
    <div className="setting-content animate-fade-in">
      <h3>{t('settings.llm.title')}</h3>
      <p className="setting-description">{t('llm.description')}</p>

      {packs.length > 0 && (
        <div className="setting-group">
          <label className="setting-label">{t('llm.modelLabel')}</label>
          <Seg
            size="small"
            value={selectedId}
            onChange={choosePack}
            options={packs.map((p) => ({ value: p.id, label: t('llm.packLabel', { name: p.name, role: p.role === 'mt' ? t('llm.roleMt') : t('llm.roleGeneral') }) }))}
          />
          <p className="setting-hint">{selected?.role === 'mt' ? t('llm.roleMtHint') : t('llm.roleGeneralHint')}</p>
        </div>
      )}

      {selected && (
        <div className="setting-group">
          <label className="setting-label">{t('llm.fileLabel')}</label>
          <div className="ocr-engines-list">
            <div className={`ocr-engine-item ${selected.status === 'ready' ? 'active' : ''}`.trim()}>
              <div className="engine-info">
                <div className="engine-header">
                  <span className="engine-name">{t('llm.engineNameWith', { name: selected.name })}</span>
                  {badge(selected)}
                </div>
                <p className="engine-meta">{t('llm.fileLine', { file: selected.file, size: formatSize(selected.size), license: selected.license?.name || '' })}</p>
                {status?.dir && <p className="engine-meta">{status.dir}</p>}
                {selected.status === 'mismatch' && (
                  <div className="engine-error-box">
                    <AlertTriangle size={14} />
                    <div className="error-content">
                      <p className="error-title">{t('llm.mismatch')}</p>
                      <p className="error-detail">{t('llm.mismatchHint')}</p>
                    </div>
                  </div>
                )}
                {selected.status !== 'ready' && (
                  <>
                    <p className="engine-meta">{t('llm.howTo')}</p>
                    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 6 }}>
                      <button className="link-button" onClick={() => window.electron?.shell?.openExternal?.(selected.source?.url)}>
                        <ExternalLink size={14} /> {t('llm.linkOfficial')}
                      </button>
                      {selected.source?.mirror && (
                        <button className="link-button" onClick={() => window.electron?.shell?.openExternal?.(selected.source.mirror)}>
                          <ExternalLink size={14} /> {t('llm.linkMirror')}
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
              <div className="engine-actions">
                <button className="btn" onClick={() => bridge?.openDir?.()} title={t('llm.openFolder')}>
                  {t('llm.openFolder')}
                </button>
                <button
                  className="btn-small"
                  onClick={rescan}
                  disabled={busy !== null}
                  title={t('llm.rescan')}
                  style={{ marginLeft: 6, padding: '4px 8px' }}
                >
                  <RefreshCw size={12} className={busy === 'scan' || status?.scanning ? 'spinning' : ''} />
                </button>
              </div>
            </div>
          </div>
          <p className="setting-hint">{t('llm.enabledHint')}</p>
        </div>
      )}

      {/* Files outside the whitelist (last year's model included) are always
          listed so the user can see what sits in the folder; probing and
          using them needs the switch. */}
      <div className="setting-group">
        <label className="setting-label">{t('llm.dev.title')}</label>
        <Switch
          checked={!!llm.allowUnlistedModels}
          onChange={(on) => {
            persist('allowUnlistedModels', on);
            load();
          }}
          label={t('llm.dev.allow')}
        />
        <p className="setting-hint">{t('llm.dev.allowHint')}</p>
        {status?.ready && (
          <div className="sub-setting" style={{ marginTop: 10 }}>
            {unlisted.length === 0 && <p className="setting-hint">{t('llm.dev.none')}</p>}
            {unlisted.length > 0 && (
              <div className="ocr-engines-list">
                {unlisted.map((u) => {
                  const pr = probes[u.file];
                  const rp = reports[u.file];
                  return (
                    <div key={u.file} className="ocr-engine-item">
                      <div className="engine-info">
                        <div className="engine-header">
                          <span className="engine-name">{u.file}</span>
                          <span className="engine-size">{formatSize(u.size)}</span>
                          {pr && (
                            <span className={`engine-badge ${pr.verdict === 'usable' ? 'installed' : 'error'}`}>
                              {pr.verdict === 'usable' ? t('llm.dev.probeUsable') : t('llm.dev.probeUnusable')}
                            </span>
                          )}
                        </div>
                        {pr && (
                          <p className="engine-meta">
                            {(pr.steps || []).map((s) => `${s.ok ? '✓' : '✗'} ${t('llm.dev.probeStep', { name: s.name, ms: s.ms })}${s.error ? ` — ${s.error}` : ''}`).join(' · ')}
                            {pr.error ? ` — ${pr.error}` : ''}
                          </p>
                        )}
                        {rp && (
                          <p className="engine-meta">
                            {rp.requests || rp.loads || rp.probes
                              ? t('llm.dev.reportLine', { loads: rp.loads, requests: rp.requests, failures: rp.failures, stalls: rp.stalls, empty: rp.empty, loops: rp.loops, leaks: rp.thinkLeaks, tps: rp.tokPerSecAvg ?? '-' })
                              : t('llm.dev.reportEmpty')}
                          </p>
                        )}
                      </div>
                      {llm.allowUnlistedModels && (
                        <div className="engine-actions">
                          <button className="btn-small" onClick={() => probe(u.file)} disabled={busy !== null}>
                            {busy === `probe:${u.file}` ? <><RefreshCw size={12} className="spinning" /> {t('llm.dev.probing')}</> : t('llm.dev.probe')}
                          </button>
                          <button className="link-button" onClick={() => report(u.file)} disabled={busy !== null} style={{ marginLeft: 10 }}>
                            {t('llm.dev.report')}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {llm.allowUnlistedModels && (
              <div style={{ marginTop: 12 }}>
                <Switch
                  checked={!!llm.trialLogText}
                  onChange={(on) => persist('trialLogText', on)}
                  label={t('llm.dev.logText')}
                />
                <p className="setting-hint">{t('llm.dev.logTextHint')}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default LlmSection;
