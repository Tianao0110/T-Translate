// src/components/SettingsPanel/sections/PrivacySection.jsx
// 隐私与安全设置区块组件 - 从 SettingsPanel 拆分

import React from 'react';
import { Zap, Shield, Lock, CheckCircle, AlertCircle, Trash2 } from 'lucide-react';
import useTranslationStore from '../../../stores/translation-store';
import { PRIVACY_MODES, PRIVACY_MODE_IDS } from '../constants.js';

/**
 * 隐私与安全设置区块
 */
const PrivacySection = ({
  settings,
  updateSetting,
  notify
}) => {
  const currentMode = useTranslationStore.getState().translationMode || PRIVACY_MODE_IDS.STANDARD;
  const modeConfig = PRIVACY_MODES[currentMode];

  // 获取模式图标组件
  const getModeIcon = (iconName, size = 24) => {
    const icons = {
      'Zap': Zap,
      'Shield': Shield,
      'Lock': Lock,
    };
    const IconComponent = icons[iconName] || Zap;
    return <IconComponent size={size} />;
  };

  // 切换隐私模式
  const handleModeChange = (mode) => {
    updateSetting('privacy', 'mode', mode.id);
    useTranslationStore.getState().setTranslationMode(mode.id);
    window.electron?.privacy?.setMode?.(mode.id);
    notify(`已切换到${mode.name}`, 'success');
  };

  // 清除历史记录
  const handleClearHistory = () => {
    if (window.confirm('确定要清除所有翻译历史吗？')) {
      useTranslationStore.getState().clearHistory?.();
      notify('历史记录已清除', 'success');
    }
  };

  // 清除所有数据
  const handleClearAllData = () => {
    if (window.confirm('确定要清除所有本地数据吗？这将重置所有设置。')) {
      localStorage.clear();
      window.electron?.store?.clear?.();
      window.location.reload();
    }
  };

  return (
    <div className="setting-content">
      <h3>隐私与安全模式</h3>
      <p className="setting-description">选择适合您需求的工作模式，不同模式下可用功能不同</p>
      
      {/* 当前模式状态提示 */}
      <div className={`current-mode-banner mode-${currentMode}`}>
        <div className="mode-banner-icon">
          {getModeIcon(modeConfig?.icon, 20)}
        </div>
        <div className="mode-banner-info">
          <span className="mode-banner-label">当前模式</span>
          <span className="mode-banner-name">{modeConfig?.name}</span>
        </div>
      </div>
      
      {/* 模式选择卡片 */}
      <div className="mode-selection-grid">
        {Object.values(PRIVACY_MODES).map((mode) => {
          const isSelected = currentMode === mode.id;
          
          return (
            <div 
              key={mode.id}
              className={`mode-card ${isSelected ? 'selected' : ''}`}
              onClick={() => handleModeChange(mode)}
            >
              <div className="mode-icon">{getModeIcon(mode.icon)}</div>
              <div className="mode-info">
                <h4>{mode.name}</h4>
                <p>{mode.description}</p>
              </div>
              {isSelected && <div className="mode-check"><CheckCircle size={18} /></div>}
            </div>
          );
        })}
      </div>

      {/* 当前模式功能说明 */}
      <div className="mode-features-panel">
        <h4>📋 当前模式功能说明</h4>
        <div className="feature-list">
          <div className={`feature-item ${modeConfig?.features.saveHistory ? 'enabled' : 'disabled'}`}>
            <span className="feature-icon">{modeConfig?.features.saveHistory ? '✓' : '✗'}</span>
            <span className="feature-name">历史记录</span>
            <span className="feature-status">{modeConfig?.features.saveHistory ? '保存' : '不保存'}</span>
          </div>
          <div className={`feature-item ${modeConfig?.features.useCache ? 'enabled' : 'disabled'}`}>
            <span className="feature-icon">{modeConfig?.features.useCache ? '✓' : '✗'}</span>
            <span className="feature-name">翻译缓存</span>
            <span className="feature-status">{modeConfig?.features.useCache ? '启用' : '禁用'}</span>
          </div>
          <div className={`feature-item ${modeConfig?.features.onlineApi ? 'enabled' : 'disabled'}`}>
            <span className="feature-icon">{modeConfig?.features.onlineApi ? '✓' : '✗'}</span>
            <span className="feature-name">在线翻译API</span>
            <span className="feature-status">{modeConfig?.features.onlineApi ? '允许' : '禁止'}</span>
          </div>
          <div className={`feature-item ${modeConfig?.features.analytics ? 'enabled' : 'disabled'}`}>
            <span className="feature-icon">{modeConfig?.features.analytics ? '✓' : '✗'}</span>
            <span className="feature-name">使用统计</span>
            <span className="feature-status">{modeConfig?.features.analytics ? '收集' : '不收集'}</span>
          </div>
        </div>
        
        {currentMode === PRIVACY_MODE_IDS.OFFLINE && (
          <div className="mode-warning">
            <AlertCircle size={16} />
            <span>离线模式下仅可使用本地 LLM 翻译，在线翻译源（OpenAI、DeepL等）将被禁用</span>
          </div>
        )}
        
        {currentMode === PRIVACY_MODE_IDS.SECURE && (
          <div className="mode-warning secure">
            <Shield size={16} />
            <span>无痕模式下所有翻译记录仅存在于当前会话，关闭应用后自动清除</span>
          </div>
        )}
      </div>

      {/* 数据管理 */}
      <div className="setting-group" style={{marginTop: '24px', paddingTop: '16px', borderTop: '1px solid var(--border-primary)'}}>
        <h4 style={{marginBottom: '16px', color: 'var(--text-primary)'}}>🗂️ 数据管理</h4>
        
        <div className="setting-row">
          <span>自动删除历史记录</span>
          <div className="input-with-suffix">
            <input
              type="number"
              className="setting-input small"
              value={settings.privacy?.autoDeleteDays || 0}
              onChange={(e) => updateSetting('privacy', 'autoDeleteDays', parseInt(e.target.value) || 0)}
              min="0"
              max="365"
              disabled={currentMode === PRIVACY_MODE_IDS.SECURE}
            />
            <span className="input-suffix">天后</span>
          </div>
        </div>
        <p className="setting-hint">
          设为 0 表示永不自动删除
          {currentMode === PRIVACY_MODE_IDS.SECURE ? '（无痕模式下此选项无效）' : ''}
        </p>
      </div>

      <div className="setting-group">
        <div className="danger-actions">
          <button className="danger-button" onClick={handleClearHistory}>
            <Trash2 size={16} /> 清除历史记录
          </button>
          <button className="danger-button" onClick={handleClearAllData}>
            <Trash2 size={16} /> 清除所有数据
          </button>
        </div>
      </div>
    </div>
  );
};

export default PrivacySection;
