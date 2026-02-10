// electron/managers/tray-manager.js
// 托盘管理器 - 负责系统托盘的创建和管理
// 已国际化版本：支持中英文切换

const { Tray, Menu, nativeImage, app } = require('electron');
const path = require('path');
const { store, runtime } = require('../state');
const PATHS = require('../shared/paths');
const logger = require('../utils/logger')('Tray');
const { t, setLanguage, getLanguage } = require('../shared/tray-labels');

// 托盘实例
let tray = null;

// 缓存的图标
let baseIcon = null;
let activeIcon = null;

// 外部依赖
let deps = {
  getMainWindow: null,
  startScreenshot: null,
  toggleGlassWindow: null,
  toggleSelectionTranslate: null,
  getSelectionEnabled: null,
};

/**
 * 检测系统语言
 * 优先级：store 设置 > 系统语言 > 默认英语
 */
function detectLanguage() {
  // 1. 检查 store 中保存的语言设置
  const savedLang = store.get('settings.interface.language');
  if (savedLang) {
    return savedLang;
  }
  
  // 2. 检测系统语言（Electron 环境）
  const { app } = require('electron');
  const systemLocale = app.getLocale(); // 如 'zh-CN', 'en-US'
  if (systemLocale && systemLocale.toLowerCase().startsWith('zh')) {
    return 'zh';
  }
  
  // 3. 默认英语
  return 'en';
}

/**
 * 初始化托盘管理器（内部使用）
 * @param {Object} dependencies - 依赖注入
 */
function init(dependencies) {
  deps = { ...deps, ...dependencies };
  logger.info('Tray manager dependencies injected');
  
  // 检测语言（优先 store，其次系统语言，默认英语）
  const lang = detectLanguage();
  setLanguage(lang);
  logger.debug('Tray language initialized:', lang);
}

/**
 * 在图标右下角绘制绿色指示点
 * @param {NativeImage} icon - 基础图标 (16x16)
 * @returns {NativeImage} 带绿点的图标
 */
function createIconWithDot(icon) {
  try {
    const size = 16;
    const dotSize = 6;
    const dotOffset = size - dotSize; // 右下角

    // 获取原始 RGBA 像素数据
    const bitmap = icon.toBitmap();
    const buf = Buffer.from(bitmap);

    // 在右下角绘制绿色圆点
    const cx = dotOffset + dotSize / 2; // 圆心 x
    const cy = dotOffset + dotSize / 2; // 圆心 y
    const r = dotSize / 2;

    for (let y = dotOffset; y < size; y++) {
      for (let x = dotOffset; x < size; x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        if (dx * dx + dy * dy <= r * r) {
          const idx = (y * size + x) * 4;
          // 绿色 (#10b981) RGBA
          buf[idx] = 0x10;     // R
          buf[idx + 1] = 0xb9; // G
          buf[idx + 2] = 0x81; // B
          buf[idx + 3] = 0xff; // A
        }
      }
    }

    return nativeImage.createFromBuffer(buf, { width: size, height: size });
  } catch (err) {
    logger.warn('Failed to create icon with dot:', err.message);
    return icon; // 失败时返回原始图标
  }
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
  
  baseIcon = nativeImage
    .createFromPath(iconPath)
    .resize({ width: 16, height: 16 });

  // 生成带绿点的图标（划词翻译开启时使用）
  activeIcon = createIconWithDot(baseIcon);

  tray = new Tray(baseIcon);
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

  // 监听语言切换 IPC
  setupLanguageListener();

  logger.info('Tray created');
  return tray;
}

/**
 * 设置语言切换监听器
 * 通过监听 store 变化来同步托盘语言，无需额外 IPC 通道
 */
function setupLanguageListener() {
  // 监听 store 中 settings 的变化
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

/**
 * 更新托盘菜单语言
 * @param {string} lang - 语言代码 ('zh' | 'en')
 */
function updateLanguage(lang) {
  const success = setLanguage(lang);
  if (success) {
    updateMenu();
    logger.info('Tray language updated to:', lang);
  }
  return success;
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
  logger.debug('Current language:', getLanguage());

  // 根据划词翻译状态切换图标
  if (baseIcon && activeIcon) {
    tray.setImage(selectionEnabled ? activeIcon : baseIcon);
  }

  const contextMenu = Menu.buildFromTemplate([
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
      label: t('glassWindow'),
      click: () => {
        logger.debug('Menu: glassWindow clicked');
        if (deps.toggleGlassWindow) {
          deps.toggleGlassWindow();
        } else {
          logger.warn('toggleGlassWindow not available');
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
    { type: 'separator' },
    {
      label: t('settings'),
      click: () => {
        logger.debug('Menu: settings clicked');
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
          // 通知渲染进程切换到设置面板
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
    },
  ]);

  tray.setContextMenu(contextMenu);
  tray.setToolTip(selectionEnabled ? 'T-Translate (划词翻译已开启)' : 'T-Translate');
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
  updateLanguage,
  destroyTray,
  getTray,
  setToolTip,
  setIcon,
};
