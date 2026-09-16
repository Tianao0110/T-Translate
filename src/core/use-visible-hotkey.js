// Window-level hotkey that only fires while the owning panel is visible.
// Tab panels stay mounted behind inactive tabs (display:none), so a bare
// window listener swallows keys app-wide — this bug class shipped three
// times (DocumentTranslator Ctrl+F, HistoryPanel arrow nav, MainWindow
// ghost search) before being centralized here.

import { useEffect, useRef } from 'react';

export default function useVisibleHotkey(rootRef, matcher, handler) {
  // Refs keep the effect subscription stable while matcher/handler stay fresh.
  const fnRef = useRef();
  fnRef.current = { matcher, handler };

  useEffect(() => {
    const onKeyDown = (e) => {
      const { matcher: match, handler: handle } = fnRef.current;
      if (!match(e)) return;
      // display:none ancestor (inactive tab) → offsetParent is null
      if (!rootRef.current?.offsetParent) return;
      handle(e);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [rootRef]);
}
