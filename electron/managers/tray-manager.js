// System tray manager with locale-aware menu labels.

const { Tray, Menu, nativeImage, app } = require('electron');
const path = require('path');
const { store, runtime } = require('../state');
const PATHS = require('../shared/paths');
const logger = require('../utils/logger')('Tray');
const { t, setLanguage, getLanguage } = require('../shared/tray-labels');

let tray = null;

let baseIcon = null;
let activeIcon = null;

let deps = {
  getMainWindow: null,
  startScreenshot: null,
  toggleFloatingWindow: null,
  toggleSelectionTranslate: null,
  getSelectionEnabled: null,
};

// Precedence: stored user preference > OS locale > English
function detectLanguage() {
  const savedLang = store.get('settings.interface.language');
  if (savedLang) {
    return savedLang;
  }

  const { app } = require('electron');
  const systemLocale = app.getLocale();
  if (systemLocale && systemLocale.toLowerCase().startsWith('zh')) {
    return 'zh';
  }

  return 'en';
}

function init(dependencies) {
  deps = { ...deps, ...dependencies };
  logger.info('Tray manager dependencies injected');

  const lang = detectLanguage();
  setLanguage(lang);
  logger.debug('Tray language initialized:', lang);
}

// Paints a 10px green dot in the bottom-right corner of the 32px tray icon
// (visual signal that selection-translate is active).
function createIconWithDot(icon) {
  try {
    const size = 32;
    const dotSize = 10;
    const dotOffset = size - dotSize;

    const bitmap = icon.toBitmap();
    const buf = Buffer.from(bitmap);

    const cx = dotOffset + dotSize / 2;
    const cy = dotOffset + dotSize / 2;
    const r = dotSize / 2;

    for (let y = dotOffset; y < size; y++) {
      for (let x = dotOffset; x < size; x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        if (dx * dx + dy * dy <= r * r) {
          const idx = (y * size + x) * 4;
          // #10b981 (emerald-500)
          buf[idx] = 0x10;
          buf[idx + 1] = 0xb9;
          buf[idx + 2] = 0x81;
          buf[idx + 3] = 0xff;
        }
      }
    }

    return nativeImage.createFromBuffer(buf, { width: size, height: size });
  } catch (err) {
    logger.warn('Failed to create icon with dot:', err.message);
    return icon;
  }
}

function createTray(ctx) {
  if (ctx) {
    init({
      getMainWindow: ctx.getMainWindow,
      startScreenshot: ctx.managers?.startScreenshot,
      toggleFloatingWindow: ctx.managers?.toggleFloatingWindow,
      toggleSelectionTranslate: ctx.managers?.toggleSelectionTranslate,
      toggleAudioProbe: ctx.managers?.toggleAudioProbe,
      isAudioProbeAvailable: ctx.managers?.isAudioProbeAvailable,
      getSelectionEnabled: () => ctx.runtime?.selectionEnabled ?? false,
    });
  }

  if (tray) {
    logger.warn('Tray already exists');
    return tray;
  }

  const iconPath = process.platform === 'win32'
    ? PATHS.resources.trayIcon
    : PATHS.resources.icon;

  baseIcon = nativeImage
    .createFromPath(iconPath)
    .resize({ width: 32, height: 32 });

  activeIcon = createIconWithDot(baseIcon);

  tray = new Tray(baseIcon);
  tray.setToolTip('T-Translate');

  updateMenu();

  // Windows fires `click` before `double-click`. Delay single-click 300ms so
  // a real double-click can cancel it before the selection-toggle fires.
  let clickTimer = null;

  tray.on('click', () => {
    if (clickTimer) clearTimeout(clickTimer);

    clickTimer = setTimeout(() => {
      clickTimer = null;
      logger.debug('Tray single-click, toggleSelectionTranslate:', !!deps.toggleSelectionTranslate);
      if (deps.toggleSelectionTranslate) {
        deps.toggleSelectionTranslate();
      }
    }, 300);
  });

  tray.on('double-click', () => {
    if (clickTimer) {
      clearTimeout(clickTimer);
      clickTimer = null;
    }

    const mainWindow = deps.getMainWindow?.();
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  setupLanguageListener();

  logger.info('Tray created');
  return tray;
}

// Sync tray labels by watching store, so no extra IPC channel is needed
function setupLanguageListener() {
  store.onDidChange('settings', (newSettings, oldSettings) => {
    const newLang = newSettings?.interface?.language;
    const oldLang = oldSettings?.interface?.language;
    if (newLang && newLang !== oldLang) {
      logger.debug('Language setting changed:', oldLang, '->', newLang);
      const success = setLanguage(newLang);
      if (success) {
        updateMenu();
        logger.info('Tray menu language updated to:', newLang);
      }
    }
  });
}

function updateLanguage(lang) {
  const success = setLanguage(lang);
  if (success) {
    updateMenu();
    logger.info('Tray language updated to:', lang);
  }
  return success;
}

function updateMenu() {
  if (!tray) {
    logger.warn('Cannot update menu: tray not created');
    return;
  }

  const mainWindow = deps.getMainWindow?.();
  const selectionEnabled = deps.getSelectionEnabled?.() ?? false;

  logger.debug('Updating tray menu, selectionEnabled:', selectionEnabled);
  logger.debug('Current language:', getLanguage());

  if (baseIcon && activeIcon) {
    tray.setImage(selectionEnabled ? activeIcon : baseIcon);
  }

  const template = [
    {
      label: t('screenshot'),
      click: () => {
        logger.debug('Menu: screenshot clicked');
        if (deps.startScreenshot) {
          deps.startScreenshot();
        } else {
          logger.warn('startScreenshot not available');
        }
      },
    },
    {
      label: t('floatingWindow'),
      click: () => {
        logger.debug('Menu: floatingWindow clicked');
        if (deps.toggleFloatingWindow) {
          deps.toggleFloatingWindow();
        } else {
          logger.warn('toggleFloatingWindow not available');
        }
      },
    },
    {
      label: t('selectionTranslate'),
      type: 'checkbox',
      checked: selectionEnabled,
      click: () => {
        logger.debug('Menu: selectionTranslate clicked');
        if (deps.toggleSelectionTranslate) {
          deps.toggleSelectionTranslate();
        } else {
          logger.warn('toggleSelectionTranslate not available');
        }
      },
    },
  ];

  // Hidden probe: the entry exists only while ASR models are present on disk
  // (manually placed — nothing in the app ever advertises or downloads them).
  if (deps.isAudioProbeAvailable?.()) {
    template.push({
      label: t('audioProbe'),
      click: () => {
        logger.debug('Menu: audioProbe clicked');
        deps.toggleAudioProbe?.();
      },
    });
  }

  template.push(
    { type: 'separator' },
    {
      label: t('settings'),
      click: () => {
        logger.debug('Menu: settings clicked');
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
          mainWindow.webContents.send('navigate', 'settings');
        }
      },
    },
    {
      label: t('quit'),
      click: () => {
        runtime.isQuitting = true;
        app.quit();
      },
    }
  );

  const contextMenu = Menu.buildFromTemplate(template);
  tray.setContextMenu(contextMenu);
  tray.setToolTip(selectionEnabled ? `T-Translate (${t('selectionTranslate')} ✓)` : 'T-Translate');
  logger.debug('Tray menu updated');
}

function destroyTray() {
  if (tray) {
    tray.destroy();
    tray = null;
    logger.info('Tray destroyed');
  }
}

function getTray() {
  return tray;
}

function setToolTip(text) {
  if (tray) {
    tray.setToolTip(text);
  }
}

function setIcon(iconPath) {
  if (tray) {
    const icon = nativeImage
      .createFromPath(iconPath)
      .resize({ width: 32, height: 32 });
    tray.setImage(icon);
  }
}

module.exports = {
  init,
  createTray,
  updateMenu,
  updateTrayMenu: updateMenu, // alias kept for existing main.js import
  updateLanguage,
  destroyTray,
  getTray,
  setToolTip,
  setIcon,
};
