import { useCallback, useEffect, useState } from 'react';
import translationService from '../services/stack-client.js';
import createLogger from '../utils/logger.js';

const logger = createLogger('useTranslationReadiness');

/**
 * Whether the app can translate anything right now.
 *
 * Re-checked whenever the stack reloads, which is what happens when a provider
 * is added, keyed, enabled or reordered — so the notice clears itself the
 * moment the user fixes the thing it is pointing at, with nothing to dismiss.
 *
 * `null` means unknown (no main-process bridge, or the check has not returned
 * yet) and callers must treat it as "say nothing". Warning that translation is
 * broken because we have not asked yet would be worse than staying quiet.
 */
export default function useTranslationReadiness() {
  const [readiness, setReadiness] = useState(null);

  const check = useCallback(() => {
    translationService.getReadiness()
      .then((result) => setReadiness(result))
      .catch((e) => {
        logger.warn('Readiness check failed:', e?.message);
        setReadiness(null);
      });
  }, []);

  useEffect(() => {
    check();
    const off = translationService.onChanged?.(check);
    return () => { if (off) off(); };
  }, [check]);

  return { readiness, recheck: check };
}
