// notifyTaskDone gates: only fires when the window is hidden, notifications
// are permitted, and the setting is not explicitly off (undefined = on).
// Clicking the toast asks the main process to show the window.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { notifyTaskDone } from '../../src/utils/system-notify.js';

class FakeNotification {
  constructor(title, opts) {
    this.title = title;
    this.opts = opts;
    FakeNotification.instances.push(this);
  }
}
FakeNotification.instances = [];
FakeNotification.permission = 'granted';

function setHidden(value) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => value });
}

const storeGet = vi.fn();
const windowShow = vi.fn();

beforeEach(() => {
  FakeNotification.instances = [];
  FakeNotification.permission = 'granted';
  storeGet.mockReset().mockResolvedValue(undefined);
  windowShow.mockReset();
  vi.stubGlobal('Notification', FakeNotification);
  window.electron = {
    store: { get: storeGet },
    window: { show: windowShow },
  };
  setHidden(true);
});

describe('notifyTaskDone', () => {
  it('fires with default settings when the window is hidden', async () => {
    expect(await notifyTaskDone('T', 'B')).toBe(true);
    expect(FakeNotification.instances).toHaveLength(1);
    expect(FakeNotification.instances[0].title).toBe('T');
  });

  it('does nothing while the window is visible', async () => {
    setHidden(false);
    expect(await notifyTaskDone('T', 'B')).toBe(false);
    expect(FakeNotification.instances).toHaveLength(0);
  });

  it('respects the setting switched off', async () => {
    storeGet.mockResolvedValue(false);
    expect(await notifyTaskDone('T', 'B')).toBe(false);
    expect(FakeNotification.instances).toHaveLength(0);
  });

  it('skips silently without notification permission (browser dev mode)', async () => {
    FakeNotification.permission = 'denied';
    expect(await notifyTaskDone('T', 'B')).toBe(false);
    expect(FakeNotification.instances).toHaveLength(0);
  });

  it('click brings the main window back', async () => {
    await notifyTaskDone('T', 'B');
    FakeNotification.instances[0].onclick();
    expect(windowShow).toHaveBeenCalledTimes(1);
  });

  it('survives a missing electron bridge (web mode)', async () => {
    window.electron = undefined;
    expect(await notifyTaskDone('T', 'B')).toBe(true); // hidden + granted + no setting = fire
  });
});
