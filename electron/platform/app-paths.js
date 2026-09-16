// Where the app keeps its files, decided before anything else touches disk:
// `<install>\data` when writable (Chromium's own storage under data\browser),
// otherwise Electron's default userData. Runs before electron-store and the
// logger load, so it depends on fs and path only. Layout and migration
// rules: docs/design/main-process.md §1.

const path = require('path');
const fs = require('fs');

const DATA_DIR = 'data';
const BROWSER_DIR = 'browser';

// Everything Chromium writes at the top of userData; only these move.
const CHROMIUM_ENTRIES = [
  'Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'DawnGraphiteCache', 'DawnWebGPUCache',
  'DIPS', 'DIPS-wal', 'DIPS-journal', 'Local State', 'Local Storage', 'Session Storage', 'IndexedDB',
  'Network', 'Preferences', 'Shared Dictionary', 'SharedStorage', 'SharedStorage-wal',
  'blob_storage', 'Cookies', 'Cookies-journal', 'Trust Tokens', 'databases', 'WebStorage',
  'Service Worker', 'Crashpad', 'Dictionaries', 'VideoDecodeStats', 'Platform Notifications',
];

// What a relocated install carries over from the old userData. `Local State`
// holds safeStorage's key: without it nothing encrypted can be read.
const CARRIED_FILES = ['config.json', 'translation-data.enc'];
const CARRIED_BROWSER_ENTRIES = ['Local State', 'Local Storage', 'IndexedDB'];
const LEGACY_CACHE = path.join('Caches', 'translation-cache.json');
const CACHE_FILE = path.join('cache', 'translation-cache.json');

let current = null;

function isWritable(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, '.write-probe');
    fs.writeFileSync(probe, '');
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

function resolveAppPaths(app, { override, writable = isWritable } = {}) {
  const legacyUserData = override ? path.resolve(override) : app.getPath('userData');
  let userData = legacyUserData;
  if (!override && app.isPackaged) {
    const dir = path.join(path.dirname(app.getPath('exe')), DATA_DIR);
    if (writable(dir)) userData = dir;
  }
  return {
    legacyUserData,
    userData,
    browser: path.join(userData, BROWSER_DIR),
    relocated: userData !== legacyUserData,
  };
}

function exists(p) {
  try {
    fs.statSync(p);
    return true;
  } catch {
    return false;
  }
}

function copyIfMissing(from, to, notes) {
  if (exists(to) || !exists(from)) return false;
  try {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.cpSync(from, to, { recursive: true });
    notes.push(`carried over ${path.basename(from)}`);
    return true;
  } catch (e) {
    notes.push(`carry-over of ${from} failed: ${e.message}`);
    return false;
  }
}

function moveIfMissing(from, to, notes) {
  if (exists(to) || !exists(from)) return false;
  try {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(from, to);
    return true;
  } catch (e) {
    notes.push(`could not move ${from}: ${e.message}`);
    return false;
  }
}

function removeIfEmpty(dir) {
  try {
    if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  } catch {
    // absent or still holds something — leave it
  }
}

// First launch in the install directory: copy, never overwrite.
function carryOverLegacy(p, notes) {
  for (const f of CARRIED_FILES) copyIfMissing(path.join(p.legacyUserData, f), path.join(p.userData, f), notes);
  copyIfMissing(path.join(p.legacyUserData, LEGACY_CACHE), path.join(p.userData, CACHE_FILE), notes);
  for (const d of CARRIED_BROWSER_ENTRIES) copyIfMissing(path.join(p.legacyUserData, d), path.join(p.browser, d), notes);
}

// userData stays where it was: Chromium folders into browser\, older layouts lifted.
function tidyInPlace(p, notes) {
  let moved = 0;
  for (const name of CHROMIUM_ENTRIES) {
    if (moveIfMissing(path.join(p.userData, name), path.join(p.browser, name), notes)) moved++;
  }
  if (moved) notes.push(`moved ${moved} Chromium entries into ${BROWSER_DIR}`);

  const nested = path.join(p.userData, DATA_DIR);
  moveIfMissing(path.join(nested, 'cache'), path.join(p.userData, 'cache'), notes);
  const nestedLogs = path.join(nested, 'logs');
  if (exists(nestedLogs)) {
    for (const f of fs.readdirSync(nestedLogs)) {
      moveIfMissing(path.join(nestedLogs, f), path.join(p.userData, 'logs', f), notes);
    }
  }
  removeIfEmpty(path.join(nested, 'cache'));
  removeIfEmpty(nestedLogs);
  removeIfEmpty(nested);

  moveIfMissing(path.join(p.userData, LEGACY_CACHE), path.join(p.userData, CACHE_FILE), notes);
  removeIfEmpty(path.join(p.userData, 'Caches'));
}

function migrate(p) {
  const notes = [];
  if (p.relocated) carryOverLegacy(p, notes);
  else tidyInPlace(p, notes);
  return notes;
}

// Call once before require('./state'): sets the paths, runs the migration,
// returns the layout plus the log lines it produced.
function applyAppPaths(app, options = {}) {
  const p = resolveAppPaths(app, options);
  app.setPath('userData', p.userData);
  app.setPath('sessionData', p.browser);
  app.setPath('crashDumps', path.join(p.browser, 'Crashpad'));
  current = { ...p, notes: migrate(p) };
  return current;
}

// The pre-move userData, which the About page offers to clean up.
function legacyUserData() {
  return current ? current.legacyUserData : null;
}

function isRelocated() {
  return Boolean(current?.relocated);
}

module.exports = {
  applyAppPaths,
  resolveAppPaths,
  legacyUserData,
  isRelocated,
  isWritable,
};
