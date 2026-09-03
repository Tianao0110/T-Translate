// OCR settings: language, capture options, and per-engine config (local / vision / online).

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff, AlertTriangle, RefreshCw, Download, Cpu, Sparkles, Globe } from 'lucide-react';
import stackClient from '../../../services/stack-client.js';
import { OCR_LANGUAGE_GROUPS, ocrLanguageName } from '../../../config/ocr-languages.js';
import LanguagePicker from '../../shared/LanguagePicker.jsx';
import PackList from './PackList.jsx';
import { Seg, Switch } from './shared';

// Must match electron/shared/ocr-packs.js BASE_PACK_ID / HQ_PACK_ID (renderer
// cannot import main-process modules; the manifest may list other generations'
// base packs, so the ids must be exact).
const BASE_PACK_ID = 'base-v6';
const HQ_PACK_ID = 'base-v6-hq';

const ENGINE_TAB = {
  'rapid-ocr': 'local',
  'windows-ocr': 'local',
  'llm-vision': 'vision',
  'ocrspace': 'online',
  'google-vision': 'online',
  'azure-ocr': 'online',
  'baidu-ocr': 'online',
};

const INSTALLED_STATES = ['installed', 'update-available', 'orphaned'];

const OcrSection = ({
  settings,
  updateSetting,
  notify,
  confirm,
  showApiKeys,
  setShowApiKeys,
  setOcrEngine
}) => {
  const { t, i18n } = useTranslation();

  // null = unchecked, 'checking', 'healthy', 'broken'
  const [engineHealth, setEngineHealth] = useState(null);
  const [healthError, setHealthError] = useState('');

  // Full pack list (PackList hands it over on every load); the base and
  // high-accuracy packs are driven from here, language packs by PackList.
  const [packs, setPacks] = useState([]);
  const [busyPackId, setBusyPackId] = useState(null);
  const [packProgress, setPackProgress] = useState(null); // { packId, progress, phase }

  // Windows OCR system engine info
  const [winOcrLangs, setWinOcrLangs] = useState(null);

  const [tab, setTab] = useState(ENGINE_TAB[settings.ocr.engine] || 'local');

  const refreshPacks = useCallback(async () => {
    if (!window.electron?.ocr?.listPacks) return;
    try {
      const res = await window.electron.ocr.listPacks({ refresh: false });
      if (res?.success) setPacks(res.packs || []);
    } catch {
      // PackList reports manifest problems; nothing to add here
    }
  }, []);

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
    // Only the two packs this page drives itself; PackList tracks its own rows.
    const cleanup = window.electron?.ocr?.onPackProgress?.((data) => {
      if (data.packId !== BASE_PACK_ID && data.packId !== HQ_PACK_ID) return;
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

  const downloadPack = useCallback(async (packId, onSuccess) => {
    setBusyPackId(packId);
    try {
      const result = await window.electron?.ocr?.downloadPack?.(packId);
      if (result?.success) {
        await onSuccess?.();
        await refreshPacks();
      } else if (result?.errorCode === 'OFFLINE_BLOCKED') {
        notify(t('ocr.packs.offlineBlocked'), 'warning');
      } else {
        notify(result?.error || t('ocr.packs.downloadFailed'), 'error');
      }
    } catch (e) {
      notify(t('ocr.packs.downloadFailed') + ': ' + e.message, 'error');
    } finally {
      setBusyPackId(null);
      setPackProgress(null);
    }
  }, [notify, t, refreshPacks]);

  const handleDownloadBase = useCallback(() => downloadPack(BASE_PACK_ID, async () => {
    notify(t('ocr.packs.downloaded'), 'success');
    updateSetting('ocr', 'rapidInstalled', true);
    checkEngineHealth(true); // deep: validate the fresh download for real
  }), [downloadPack, notify, t, updateSetting, checkEngineHealth]);

  // Immediate-apply control (like theme/language): silent React update +
  // dot-path persist + engine hot-swap via IPC.
  const applyTier = useCallback(async (tier) => {
    updateSetting('ocr', 'modelTier', tier, true);
    window.electron?.store?.set?.('settings.ocr.modelTier', tier);
    await window.electron?.ocr?.setModelTier?.(tier);
  }, [updateSetting]);

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

  // The picker groups by initial letter, so the pack a language needs rides
  // in the tooltip instead of an <optgroup>.
  const langOptions = useMemo(() => {
    const opts = [{ code: 'auto', name: t('ocr.lang.auto'), en: t('ocr.lang.auto') }];
    for (const group of OCR_LANGUAGE_GROUPS) {
      const builtin = group.packId === BASE_PACK_ID;
      const packLabel = t(`ocr.langGroup.${builtin ? 'builtin' : group.packId}`);
      for (const code of group.languages) {
        opts.push({
          code,
          name: ocrLanguageName(code, 'zh'),
          en: ocrLanguageName(code, 'en'),
          nativeName: builtin ? undefined : packLabel,
        });
      }
    }
    return opts;
  }, [t]);

  const basePack = packs.find((p) => p.type === 'base');
  const hqPack = packs.find((p) => p.id === HQ_PACK_ID);
  const hqInstalled = !!hqPack && INSTALLED_STATES.includes(hqPack.status);
  const modelTier = settings.ocr.modelTier || 'standard';

  const handleTierChange = async (tier) => {
    if (tier === modelTier) return;
    if (tier === 'high' && !hqInstalled) {
      // Not on disk yet: download first, enable only on success
      await downloadPack(HQ_PACK_ID, async () => {
        await applyTier('high');
        notify(t('ocr.tier.enabled'), 'success');
      });
      return;
    }
    await applyTier(tier);
    notify(tier === 'high' ? t('ocr.tier.enabled') : t('ocr.tier.disabled'), 'success');
  };

  const progressBar = (packId) => {
    const progress = packProgress?.packId === packId ? packProgress : null;
    if (!progress) return null;
    return (
      <div className="engine-download-progress" style={{ marginTop: 6 }}>
        <div className="download-progress-bar">
          <div className="download-progress-fill" style={{ width: `${Math.max(progress.progress, 2)}%` }} />
        </div>
        <span className="download-progress-text">
          {progress.progress}% {t(`ocr.packs.phase.${progress.phase}`, '')}
        </span>
      </div>
    );
  };

  // Render helpers, not inline components: a component defined in the render
  // body gets a new identity every keystroke, so React would remount the
  // input and drop focus.
  const selectButton = (engineId, ready = true, onBlocked) => (
    <button
      className={`btn ${settings.ocr.engine === engineId ? 'active' : ''} ${ready ? '' : 'disabled'}`}
      onClick={() => (ready ? selectEngine(engineId) : onBlocked?.())}
    >
      {settings.ocr.engine === engineId ? t('ocr.inUse') : t('ocr.use')}
    </button>
  );

  const engineCard = ({ id, name, badge, meta, body, actions, className = '' }) => (
    <div key={id} className={`ocr-engine-item ${settings.ocr.engine === id ? 'active' : ''} ${className}`.trim()}>
      <div className="engine-info">
        <div className="engine-header">
          <span className="engine-name">{name}</span>
          {badge}
        </div>
        {meta && <p className="engine-meta">{meta}</p>}
        {body}
      </div>
      <div className="engine-actions">{actions}</div>
    </div>
  );

  const keyField = ({ label, keyName, toggleKey, placeholder }) => (
    <div className="ps-field" key={keyName}>
      <label className="ps-label">{label}</label>
      <div className="ps-input-group">
        <input
          type={showApiKeys[toggleKey] ? 'text' : 'password'}
          className="ps-input"
          placeholder={placeholder}
          value={settings.ocr[keyName] || ''}
          onChange={(e) => updateSetting('ocr', keyName, e.target.value)}
          autoComplete="off"
        />
        <button
          type="button"
          className="ps-input-btn"
          onClick={(e) => toggleApiKeyVisibility(toggleKey, e)}
          title={showApiKeys[toggleKey] ? t('common.hide') : t('common.show')}
        >
          {showApiKeys[toggleKey] ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
    </div>
  );

  const textField = ({ label, keyName, placeholder }) => (
    <div className="ps-field" key={keyName}>
      <label className="ps-label">{label}</label>
      <input
        type="text"
        className="ps-input"
        placeholder={placeholder}
        value={settings.ocr[keyName] || ''}
        onChange={(e) => updateSetting('ocr', keyName, e.target.value)}
      />
    </div>
  );

  const localBadge = settings.ocr.rapidInstalled ? (
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
  );

  const localActions = settings.ocr.rapidInstalled ? (
    <>
      {engineHealth === 'broken' ? (
        <button
          className="btn repair"
          disabled={busyPackId !== null}
          onClick={handleDownloadBase}
        >
          {busyPackId === BASE_PACK_ID ? (
            <><RefreshCw size={13} className="spinning" /> {t('ocr.repairing')}</>
          ) : (
            <><Download size={13} /> {t('ocr.packs.redownloadBase')}</>
          )}
        </button>
      ) : selectButton('rapid-ocr')}
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
      onClick={handleDownloadBase}
    >
      {busyPackId === BASE_PACK_ID
        ? <><RefreshCw size={13} className="spinning" /> {t('ocr.packs.downloadingShort')}</>
        : t('ocr.download')}
    </button>
  );

  const tierBusy = busyPackId !== null;
  const localBody = (
    <>
      {engineHealth === 'broken' && (
        <div className="engine-error-box">
          <AlertTriangle size={14} />
          <div className="error-content">
            <p className="error-title">{t('ocr.engineErrorTitle')}</p>
            <p className="error-detail">{healthError}</p>
          </div>
        </div>
      )}
      {progressBar(BASE_PACK_ID)}
      {basePack?.status === 'update-available' && settings.ocr.rapidInstalled && (
        <button
          className="btn-small download"
          style={{ marginTop: 6 }}
          disabled={busyPackId !== null}
          onClick={handleDownloadBase}
        >
          <Download size={12} /> {t('ocr.packs.update')}
        </button>
      )}
      {/* Model tier: bundled small vs downloadable medium. Selecting "high"
          without the pack on disk downloads it first. */}
      <div className="ocr-tier">
        <label className="setting-label">{t('ocr.tier.label')}</label>
        <Seg
          size="small"
          value={modelTier}
          onChange={handleTierChange}
          options={[
            { value: 'standard', label: t('ocr.tier.standard'), disabled: tierBusy },
            { value: 'high', label: t('ocr.tier.high'), disabled: tierBusy },
          ]}
        />
        {progressBar(HQ_PACK_ID)}
      </div>
    </>
  );

  const localTab = (
    <>
      <div className="ocr-engines-list">
        {engineCard({
          id: 'rapid-ocr',
          name: t('ocr.localOcrName'),
          badge: localBadge,
          body: localBody,
          actions: localActions,
          className: engineHealth === 'broken' ? 'engine-broken' : '',
        })}
        {settings.ocr.isWindows && engineCard({
          id: 'windows-ocr',
          name: 'Windows OCR',
          badge: <span className="engine-badge system">{t('ocr.windowsOcr.badge')}</span>,
          meta: winOcrLangs && winOcrLangs.length > 0
            ? t('ocr.windowsOcr.langs', { langs: winOcrLangs.join(', ') })
            : null,
          actions: selectButton('windows-ocr'),
        })}
      </div>
      <PackList
        bridge={window.electron?.ocr}
        prefix="ocr.packs"
        notify={notify}
        confirm={confirm}
        filter={(p) => p.type === 'lang'}
        onPacks={(list) => setPacks(list)}
      />
    </>
  );

  const visionTab = (
    <div className="ocr-engines-list">
      {engineCard({
        id: 'llm-vision',
        name: 'LLM Vision',
        badge: <span className="engine-badge builtin">{t('ocr.builtin')}</span>,
        body: (
          <div className="ps-config-form">
            {textField({ label: t('ocr.llmEndpoint'), keyName: 'llmEndpoint', placeholder: t('ocr.llmEndpointPlaceholder') })}
            {textField({ label: t('ocr.llmModel'), keyName: 'llmModel', placeholder: t('ocr.llmModelPlaceholder') })}
          </div>
        ),
        actions: selectButton('llm-vision'),
      })}
    </div>
  );

  const onlineTab = (
    <div className="ocr-engines-list">
      {engineCard({
        id: 'ocrspace',
        name: 'OCR.space',
        badge: <span className="engine-badge free">{t('ocr.free25k')}</span>,
        body: (
          <div className="ps-config-form">
            {keyField({ label: 'API Key', keyName: 'ocrspaceKey', toggleKey: 'ocrspace', placeholder: 'API Key' })}
          </div>
        ),
        actions: selectButton('ocrspace', !!settings.ocr.ocrspaceKey, () => notify(t('ocr.configKeyFirst'), 'warning')),
      })}
      {engineCard({
        id: 'google-vision',
        name: 'Google Vision',
        badge: <span className="engine-badge free">{t('ocr.free1k')}</span>,
        body: (
          <div className="ps-config-form">
            {keyField({ label: 'API Key', keyName: 'googleVisionKey', toggleKey: 'googleVision', placeholder: 'API Key' })}
          </div>
        ),
        actions: selectButton('google-vision', !!settings.ocr.googleVisionKey, () => notify(t('ocr.configKeyFirst'), 'warning')),
      })}
      {engineCard({
        id: 'azure-ocr',
        name: 'Azure OCR',
        badge: <span className="engine-badge free">{t('ocr.free5k')}</span>,
        body: (
          <div className="ps-config-form">
            {keyField({ label: 'API Key', keyName: 'azureKey', toggleKey: 'azure', placeholder: 'API Key' })}
            {textField({ label: 'Endpoint', keyName: 'azureEndpoint', placeholder: t('ocr.azureEndpoint') })}
          </div>
        ),
        actions: selectButton(
          'azure-ocr',
          !!(settings.ocr.azureKey && settings.ocr.azureEndpoint),
          () => notify(t('ocr.configKeyEndpoint'), 'warning')
        ),
      })}
      {engineCard({
        id: 'baidu-ocr',
        name: t('ocr.baiduOcr'),
        badge: <span className="engine-badge free">{t('ocr.free1k')}</span>,
        body: (
          <div className="ps-config-form">
            {keyField({ label: 'API Key', keyName: 'baiduApiKey', toggleKey: 'baidu', placeholder: 'API Key' })}
            {keyField({ label: 'Secret Key', keyName: 'baiduSecretKey', toggleKey: 'baiduSecret', placeholder: 'Secret Key' })}
          </div>
        ),
        actions: selectButton(
          'baidu-ocr',
          !!(settings.ocr.baiduApiKey && settings.ocr.baiduSecretKey),
          () => notify(t('ocr.configKeySecret'), 'warning')
        ),
      })}
    </div>
  );

  const preprocess = settings.ocr?.enablePreprocess ?? true;

  return (
    <div className="setting-content animate-fade-in">
      <h3>{t('settings.ocr.title')}</h3>

      <div className="setting-group">
        <label className="setting-label">{t('ocr.recognitionLanguage')}</label>
        <LanguagePicker
          value={settings.ocr.recognitionLanguage || 'auto'}
          options={langOptions}
          onChange={(code) => updateSetting('ocr', 'recognitionLanguage', code)}
        />
      </div>

      <div className="setting-group">
        <Switch
          checked={settings.screenshot?.showConfirmButtons ?? true}
          onChange={(on) => updateSetting('screenshot', 'showConfirmButtons', on)}
          label={t('ocr.showConfirmButtons')}
        />
        <Switch
          checked={preprocess}
          onChange={(on) => updateSetting('ocr', 'enablePreprocess', on)}
          label={t('ocr.autoEnlarge')}
        />
        {preprocess && (
          <div className="sub-setting" style={{ marginTop: 10 }}>
            <label className="setting-label">{t('ocr.scaleFactor')}</label>
            <Seg
              size="small"
              value={String(settings.ocr?.scaleFactor || 2)}
              onChange={(v) => updateSetting('ocr', 'scaleFactor', parseFloat(v))}
              options={[
                { value: '1.5', label: '1.5x' },
                { value: '2', label: `2x ${t('ocr.recommended')}` },
                { value: '2.5', label: '2.5x' },
                { value: '3', label: '3x' },
              ]}
            />
          </div>
        )}
      </div>

      <div className="setting-group wide">
        <label className="setting-label">{t('ocr.engineTitle')}</label>
        <Seg
          className="tabs"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'local', icon: <Cpu size={14} />, label: t('ocr.localEngines') },
            { value: 'vision', icon: <Sparkles size={14} />, label: t('ocr.visionModels') },
            { value: 'online', icon: <Globe size={14} />, label: t('ocr.onlineServices') },
          ]}
        />
        {tab === 'local' && localTab}
        {tab === 'vision' && visionTab}
        {tab === 'online' && onlineTab}
      </div>
    </div>
  );
};

export default OcrSection;
