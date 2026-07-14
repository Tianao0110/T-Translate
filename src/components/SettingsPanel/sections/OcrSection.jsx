// OCR settings: language, preprocessing, and per-engine config (local / vision / online).

import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff, AlertTriangle, RefreshCw, Download, Trash2, Cpu, Sparkles, Globe } from 'lucide-react';
import stackClient from '../../../services/stack-client.js';

// Must match electron/shared/ocr-packs.js BASE_PACK_ID / HQ_PACK_ID (renderer
// cannot import main-process modules; the manifest may list other generations'
// base packs, so the ids must be exact).
const BASE_PACK_ID = 'base-v6';
const HQ_PACK_ID = 'base-v6-hq';

const OcrSection = ({
  settings,
  updateSetting,
  notify,
  confirm,
  collapsedGroups,
  toggleGroup,
  showApiKeys,
  setShowApiKeys,
  setOcrEngine
}) => {
  const { t } = useTranslation();

  // null = unchecked, 'checking', 'healthy', 'broken'
  const [engineHealth, setEngineHealth] = useState(null);
  const [healthError, setHealthError] = useState('');

  // Model packs: merged manifest + installed list from the main process
  const [packs, setPacks] = useState([]);
  const [manifestError, setManifestError] = useState(null);
  const [packsLoading, setPacksLoading] = useState(false);
  const [busyPackId, setBusyPackId] = useState(null);
  const [packProgress, setPackProgress] = useState(null); // { packId, progress, phase }

  // Windows OCR system engine info
  const [winOcrLangs, setWinOcrLangs] = useState(null);

  const loadPacks = useCallback(async (refresh = false) => {
    if (!window.electron?.ocr?.listPacks) return;
    setPacksLoading(true);
    try {
      const res = await window.electron.ocr.listPacks({ refresh });
      if (res?.success) {
        setPacks(res.packs || []);
        setManifestError(res.manifestError || null);
        // Passive update notice (user decision): feedback only on a manual
        // refresh — no unsolicited prompts elsewhere in the app.
        if (refresh && !res.manifestError) {
          const updatable = (res.packs || []).filter((p) => p.status === 'update-available');
          if (updatable.length > 0) {
            notify(t('ocr.packs.updatesFound', { count: updatable.length }), 'info');
          } else {
            notify(t('ocr.packs.upToDate'), 'success');
          }
        }
      } else {
        setManifestError(res?.error || 'unknown');
      }
    } catch (e) {
      setManifestError(e.message);
    } finally {
      setPacksLoading(false);
    }
  }, [notify, t]);

  // Light check (file presence) on page entry; deep (builds the ONNX session,
  // ~0.5s of main-process stalls) only for explicit user action.
  const checkEngineHealth = useCallback(async (deep = false) => {
    setEngineHealth('checking');
    setHealthError('');
    try {
      const result = await window.electron?.ocr?.healthCheck?.('rapid-ocr', { deep: deep === true });
      if (result?.healthy) {
        setEngineHealth('healthy');
      } else {
        setEngineHealth('broken');
        setHealthError(result?.message || t('ocr.healthUnknownError'));
      }
    } catch (e) {
      setEngineHealth('broken');
      setHealthError(e.message);
    }
  }, [t]);

  // Auto-health-check rapid-ocr on entry only if user is actively using it
  // (avoid running model load on every settings open if they're on another engine)
  useEffect(() => {
    if (settings.ocr.rapidInstalled && settings.ocr.engine === 'rapid-ocr') {
      checkEngineHealth();
    } else {
      setEngineHealth(null);
      setHealthError('');
    }
  }, [settings.ocr.engine, settings.ocr.rapidInstalled, checkEngineHealth]);

  useEffect(() => {
    loadPacks(false);

    const cleanup = window.electron?.ocr?.onPackProgress?.((data) => {
      setPackProgress(data.progress >= 100 || data.progress < 0 ? null : data);
    });

    if (settings.ocr.isWindows && window.electron?.ocr?.checkWindowsOCR) {
      window.electron.ocr.checkWindowsOCR()
        .then((r) => setWinOcrLangs(r?.languages || []))
        .catch(() => setWinOcrLangs([]));
    }

    return () => cleanup?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDownloadPack = useCallback(async (packId) => {
    setBusyPackId(packId);
    try {
      const result = await window.electron?.ocr?.downloadPack?.(packId);
      if (result?.success) {
        notify(t('ocr.packs.downloaded'), 'success');
        if (packId === BASE_PACK_ID) {
          updateSetting('ocr', 'rapidInstalled', true);
          checkEngineHealth(true); // deep: validate the fresh download for real
        }
        await loadPacks(false);
      } else {
        notify(result?.error || t('ocr.packs.downloadFailed'), 'error');
      }
    } catch (e) {
      notify(t('ocr.packs.downloadFailed') + ': ' + e.message, 'error');
    } finally {
      setBusyPackId(null);
      setPackProgress(null);
    }
  }, [notify, t, updateSetting, checkEngineHealth, loadPacks]);

  // Immediate-apply control (like theme/language): silent React update +
  // dot-path persist + engine hot-swap via IPC.
  const applyTier = useCallback(async (tier) => {
    updateSetting('ocr', 'modelTier', tier, true);
    window.electron?.store?.set?.('settings.ocr.modelTier', tier);
    await window.electron?.ocr?.setModelTier?.(tier);
  }, [updateSetting]);

  const handleRemovePack = useCallback(async (packId) => {
    if (!(await confirm(t('ocr.packs.removeConfirm')))) return;
    try {
      const result = await window.electron?.ocr?.removePack?.(packId);
      if (result?.success) {
        // Removing the high-accuracy variant reverts the tier — the engine
        // would silently fall back anyway, but the setting must not lie.
        if (packId === HQ_PACK_ID) await applyTier('standard');
        notify(t('ocr.packs.removed'), 'success');
        await loadPacks(false);
      } else {
        notify(result?.error || t('ocr.packs.removeFailed'), 'error');
      }
    } catch (e) {
      notify(t('ocr.packs.removeFailed') + ': ' + e.message, 'error');
    }
  }, [notify, t, loadPacks, confirm, applyTier]);

  const toggleApiKeyVisibility = (key, e) => {
    e?.stopPropagation();
    setShowApiKeys(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const selectEngine = (engineId, requiredKeys = []) => {
    const missingKey = requiredKeys.find(key => !settings.ocr[key]);
    if (missingKey) {
      notify(t('ocr.configKeyFirst'), 'warning');
      return;
    }
    updateSetting('ocr', 'engine', engineId);
    if (setOcrEngine) setOcrEngine(engineId);

    // Manual re-select of llm-vision clears the auto-degrade lock so the user
    // can re-enable it after fixing their model setup (lock lives in the
    // main-process stack now — global across all three windows)
    if (engineId === 'llm-vision') {
      stackClient.ocr.resetVisionFallback();
    }
  };

  // A render function, not an inline component: defining a component inside the
  // render body gives it a new identity every keystroke, so React remounted the
  // input and dropped focus. toggleKey is passed explicitly — the old
  // keyName-derived key ('baiduApiKey' -> 'baiduApi') never matched the
  // showApiKeys key ('baidu'), so that eye toggle did nothing.
  const renderApiKeyInput = ({ keyName, toggleKey, placeholder = 'API Key', value, showKey }) => (
    <div className="api-key-input-wrapper">
      <input
        type={showKey ? "text" : "password"}
        className="setting-input compact"
        placeholder={placeholder}
        value={value || ''}
        onChange={(e) => updateSetting('ocr', keyName, e.target.value)}
        onClick={(e) => e.stopPropagation()}
      />
      <button
        type="button"
        className="api-key-toggle"
        onClick={(e) => toggleApiKeyVisibility(toggleKey, e)}
        title={showKey ? t('common.hide') : t('common.show')}
      >
        {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </div>
  );

  const packDisplayName = (pack) =>
    t(`ocr.packs.names.${pack.id}`, pack.name || pack.id);

  const packStatusBadge = (status) => {
    switch (status) {
      case 'installed':
        return <span className="engine-badge installed">{t('ocr.packs.installed')}</span>;
      case 'update-available':
        return <span className="engine-badge download">{t('ocr.packs.updateAvailable')}</span>;
      case 'orphaned':
        return <span className="engine-badge installed">{t('ocr.packs.installed')}</span>;
      default:
        return <span className="engine-badge unavailable">{t('ocr.packs.notInstalled')}</span>;
    }
  };

  const langPacks = packs.filter((p) => p.type === 'lang');
  const basePack = packs.find((p) => p.type === 'base');
  const hqPack = packs.find((p) => p.id === HQ_PACK_ID);
  const hqInstalled = !!hqPack && ['installed', 'update-available', 'orphaned'].includes(hqPack.status);
  const modelTier = settings.ocr.modelTier || 'standard';

  const handleTierChange = async (tier) => {
    if (tier === modelTier) return;
    if (tier === 'high' && !hqInstalled) {
      // Not on disk yet: download first, enable only on success
      setBusyPackId(HQ_PACK_ID);
      try {
        const result = await window.electron?.ocr?.downloadPack?.(HQ_PACK_ID);
        if (result?.success) {
          await applyTier('high');
          notify(t('ocr.tier.enabled'), 'success');
          await loadPacks(false);
        } else {
          notify(result?.error || t('ocr.packs.downloadFailed'), 'error');
        }
      } catch (e) {
        notify(t('ocr.packs.downloadFailed') + ': ' + e.message, 'error');
      } finally {
        setBusyPackId(null);
        setPackProgress(null);
      }
      return;
    }
    await applyTier(tier);
    notify(tier === 'high' ? t('ocr.tier.enabled') : t('ocr.tier.disabled'), 'success');
  };

  const renderPackRow = (pack) => {
    const busy = busyPackId === pack.id;
    const progress = packProgress?.packId === pack.id ? packProgress : null;
    const sizeMB = pack.size ? (pack.size / 1024 / 1024).toFixed(1) : null;

    return (
      <div key={pack.id} className="ocr-pack-row">
        <div className="pack-info">
          <div className="pack-header">
            <span className="pack-name">{packDisplayName(pack)}</span>
            {packStatusBadge(pack.status)}
            {sizeMB && <span className="engine-size">{sizeMB} MB</span>}
          </div>
          {progress && (
            <div className="engine-download-progress" style={{ marginTop: 6 }}>
              <div className="download-progress-bar">
                <div className="download-progress-fill" style={{ width: `${Math.max(progress.progress, 2)}%` }} />
              </div>
              <span className="download-progress-text">
                {progress.progress}% {t(`ocr.packs.phase.${progress.phase}`, '')}
              </span>
            </div>
          )}
        </div>
        <div className="pack-actions">
          {(pack.status === 'not-installed' || pack.status === 'update-available') && (
            <button
              className="btn-small download"
              disabled={busy || busyPackId !== null}
              onClick={() => handleDownloadPack(pack.id)}
              title={pack.status === 'update-available' ? t('ocr.packs.update') : t('ocr.packs.download')}
            >
              {busy
                ? <RefreshCw size={12} className="spinning" />
                : <><Download size={12} /> {pack.status === 'update-available' ? t('ocr.packs.update') : t('ocr.packs.download')}</>}
            </button>
          )}
          {(pack.status === 'installed' || pack.status === 'update-available' || pack.status === 'orphaned') && (
            <button
              className="btn-small uninstall"
              disabled={busy || busyPackId !== null}
              onClick={() => handleRemovePack(pack.id)}
              title={t('ocr.packs.uninstall')}
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="setting-content animate-fade-in">
      <h3>{t('settings.ocr.title')}</h3>
      <p className="setting-description">{t('ocr.description')}</p>

      <div className="setting-group">
        <label className="setting-label">{t('ocr.recognitionLanguage')}</label>
        <select
          className="setting-select"
          value={settings.ocr.recognitionLanguage || 'auto'}
          onChange={(e) => updateSetting('ocr', 'recognitionLanguage', e.target.value)}
        >
          {/* Native <option> can't render SVG, so no icons here (emoji flags
              violated the lucide-only rule and rendered inconsistently). */}
          <option value="auto">{t('ocr.lang.auto')}</option>
          <option value="zh-Hans">{t('ocr.lang.zhHans')}</option>
          <option value="zh-Hant">{t('ocr.lang.zhHant')}</option>
          <option value="en">{t('ocr.lang.en')}</option>
          <option value="ja">{t('ocr.lang.ja')}</option>
          <option value="ko">{t('ocr.lang.ko')}</option>
          <option value="fr">{t('ocr.lang.fr')}</option>
          <option value="de">{t('ocr.lang.de')}</option>
          <option value="es">{t('ocr.lang.es')}</option>
          <option value="ru">{t('ocr.lang.ru')}</option>
          <option value="hi">{t('ocr.lang.hi')}</option>
          <option value="ar">{t('ocr.lang.ar')}</option>
        </select>
        <p className="setting-hint">{t('ocr.autoLangHint')}</p>
        <p className="setting-hint">{t('ocr.langPackHint')}</p>
      </div>

      <div className="setting-group">
        <label className="setting-toggle">
          <input
            type="checkbox"
            checked={settings.screenshot?.showConfirmButtons ?? true}
            onChange={(e) => updateSetting('screenshot', 'showConfirmButtons', e.target.checked)}
          />
          <span>{t('ocr.showConfirmButtons')}</span>
        </label>
        <p className="setting-hint">{t('ocr.confirmButtonsHint')}</p>
      </div>

      <div className="setting-group">
        <label className="setting-toggle">
          <input
            type="checkbox"
            checked={settings.ocr?.enablePreprocess ?? true}
            onChange={(e) => updateSetting('ocr', 'enablePreprocess', e.target.checked)}
          />
          <span>{t('ocr.autoEnlarge')}</span>
        </label>
        <p className="setting-hint">{t('ocr.enlargeHint')}</p>
        {(settings.ocr?.enablePreprocess ?? true) && (
          <div className="sub-setting">
            <label className="setting-label">{t('ocr.scaleFactor')}</label>
            <select
              className="setting-select"
              value={settings.ocr?.scaleFactor || 2}
              onChange={(e) => updateSetting('ocr', 'scaleFactor', parseFloat(e.target.value))}
              style={{width: '120px'}}
            >
              <option value="1.5">1.5x</option>
              <option value="2">2x {t('ocr.recommended')}</option>
              <option value="2.5">2.5x</option>
              <option value="3">3x</option>
            </select>
          </div>
        )}
      </div>

      {/* Tier 1: local engines */}
      <details className="setting-section" open={!collapsedGroups['ocr-local']}>
        <summary className="section-header" onClick={(e) => { e.preventDefault(); toggleGroup('ocr-local'); }}>
          <span className="section-title"><Cpu size={15} /> {t('ocr.localEngines')}</span>
          <span className="section-hint">{t('ocr.localHint')}</span>
        </summary>
        <div className="section-content">
          <div className="ocr-engines-list">

            {/* Local PP-OCRv6 engine */}
            <div className={`ocr-engine-item ${settings.ocr.engine === 'rapid-ocr' ? 'active' : ''} ${engineHealth === 'broken' ? 'engine-broken' : ''}`}>
              <div className="engine-info">
                <div className="engine-header">
                  <span className="engine-name">{t('ocr.localOcrName')}</span>
                  {settings.ocr.rapidInstalled ? (
                    engineHealth === 'broken' ? (
                      <span className="engine-badge error">
                        <AlertTriangle size={11} style={{marginRight: 3}} />
                        {t('ocr.engineBroken')}
                      </span>
                    ) : engineHealth === 'checking' ? (
                      <span className="engine-badge checking">
                        <RefreshCw size={11} className="spinning" style={{marginRight: 3}} />
                        {t('ocr.checking')}
                      </span>
                    ) : (
                      <span className="engine-badge installed">{t('ocr.installed')}</span>
                    )
                  ) : (
                    <span className="engine-badge download">{t('ocr.needDownload')}</span>
                  )}
                </div>
                <p className="engine-desc">{t('ocr.rapidDesc')}</p>

                {engineHealth === 'broken' && (
                  <div className="engine-error-box">
                    <AlertTriangle size={14} />
                    <div className="error-content">
                      <p className="error-title">{t('ocr.engineErrorTitle')}</p>
                      <p className="error-detail">{healthError}</p>
                    </div>
                  </div>
                )}

                {/* Language packs — installed once then rarely touched: folded by
                    default. Manifest errors and the base pack stay outside the fold
                    (a broken manifest / missing core model must be visible). */}
                {manifestError && (
                  <p className="pack-manifest-error">
                    <AlertTriangle size={12} style={{marginRight: 4, verticalAlign: -2}} />
                    {t('ocr.packs.manifestError')}
                  </p>
                )}

                {basePack && (basePack.status === 'update-available' || !settings.ocr.rapidInstalled) &&
                  renderPackRow(basePack)}

                {/* Model tier: bundled small vs downloadable medium. Selecting
                    "high" without the pack on disk downloads it first. */}
                <div className="setting-group" style={{ margin: '10px 0 4px' }}>
                  <label className="setting-label">{t('ocr.tier.label')}</label>
                  <select
                    className="setting-select"
                    style={{ maxWidth: 340 }}
                    value={modelTier}
                    onChange={(e) => handleTierChange(e.target.value)}
                    disabled={busyPackId !== null}
                  >
                    <option value="standard">{t('ocr.tier.standard')}</option>
                    <option value="high">{t('ocr.tier.high')}</option>
                  </select>
                  <p className="setting-hint">{t('ocr.tier.hint')}</p>
                  {hqPack && (hqInstalled || busyPackId === HQ_PACK_ID) && renderPackRow(hqPack)}
                </div>

                <details className="ocr-pack-section">
                  <summary className="ocr-pack-section-header">
                    <span className="pack-section-title">
                      {t('ocr.packs.title')}
                      {langPacks.length > 0 && (
                        <span className="pack-count">
                          {langPacks.filter((p) => ['installed', 'update-available', 'orphaned'].includes(p.status)).length}/{langPacks.length}
                        </span>
                      )}
                    </span>
                    <button
                      className="btn-small"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); loadPacks(true); }}
                      disabled={packsLoading}
                      title={t('ocr.packs.refresh')}
                    >
                      <RefreshCw size={12} className={packsLoading ? 'spinning' : ''} />
                      <span style={{marginLeft: 4}}>{t('ocr.packs.refresh')}</span>
                    </button>
                  </summary>

                  {langPacks.length > 0
                    ? langPacks.map(renderPackRow)
                    : !manifestError && (
                        <p className="setting-hint" style={{margin: '6px 0 0'}}>
                          {packsLoading ? t('ocr.packs.loading') : t('ocr.packs.empty')}
                        </p>
                      )}
                </details>
              </div>
              <div className="engine-actions">
                {settings.ocr.rapidInstalled ? (
                  <>
                    {engineHealth === 'broken' ? (
                      <button
                        className="btn repair"
                        disabled={busyPackId !== null}
                        onClick={() => handleDownloadPack(BASE_PACK_ID)}
                      >
                        {busyPackId === BASE_PACK_ID ? (
                          <><RefreshCw size={13} className="spinning" /> {t('ocr.repairing')}</>
                        ) : (
                          <><Download size={13} /> {t('ocr.packs.redownloadBase')}</>
                        )}
                      </button>
                    ) : (
                      <button
                        className={`btn ${settings.ocr.engine === 'rapid-ocr' ? 'active' : ''}`}
                        onClick={() => selectEngine('rapid-ocr')}
                      >
                        {settings.ocr.engine === 'rapid-ocr' ? t('ocr.inUse') : t('ocr.use')}
                      </button>
                    )}
                    <button
                      className="btn-small"
                      onClick={() => checkEngineHealth(true)}
                      disabled={engineHealth === 'checking'}
                      title={t('ocr.recheckHealth')}
                      style={{marginLeft: 6, padding: '4px 8px'}}
                    >
                      <RefreshCw size={12} className={engineHealth === 'checking' ? 'spinning' : ''} />
                    </button>
                  </>
                ) : (
                  <button
                    className="btn download"
                    disabled={busyPackId !== null}
                    onClick={() => handleDownloadPack(BASE_PACK_ID)}
                  >
                    {busyPackId === BASE_PACK_ID
                      ? <><RefreshCw size={13} className="spinning" /> {t('ocr.packs.downloadingShort')}</>
                      : t('ocr.download')}
                  </button>
                )}
              </div>
            </div>

            {/* Windows OCR (system engine) */}
            {settings.ocr.isWindows && (
              <div className={`ocr-engine-item ${settings.ocr.engine === 'windows-ocr' ? 'active' : ''}`}>
                <div className="engine-info">
                  <div className="engine-header">
                    <span className="engine-name">Windows OCR</span>
                    <span className="engine-badge system">{t('ocr.windowsOcr.badge')}</span>
                  </div>
                  <p className="engine-desc">{t('ocr.windowsOcr.desc')}</p>
                  {winOcrLangs && winOcrLangs.length > 0 && (
                    <p className="engine-meta">{t('ocr.windowsOcr.langs', { langs: winOcrLangs.join(', ') })}</p>
                  )}
                </div>
                <div className="engine-actions">
                  <button
                    className={`btn ${settings.ocr.engine === 'windows-ocr' ? 'active' : ''}`}
                    onClick={() => selectEngine('windows-ocr')}
                  >
                    {settings.ocr.engine === 'windows-ocr' ? t('ocr.inUse') : t('ocr.use')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </details>

      {/* Tier 2: vision LLM */}
      <details className="setting-section" open={!collapsedGroups['ocr-vision']}>
        <summary className="section-header" onClick={(e) => { e.preventDefault(); toggleGroup('ocr-vision'); }}>
          <span className="section-title"><Sparkles size={15} /> {t('ocr.visionModels')}</span>
          <span className="section-hint">{t('ocr.visionHint')}</span>
        </summary>
        <div className="section-content">
          <div className="ocr-engines-list">
            <div className={`ocr-engine-item ${settings.ocr.engine === 'llm-vision' ? 'active' : ''}`}>
              <div className="engine-info">
                <div className="engine-header">
                  <span className="engine-name">LLM Vision</span>
                  <span className="engine-badge builtin">{t('ocr.builtin')}</span>
                </div>
                <p className="engine-desc">{t('ocr.llmVisionDesc')}</p>
                <p className="engine-meta">{t('ocr.llmVisionMeta')}</p>
                <div className="api-key-input-wrapper" style={{marginTop: '6px'}}>
                  <input
                    type="text"
                    className="setting-input compact"
                    placeholder={t('ocr.llmEndpointPlaceholder')}
                    value={settings.ocr.llmEndpoint || ''}
                    onChange={(e) => updateSetting('ocr', 'llmEndpoint', e.target.value)}
                  />
                </div>
                <p className="setting-hint">{t('ocr.llmEndpointHint')}</p>
                <div className="api-key-input-wrapper" style={{marginTop: '6px'}}>
                  <input
                    type="text"
                    className="setting-input compact"
                    placeholder={t('ocr.llmModelPlaceholder')}
                    value={settings.ocr.llmModel || ''}
                    onChange={(e) => updateSetting('ocr', 'llmModel', e.target.value)}
                  />
                </div>
                <p className="setting-hint">{t('ocr.llmModelHint')}</p>
              </div>
              <div className="engine-actions">
                <button
                  className={`btn ${settings.ocr.engine === 'llm-vision' ? 'active' : ''}`}
                  onClick={() => selectEngine('llm-vision')}
                >
                  {settings.ocr.engine === 'llm-vision' ? t('ocr.inUse') : t('ocr.use')}
                </button>
              </div>
            </div>
          </div>
        </div>
      </details>

      {/* Tier 3: online APIs */}
      <details className="setting-section" open={!collapsedGroups['ocr-online']}>
        <summary className="section-header" onClick={(e) => { e.preventDefault(); toggleGroup('ocr-online'); }}>
          <span className="section-title"><Globe size={15} /> {t('ocr.onlineServices')}</span>
          <span className="section-hint">{t('ocr.onlineHint')}</span>
        </summary>
        <div className="section-content">
          <p className="setting-hint" style={{marginBottom: '12px'}}>{t('ocr.onlineNote')}</p>
          <div className="ocr-engines-list">
            <div className={`ocr-engine-item ${settings.ocr.engine === 'ocrspace' ? 'active' : ''}`}>
              <div className="engine-info">
                <div className="engine-header">
                  <span className="engine-name">OCR.space</span>
                  <span className="engine-badge free">{t('ocr.free25k')}</span>
                </div>
                <p className="engine-desc">{t('ocr.ocrspaceDesc')}</p>
                {renderApiKeyInput({ keyName: 'ocrspaceKey', toggleKey: 'ocrspace', value: settings.ocr.ocrspaceKey, showKey: showApiKeys.ocrspace })}
              </div>
              <div className="engine-actions">
                <button
                  className={`btn ${settings.ocr.engine === 'ocrspace' ? 'active' : ''} ${!settings.ocr.ocrspaceKey ? 'disabled' : ''}`}
                  onClick={() => selectEngine('ocrspace', ['ocrspaceKey'])}
                >
                  {settings.ocr.engine === 'ocrspace' ? t('ocr.inUse') : t('ocr.use')}
                </button>
              </div>
            </div>

            <div className={`ocr-engine-item ${settings.ocr.engine === 'google-vision' ? 'active' : ''}`}>
              <div className="engine-info">
                <div className="engine-header">
                  <span className="engine-name">Google Vision</span>
                  <span className="engine-badge free">{t('ocr.free1k')}</span>
                </div>
                <p className="engine-desc">{t('ocr.googleVisionDesc')}</p>
                {renderApiKeyInput({ keyName: 'googleVisionKey', toggleKey: 'googleVision', value: settings.ocr.googleVisionKey, showKey: showApiKeys.googleVision })}
              </div>
              <div className="engine-actions">
                <button
                  className={`btn ${settings.ocr.engine === 'google-vision' ? 'active' : ''} ${!settings.ocr.googleVisionKey ? 'disabled' : ''}`}
                  onClick={() => selectEngine('google-vision', ['googleVisionKey'])}
                >
                  {settings.ocr.engine === 'google-vision' ? t('ocr.inUse') : t('ocr.use')}
                </button>
              </div>
            </div>

            <div className={`ocr-engine-item ${settings.ocr.engine === 'azure-ocr' ? 'active' : ''}`}>
              <div className="engine-info">
                <div className="engine-header">
                  <span className="engine-name">Azure OCR</span>
                  <span className="engine-badge free">{t('ocr.free5k')}</span>
                </div>
                <p className="engine-desc">{t('ocr.azureDesc')}</p>
                {renderApiKeyInput({ keyName: 'azureKey', toggleKey: 'azure', value: settings.ocr.azureKey, showKey: showApiKeys.azure })}
                <div className="api-key-input-wrapper" style={{marginTop: '6px'}}>
                  <input type="text" className="setting-input compact" placeholder={t('ocr.azureEndpoint')}
                    value={settings.ocr.azureEndpoint || ''} onChange={(e) => updateSetting('ocr', 'azureEndpoint', e.target.value)} />
                </div>
              </div>
              <div className="engine-actions">
                <button
                  className={`btn ${settings.ocr.engine === 'azure-ocr' ? 'active' : ''} ${!(settings.ocr.azureKey && settings.ocr.azureEndpoint) ? 'disabled' : ''}`}
                  onClick={() => {
                    if (settings.ocr.azureKey && settings.ocr.azureEndpoint) selectEngine('azure-ocr');
                    else notify(t('ocr.configKeyEndpoint'), 'warning');
                  }}
                >
                  {settings.ocr.engine === 'azure-ocr' ? t('ocr.inUse') : t('ocr.use')}
                </button>
              </div>
            </div>

            <div className={`ocr-engine-item ${settings.ocr.engine === 'baidu-ocr' ? 'active' : ''}`}>
              <div className="engine-info">
                <div className="engine-header">
                  <span className="engine-name">{t('ocr.baiduOcr')}</span>
                  <span className="engine-badge free">{t('ocr.free1k')}</span>
                </div>
                <p className="engine-desc">{t('ocr.baiduDesc')}</p>
                {renderApiKeyInput({ keyName: 'baiduApiKey', toggleKey: 'baidu', value: settings.ocr.baiduApiKey, showKey: showApiKeys.baidu })}
                <div className="api-key-input-wrapper" style={{marginTop: '6px'}}>
                  <input type={showApiKeys.baiduSecret ? "text" : "password"} className="setting-input compact" placeholder="Secret Key"
                    value={settings.ocr.baiduSecretKey || ''} onChange={(e) => updateSetting('ocr', 'baiduSecretKey', e.target.value)} />
                  <button type="button" className="api-key-toggle" onClick={(e) => toggleApiKeyVisibility('baiduSecret', e)}>
                    {showApiKeys.baiduSecret ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
              <div className="engine-actions">
                <button
                  className={`btn ${settings.ocr.engine === 'baidu-ocr' ? 'active' : ''} ${!(settings.ocr.baiduApiKey && settings.ocr.baiduSecretKey) ? 'disabled' : ''}`}
                  onClick={() => {
                    if (settings.ocr.baiduApiKey && settings.ocr.baiduSecretKey) selectEngine('baidu-ocr');
                    else notify(t('ocr.configKeySecret'), 'warning');
                  }}
                >
                  {settings.ocr.engine === 'baidu-ocr' ? t('ocr.inUse') : t('ocr.use')}
                </button>
              </div>
            </div>
          </div>
        </div>
      </details>
    </div>
  );
};

export default OcrSection;
