// Reusable building blocks for settings sections.

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
