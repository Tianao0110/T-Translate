// Which tab the user is looking at: the active tab of the last focused
// window, and the active tab of every window (a tab playing in a window
// behind the focused one is still visible). The orchestrator picks the one
// tab to serve from these.

export function createTabArbiter({ tabs = globalThis.chrome?.tabs, windows = globalThis.chrome?.windows, onChange = () => {} } = {}) {
  const activeByWindow = new Map(); // windowId → tabId
  const focusOrder = []; // windowIds, most recently focused first
  let focusedWindow = null;

  const NONE = windows?.WINDOW_ID_NONE ?? -1;

  function changed() {
    try {
      onChange();
    } catch {}
  }

  function focus(windowId) {
    if (!Number.isInteger(windowId) || windowId === NONE) return;
    focusedWindow = windowId;
    const i = focusOrder.indexOf(windowId);
    if (i >= 0) focusOrder.splice(i, 1);
    focusOrder.unshift(windowId);
  }

  tabs?.onActivated?.addListener?.(({ tabId, windowId }) => {
    activeByWindow.set(windowId, tabId);
    changed();
  });
  windows?.onFocusChanged?.addListener?.((windowId) => {
    focus(windowId);
    changed();
  });
  windows?.onRemoved?.addListener?.((windowId) => {
    activeByWindow.delete(windowId);
    const i = focusOrder.indexOf(windowId);
    if (i >= 0) focusOrder.splice(i, 1);
    if (focusedWindow === windowId) focusedWindow = focusOrder[0] ?? null;
    changed();
  });
  tabs?.onRemoved?.addListener?.((tabId) => {
    for (const [w, t] of activeByWindow) if (t === tabId) activeByWindow.delete(w);
    changed();
  });

  return {
    async init() {
      try {
        const list = (await tabs?.query?.({ active: true })) || [];
        for (const t of list) if (Number.isInteger(t.windowId) && Number.isInteger(t.id)) activeByWindow.set(t.windowId, t.id);
        const w = await windows?.getLastFocused?.({ populate: false });
        if (w?.focused && Number.isInteger(w.id)) focus(w.id);
        else if (w && Number.isInteger(w.id)) focus(w.id);
      } catch {}
      changed();
    },
    // The active tab of the focused window, or null.
    focused: () => (focusedWindow !== null ? activeByWindow.get(focusedWindow) ?? null : null),
    // Active tabs of all windows, the focused window's first.
    visible() {
      const order = [...focusOrder, ...[...activeByWindow.keys()].filter((w) => !focusOrder.includes(w))];
      return order.map((w) => activeByWindow.get(w)).filter((t) => Number.isInteger(t));
    },
    isVisible: (tabId) => [...activeByWindow.values()].includes(tabId),
  };
}
