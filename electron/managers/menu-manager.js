// electron/managers/menu-manager.js
// 应用菜单管理器
// 包含：主菜单模板、右键菜单

const { Menu, dialog, shell, app } = require('electron');
const { CHANNELS, MENU_ACTIONS } = require('../shared/channels');
const logger = require('../utils/logger')('MenuManager');
const { t } = require('../shared/main-i18n');

/**
 * 创建应用菜单
 * @param {Object} ctx - 上下文
 * @param {Function} ctx.getMainWindow - 获取主窗口
 * @param {Object} ctx.runtime - 运行时状态
 * @param {Object} ctx.store - 存储
 * @param {Object} ctx.managers - 管理器函数
 */
function createMenu(ctx) {
  const { getMainWindow, runtime, store, managers } = ctx;

  const template = [
    createFileMenu(ctx),
    createEditMenu(),
    createViewMenu(ctx),
    createTranslateMenu(ctx),
    createSettingsMenu(ctx),
    createHelpMenu(ctx),
  ];

  // macOS 特殊处理
  if (process.platform === 'darwin') {
    template.unshift(createMacAppMenu(ctx));
  }

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
  
  logger.info('Application menu created');
  return menu;
}

/**
 * macOS 应用菜单
 */
function createMacAppMenu(ctx) {
  const { getMainWindow, runtime } = ctx;
  
  return {
    label: app.getName(),
    submenu: [
      { label: t('menu.about', '关于') + ' ' + app.getName(), role: 'about' },
      { type: 'separator' },
      {
        label: t('menu.preferences', '偏好设置'),
        accelerator: 'Cmd+,',
        click: () => getMainWindow()?.webContents.send(CHANNELS.MENU.ACTION, MENU_ACTIONS.OPEN_SETTINGS),
      },
      { type: 'separator' },
      { label: t('menu.hide', '隐藏') + ' ' + app.getName(), accelerator: 'Cmd+H', role: 'hide' },
      { label: t('menu.hideOthers', '隐藏其他'), accelerator: 'Cmd+Shift+H', role: 'hideothers' },
      { label: t('menu.showAll', '显示全部'), role: 'unhide' },
      { type: 'separator' },
      {
        label: t('menu.quit', '退出'),
        accelerator: 'Cmd+Q',
        click: () => {
          runtime.isQuitting = true;
          app.quit();
        },
      },
    ],
  };
}

/**
 * 文件菜单
 */
function createFileMenu(ctx) {
  const { getMainWindow, runtime } = ctx;
  
  return {
    label: t('menu.file', '文件'),
    submenu: [
      {
        label: t('menu.newTranslation', '新建翻译'),
        accelerator: 'CmdOrCtrl+N',
        click: () => getMainWindow()?.webContents.send(CHANNELS.MENU.ACTION, MENU_ACTIONS.NEW_TRANSLATION),
      },
      {
        label: t('menu.importText', '导入文本'),
        accelerator: 'CmdOrCtrl+O',
        click: async () => {
          const mainWindow = getMainWindow();
          if (!mainWindow) return;
          
          const result = await dialog.showOpenDialog(mainWindow, {
            properties: ['openFile'],
            filters: [
              { name: t('menu.textFiles', '文本文件'), extensions: ['txt', 'md', 'doc', 'docx', 'pdf'] },
              { name: t('menu.allFiles', '所有文件'), extensions: ['*'] },
            ],
          });
          
          if (!result.canceled && result.filePaths[0]) {
            mainWindow.webContents.send(CHANNELS.MENU.IMPORT_FILE, result.filePaths[0]);
          }
        },
      },
      {
        label: t('menu.exportTranslation', '导出翻译'),
        accelerator: 'CmdOrCtrl+S',
        click: () => getMainWindow()?.webContents.send(CHANNELS.MENU.ACTION, MENU_ACTIONS.EXPORT_TRANSLATION),
      },
      { type: 'separator' },
      {
        label: t('menu.quit', '退出'),
        accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
        click: () => {
          runtime.isQuitting = true;
          app.quit();
        },
      },
    ],
  };
}

/**
 * 编辑菜单
 */
function createEditMenu() {
  return {
    label: t('menu.edit', '编辑'),
    submenu: [
      { label: t('menu.undo', '撤销'), accelerator: 'CmdOrCtrl+Z', role: 'undo' },
      { label: t('menu.redo', '重做'), accelerator: 'Shift+CmdOrCtrl+Z', role: 'redo' },
      { type: 'separator' },
      { label: t('menu.cut', '剪切'), accelerator: 'CmdOrCtrl+X', role: 'cut' },
      { label: t('menu.copy', '复制'), accelerator: 'CmdOrCtrl+C', role: 'copy' },
      { label: t('menu.paste', '粘贴'), accelerator: 'CmdOrCtrl+V', role: 'paste' },
      { label: t('menu.selectAll', '全选'), accelerator: 'CmdOrCtrl+A', role: 'selectAll' },
    ],
  };
}

/**
 * 视图菜单
 */
function createViewMenu(ctx) {
  const { getMainWindow, store } = ctx;
  
  return {
    label: t('menu.view', '视图'),
    submenu: [
      {
        label: t('menu.reload', '重新加载'),
        accelerator: 'CmdOrCtrl+R',
        click: () => getMainWindow()?.reload(),
      },
      {
        label: t('menu.devTools', '开发者工具'),
        accelerator: 'F12',
        click: () => getMainWindow()?.webContents.toggleDevTools(),
      },
      { type: 'separator' },
      {
        label: t('menu.actualSize', '实际大小'),
        accelerator: 'CmdOrCtrl+0',
        click: () => getMainWindow()?.webContents.setZoomLevel(0),
      },
      {
        label: t('menu.zoomIn', '放大'),
        accelerator: 'CmdOrCtrl+Plus',
        click: () => {
          const mainWindow = getMainWindow();
          if (mainWindow) {
            const currentZoom = mainWindow.webContents.getZoomLevel();
            mainWindow.webContents.setZoomLevel(currentZoom + 1);
          }
        },
      },
      {
        label: t('menu.zoomOut', '缩小'),
        accelerator: 'CmdOrCtrl+-',
        click: () => {
          const mainWindow = getMainWindow();
          if (mainWindow) {
            const currentZoom = mainWindow.webContents.getZoomLevel();
            mainWindow.webContents.setZoomLevel(currentZoom - 1);
          }
        },
      },
      { type: 'separator' },
      {
        label: t('menu.fullscreen', '全屏'),
        accelerator: 'F11',
        click: () => {
          const mainWindow = getMainWindow();
          if (mainWindow) {
            mainWindow.setFullScreen(!mainWindow.isFullScreen());
          }
        },
      },
      {
        label: t('menu.alwaysOnTop', '置顶'),
        type: 'checkbox',
        checked: store.get('alwaysOnTop', false),
        click: (menuItem) => {
          const mainWindow = getMainWindow();
          if (mainWindow) {
            mainWindow.setAlwaysOnTop(menuItem.checked);
            store.set('alwaysOnTop', menuItem.checked);
          }
        },
      },
    ],
  };
}

/**
 * 翻译菜单
 */
function createTranslateMenu(ctx) {
  const { getMainWindow, managers } = ctx;
  
  return {
    label: t('menu.translate', '翻译'),
    submenu: [
      {
        label: t('menu.screenshotTranslate', '截图翻译'),
        accelerator: 'Alt+Q',
        click: () => managers.startScreenshot?.(),
      },
      {
        label: t('menu.quickTranslate', '快速翻译'),
        accelerator: 'CmdOrCtrl+Shift+T',
        click: () => getMainWindow()?.webContents.send(CHANNELS.MENU.ACTION, MENU_ACTIONS.QUICK_TRANSLATE),
      },
      { type: 'separator' },
      {
        label: t('menu.switchLang', '切换语言'),
        accelerator: 'CmdOrCtrl+L',
        click: () => getMainWindow()?.webContents.send(CHANNELS.MENU.ACTION, MENU_ACTIONS.SWITCH_LANGUAGE),
      },
      {
        label: t('menu.clearContent', '清空内容'),
        accelerator: 'CmdOrCtrl+Shift+C',
        click: () => getMainWindow()?.webContents.send(CHANNELS.MENU.ACTION, MENU_ACTIONS.CLEAR_CONTENT),
      },
    ],
  };
}

/**
 * 设置菜单
 */
function createSettingsMenu(ctx) {
  const { getMainWindow } = ctx;
  
  return {
    label: t('menu.settings', '设置'),
    submenu: [
      {
        label: t('menu.preferences', '偏好设置'),
        accelerator: 'CmdOrCtrl+,',
        click: () => getMainWindow()?.webContents.send(CHANNELS.MENU.ACTION, MENU_ACTIONS.OPEN_SETTINGS),
      },
      {
        label: t('menu.lmStudioSettings', 'LM Studio 设置'),
        click: () => getMainWindow()?.webContents.send(CHANNELS.MENU.ACTION, MENU_ACTIONS.LLM_SETTINGS),
      },
      {
        label: t('menu.ocrSettings', 'OCR 设置'),
        click: () => getMainWindow()?.webContents.send(CHANNELS.MENU.ACTION, MENU_ACTIONS.OCR_SETTINGS),
      },
    ],
  };
}

/**
 * 帮助菜单
 */
function createHelpMenu(ctx) {
  const { getMainWindow } = ctx;
  
  return {
    label: t('menu.help', '帮助'),
    submenu: [
      {
        label: t('menu.userGuide', '使用指南'),
        click: () => shell.openExternal('https://github.com/yourusername/t-translate/wiki'),
      },
      {
        label: t('menu.shortcutList', '快捷键列表'),
        click: () => getMainWindow()?.webContents.send(CHANNELS.MENU.ACTION, MENU_ACTIONS.SHOW_SHORTCUTS),
      },
      { type: 'separator' },
      {
        label: t('menu.checkUpdate', '检查更新'),
        click: () => showUpdateDialog(getMainWindow()),
      },
      {
        label: t('menu.about', '关于'),
        click: () => showAboutDialog(getMainWindow()),
      },
    ],
  };
}

/**
 * 显示更新对话框
 */
function showUpdateDialog(mainWindow) {
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: t('menu.checkUpdate', '检查更新'),
    message: t('menu.upToDate', '当前已是最新版本'),
    buttons: [t('menu.ok', '确定')],
  });
}

/**
 * 显示关于对话框
 */
function showAboutDialog(mainWindow) {
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: t('menu.about', '关于') + ' T-Translate',
    message: 'T-Translate',
    detail: t('menu.aboutDetail', '版本: {{version}}\n离线翻译工具\n\n基于 LM Studio 和本地 OCR', { version: app.getVersion() }),
    buttons: [t('menu.ok', '确定')],
  });
}

module.exports = {
  createMenu,
  showUpdateDialog,
  showAboutDialog,
};
