// electron/managers/menu-manager.js
// 应用菜单管理器
// 包含：主菜单模板、右键菜单

const { Menu, dialog, shell, app } = require('electron');
const { CHANNELS, MENU_ACTIONS } = require('../shared/channels');
const logger = require('../utils/logger')('MenuManager');

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
      { label: '关于 ' + app.getName(), role: 'about' },
      { type: 'separator' },
      {
        label: '偏好设置',
        accelerator: 'Cmd+,',
        click: () => getMainWindow()?.webContents.send(CHANNELS.MENU.ACTION, MENU_ACTIONS.OPEN_SETTINGS),
      },
      { type: 'separator' },
      { label: '隐藏 ' + app.getName(), accelerator: 'Cmd+H', role: 'hide' },
      { label: '隐藏其他', accelerator: 'Cmd+Shift+H', role: 'hideothers' },
      { label: '显示全部', role: 'unhide' },
      { type: 'separator' },
      {
        label: '退出',
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
    label: '文件',
    submenu: [
      {
        label: '新建翻译',
        accelerator: 'CmdOrCtrl+N',
        click: () => getMainWindow()?.webContents.send(CHANNELS.MENU.ACTION, MENU_ACTIONS.NEW_TRANSLATION),
      },
      {
        label: '导入文本',
        accelerator: 'CmdOrCtrl+O',
        click: async () => {
          const mainWindow = getMainWindow();
          if (!mainWindow) return;
          
          const result = await dialog.showOpenDialog(mainWindow, {
            properties: ['openFile'],
            filters: [
              { name: '文本文件', extensions: ['txt', 'md', 'doc', 'docx', 'pdf'] },
              { name: '所有文件', extensions: ['*'] },
            ],
          });
          
          if (!result.canceled && result.filePaths[0]) {
            mainWindow.webContents.send(CHANNELS.MENU.IMPORT_FILE, result.filePaths[0]);
          }
        },
      },
      {
        label: '导出翻译',
        accelerator: 'CmdOrCtrl+S',
        click: () => getMainWindow()?.webContents.send(CHANNELS.MENU.ACTION, MENU_ACTIONS.EXPORT_TRANSLATION),
      },
      { type: 'separator' },
      {
        label: '退出',
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
    label: '编辑',
    submenu: [
      { label: '撤销', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
      { label: '重做', accelerator: 'Shift+CmdOrCtrl+Z', role: 'redo' },
      { type: 'separator' },
      { label: '剪切', accelerator: 'CmdOrCtrl+X', role: 'cut' },
      { label: '复制', accelerator: 'CmdOrCtrl+C', role: 'copy' },
      { label: '粘贴', accelerator: 'CmdOrCtrl+V', role: 'paste' },
      { label: '全选', accelerator: 'CmdOrCtrl+A', role: 'selectAll' },
    ],
  };
}

/**
 * 视图菜单
 */
function createViewMenu(ctx) {
  const { getMainWindow, store } = ctx;
  
  return {
    label: '视图',
    submenu: [
      {
        label: '重新加载',
        accelerator: 'CmdOrCtrl+R',
        click: () => getMainWindow()?.reload(),
      },
      {
        label: '开发者工具',
        accelerator: 'F12',
        click: () => getMainWindow()?.webContents.toggleDevTools(),
      },
      { type: 'separator' },
      {
        label: '实际大小',
        accelerator: 'CmdOrCtrl+0',
        click: () => getMainWindow()?.webContents.setZoomLevel(0),
      },
      {
        label: '放大',
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
        label: '缩小',
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
        label: '全屏',
        accelerator: 'F11',
        click: () => {
          const mainWindow = getMainWindow();
          if (mainWindow) {
            mainWindow.setFullScreen(!mainWindow.isFullScreen());
          }
        },
      },
      {
        label: '置顶',
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
    label: '翻译',
    submenu: [
      {
        label: '截图翻译',
        accelerator: 'Alt+Q',
        click: () => managers.startScreenshot?.(),
      },
      {
        label: '快速翻译',
        accelerator: 'CmdOrCtrl+Shift+T',
        click: () => getMainWindow()?.webContents.send(CHANNELS.MENU.ACTION, MENU_ACTIONS.QUICK_TRANSLATE),
      },
      { type: 'separator' },
      {
        label: '切换语言',
        accelerator: 'CmdOrCtrl+L',
        click: () => getMainWindow()?.webContents.send(CHANNELS.MENU.ACTION, MENU_ACTIONS.SWITCH_LANGUAGE),
      },
      {
        label: '清空内容',
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
    label: '设置',
    submenu: [
      {
        label: '偏好设置',
        accelerator: 'CmdOrCtrl+,',
        click: () => getMainWindow()?.webContents.send(CHANNELS.MENU.ACTION, MENU_ACTIONS.OPEN_SETTINGS),
      },
      {
        label: 'LM Studio 设置',
        click: () => getMainWindow()?.webContents.send(CHANNELS.MENU.ACTION, MENU_ACTIONS.LLM_SETTINGS),
      },
      {
        label: 'OCR 设置',
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
    label: '帮助',
    submenu: [
      {
        label: '使用指南',
        click: () => shell.openExternal('https://github.com/yourusername/t-translate/wiki'),
      },
      {
        label: '快捷键列表',
        click: () => getMainWindow()?.webContents.send(CHANNELS.MENU.ACTION, MENU_ACTIONS.SHOW_SHORTCUTS),
      },
      { type: 'separator' },
      {
        label: '检查更新',
        click: () => showUpdateDialog(getMainWindow()),
      },
      {
        label: '关于',
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
    title: '检查更新',
    message: '当前已是最新版本',
    buttons: ['确定'],
  });
}

/**
 * 显示关于对话框
 */
function showAboutDialog(mainWindow) {
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: '关于 T-Translate',
    message: 'T-Translate',
    detail: `版本: ${app.getVersion()}\n离线翻译工具\n\n基于 LM Studio 和本地 OCR`,
    buttons: ['确定'],
  });
}

module.exports = {
  createMenu,
  showUpdateDialog,
  showAboutDialog,
};
