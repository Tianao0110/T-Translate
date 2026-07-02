// Promise-based confirm dialog replacing window.confirm (which blocks the
// renderer thread and ignores the app's theme).
//
// Usage:
//   const [confirm, confirmDialog] = useConfirm();
//   ...
//   if (!(await confirm(t('history.clearAllConfirm')))) return;
//   ...
//   return <div>...{confirmDialog}</div>;

import { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import './confirm-dialog.css';

function ConfirmDialog({ message, danger, onConfirm, onCancel }) {
  const { t } = useTranslation();

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter') onConfirm();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onConfirm, onCancel]);

  return (
    <div className="confirm-overlay" onClick={onCancel}>
      <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
        <div className={`confirm-icon ${danger ? 'danger' : ''}`}>
          <AlertTriangle size={22} />
        </div>
        <p className="confirm-message">{message}</p>
        <div className="confirm-actions">
          <button className="confirm-btn cancel" onClick={onCancel} autoFocus>
            {t('common.cancel')}
          </button>
          <button className={`confirm-btn ${danger ? 'danger' : 'primary'}`} onClick={onConfirm}>
            {t('common.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}

export function useConfirm() {
  const [request, setRequest] = useState(null);
  const resolverRef = useRef(null);

  const confirm = useCallback((message, { danger = true } = {}) => {
    return new Promise((resolve) => {
      resolverRef.current = resolve;
      setRequest({ message, danger });
    });
  }, []);

  const close = useCallback((result) => {
    setRequest(null);
    resolverRef.current?.(result);
    resolverRef.current = null;
  }, []);

  const dialog = request ? (
    <ConfirmDialog
      message={request.message}
      danger={request.danger}
      onConfirm={() => close(true)}
      onCancel={() => close(false)}
    />
  ) : null;

  return [confirm, dialog];
}

export default ConfirmDialog;
