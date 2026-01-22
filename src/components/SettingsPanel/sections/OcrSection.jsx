// src/components/SettingsPanel/sections/OcrSection.jsx
// OCR 设置区块组件

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff } from 'lucide-react';

/**
 * OCR 设置区块
 */
const OcrSection = ({
  settings,
  updateSetting,
  notify,
  collapsedGroups,
  toggleGroup,
  showApiKeys,
  setShowApiKeys,
  setOcrEngine
}) => {
  const { t } = useTranslation();

  // 切换 API Key 显示状态的辅助函数
  const toggleApiKeyVisibility = (key, e) => {
    e?.stopPropagation();
    setShowApiKeys(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // 选择引擎的辅助函数
  const selectEngine = (engineId, requiredKeys = []) => {
    const missingKey = requiredKeys.find(key => !settings.ocr[key]);
    if (missingKey) {
      notify(t('ocr.configKeyFirst'), 'warning');
      return;
    }
    updateSetting('ocr', 'engine', engineId);
    if (setOcrEngine) setOcrEngine(engineId);
  };

  // API Key 输入框组件
  const ApiKeyInput = ({ keyName, placeholder = 'API Key', value, showKey }) => (
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
        onClick={(e) => toggleApiKeyVisibility(keyName.replace('Key', '').replace('Secret', 'Secret'), e)}
        title={showKey ? t('common.hide') : t('common.show')}
      >
        {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </div>
  );

  return (
    <div className="setting-content animate-fade-in">
      <h3>{t('settings.ocr.title')}</h3>
      <p className="setting-description">{t('ocr.description')}</p>
      
      {/* 1. OCR 识别语言 */}
      <div className="setting-group">
        <label className="setting-label">{t('ocr.recognitionLanguage')}</label>
        <select 
          className="setting-select" 
          value={settings.ocr.recognitionLanguage || 'auto'} 
          onChange={(e) => updateSetting('ocr', 'recognitionLanguage', e.target.value)}
        >
          <option value="auto">🔄 {t('ocr.lang.auto')}</option>
          <option value="zh-Hans">🇨🇳 {t('ocr.lang.zhHans')}</option>
          <option value="zh-Hant">🇹🇼 {t('ocr.lang.zhHant')}</option>
          <option value="en">🇺🇸 {t('ocr.lang.en')}</option>
          <option value="ja">🇯🇵 {t('ocr.lang.ja')}</option>
          <option value="ko">🇰🇷 {t('ocr.lang.ko')}</option>
          <option value="fr">🇫🇷 {t('ocr.lang.fr')}</option>
          <option value="de">🇩🇪 {t('ocr.lang.de')}</option>
          <option value="es">🇪🇸 {t('ocr.lang.es')}</option>
          <option value="ru">🇷🇺 {t('ocr.lang.ru')}</option>
        </select>
        <p className="setting-hint">{t('ocr.autoLangHint')}</p>
      </div>
      
      {/* 2. 截图设置 */}
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

      {/* 3. 图片预处理设置 */}
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

      {/* ========== 第一梯队：本地 OCR ========== */}
      <details className="setting-section" open={!collapsedGroups['ocr-local']}>
        <summary className="section-header" onClick={(e) => { e.preventDefault(); toggleGroup('ocr-local'); }}>
          <span className="section-title">🚀 {t('ocr.localEngines')}</span>
          <span className="section-hint">{t('ocr.localHint')}</span>
        </summary>
        <div className="section-content">
          <div className="ocr-engines-list">
            {/* RapidOCR */}
            <div className={`ocr-engine-item ${settings.ocr.engine === 'rapid-ocr' ? 'active' : ''}`}>
              <div className="engine-info">
                <div className="engine-header">
                  <span className="engine-name">RapidOCR</span>
                  {settings.ocr.rapidInstalled ? (
                    <span className="engine-badge installed">{t('ocr.installed')}</span>
                  ) : (
                    <span className="engine-badge download">{t('ocr.needDownload')}</span>
                  )}
                </div>
                <p className="engine-desc">{t('ocr.rapidDesc')}</p>
              </div>
              <div className="engine-actions">
                {settings.ocr.rapidInstalled ? (
                  <>
                    <button 
                      className={`btn ${settings.ocr.engine === 'rapid-ocr' ? 'active' : ''}`}
                      onClick={() => selectEngine('rapid-ocr')}
                    >
                      {settings.ocr.engine === 'rapid-ocr' ? t('ocr.inUse') : t('ocr.use')}
                    </button>
                    <button 
                      className="btn-small uninstall"
                      onClick={async () => {
                        if (!window.confirm(t('ocr.uninstallConfirm'))) return;
                        notify(t('ocr.uninstalling'), 'info');
                        try {
                          const result = await window.electron?.ocr?.removeEngine?.('rapid-ocr');
                          if (result?.success) {
                            updateSetting('ocr', 'rapidInstalled', false);
                            if (settings.ocr.engine === 'rapid-ocr') selectEngine('llm-vision');
                            notify(t('ocr.uninstalled'), 'success');
                          } else {
                            notify(result?.error || t('ocr.uninstallFailed'), 'error');
                          }
                        } catch (e) {
                          notify(t('ocr.uninstallFailed'), 'error');
                        }
                      }}
                    >
                      {t('ocr.uninstall')}
                    </button>
                  </>
                ) : (
                  <button 
                    className="btn download"
                    onClick={async () => {
                      notify(t('ocr.downloading'), 'info');
                      try {
                        const result = await window.electron?.ocr?.downloadEngine?.('rapid-ocr');
                        if (result?.success) {
                          updateSetting('ocr', 'rapidInstalled', true);
                          notify(t('ocr.downloadComplete'), 'success');
                        } else {
                          notify(result?.error || t('ocr.downloadFailed'), 'error');
                        }
                      } catch (e) {
                        notify(t('ocr.downloadFailed'), 'error');
                      }
                    }}
                  >
                    {t('ocr.download')}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </details>

      {/* ========== 第二梯队：视觉大模型 ========== */}
      <details className="setting-section" open={!collapsedGroups['ocr-vision']}>
        <summary className="section-header" onClick={(e) => { e.preventDefault(); toggleGroup('ocr-vision'); }}>
          <span className="section-title">⚡ {t('ocr.visionModels')}</span>
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

      {/* ========== 第三梯队：在线 OCR API ========== */}
      <details className="setting-section" open={!collapsedGroups['ocr-online']}>
        <summary className="section-header" onClick={(e) => { e.preventDefault(); toggleGroup('ocr-online'); }}>
          <span className="section-title">🌐 {t('ocr.onlineServices')}</span>
          <span className="section-hint">{t('ocr.onlineHint')}</span>
        </summary>
        <div className="section-content">
          <p className="setting-hint" style={{marginBottom: '12px'}}>{t('ocr.onlineNote')}</p>
          <div className="ocr-engines-list">
            {/* OCR.space */}
            <div className={`ocr-engine-item ${settings.ocr.engine === 'ocrspace' ? 'active' : ''}`}>
              <div className="engine-info">
                <div className="engine-header">
                  <span className="engine-name">OCR.space</span>
                  <span className="engine-badge free">{t('ocr.free25k')}</span>
                </div>
                <p className="engine-desc">{t('ocr.ocrspaceDesc')}</p>
                <ApiKeyInput keyName="ocrspaceKey" value={settings.ocr.ocrspaceKey} showKey={showApiKeys.ocrspace} />
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

            {/* Google Vision */}
            <div className={`ocr-engine-item ${settings.ocr.engine === 'google-vision' ? 'active' : ''}`}>
              <div className="engine-info">
                <div className="engine-header">
                  <span className="engine-name">Google Vision</span>
                  <span className="engine-badge free">{t('ocr.free1k')}</span>
                </div>
                <p className="engine-desc">{t('ocr.googleVisionDesc')}</p>
                <ApiKeyInput keyName="googleVisionKey" value={settings.ocr.googleVisionKey} showKey={showApiKeys.googleVision} />
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

            {/* Azure OCR */}
            <div className={`ocr-engine-item ${settings.ocr.engine === 'azure-ocr' ? 'active' : ''}`}>
              <div className="engine-info">
                <div className="engine-header">
                  <span className="engine-name">Azure OCR</span>
                  <span className="engine-badge free">{t('ocr.free5k')}</span>
                </div>
                <p className="engine-desc">{t('ocr.azureDesc')}</p>
                <ApiKeyInput keyName="azureKey" value={settings.ocr.azureKey} showKey={showApiKeys.azure} />
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

            {/* 百度 OCR */}
            <div className={`ocr-engine-item ${settings.ocr.engine === 'baidu-ocr' ? 'active' : ''}`}>
              <div className="engine-info">
                <div className="engine-header">
                  <span className="engine-name">{t('ocr.baiduOcr')}</span>
                  <span className="engine-badge free">{t('ocr.free1k')}</span>
                </div>
                <p className="engine-desc">{t('ocr.baiduDesc')}</p>
                <ApiKeyInput keyName="baiduApiKey" value={settings.ocr.baiduApiKey} showKey={showApiKeys.baidu} />
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
