// The high-accuracy listen tier's models: the whitelisted Qwen3-ASR GGUF
// pairs the user downloads and drops into the model folder. Rows come from
// llm:status; T-Engine's speech host loads the one llm-manager picks.
// Markup reuses the engine card classes (styles/ocr.css).

import { useTranslation } from 'react-i18next';
import { AlertTriangle, ExternalLink, FolderOpen, RefreshCw } from 'lucide-react';

const SpeechPacks = ({ status, busy, onRescan }) => {
  const { t } = useTranslation();
  const packs = (status?.packs?.packs || []).filter((p) => p.role === 'asr');
  const asr = status?.asr || null;
  const next = asr?.selected ? packs.find((p) => p.id === asr.selected) : null;
  const openLink = (url) => url && window.electron?.shell?.openExternal?.(url);

  const badge = (p) => {
    if (p.status === 'ready') return <span className="engine-badge installed">{t('listen.hq.badge.ready')}</span>;
    if (p.status === 'mismatch') {
      return (
        <span className="engine-badge error">
          <AlertTriangle size={11} style={{ marginRight: 3 }} />
          {t('listen.hq.badge.mismatch')}
        </span>
      );
    }
    return <span className="engine-badge download">{t(p.status === 'partial' ? 'listen.hq.badge.partial' : 'listen.hq.badge.missing')}</span>;
  };

  return (
    <div className="setting-group">
      <label className="setting-label">{t('listen.hq.title')}</label>
      <p className="setting-hint">{t('listen.hq.hint')}</p>
      <div className="ocr-engines-list">
        {packs.map((p) => {
          const ready = p.status === 'ready';
          const sizeMB = Math.round((p.files || []).reduce((n, f) => n + (f.size || 0), 0) / 1048576);
          return (
            <div key={p.id} className={`ocr-engine-item ${ready ? 'active' : ''}`.trim()}>
              <div className="engine-info">
                <div className="engine-header">
                  <span className="engine-name">{p.name}</span>
                  {badge(p)}
                  <span className="engine-size">{sizeMB} MB</span>
                </div>
                {(p.files || []).map((f) => (
                  <p className="engine-meta" key={f.part}>
                    {t(`listen.hq.part.${f.part}`)}: {f.file} · {t(`listen.hq.state.${f.status}`)}
                  </p>
                ))}
                {!ready && p.source && (
                  <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 6 }}>
                    <button className="link-button" onClick={() => openLink(p.source.url)}>
                      <ExternalLink size={14} /> {t('listen.hq.linkModel')}
                    </button>
                    <button className="link-button" onClick={() => openLink(p.source.mmproj?.url)}>
                      <ExternalLink size={14} /> {t('listen.hq.linkEncoder')}
                    </button>
                    {p.source.mirror && (
                      <button className="link-button" onClick={() => openLink(p.source.mirror)}>
                        <ExternalLink size={14} /> {t('listen.hq.mirrorModel')}
                      </button>
                    )}
                    {p.source.mmproj?.mirror && (
                      <button className="link-button" onClick={() => openLink(p.source.mmproj.mirror)}>
                        <ExternalLink size={14} /> {t('listen.hq.mirrorEncoder')}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {status?.dir && <p className="setting-hint">{t('listen.hq.folder', { dir: status.dir })}</p>}
      {next && (
        <p className="setting-hint">
          {t('listen.hq.next', { name: next.name, where: t(`listen.hq.where.${asr.provider === 'gpu' ? 'gpu' : 'cpu'}`) })}
        </p>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
        <button className="btn-small" onClick={() => window.electron?.llm?.openDir?.()}>
          <FolderOpen size={12} /> {t('listen.hq.openFolder')}
        </button>
        <button className="btn-small" onClick={onRescan} disabled={busy}>
          <RefreshCw size={12} className={busy ? 'spinning' : ''} /> {t('listen.hq.rescan')}
        </button>
      </div>
    </div>
  );
};

export default SpeechPacks;
