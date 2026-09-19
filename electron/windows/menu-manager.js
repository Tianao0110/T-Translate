// Application menu. The main window is frameless and never shows a menu bar,
// so every item here is an accelerator: Ctrl+Q, the edit roles, zoom, F11,
// and Ctrl+, which opens the in-app settings through 'navigate'.

const { Menu, app } = require('electron');
const logger = require('../platform/logger')('MenuManager');
const { t } = require('../shared/main-i18n');

// Shows the main window and asks it for `target` ('settings' | 'settings:<section>').
function openInMain(getMainWindow, target) {
  const win = getMainWindow();
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  win.webContents.send('navigate', target);
}

function createMenu(ctx) {
  const { getMainWindow, runtime, isDev } = ctx;

  const fileMenu = {
    label: t('menu.file'),
    submenu: [
      {
        label: t('menu.quit'),
        accelerator: 'CmdOrCtrl+Q',
        click: () => {
          runtime.isQuitting = true;
          app.quit();
        },
      },
    ],
  };

  const editMenu = {
    label: t('menu.edit'),
    submenu: [
      { label: t('menu.undo'), accelerator: 'CmdOrCtrl+Z', role: 'undo' },
      { label: t('menu.redo'), accelerator: 'Shift+CmdOrCtrl+Z', role: 'redo' },
      { type: 'separator' },
      { label: t('menu.cut'), accelerator: 'CmdOrCtrl+X', role: 'cut' },
      { label: t('menu.copy'), accelerator: 'CmdOrCtrl+C', role: 'copy' },
      { label: t('menu.paste'), accelerator: 'CmdOrCtrl+V', role: 'paste' },
      { label: t('menu.selectAll'), accelerator: 'CmdOrCtrl+A', role: 'selectAll' },
    ],
  };

  const devItems = isDev
    ? [
        { label: t('menu.reload'), accelerator: 'CmdOrCtrl+R', click: () => getMainWindow()?.reload() },
        { label: t('menu.devTools'), accelerator: 'F12', click: () => getMainWindow()?.webContents.toggleDevTools() },
        { type: 'separator' },
      ]
    : [];

  const zoomBy = (delta) => {
    const win = getMainWindow();
    if (win) win.webContents.setZoomLevel(win.webContents.getZoomLevel() + delta);
  };

  const viewMenu = {
    label: t('menu.view'),
    submenu: [
      ...devItems,
      { label: t('menu.actualSize'), accelerator: 'CmdOrCtrl+0', click: () => getMainWindow()?.webContents.setZoomLevel(0) },
      { label: t('menu.zoomIn'), accelerator: 'CmdOrCtrl+Plus', click: () => zoomBy(1) },
      { label: t('menu.zoomOut'), accelerator: 'CmdOrCtrl+-', click: () => zoomBy(-1) },
      { type: 'separator' },
      {
        label: t('menu.fullscreen'),
        accelerator: 'F11',
        click: () => {
          const win = getMainWindow();
          if (win) win.setFullScreen(!win.isFullScreen());
        },
      },
    ],
  };

  const settingsMenu = {
    label: t('menu.settings'),
    submenu: [
      { label: t('menu.preferences'), accelerator: 'CmdOrCtrl+,', click: () => openInMain(getMainWindow, 'settings') },
    ],
  };

  const menu = Menu.buildFromTemplate([fileMenu, editMenu, viewMenu, settingsMenu]);
  Menu.setApplicationMenu(menu);
  logger.info('Application menu created');
  return menu;
}

module.exports = { createMenu };
