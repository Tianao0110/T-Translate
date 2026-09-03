// Offline-mode smoke test: every download path the main process exposes,
// driven with the real store set to offline and every network primitive
// replaced by a tripwire. A single reached primitive fails the run.
//
//   npx electron scripts/smoke-offline.js
//
// Covers the three real pack managers (OCR / listen / voice) at manager level
// and through their IPC handlers, plus the updater's check and download
// channels. Everything happens under a temp userData; the user's own store
// and models are never touched.
/* eslint-disable no-console */

const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const https = require('https');
const { app, ipcMain, net } = require('electron');

const SANDBOX = path.join(os.tmpdir(), 'tt-offline-smoke');
const results = [];
function step(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

// Any of these being reached while offline is the bug this script exists for.
const netCalls = [];
function trip(label) {
  return (...args) => {
    const target = args[0]?.url || args[0]?.href || args[0];
    netCalls.push(`${label} ${typeof target === 'string' ? target : ''}`.trim());
    throw new Error(`network reached: ${label}`);
  };
}
function armTripwire() {
  for (const [obj, key] of [[net, 'fetch'], [net, 'request'], [global, 'fetch'],
    [https, 'request'], [https, 'get'], [http, 'request'], [http, 'get']]) {
    Object.defineProperty(obj, key, { value: trip(`${key === 'fetch' && obj === global ? 'global' : obj === net ? 'net' : obj === https ? 'https' : 'http'}.${key}`), writable: true, configurable: true });
  }
}

async function refusal(call) {
  try {
    const r = await call();
    return r?.errorCode || r?.error || (r?.offline ? 'OFFLINE_BLOCKED' : 'NOT-BLOCKED');
  } catch (e) {
    return e.code || e.message;
  }
}

async function main() {
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  fs.mkdirSync(SANDBOX, { recursive: true });
  app.setPath('userData', SANDBOX);
  armTripwire();

  const { store } = require('../electron/state');
  store.set('privacyMode', 'offline');

  // Capture IPC handlers instead of registering them: the handlers are the
  // exact functions a renderer reaches, called here with a fake event.
  const handlers = new Map();
  ipcMain.handle = (channel, fn) => handlers.set(channel, fn);
  ipcMain.on = () => {};

  const { CHANNELS } = require('../electron/shared/channels');
  const AE = CHANNELS.AUDIO_ENGINE;
  const managers = {
    'ocr-pack-manager': require('../electron/utils/ocr-pack-manager'),
    'audio-pack-manager': require('../electron/utils/audio-pack-manager'),
    'tts-pack-manager': require('../electron/utils/tts-pack-manager'),
  };

  // ---- manager level ----
  for (const [name, mgr] of Object.entries(managers)) {
    const list = await mgr.listPacks({ refresh: true });
    step(`${name}: manifest refresh refused`, list.manifestError === 'OFFLINE_BLOCKED', `manifestError=${list.manifestError}`);
    const dl = await refusal(() => mgr.downloadPack('smoke-nonexistent-pack'));
    step(`${name}: download refused`, dl === 'OFFLINE_BLOCKED', `code=${dl}`);
  }

  // ---- IPC level ----
  const autoUpdater = require('../electron/utils/auto-updater');
  autoUpdater.checkForUpdate = trip('auto-updater.checkForUpdate');
  autoUpdater.downloadUpdate = trip('auto-updater.downloadUpdate');

  const ctx = { getMainWindow: () => null, store, app, runtime: {}, windows: {} };
  require('../electron/ipc/system')(ctx);
  require('../electron/ipc/ocr')(ctx);
  require('../electron/ipc/audio-engine')(ctx);

  const evt = { sender: { id: 1, send() {} } };
  const ipcCases = [
    ['ocr packs list', CHANNELS.OCR.PACKS_LIST, [{ refresh: true }], (r) => r.manifestError === 'OFFLINE_BLOCKED'],
    ['ocr pack download', CHANNELS.OCR.PACKS_DOWNLOAD, ['smoke-nonexistent-pack'], (r) => r.success === false && r.errorCode === 'OFFLINE_BLOCKED'],
    ['listen packs list', AE.PACKS_LIST, [{ refresh: true }], (r) => r.manifestError === 'OFFLINE_BLOCKED'],
    ['listen pack download', AE.PACKS_DOWNLOAD, ['smoke-nonexistent-pack'], (r) => r.success === false && r.errorCode === 'OFFLINE_BLOCKED'],
    ['voice packs list', AE.TTS_PACKS_LIST, [{ refresh: true }], (r) => r.manifestError === 'OFFLINE_BLOCKED'],
    ['voice pack download', AE.TTS_PACKS_DOWNLOAD, ['smoke-nonexistent-pack'], (r) => r.success === false && r.errorCode === 'OFFLINE_BLOCKED'],
    ['update check', CHANNELS.APP.CHECK_UPDATE, [], (r) => r.success === false && r.offline === true],
    ['update download', CHANNELS.APP.DOWNLOAD_UPDATE, [], (r) => r.success === false && r.offline === true],
  ];
  for (const [name, channel, args, ok] of ipcCases) {
    const fn = handlers.get(channel);
    if (!fn) {
      step(`ipc ${name}: handler registered`, false, `no handler for ${channel}`);
      continue;
    }
    let result;
    try {
      result = await fn(evt, ...args);
    } catch (e) {
      result = { success: false, error: e.message, errorCode: e.code };
    }
    step(`ipc ${name}: refused offline`, ok(result), JSON.stringify(result).slice(0, 160));
  }

  step('no network primitive was reached', netCalls.length === 0, netCalls.join(' | '));

  store.set('privacyMode', 'standard');
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n==== ${results.length - failed}/${results.length} passed ====`);
  try {
    fs.rmSync(SANDBOX, { recursive: true, force: true });
  } catch {
    console.log('sandbox cleanup deferred to next run (EPERM)');
  }
  app.exit(failed ? 1 : 0);
}

app.on('window-all-closed', () => {});
app.whenReady().then(main).catch((e) => {
  console.error('smoke crashed:', e);
  app.exit(2);
});
