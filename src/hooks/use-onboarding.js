import { useCallback, useEffect, useState } from 'react';

const STORE_KEY = 'onboarding';

/**
 * What the user has already been shown.
 *
 * Lives in electron-store rather than the zustand persist, because it is
 * app-level state that Settings resets and that has nothing to do with
 * translation content — and because a user who clears their history should not
 * be greeted by the welcome dialog again.
 *
 * Every read defaults to "already seen". A store that fails to answer must not
 * cause the welcome dialog to appear on someone's hundredth launch; showing a
 * hint one time too few is a non-event, one time too many is an annoyance the
 * user cannot stop.
 */
export default function useOnboarding() {
  const [state, setState] = useState(null);

  useEffect(() => {
    let cancelled = false;
    window.electron?.store?.get?.(STORE_KEY)
      .then((value) => { if (!cancelled) setState(value || { welcomeSeen: false, hints: {} }); })
      // A store that cannot be read cannot be written either, so a hint shown
      // now would come back on every launch with its dismiss button doing
      // nothing. Treat everything as already seen.
      .catch(() => { if (!cancelled) setState({ welcomeSeen: true, hints: {}, unavailable: true }); });
    return () => { cancelled = true; };
  }, []);

  const persist = useCallback((next) => {
    setState(next);
    window.electron?.store?.set?.(STORE_KEY, next);
  }, []);

  const markWelcomeSeen = useCallback(() => {
    persist({ ...(state || {}), welcomeSeen: true, hints: state?.hints || {} });
  }, [state, persist]);

  const dismissHint = useCallback((id) => {
    persist({
      welcomeSeen: state?.welcomeSeen ?? true,
      hints: { ...(state?.hints || {}), [id]: true },
    });
  }, [state, persist]);

  const reset = useCallback(() => {
    persist({ welcomeSeen: false, hints: {} });
  }, [persist]);

  return {
    // null until the store answers — callers show nothing while it is null.
    loaded: state !== null,
    showWelcome: state !== null && !state.welcomeSeen,
    hintSeen: useCallback(
      (id) => state?.unavailable === true || state?.hints?.[id] === true,
      [state]
    ),
    markWelcomeSeen,
    dismissHint,
    reset,
  };
}
