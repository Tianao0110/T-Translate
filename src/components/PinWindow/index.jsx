// Pinned screenshot: shows the captured image and moves by manual drag.
// Close gestures are in windows/pin-entry.jsx; the window itself is
// electron/screenshot/pin-windows.js.

import React, { useEffect, useState } from 'react';
import './styles.css';

const PinWindow = () => {
  const [image, setImage] = useState(null);
  const [size, setSize] = useState(null);
  const [theme, setTheme] = useState('light');

  useEffect(() => {
    let cancelled = false;
    window.electron?.pin?.getInit?.().then((init) => {
      if (cancelled || !init) return;
      setTheme(init.theme || 'light');
      setImage(init.image);
    });
    const unsubscribeTheme = window.electron?.theme?.onChanged?.((next) => setTheme(next));
    return () => {
      cancelled = true;
      unsubscribeTheme?.();
    };
  }, []);

  // Track the pointer and stream window positions to main (DIP, like setBounds).
  const handleMouseDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();

    const offsetX = e.screenX - window.screenX;
    const offsetY = e.screenY - window.screenY;

    let pending = null;
    let raf = 0;
    const onMove = (ev) => {
      pending = { x: ev.screenX - offsetX, y: ev.screenY - offsetY };
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        window.electron?.pin?.moveTo?.(pending.x, pending.y);
      });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (raf) cancelAnimationFrame(raf);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // One image pixel per device pixel at the capture's scale.
  const handleLoad = (e) => {
    const img = e.currentTarget;
    const dpr = window.devicePixelRatio || 1;
    setSize({ width: img.naturalWidth / dpr, height: img.naturalHeight / dpr });
  };

  useEffect(() => {
    if (size) window.electron?.pin?.ready?.();
  }, [size]);

  return (
    <div className="pin-root" data-theme={theme} onMouseDown={handleMouseDown}>
      {image && (
        <div className="pin-frame" style={size || { visibility: 'hidden' }}>
          <img className="pin-image" src={image} alt="" draggable={false} onLoad={handleLoad} />
        </div>
      )}
    </div>
  );
};

export default PinWindow;
