// Capture level meter for listen mode: moves at the audio callback's rate,
// painted from a rAF loop reading a ref so it never re-renders the
// transcript. Design notes: docs/design/renderer.md §4.

import { useEffect, useRef } from 'react';

// Slow fall, fast rise.
const DECAY = 0.82;

const ListenLevel = ({ levelRef, active, gated = false }) => {
  const barRef = useRef(null);

  useEffect(() => {
    if (!active) return undefined;
    let raf = 0;
    let shown = 0;
    const tick = () => {
      const target = levelRef.current || 0;
      shown = target > shown ? target : shown * DECAY;
      // One colour (docs/design/renderer.md §4).
      const el = barRef.current;
      if (el) el.style.transform = `scaleX(${shown.toFixed(3)})`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, levelRef]);

  if (!active) return null;
  // gated: the app's own TTS is playing and capture is being dropped.
  return (
    <div className={`listen-level ${gated ? 'gated' : ''}`} aria-hidden="true">
      <div className="listen-level-bar" ref={barRef} />
    </div>
  );
};

export default ListenLevel;
