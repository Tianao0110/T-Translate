// Start-with-Windows housekeeping. Electron keeps the HKCU Run value under
// the AppUserModelId and only ever reads or deletes that one name. Builds
// before v0.3.7 set no AppUserModelId, so their entry sits under Electron's
// default "electron.app.T-Translate" — invisible to getLoginItemSettings.
// v0.4.7's restore therefore wrote a second entry beside it and the app
// launched twice at logon, the second instance surfacing the window. Node has
// no registry API; reg.exe ships with every Windows.

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

// Once per install: retire the legacy entry (a legacy entry means the user
// had auto-launch on, so the preference follows it). Every start: make the
// entry under the current name match the stored preference — a keep-data
// reinstall clears the registry but keeps the preference. Only a missing
// entry is written; rewriting an existing one would also reset the Task
// Manager "disabled" flag the user may have set.
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

module.exports = { syncLoginItem, LEGACY_RUN_NAME, STARTUP_ARGS, RUN_KEY, APPROVED_KEY };
