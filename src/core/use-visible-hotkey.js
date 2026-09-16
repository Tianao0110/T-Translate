// Window-level hotkey that only fires while the owning panel is visible
// (tab panels stay mounted behind inactive tabs).

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
