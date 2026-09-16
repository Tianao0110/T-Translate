import { useCallback, useEffect, useState } from 'react';
import translationService from './stack-client.js';
import createLogger from '../core/logger.js';

const logger = createLogger('useTranslationReadiness');

/**
 * Whether the app can translate anything right now. Re-checked whenever
 * the stack reloads. `null` means unknown and callers say nothing.
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
