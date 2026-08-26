import { Lightbulb, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import './one-time-hint.css';

/**
 * A small bubble pointing at a control the user has not met yet.
 *
 * Deliberately only used in the two places the design named. A hint on every
 * control means the first launch pops something everywhere the eye lands,
 * which trains the user to dismiss without reading — and then the two hints
 * that would have helped get dismissed too.
 *
 * Renders nothing once dismissed, and dismissal is permanent — the only way
 * back is the full settings reset, which clears the onboarding flags with
 * everything else.
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
