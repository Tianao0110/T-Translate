import { AlertCircle, ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import './setup-notice.css';

/**
 * The one thing a new install gets wrong: no translation source it can reach.
 *
 * A persistent strip rather than a toast, because it is a standing condition,
 * not an event — and it clears itself the moment the stack reloads with
 * something usable, so there is nothing to dismiss and no state to remember.
 *
 * Renders nothing when readiness is unknown (`null`). Saying "translation is
 * not set up" because the check has not answered yet would be a lie shown to
 * exactly the users least able to tell it is one.
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
