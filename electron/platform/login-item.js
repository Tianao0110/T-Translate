// Start-with-Windows housekeeping: retire the pre-v0.3.7 Run entry (under
// Electron's default name, invisible to getLoginItemSettings) once via
// reg.exe, then keep the current entry in line with the stored preference.
// History: docs/design/main-process.md §4.

const { execFile } = require('child_process');

const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const APPROVED_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run';
const LEGACY_RUN_NAME = 'electron.app.T-Translate';
const STARTUP_ARGS = ['--startup'];
const PREF_KEY = 'settings.startup.autoLaunch';
const MIGRATED_KEY = 'settings.startup.runEntryMigrated';

function reg(args, exec) {
  return new Promise((resolve) => {
    exec('reg', args, { windowsHide: true }, (err) => resolve(!err));
  });
}

const hasRunValue = (name, exec) => reg(['query', RUN_KEY, '/v', name], exec);

async function deleteRunValue(name, exec) {
  await reg(['delete', RUN_KEY, '/v', name, '/f'], exec);
  await reg(['delete', APPROVED_KEY, '/v', name, '/f'], exec);
}

// Once per install: retire the legacy entry (its presence means auto-launch
// was on). Every start: write a missing entry only, never rewrite one.
async function syncLoginItem({ app, store, exec = execFile, platform = process.platform }) {
  if (platform !== 'win32' || !app.isPackaged) return { skipped: true };
  const result = { legacyRemoved: false, entryWritten: false };

  if (!store.get(MIGRATED_KEY)) {
    if (await hasRunValue(LEGACY_RUN_NAME, exec)) {
      await deleteRunValue(LEGACY_RUN_NAME, exec);
      store.set(PREF_KEY, true);
      result.legacyRemoved = true;
    }
    store.set(MIGRATED_KEY, true);
  }

  if (store.get(PREF_KEY) === true && !app.getLoginItemSettings({ args: STARTUP_ARGS }).openAtLogin) {
    app.setLoginItemSettings({ openAtLogin: true, args: STARTUP_ARGS });
    result.entryWritten = true;
  }
  return result;
}

module.exports = { syncLoginItem, LEGACY_RUN_NAME, RUN_KEY, APPROVED_KEY };
