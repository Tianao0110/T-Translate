// T-Engine IPC: the status snapshot on demand, and the engine event stream
// forwarded to the windows that show engine state. The main process is the
// first reader of that stream — every host lifecycle event lands in the app
// log here, so a misbehaving engine leaves a trail without any window open.

const { ipcMain } = require('electron');
const { CHANNELS } = require('../shared/channels');
const tengine = require('../tengine');
const logger = require('../utils/logger')('IPC:TEngine');

function register(ctx) {
  const engine = tengine.get();

  ipcMain.handle(CHANNELS.TENGINE.STATUS, () => engine.status());

  engine.on((evt) => {
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
