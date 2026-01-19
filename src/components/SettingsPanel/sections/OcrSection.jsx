// src/components/SettingsPanel/sections/OcrSection.jsx
// OCR 设置区块组件

import React from 'react';
import { Eye, EyeOff } from 'lucide-react';

/**
 * OCR 设置区块
 * @param {Object} props
 * @param {Object} props.settings - 设置对象
 * @param {Function} props.updateSetting - 更新设置函数
 * @param {Function} props.notify - 通知函数
 * @param {Object} props.collapsedGroups - 折叠状态
 * @param {Function} props.toggleGroup - 切换折叠
 * @param {Object} props.showApiKeys - API Key 显示状态
 * @param {Function} props.setShowApiKeys - 设置 API Key 显示
 * @param {Function} props.setOcrEngine - 设置 OCR 引擎（store）
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
  // 切换 API Key 显示状态的辅助函数
  const toggleApiKeyVisibility = (key, e) => {
    e?.stopPropagation();
    setShowApiKeys(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // 选择引擎的辅助函数
  const selectEngine = (engineId, requiredKeys = []) => {
    // 检查是否配置了必要的 Key
    const missingKey = requiredKeys.find(key => !settings.ocr[key]);
    if (missingKey) {
      notify('请先配置 API Key', 'warning');
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
        title={showKey ? "隐藏" : "显示"}
      >
        {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </div>
  );

  return (
    <div className="setting-content animate-fade-in">
      <h3>OCR 设置</h3>
      <p className="setting-description">配置文字识别引擎和语言</p>
      
      {/* 1. OCR 识别语言 */}
      <div className="setting-group">
        <label className="setting-label">识别语言</label>
        <select 
          className="setting-select" 
          value={settings.ocr.recognitionLanguage || 'auto'} 
          onChange={(e) => updateSetting('ocr', 'recognitionLanguage', e.target.value)}
        >
          <option value="auto">🔄 自动检测</option>
          <option value="zh-Hans">🇨🇳 简体中文</option>
          <option value="zh-Hant">🇹🇼 繁体中文</option>
          <option value="en">🇺🇸 英文</option>
          <option value="ja">🇯🇵 日文</option>
          <option value="ko">🇰🇷 韩文</option>
          <option value="fr">🇫🇷 法文</option>
          <option value="de">🇩🇪 德文</option>
          <option value="es">🇪🇸 西班牙文</option>
          <option value="ru">🇷🇺 俄文</option>
        </select>
        <p className="setting-hint">
          选择"自动检测"时，将根据翻译设置自动选择
        </p>
      </div>
      
      {/* 2. 截图设置 */}
      <div className="setting-group">
        <label className="setting-toggle">
          <input 
            type="checkbox" 
            checked={settings.screenshot?.showConfirmButtons ?? true}
            onChange={(e) => updateSetting('screenshot', 'showConfirmButtons', e.target.checked)}
          />
          <span>显示截图确认按钮</span>
        </label>
        <p className="setting-hint">
          启用后，选择区域后需点击确认或按 Enter 键
        </p>
      </div>

      {/* 3. 图片预处理设置 */}
      <div className="setting-group">
        <label className="setting-toggle">
          <input 
            type="checkbox" 
            checked={settings.ocr?.enablePreprocess ?? true}
            onChange={(e) => updateSetting('ocr', 'enablePreprocess', e.target.checked)}
          />
          <span>自动放大小图片</span>
        </label>
        <p className="setting-hint">
          小字体（&lt;15px）识别率低，自动放大可提升准确率
        </p>
        {(settings.ocr?.enablePreprocess ?? true) && (
          <div className="sub-setting">
            <label className="setting-label">放大倍数</label>
            <select 
              className="setting-select"
              value={settings.ocr?.scaleFactor || 2}
              onChange={(e) => updateSetting('ocr', 'scaleFactor', parseFloat(e.target.value))}
              style={{width: '120px'}}
            >
              <option value="1.5">1.5x</option>
              <option value="2">2x（推荐）</option>
              <option value="2.5">2.5x</option>
              <option value="3">3x</option>
            </select>
          </div>
        )}
      </div>

      {/* ========== 第一梯队：本地 OCR ========== */}
      <details className="setting-section" open={!collapsedGroups['ocr-local']}>
        <summary className="section-header" onClick={(e) => { e.preventDefault(); toggleGroup('ocr-local'); }}>
          <span className="section-title">🚀 本地 OCR 引擎</span>
          <span className="section-hint">毫秒级响应，推荐优先使用</span>
        </summary>
        <div className="section-content">
          <div className="ocr-engines-list">
            {/* RapidOCR */}
            <div className={`ocr-engine-item ${settings.ocr.engine === 'rapid-ocr' ? 'active' : ''}`}>
              <div className="engine-info">
                <div className="engine-header">
                  <span className="engine-name">RapidOCR</span>
                  {settings.ocr.rapidInstalled ? (
                    <span className="engine-badge installed">已安装</span>
                  ) : (
                    <span className="engine-badge download">需下载 ~60MB</span>
                  )}
                </div>
                <p className="engine-desc">基于 PP-OCRv4，标准文字识别率 98%+，速度最快</p>
              </div>
              <div className="engine-actions">
                {settings.ocr.rapidInstalled ? (
                  <>
                    <button 
                      className={`btn ${settings.ocr.engine === 'rapid-ocr' ? 'active' : ''}`}
                      onClick={() => selectEngine('rapid-ocr')}
                    >
                      {settings.ocr.engine === 'rapid-ocr' ? '✓ 使用中' : '使用'}
                    </button>
                    <button 
                      className="btn-small uninstall"
                      onClick={async () => {
                        if (!window.confirm('确定要卸载 RapidOCR 吗？')) return;
                        notify('正在卸载...', 'info');
                        try {
                          const result = await window.electron?.ocr?.removeEngine?.('rapid-ocr');
                          if (result?.success) {
                            updateSetting('ocr', 'rapidInstalled', false);
                            if (settings.ocr.engine === 'rapid-ocr') {
                              selectEngine('llm-vision');
                            }
                            notify('已卸载', 'success');
                          } else {
                            notify(result?.error || '卸载失败', 'error');
                          }
                        } catch (e) {
                          notify('卸载失败', 'error');
                        }
                      }}
                    >
                      卸载
                    </button>
                  </>
                ) : (
                  <button 
                    className="btn download"
                    onClick={async () => {
                      notify('开始下载 RapidOCR...', 'info');
                      try {
                        const result = await window.electron?.ocr?.downloadEngine?.('rapid-ocr');
                        if (result?.success) {
                          updateSetting('ocr', 'rapidInstalled', true);
                          notify('下载完成！建议重启应用', 'success');
                        } else {
                          notify(result?.error || '下载失败', 'error');
                        }
                      } catch (e) {
                        notify('下载失败', 'error');
                      }
                    }}
                  >
                    下载
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
          <span className="section-title">⚡ 视觉大模型</span>
          <span className="section-hint">深度识别，处理复杂场景</span>
        </summary>
        <div className="section-content">
          <div className="ocr-engines-list">
            <div className={`ocr-engine-item ${settings.ocr.engine === 'llm-vision' ? 'active' : ''}`}>
              <div className="engine-info">
                <div className="engine-header">
                  <span className="engine-name">LLM Vision</span>
                  <span className="engine-badge builtin">内置</span>
                </div>
                <p className="engine-desc">处理艺术字、手写体、模糊文字、漫画气泡等复杂场景</p>
                <p className="engine-meta">需要 LM Studio + 视觉模型（如 Qwen-VL）</p>
              </div>
              <div className="engine-actions">
                <button 
                  className={`btn ${settings.ocr.engine === 'llm-vision' ? 'active' : ''}`}
                  onClick={() => selectEngine('llm-vision')}
                >
                  {settings.ocr.engine === 'llm-vision' ? '✓ 使用中' : '使用'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </details>

      {/* ========== 第三梯队：在线 OCR API ========== */}
      <details className="setting-section" open={!collapsedGroups['ocr-online']}>
        <summary className="section-header" onClick={(e) => { e.preventDefault(); toggleGroup('ocr-online'); }}>
          <span className="section-title">🌐 在线 OCR 服务</span>
          <span className="section-hint">精准模式，需联网</span>
        </summary>
        <div className="section-content">
          <p className="setting-hint" style={{marginBottom: '12px'}}>
            商业 API 训练数据最多，识别精度最高。隐私模式下自动禁用。
          </p>
          <div className="ocr-engines-list">
            {/* OCR.space */}
            <div className={`ocr-engine-item ${settings.ocr.engine === 'ocrspace' ? 'active' : ''}`}>
              <div className="engine-info">
                <div className="engine-header">
                  <span className="engine-name">OCR.space</span>
                  <span className="engine-badge free">免费 25000次/月</span>
                </div>
                <p className="engine-desc">免费额度最高，支持 25+ 语言</p>
                <ApiKeyInput 
                  keyName="ocrspaceKey" 
                  value={settings.ocr.ocrspaceKey}
                  showKey={showApiKeys.ocrspace}
                />
              </div>
              <div className="engine-actions">
                <button 
                  className={`btn ${settings.ocr.engine === 'ocrspace' ? 'active' : ''} ${!settings.ocr.ocrspaceKey ? 'disabled' : ''}`}
                  onClick={() => selectEngine('ocrspace', ['ocrspaceKey'])}
                >
                  {settings.ocr.engine === 'ocrspace' ? '✓ 使用中' : '使用'}
                </button>
              </div>
            </div>

            {/* Google Vision */}
            <div className={`ocr-engine-item ${settings.ocr.engine === 'google-vision' ? 'active' : ''}`}>
              <div className="engine-info">
                <div className="engine-header">
                  <span className="engine-name">Google Vision</span>
                  <span className="engine-badge free">免费 1000次/月</span>
                </div>
                <p className="engine-desc">识别效果最好，支持 200+ 语言</p>
                <ApiKeyInput 
                  keyName="googleVisionKey" 
                  value={settings.ocr.googleVisionKey}
                  showKey={showApiKeys.googleVision}
                />
              </div>
              <div className="engine-actions">
                <button 
                  className={`btn ${settings.ocr.engine === 'google-vision' ? 'active' : ''} ${!settings.ocr.googleVisionKey ? 'disabled' : ''}`}
                  onClick={() => selectEngine('google-vision', ['googleVisionKey'])}
                >
                  {settings.ocr.engine === 'google-vision' ? '✓ 使用中' : '使用'}
                </button>
              </div>
            </div>

            {/* Azure OCR */}
            <div className={`ocr-engine-item ${settings.ocr.engine === 'azure-ocr' ? 'active' : ''}`}>
              <div className="engine-info">
                <div className="engine-header">
                  <span className="engine-name">Azure OCR</span>
                  <span className="engine-badge free">免费 5000次/月</span>
                </div>
                <p className="engine-desc">微软认知服务，手写识别强</p>
                <ApiKeyInput 
                  keyName="azureKey" 
                  value={settings.ocr.azureKey}
                  showKey={showApiKeys.azure}
                />
                <div className="api-key-input-wrapper" style={{marginTop: '6px'}}>
                  <input 
                    type="text"
                    className="setting-input compact"
                    placeholder="Endpoint (如 https://xxx.cognitiveservices.azure.com)"
                    value={settings.ocr.azureEndpoint || ''}
                    onChange={(e) => updateSetting('ocr', 'azureEndpoint', e.target.value)}
                  />
                </div>
              </div>
              <div className="engine-actions">
                <button 
                  className={`btn ${settings.ocr.engine === 'azure-ocr' ? 'active' : ''} ${!(settings.ocr.azureKey && settings.ocr.azureEndpoint) ? 'disabled' : ''}`}
                  onClick={() => {
                    if (settings.ocr.azureKey && settings.ocr.azureEndpoint) {
                      selectEngine('azure-ocr');
                    } else {
                      notify('请先配置 API Key 和 Endpoint', 'warning');
                    }
                  }}
                >
                  {settings.ocr.engine === 'azure-ocr' ? '✓ 使用中' : '使用'}
                </button>
              </div>
            </div>

            {/* 百度 OCR */}
            <div className={`ocr-engine-item ${settings.ocr.engine === 'baidu-ocr' ? 'active' : ''}`}>
              <div className="engine-info">
                <div className="engine-header">
                  <span className="engine-name">百度 OCR</span>
                  <span className="engine-badge free">免费 1000次/月</span>
                </div>
                <p className="engine-desc">中文识别强，支持身份证、银行卡等</p>
                <ApiKeyInput 
                  keyName="baiduApiKey" 
                  value={settings.ocr.baiduApiKey}
                  showKey={showApiKeys.baidu}
                />
                <div className="api-key-input-wrapper" style={{marginTop: '6px'}}>
                  <input 
                    type={showApiKeys.baiduSecret ? "text" : "password"}
                    className="setting-input compact"
                    placeholder="Secret Key"
                    value={settings.ocr.baiduSecretKey || ''}
                    onChange={(e) => updateSetting('ocr', 'baiduSecretKey', e.target.value)}
                  />
                  <button 
                    type="button"
                    className="api-key-toggle"
                    onClick={(e) => toggleApiKeyVisibility('baiduSecret', e)}
                  >
                    {showApiKeys.baiduSecret ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
              <div className="engine-actions">
                <button 
                  className={`btn ${settings.ocr.engine === 'baidu-ocr' ? 'active' : ''} ${!(settings.ocr.baiduApiKey && settings.ocr.baiduSecretKey) ? 'disabled' : ''}`}
                  onClick={() => {
                    if (settings.ocr.baiduApiKey && settings.ocr.baiduSecretKey) {
                      selectEngine('baidu-ocr');
                    } else {
                      notify('请先配置 API Key 和 Secret Key', 'warning');
                    }
                  }}
                >
                  {settings.ocr.engine === 'baidu-ocr' ? '✓ 使用中' : '使用'}
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
