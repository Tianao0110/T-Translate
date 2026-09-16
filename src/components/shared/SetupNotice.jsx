import { AlertCircle, ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import './setup-notice.css';

/**
 * Persistent strip for "no translation source can be reached"; clears
 * itself when the stack reloads with something usable. Renders nothing
 * while readiness is unknown (`null`).
 */
export default function SetupNotice({ readiness, onOpenSettings }) {
  const { t } = useTranslation();
  if (!readiness || readiness.ready) return null;

  const { reason } = readiness;
  const text = reason === 'local-unreachable' ? t('setupNotice.localUnreachable')
    : reason === 'offline-remote-endpoint' ? t('setupNotice.offlineRemote')
    : t('setupNotice.noProvider');
  // Nothing configured needs setting up; anything else needs a look at what is.
  const action = reason === 'no-provider' ? t('setupNotice.setUp') : t('setupNotice.checkProviders');

  return (
    <div className="setup-notice" role="status">
      <AlertCircle size={16} />
      <span className="setup-notice-text">{text}</span>
      <button className="setup-notice-action" onClick={onOpenSettings}>
        {action}
        <ArrowRight size={13} />
      </button>
    </div>
  );
}
