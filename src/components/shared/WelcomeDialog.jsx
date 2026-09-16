import { MousePointerClick, Crop, Layers, FileText, ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import './welcome-dialog.css';

/**
 * Shown once, on the first launch: what the app can do and where to start.
 * It configures nothing (docs/design/renderer.md §9).
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
