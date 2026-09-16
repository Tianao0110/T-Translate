// T-Engine IPC: the status snapshot on demand, the engine event stream
// forwarded to the windows that show engine state, and every host lifecycle
// event into the app log.

const { ipcMain } = require('electron');
const { CHANNELS, PRIVACY_MODES } = require('../shared/channels');
const { dataDir } = require('../platform/data-root');
const tengine = require('../tengine');
const { createMetricsLog } = require('../tengine/metrics-log');
const logger = require('../platform/logger')('IPC:TEngine');

function register(ctx) {
  const engine = tengine.get();
  // The metrics sink (docs/T-ENGINE.md §7): numbers to data\logs, nothing
  // in secure mode; the gate is read per event.
  const metrics = createMetricsLog({
    dir: dataDir('logs'),
    isSecure: () => ctx.store.get('privacyMode', PRIVACY_MODES.STANDARD) === PRIVACY_MODES.SECURE,
    logger,
  });
  ctx.tengineMetrics = metrics;

  ipcMain.handle(CHANNELS.TENGINE.STATUS, () => engine.status());

  engine.on((evt) => {
    metrics.write(evt);
    const detail = Object.entries(evt)
      .filter(([k]) => !['engine', 'host', 'kind', 'at'].includes(k))
      .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
      .join(' ');
    (evt.kind === 'exit' && !evt.expected ? logger.warn : logger.info).call(logger, `${evt.engine}: ${evt.kind} ${detail}`.trim());
    for (const win of [ctx.getMainWindow(), ctx.getFloatingWindow()]) {
      if (win && !win.isDestroyed()) win.webContents.send(CHANNELS.TENGINE.EVENT, evt);
    }
  });

  logger.info('T-Engine IPC handlers registered');
}

module.exports = register;
