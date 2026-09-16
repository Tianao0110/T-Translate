import './ai-badge.css';

const AiBadge = ({ size = 14 }) => (
  <span
    className="ai-text-badge"
    style={{ height: size, fontSize: Math.max(8, Math.round(size * 0.64)) }}
  >
    AI
  </span>
);

export default AiBadge;
