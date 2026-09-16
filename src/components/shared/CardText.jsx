// The flip-able text block of a history / favorites card: the label with its
// "click to switch" hint, then the highlighted source or target text.

import { RotateCcw } from 'lucide-react';
import HighlightText from './HighlightText.jsx';

const CardText = ({ label, translated, text, search }) => (
  <>
    <div className="card-text-label">
      {label}
      <RotateCcw size={12} className="switch-hint" />
    </div>
    <div className={`card-text ${translated ? 'translated' : 'source'}`}>
      <HighlightText text={text} search={search} />
    </div>
  </>
);

export default CardText;
