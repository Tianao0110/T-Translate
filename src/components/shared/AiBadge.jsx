// Literal "AI" chip standing in for a lucide icon wherever AI output needs
// marking. Draws with currentColor only: the floating/selection windows never
// load App.css tokens, so a theme variable here would silently fail.
import React from 'react';
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
