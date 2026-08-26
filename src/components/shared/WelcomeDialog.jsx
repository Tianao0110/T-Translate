import { MousePointerClick, Crop, Layers, FileText, ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import './welcome-dialog.css';

/**
 * Shown once, on the first launch.
 *
 * It says what the app can do and where to start — it does not configure
 * anything. A first-run wizard that asks for an API key before the user knows
 * what they are buying into is the thing this deliberately is not; the setup
 * notice on the translate panel covers "you still need a provider", at the
 * moment it actually matters.
 */
const FEATURES = [
  { id: 'selection', Icon: MousePointerClick },
  { id: 'screenshot', Icon: Crop },
  { id: 'floatingWindow', Icon: Layers },
  { id: 'document', Icon: FileText },
];

export default function WelcomeDialog({ onClose }) {
  const { t } = useTranslation();

  return (
    <div className="welcome-overlay" onClick={onClose}>
      <div className="welcome-dialog" onClick={(e) => e.stopPropagation()}>
        <h2>{t('app.name')}</h2>
        <p className="welcome-subtitle">{t('guide.subtitle')}</p>

        <div className="welcome-grid">
          {FEATURES.map(({ id, Icon }) => (
            <div key={id} className="welcome-card">
              <Icon size={18} />
              <div>
                <div className="welcome-card-title">{t(`guide.${id}.title`)}</div>
                <div className="welcome-card-desc">{t(`guide.${id}.desc`)}</div>
              </div>
            </div>
          ))}
        </div>

        <p className="welcome-next">{t('guide.next')}</p>

        <button className="welcome-start" onClick={onClose}>
          {t('guide.start')}
          <ArrowRight size={15} />
        </button>
      </div>
    </div>
  );
}
