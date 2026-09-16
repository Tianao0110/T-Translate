// OS-level notification for long-task completion (document translation, the
// summarize-everything pass). Fires only when the window is hidden or
// minimized — the in-window toast already covers the visible case — and only
// while settings.interface.systemNotifications is on (default on; undefined
// counts as on). Clicking brings the main window back, including from the
// close-to-tray hidden state.

import createLogger from './logger.js';

const logger = createLogger('SystemNotify');

export async function notifyTaskDone(title, body) {
  try {
    if (typeof document === 'undefined' || !document.hidden) return false;
    // Electron grants renderer notifications unconditionally; the permission
    // check only matters for the browser-mode dev server, where we skip
    // rather than nag with a permission prompt.
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return false;

    const enabled = await window.electron?.store?.get?.('settings.interface.systemNotifications');
    if (enabled === false) return false;

    const n = new Notification(title, { body: body || '' });
    n.onclick = () => {
      window.electron?.window?.show?.();
    };
    return true;
  } catch (err) {
    logger.warn('System notification failed:', err?.message);
    return false;
  }
}
