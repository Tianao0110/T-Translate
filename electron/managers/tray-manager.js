// electron/managers/tray-manager.js
// 托盘管理器 - 负责系统托盘的创建和管理
// 修复版：正确处理依赖注入

const { Tray, Menu, nativeImage, app } = require('electron');
const path = require('path');
const { store } = require('../state');
const PATHS = require('../shared/paths');
const logger = require('../utils/logger')('Tray');

// 托盘实例
let tray = null;

// 外部依赖
let deps = {
  getMainWindow: null,
  startScreenshot: null,
  toggleGlassWindow: null,
  toggleSelectionTranslate: null,
  getSelectionEnabled: null,
};

/**
 * 初始化托盘管理器（内部使用）
 * @param {Object} dependencies - 依赖注入
 */
function init(dependencies) {
  deps = { ...deps, ...dependencies };
  logger.info('Tray manager dependencies injected');
}

/**
 * 创建系统托盘
 * @param {Object} ctx - 上下文对象（可选，用于自动注入依赖）
 */
function createTray(ctx) {
  // ========== 修复：从 ctx 自动提取依赖 ==========
  if (ctx) {
    init({
      getMainWindow: ctx.getMainWindow,
      startScreenshot: ctx.managers?.startScreenshot,
      toggleGlassWindow: ctx.managers?.toggleGlassWindow,
      toggleSelectionTranslate: ctx.managers?.toggleSelectionTranslate,
      getSelectionEnabled: () => ctx.runtime?.selectionEnabled ?? false,
    });
  }
  // ========== 修复结束 ==========

  if (tray) {
    logger.warn('Tray already exists');
    return tray;
  }

  const iconPath = process.platform === 'win32' 
    ? PATHS.resources.trayIcon  // Windows 使用 .ico
    : PATHS.resources.icon;     // 其他系统使用 .png
  const trayIcon = nativeImage
    .createFromPath(iconPath)
    .resize({ width: 16, height: 16 });

  tray = new Tray(trayIcon);
  tray.setToolTip('T-Translate');

  // 初始化菜单
  updateMenu();

  // 单击托盘图标切换划词翻译
  tray.on('click', () => {
    logger.debug('Tray clicked, toggleSelectionTranslate:', !!deps.toggleSelectionTranslate);
    if (deps.toggleSelectionTranslate) {
      deps.toggleSelectionTranslate();
    }
  });

  // 双击托盘图标显示窗口
  tray.on('double-click', () => {
    const mainWindow = deps.getMainWindow?.();
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  logger.info('Tray created');
  return tray;
}

/**
 * 更新托盘菜单
 */
function updateMenu() {
  if (!tray) {
    logger.warn('Cannot update menu: tray not created');
    return;
  }

  const mainWindow = deps.getMainWindow?.();
  const selectionEnabled = deps.getSelectionEnabled?.() ?? false;

  logger.debug('Updating tray menu, selectionEnabled:', selectionEnabled);
  logger.debug('deps.toggleGlassWindow:', !!deps.toggleGlassWindow);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示窗口',
      click: () => {
        logger.debug('Menu: 显示窗口 clicked');
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    {
      label: '截图翻译',
      click: () => {
        logger.debug('Menu: 截图翻译 clicked');
        if (deps.startScreenshot) {
          deps.startScreenshot();
        } else {
          logger.warn('startScreenshot not available');
        }
      },
    },
    {
      label: '玻璃窗口',
      click: () => {
        logger.debug('Menu: 玻璃窗口 clicked');
        if (deps.toggleGlassWindow) {
          deps.toggleGlassWindow();
        } else {
          logger.warn('toggleGlassWindow not available');
        }
      },
    },
    { type: 'separator' },
    {
      label: '划词翻译',
      type: 'checkbox',
      checked: selectionEnabled,
      click: () => {
        logger.debug('Menu: 划词翻译 clicked');
        if (deps.toggleSelectionTranslate) {
          deps.toggleSelectionTranslate();
        } else {
          logger.warn('toggleSelectionTranslate not available');
        }
      },
    },
    {
      label: '置顶',
      type: 'checkbox',
      checked: store.get('alwaysOnTop', false),
      click: (menuItem) => {
        const alwaysOnTop = menuItem.checked;
        if (mainWindow) {
          mainWindow.setAlwaysOnTop(alwaysOnTop);
        }
        store.set('alwaysOnTop', alwaysOnTop);
      },
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        runtime.isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
  logger.debug('Tray menu updated');
}

/**
 * 销毁托盘
 */
function destroyTray() {
  if (tray) {
    tray.destroy();
    tray = null;
    logger.info('Tray destroyed');
  }
}

/**
 * 获取托盘实例
 */
function getTray() {
  return tray;
}

/**
 * 设置托盘提示文字
 */
function setToolTip(text) {
  if (tray) {
    tray.setToolTip(text);
  }
}

/**
 * 设置托盘图标
 */
function setIcon(iconPath) {
  if (tray) {
    const icon = nativeImage
      .createFromPath(iconPath)
      .resize({ width: 16, height: 16 });
    tray.setImage(icon);
  }
}

module.exports = {
  init,
  createTray,
  updateMenu,
  updateTrayMenu: updateMenu,  // 别名，兼容 main.js 的导入
  destroyTray,
  getTray,
  setToolTip,
  setIcon,
};
