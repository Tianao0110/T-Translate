// In-app updater backed by electron-updater: blockmap differential downloads,
// SHA512 verification, resumable transfers, silent NSIS install.
// The IPC-facing result shapes are kept identical to the previous hand-rolled
// GitHub updater so preload/renderer stay untouched.

const { app } = require('electron');
const logger = require('./logger')('AutoUpdater');

const GITHUB_OWNER = 'Tianao0110';
const GITHUB_REPO = 'T-Translate';

let _updater = null;

function getUpdater() {
  if (_updater) return _updater;

  const { autoUpdater } = require('electron-updater');

  // Test hook: lets an unpackaged probe point the updater at a local feed.
  if (!app.isPackaged && process.env.TT_UPDATE_CONFIG) {
    autoUpdater.forceDevUpdateConfig = true;
    autoUpdater.updateConfigPath = process.env.TT_UPDATE_CONFIG;
  }

  // Download stays user-triggered from the About page, but a downloaded
  // update still applies if the user quits without clicking install.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = logger;

  _updater = autoUpdater;
  return _updater;
}

// GitHub provider returns release notes as HTML; the About modal renders plain
// text, so strip tags and decode the entities that survive.
function normalizeReleaseNotes(notes) {
  if (!notes) return '';
  let text;
  if (typeof notes === 'string') {
    text = notes;
  } else if (Array.isArray(notes)) {
    text = notes.map(n => (typeof n === 'string' ? n : n?.note || '')).join('\n');
  } else {
    text = String(notes);
  }
  return text
    .replace(/<\/(p|div|li|h[1-6]|ul|ol|br)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function checkForUpdate() {
  const currentVersion = app.getVersion().replace(/^v/, '');

  // electron-updater needs the packaged app-update.yml; dev mode is a no-op
  // (renderer shows "no releases") unless the TT_UPDATE_CONFIG hook is set.
  if (!app.isPackaged && !process.env.TT_UPDATE_CONFIG) {
    logger.info('Dev mode - update check skipped');
    return { success: true, hasUpdate: false, currentVersion, latestVersion: null };
  }

  logger.info(`Checking for updates... (current: ${currentVersion})`);

  const result = await getUpdater().checkForUpdates();
  const info = result?.updateInfo;

  if (!info) {
    logger.info('No releases found');
    return { success: true, hasUpdate: false, currentVersion, latestVersion: null };
  }

  const hasUpdate = result.isUpdateAvailable === true;
  const file = info.files?.[0];
  const downloadName = file?.url || null;

  logger.info(`Latest: ${info.version}, HasUpdate: ${hasUpdate}, Asset: ${downloadName || 'none'}`);

  return {
    success: true,
    hasUpdate,
    currentVersion,
    latestVersion: info.version,
    releaseUrl: `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`,
    releaseName: info.releaseName || `v${info.version}`,
    releaseNotes: normalizeReleaseNotes(info.releaseNotes),
    publishedAt: info.releaseDate || null,
    // Renderer only needs these truthy/for display - the actual download is
    // driven by electron-updater from the same feed.
    downloadUrl: downloadName
      ? `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest/download/${encodeURIComponent(downloadName)}`
      : null,
    downloadName,
    downloadSize: file?.size || 0,
  };
}

async function downloadUpdate(onProgress) {
  const updater = getUpdater();

  const progressHandler = (p) => {
    onProgress?.({
      downloaded: p.transferred,
      total: p.total,
      percent: Math.round(p.percent),
    });
  };
  updater.on('download-progress', progressHandler);

  try {
    logger.info('Downloading update (differential when blockmaps allow)...');
    const files = await updater.downloadUpdate();
    const filePath = Array.isArray(files) ? files[0] : files;
    logger.info(`Download complete: ${filePath}`);
    return filePath;
  } finally {
    updater.removeListener('download-progress', progressHandler);
  }
}

async function installUpdate() {
  logger.info('Installing update (silent NSIS, relaunch after)');
  // isSilent: NSIS runs with /S - no wizard, no progress-bar bounce.
  // isForceRunAfter: relaunch the app once the update is applied.
  getUpdater().quitAndInstall(true, true);
}

module.exports = {
  checkForUpdate,
  downloadUpdate,
  installUpdate,
};
