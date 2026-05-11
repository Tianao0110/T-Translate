// Unified CommonJS exports for shared/.
// Main process: const { CHANNELS, PRIVACY_MODES } = require('./shared');

const constants = require('./constants');
const channels = require('./channels');

module.exports = {
  ...constants,
  ...channels,
};
