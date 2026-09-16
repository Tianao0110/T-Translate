import { Lightbulb, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import './one-time-hint.css';

/**
 * A small bubble pointing at a control the user has not met yet. Used in
 * two places only; dismissal is permanent until a full settings reset
 * (docs/design/renderer.md §9).
 */
export default function OneTimeHint({ id, text, seen, onDismiss, placement = 'bottom' }) {
  const { t } = useTranslation();
  if (seen) return null;

  return (
    <div className={`one-time-hint ${placement}`} role="note">
      <Lightbulb size={13} />
      <span className="one-time-hint-text">{text}</span>
      <button
        className="one-time-hint-dismiss"
        onClick={() => onDismiss(id)}
        title={t('guide.dismiss')}
      >
        <X size={12} />
      </button>
    </div>
  );
}
