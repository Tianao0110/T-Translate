// src/components/SettingsPanel/sections/shared.jsx
// 设置面板子组件共享的工具和类型

import { Eye, EyeOff } from 'lucide-react';

/**
 * 设置项通用 Props 类型定义（JSDoc）
 * @typedef {Object} SectionProps
 * @property {Object} settings - 当前设置对象
 * @property {Function} updateSetting - 更新设置的函数 (category, key, value)
 * @property {Function} notify - 通知函数 (message, type)
 * @property {Object} [collapsedGroups] - 折叠状态
 * @property {Function} [toggleGroup] - 切换折叠状态
 * @property {Object} [showApiKeys] - API Key 显示状态
 * @property {Function} [setShowApiKeys] - 设置 API Key 显示状态
 */

/**
 * API Key 输入框组件
 */
export const ApiKeyInput = ({ 
  value, 
  onChange, 
  placeholder = 'API Key',
  showKey,
  onToggleShow,
  className = ''
}) => {
  return (
    <div className={`api-key-input-wrapper ${className}`}>
      <input 
        type={showKey ? "text" : "password"}
        className="setting-input compact"
        placeholder={placeholder}
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
      />
      <button 
        type="button"
        className="api-key-toggle"
        onClick={onToggleShow}
      >
        {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </div>
  );
};

/**
 * 设置分组组件
 */
export const SettingGroup = ({ 
  label, 
  hint, 
  children,
  className = ''
}) => {
  return (
    <div className={`setting-group ${className}`}>
      {label && <label className="setting-label">{label}</label>}
      {children}
      {hint && <p className="setting-hint">{hint}</p>}
    </div>
  );
};

/**
 * 开关设置组件
 */
export const ToggleSetting = ({
  checked,
  onChange,
  label,
  hint,
  disabled = false
}) => {
  return (
    <div className="setting-group">
      <label className="setting-toggle">
        <input 
          type="checkbox" 
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
        />
        <span>{label}</span>
      </label>
      {hint && <p className="setting-hint">{hint}</p>}
    </div>
  );
};

/**
 * 可折叠设置区块
 */
export const CollapsibleSection = ({
  id,
  title,
  hint,
  children,
  collapsed,
  onToggle,
  defaultOpen = true
}) => {
  const isOpen = collapsed !== undefined ? !collapsed : defaultOpen;
  
  return (
    <details className="setting-section" open={isOpen}>
      <summary 
        className="section-header" 
        onClick={(e) => { 
          e.preventDefault(); 
          onToggle?.(id); 
        }}
      >
        <span className="section-title">{title}</span>
        {hint && <span className="section-hint">{hint}</span>}
      </summary>
      <div className="section-content">
        {children}
      </div>
    </details>
  );
};

/**
 * OCR 引擎项组件
 */
export const OcrEngineItem = ({
  name,
  description,
  meta,
  badge,
  badgeType = 'default',
  isActive,
  onSelect,
  actions,
  apiKeyInput,
  testButton
}) => {
  return (
    <div className={`ocr-engine-item ${isActive ? 'active' : ''}`}>
      <div className="engine-info">
        <div className="engine-header">
          <span className="engine-name">{name}</span>
          {badge && (
            <span className={`engine-badge ${badgeType}`}>{badge}</span>
          )}
        </div>
        <p className="engine-desc">{description}</p>
        {meta && <p className="engine-meta">{meta}</p>}
        {apiKeyInput}
      </div>
      <div className="engine-actions">
        {actions || (
          <button 
            className={`btn ${isActive ? 'active' : ''}`}
            onClick={onSelect}
          >
            {isActive ? '✓ 使用中' : '使用'}
          </button>
        )}
        {testButton}
      </div>
    </div>
  );
};

export default {
  ApiKeyInput,
  SettingGroup,
  ToggleSetting,
  CollapsibleSection,
  OcrEngineItem,
};
