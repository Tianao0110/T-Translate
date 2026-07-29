// Action configs name their icon as a string (they are data, and imported
// actions cannot ship components), so the lucide component is resolved here.
// An unknown name falls back rather than rendering nothing.

import React from 'react';
import { ScrollText, Sparkles, Lightbulb, BookOpen, Brain } from 'lucide-react';

const ICONS = { ScrollText, Sparkles, Lightbulb, BookOpen, Brain };

const AiActionIcon = ({ name, size = 14 }) => {
  const Icon = ICONS[name] || Sparkles;
  return <Icon size={size} />;
};

export default AiActionIcon;
