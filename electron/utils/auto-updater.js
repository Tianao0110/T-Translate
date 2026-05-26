// In-app updater. Polls GitHub Releases, downloads the platform-matching
// installer with progress, and hands off to the OS installer on launch.

const { app, net, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const logger = require('./logger')('AutoUpdater');

const GITHUB_REPO = 'Tianao0110/T-Translate';
const API_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
const REQUEST_TIMEOUT = 20000;

// ===== Version compare =====

function compareVersions(a, b) {
  const partsA = (a || '').split('.').map(Number);
  const partsB = (b || '').split('.').map(Number);
  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const numA = partsA[i] || 0;
    const numB = partsB[i] || 0;
    if (numA > numB) return 1;
    if (numA < numB) return -1;
  }
  return 0;
}

// ===== Platform asset matching =====

function getExpectedAssetPattern() {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === 'win32') {
    // T-Translate-Setup-x.x.x.exe or T-Translate-Setup-x.x.x-x64.exe
    return /\.exe$/i;
  } else if (platform === 'darwin') {
    // T-Translate-x.x.x.dmg or T-Translate-x.x.x-arm64.dmg
    if (arch === 'arm64') return /arm64.*\.dmg$/i;
    return /\.dmg$/i;
  } else {
    return /\.AppImage$/i;
  }
}

function findDownloadAsset(assets) {
  if (!assets || assets.length === 0) return null;

  const pattern = getExpectedAssetPattern();

  let match = assets.find(a => pattern.test(a.name));

  // Fall back to anything installer-shaped if exact platform asset is missing
  if (!match) {
    const fallbackPatterns = [/\.exe$/i, /\.dmg$/i, /\.AppImage$/i, /\.deb$/i];
    for (const fp of fallbackPatterns) {
      match = assets.find(a => fp.test(a.name));
      if (match) break;
    }
  }

  return match;
}

// ===== GitHub API =====

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const request = net.request({ method: 'GET', url });
    request.setHeader('User-Agent', 'T-Translate-Updater');
    request.setHeader('Accept', 'application/vnd.github.v3+json');

    let data = '';
    let statusCode = 0;

    request.on('response', (resp) => {
      statusCode = resp.statusCode;
      resp.on('data', (chunk) => { data += chunk.toString(); });
      resp.on('end', () => {
        if (statusCode === 404) return resolve(null);
        if (statusCode !== 200) return reject(new Error(`HTTP ${statusCode}`));
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('Invalid JSON')); }
      });
    });

    request.on('error', reject);

    const timer = setTimeout(() => {
      request.abort();
      reject(new Error('Request timeout'));
    }, REQUEST_TIMEOUT);

    request.on('close', () => clearTimeout(timer));
    request.end();
  });
}

// ===== Download (with progress + redirect handling) =====

function downloadFile(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const request = net.request({ method: 'GET', url });
    request.setHeader('User-Agent', 'T-Translate-Updater');

    request.on('response', (resp) => {
      // GitHub asset URLs 302 to S3 — follow the redirect chain manually
      if ([301, 302, 303, 307, 308].includes(resp.statusCode)) {
        const redirectUrl = resp.headers.location;
        if (redirectUrl) {
          downloadFile(
            Array.isArray(redirectUrl) ? redirectUrl[0] : redirectUrl,
            destPath,
            onProgress
          ).then(resolve).catch(reject);
          return;
        }
        return reject(new Error(`Redirect without location: ${resp.statusCode}`));
      }

      if (resp.statusCode !== 200) {
        return reject(new Error(`Download HTTP ${resp.statusCode}`));
      }

      const contentLength = parseInt(
        (Array.isArray(resp.headers['content-length'])
          ? resp.headers['content-length'][0]
          : resp.headers['content-length']) || '0',
        10
      );

      const file = fs.createWriteStream(destPath);
      let downloaded = 0;
      let lastProgressTime = 0;

      resp.on('data', (chunk) => {
        file.write(chunk);
        downloaded += chunk.length;

        // Throttle to ~4 events/sec so the UI doesn't thrash
        const now = Date.now();
        if (now - lastProgressTime > 250) {
          lastProgressTime = now;
          const percent = contentLength > 0
            ? Math.round((downloaded / contentLength) * 100)
            : -1;
          onProgress?.({ downloaded, total: contentLength, percent });
        }
      });

      resp.on('end', () => {
        file.end(() => {
          onProgress?.({ downloaded, total: contentLength, percent: 100 });
          resolve(destPath);
        });
      });

      resp.on('error', (e) => {
        file.close();
        fs.unlink(destPath, () => {});
        reject(e);
      });
    });

    request.on('error', (e) => {
      fs.unlink(destPath, () => {});
      reject(e);
    });

    request.end();
  });
}

// ===== Public API =====

async function checkForUpdate() {
  const currentVersion = app.getVersion().replace(/^v/, '');

  logger.info(`Checking for updates... (current: ${currentVersion})`);

  const release = await fetchJSON(API_URL);

  if (!release) {
    logger.info('No releases found');
    return {
      success: true,
      hasUpdate: false,
      currentVersion,
      latestVersion: null,
    };
  }

  const latestVersion = (release.tag_name || '').replace(/^v/, '');
  const hasUpdate = compareVersions(latestVersion, currentVersion) > 0;
  const asset = findDownloadAsset(release.assets);

  logger.info(`Latest: ${latestVersion}, HasUpdate: ${hasUpdate}, Asset: ${asset?.name || 'none'}`);

  return {
    success: true,
    hasUpdate,
    currentVersion,
    latestVersion,
    releaseUrl: release.html_url,
    releaseName: release.name,
    releaseNotes: release.body || '',
    publishedAt: release.published_at,
    downloadUrl: asset?.browser_download_url || null,
    downloadName: asset?.name || null,
    downloadSize: asset?.size || 0,
  };
}

async function downloadUpdate(downloadUrl, fileName, onProgress) {
  if (!downloadUrl) throw new Error('No download URL');

  const downloadDir = path.join(app.getPath('temp'), 'T-Translate-Update');

  fs.mkdirSync(downloadDir, { recursive: true });

  const destPath = path.join(downloadDir, fileName);

  if (fs.existsSync(destPath)) {
    fs.unlinkSync(destPath);
  }

  logger.info(`Downloading: ${fileName} → ${destPath}`);

  await downloadFile(downloadUrl, destPath, onProgress);

  logger.info(`Download complete: ${destPath}`);
  return destPath;
}

async function installUpdate(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error('Installer file not found');
  }

  logger.info(`Installing update: ${filePath}`);

  const ext = path.extname(filePath).toLowerCase();

  if (process.platform === 'win32' && ext === '.exe') {
    // Detached spawn so the installer survives our app.quit() 1500ms later.
    const { spawn } = require('child_process');
    try {
      const child = spawn(filePath, [], {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      });
      child.on('error', (err) => logger.error('Failed to launch installer:', err));
      child.unref();
    } catch (err) {
      logger.error('Failed to spawn installer:', err);
      throw err;
    }
    // Give NSIS a moment to spawn before we exit and release file locks
    setTimeout(() => app.quit(), 1500);
  } else if (process.platform === 'darwin' && ext === '.dmg') {
    shell.openPath(filePath);
    setTimeout(() => app.quit(), 1500);
  } else {
    shell.openPath(filePath);
  }
}

function formatSize(bytes) {
  if (bytes <= 0) return '';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

module.exports = {
  checkForUpdate,
  downloadUpdate,
  installUpdate,
  compareVersions,
  formatSize,
};
