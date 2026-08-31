// Capture level meter for listen mode.
//
// The point is latency, not decoration: text needs ~0.6s (draft) or ~0.4s
// after a sentence ends (final), so until now nothing on screen told you
// whether sound was even arriving — the "no sound detected" hint only fires
// after seconds of silence. This bar moves at the audio callback's own rate
// (~85ms), which is as fast as this feature can honestly react, and answers
// the actual question users ask: "it's playing, why is nothing happening?"
//
// Paints itself from a rAF loop reading a ref, so twelve updates a second
// never re-render the transcript above it.

import React, { useEffect, useRef } from 'react';

// Falls faster than it rises would look jumpy; falling slowly reads as a
// meter rather than a strobe.
const DECAY = 0.82;

const ListenLevel = ({ levelRef, active }) => {
  const barRef = useRef(null);

  useEffect(() => {
    if (!active) return undefined;
    let raf = 0;
    let shown = 0;
    const tick = () => {
      const target = levelRef.current || 0;
      shown = target > shown ? target : shown * DECAY;
      // One colour on purpose. A "too quiet to transcribe" tint was tried and
      // dropped: the threshold would be a claim about what the VAD can hear,
      // and there is no calibrated number for it. Bar length already separates
      // silence from signal, and the engine's own hints cover the rest.
      const el = barRef.current;
      if (el) el.style.transform = `scaleX(${shown.toFixed(3)})`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, levelRef]);

  if (!active) return null;
  return (
    <div className="listen-level" aria-hidden="true">
      <div className="listen-level-bar" ref={barRef} />
    </div>
  );
};

export default ListenLevel;
