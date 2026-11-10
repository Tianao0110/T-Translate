// One line over the video with a sentence and a button (and a dismiss), for
// the tier-3 prompt: in a shadow root like the caption overlay, mounted in
// the fullscreen element while one holds the video, laid over the video's
// lower edge. show() replaces what is shown; hide() keeps the host for the
// next show; destroy() removes it.

const HOST_STYLE = {
  all: 'initial',
  display: 'block',
  position: 'absolute',
  left: '0px',
  top: '0px',
  width: '0px',
  height: '0px',
  'pointer-events': 'none',
  'z-index': '2147483001',
};

const CSS = `
.tc-nt-root { position: absolute; inset: 0; overflow: hidden; container-type: size; }
.tc-nt-bar {
  position: absolute; left: 50%; bottom: 16%; transform: translateX(-50%);
  max-width: 92%; box-sizing: border-box; padding: 0.45em 0.6em 0.45em 0.9em;
  display: flex; align-items: center; gap: 0.7em;
  font-family: system-ui, "Segoe UI", "PingFang SC", "Hiragino Sans", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif;
  font-size: var(--tc-nt-size, clamp(12px, 2.6cqh, 18px)); line-height: 1.3;
  color: var(--tc-nt-fg, #fff); background: var(--tc-nt-bg, rgba(20, 20, 20, 0.86));
  border-radius: 0.5em; box-shadow: 0 2px 10px rgba(0, 0, 0, 0.35);
  pointer-events: auto;
}
.tc-nt-bar[hidden] { display: none; }
.tc-nt-text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tc-nt-btn {
  all: initial; cursor: pointer; font: inherit; color: inherit; white-space: nowrap;
  padding: 0.3em 0.9em; border-radius: 0.4em; background: var(--tc-nt-accent, #2b7de9);
}
.tc-nt-btn:hover { filter: brightness(1.1); }
.tc-nt-x { all: initial; cursor: pointer; font: inherit; color: inherit; opacity: 0.7; padding: 0.2em 0.4em; line-height: 1; }
.tc-nt-x:hover { opacity: 1; }
`;

export function createNotice({ video, onAccept = () => {}, onDismiss = () => {} }) {
  const doc = video.ownerDocument;
  const win = doc.defaultView;
  const host = doc.createElement('div');
  host.className = 'tc-nt-host';
  for (const [k, v] of Object.entries(HOST_STYLE)) host.style.setProperty(k, v, 'important');
  const shadow = host.attachShadow({ mode: 'open' });
  const style = doc.createElement('style');
  style.textContent = CSS;
  const root = doc.createElement('div');
  root.className = 'tc-nt-root';
  const bar = doc.createElement('div');
  bar.className = 'tc-nt-bar';
  bar.hidden = true;
  const text = doc.createElement('span');
  text.className = 'tc-nt-text';
  const btn = doc.createElement('button');
  btn.className = 'tc-nt-btn';
  btn.type = 'button';
  const x = doc.createElement('button');
  x.className = 'tc-nt-x';
  x.type = 'button';
  x.textContent = '×';
  bar.append(text, btn, x);
  root.append(bar);
  shadow.append(style, root);

  let lastBox = '';
  let raf = 0;
  let destroyed = false;
  let kind = null;

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const k = kind;
    hide();
    onAccept(k);
  });
  x.addEventListener('click', (e) => {
    e.stopPropagation();
    const k = kind;
    hide();
    onDismiss(k);
  });

  function mount() {
    const fs = doc.fullscreenElement;
    const target = fs && fs !== video && fs.contains(video) ? fs : video.parentElement;
    if (target && host.parentNode !== target) target.append(host);
  }

  // Lays the host over the video box, relative to the host's containing block.
  function place() {
    const v = video.getBoundingClientRect();
    const parent = host.offsetParent;
    let left = v.left;
    let top = v.top;
    if (parent && !(parent === doc.body && win.getComputedStyle(parent).position === 'static')) {
      const p = parent.getBoundingClientRect();
      left += parent.scrollLeft - p.left - parent.clientLeft;
      top += parent.scrollTop - p.top - parent.clientTop;
    } else {
      left += win.scrollX;
      top += win.scrollY;
    }
    const next = [left, top, v.width, v.height].map((n) => `${Math.round(n)}px`);
    if (next.join() === lastBox) return;
    lastBox = next.join();
    ['left', 'top', 'width', 'height'].forEach((k, i) => host.style.setProperty(k, next[i], 'important'));
  }

  function tick() {
    raf = 0;
    if (destroyed || bar.hidden) return;
    mount();
    place();
    raf = win.requestAnimationFrame(tick);
  }

  function hide() {
    bar.hidden = true;
    kind = null;
    if (raf) win.cancelAnimationFrame(raf);
    raf = 0;
  }

  return {
    show({ kind: k, text: t, button, dismissTitle = '' }) {
      if (destroyed) return;
      kind = k;
      text.textContent = t;
      btn.textContent = button;
      btn.title = button;
      x.title = dismissTitle;
      x.setAttribute('aria-label', dismissTitle);
      bar.hidden = false;
      mount();
      lastBox = '';
      place();
      if (!raf) raf = win.requestAnimationFrame(tick);
    },
    hide,
    get kind() {
      return kind;
    },
    get visible() {
      return !bar.hidden;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      hide();
      host.remove();
    },
  };
}
