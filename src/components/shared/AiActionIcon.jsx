// Action configs name their icon as a string (they are data, and imported
// actions cannot ship components), so the lucide component is resolved here.
// 'ai' renders the literal AI text chip instead of a lucide glyph; an unknown
// name falls back rather than rendering nothing.

import React from 'react';
import { ScrollText, Sparkles, Lightbulb, BookOpen, Brain, ClipboardList } from 'lucide-react';
import AiBadge from './AiBadge.jsx';

const ICONS = { ScrollText, Sparkles, Lightbulb, BookOpen, Brain, ClipboardList };

const AiActionIcon = ({ name, size = 14 }) => {
  if (name === 'ai') return <AiBadge size={size} />;
  const Icon = ICONS[name] || Sparkles;
  return <Icon size={size} />;
};

export default AiActionIcon;
