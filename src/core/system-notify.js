// OS-level notification for long-task completion. Fires only when the
// window is hidden or minimized and settings.interface.systemNotifications
// is on (undefined counts as on). Clicking brings the main window back.

import createLogger from './logger.js';

const logger = createLogger('SystemNotify');

export async function notifyTaskDone(title, body) {
  try {
    if (typeof document === 'undefined' || !document.hidden) return false;
    // The permission check only matters for the browser-mode dev server.
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
