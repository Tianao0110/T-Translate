// Reusable building blocks for settings sections.

import { Eye, EyeOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';

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
  const { t } = useTranslation();
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
            {isActive ? t('ocr.inUse') : t('ocr.use')}
          </button>
        )}
        {testButton}
      </div>
    </div>
  );
};

// Segmented control — the one style for every "pick one of these" setting.
// options: [{ value, label, icon?, disabled? }]
export const Seg = ({ value, options, onChange, size, className = '' }) => (
  <div className={`seg ${size === 'small' ? 'small' : ''} ${className}`.trim()}>
    {options.map((o) => (
      <button
        key={o.value}
        type="button"
        className={o.value === value ? 'on' : ''}
        disabled={o.disabled}
        onClick={() => onChange(o.value)}
      >
        {o.icon}
        {o.label}
      </button>
    ))}
  </div>
);

// Pill switch — the one style for every on/off setting.
export const Switch = ({ checked, onChange, label, disabled = false }) => (
  <label className="setting-switch">
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
    />
    <span className="switch-slider"></span>
    <span className="switch-label">{label}</span>
  </label>
);

// Compact slider: label and current value on one line, track below. Put one
// or more inside <div className="sliders"> so they share the row.
export const Slider = ({ label, display, value, min, max, step = 1, onChange, disabled = false }) => (
  <div className={`sl ${disabled ? 'off' : ''}`.trim()}>
    <div className="sl-head">
      <span>{label}</span>
      <span className="tts-slider-value">{display}</span>
    </div>
    <input
      type="range"
      className="setting-range"
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(parseFloat(e.target.value))}
    />
  </div>
);

export default {
  ApiKeyInput,
  SettingGroup,
  ToggleSetting,
  CollapsibleSection,
  OcrEngineItem,
  Seg,
  Switch,
  Slider,
};
