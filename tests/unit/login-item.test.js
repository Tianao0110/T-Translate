// syncLoginItem with a fake reg.exe, app and store: the legacy Run entry is
// retired once, and the current-name entry follows the stored preference.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { syncLoginItem, LEGACY_RUN_NAME, RUN_KEY, APPROVED_KEY } = require('../../electron/utils/login-item.js');

function fakeReg({ legacyPresent }) {
  const calls = [];
  const exec = (cmd, args, _opts, cb) => {
    calls.push(args.join(' '));
    const isQuery = args[0] === 'query';
    cb(isQuery && !legacyPresent ? new Error('not found') : null, '');
  };
  return { exec, calls };
}

function fakeApp({ packaged = true, present = false } = {}) {
  const written = [];
  return {
    isPackaged: packaged,
    getLoginItemSettings: () => ({ openAtLogin: present }),
    setLoginItemSettings: (s) => written.push(s),
    written,
  };
}

function fakeStore(entries = {}) {
  const map = new Map(Object.entries(entries));
  return { get: (k) => map.get(k), set: (k, v) => map.set(k, v), map };
}

const run = (opts) => syncLoginItem({ ...opts, platform: 'win32' });

describe('syncLoginItem', () => {
  it('retires a legacy entry, adopts its preference and writes the current-name entry', async () => {
    const reg = fakeReg({ legacyPresent: true });
    const app = fakeApp();
    const store = fakeStore();
    const r = await run({ app, store, exec: reg.exec });

    expect(r).toEqual({ legacyRemoved: true, entryWritten: true });
    expect(reg.calls).toEqual([
      `query ${RUN_KEY} /v ${LEGACY_RUN_NAME}`,
      `delete ${RUN_KEY} /v ${LEGACY_RUN_NAME} /f`,
      `delete ${APPROVED_KEY} /v ${LEGACY_RUN_NAME} /f`,
    ]);
    expect(store.get('settings.startup.autoLaunch')).toBe(true);
    expect(store.get('settings.startup.runEntryMigrated')).toBe(true);
    expect(app.written).toEqual([{ openAtLogin: true, args: ['--startup'] }]);
  });

  it('writes the entry when the preference is on and nothing is there (keep-data reinstall)', async () => {
    const reg = fakeReg({ legacyPresent: false });
    const app = fakeApp();
    const store = fakeStore({ 'settings.startup.autoLaunch': true });
    const r = await run({ app, store, exec: reg.exec });

    expect(r).toEqual({ legacyRemoved: false, entryWritten: true });
    expect(reg.calls).toEqual([`query ${RUN_KEY} /v ${LEGACY_RUN_NAME}`]);
    expect(app.written).toHaveLength(1);
  });

  it('leaves an existing entry alone so a Task Manager "disabled" flag survives', async () => {
    const reg = fakeReg({ legacyPresent: false });
    const app = fakeApp({ present: true });
    const store = fakeStore({ 'settings.startup.autoLaunch': true });
    const r = await run({ app, store, exec: reg.exec });

    expect(r).toEqual({ legacyRemoved: false, entryWritten: false });
    expect(app.written).toHaveLength(0);
  });

  it('never spawns reg.exe again once migrated, and writes nothing when the preference is off', async () => {
    const reg = fakeReg({ legacyPresent: true });
    const app = fakeApp();
    const store = fakeStore({ 'settings.startup.runEntryMigrated': true, 'settings.startup.autoLaunch': false });
    const r = await run({ app, store, exec: reg.exec });

    expect(r).toEqual({ legacyRemoved: false, entryWritten: false });
    expect(reg.calls).toEqual([]);
    expect(app.written).toHaveLength(0);
  });

  it('does nothing outside a packaged Windows build', async () => {
    const reg = fakeReg({ legacyPresent: true });
    expect(await run({ app: fakeApp({ packaged: false }), store: fakeStore(), exec: reg.exec })).toEqual({ skipped: true });
    expect(await syncLoginItem({ app: fakeApp(), store: fakeStore(), exec: reg.exec, platform: 'darwin' })).toEqual({ skipped: true });
    expect(reg.calls).toEqual([]);
  });
});
