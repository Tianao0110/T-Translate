// In-app updater over electron-updater (blockmap differential downloads,
// silent NSIS install); ipc/system.js exposes it, the About page drives it.

const { app } = require('electron');
const logger = require('./logger')('AutoUpdater');

const GITHUB_OWNER = 'Tianao0110';
const GITHUB_REPO = 'T-Translate';

let _updater = null;

function getUpdater() {
  if (_updater) return _updater;

  const { autoUpdater } = require('electron-updater');

  // Test hook: an unpackaged probe can point the updater at a local feed.
  if (!app.isPackaged && process.env.TT_UPDATE_CONFIG) {
    autoUpdater.forceDevUpdateConfig = true;
    autoUpdater.updateConfigPath = process.env.TT_UPDATE_CONFIG;
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.disableWebInstaller = true;
  autoUpdater.logger = logger;

  _updater = autoUpdater;
  return _updater;
}

// GitHub release notes arrive as HTML; the About modal renders plain text.
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

  // Dev mode is a no-op unless the TT_UPDATE_CONFIG hook is set.
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
  getUpdater().quitAndInstall(true, true); // silent, relaunch after
}

module.exports = {
  checkForUpdate,
  downloadUpdate,
  installUpdate,
};
