// electron/shared/index.js
// 统一导出入口 (CommonJS)
// 主进程使用: const { CHANNELS, PRIVACY_MODES } = require('./shared');

const constants = require('./constants');
const channels = require('./channels');

module.exports = {
  ...constants,
  ...channels,
};
