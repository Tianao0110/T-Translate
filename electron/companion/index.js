// T-Caption's local channel: the server runs while settings.companion.enabled
// is on; status() is what the settings page shows and onStatus pushes it on
// every change. Rules: docs/design/listen.md §11.

const { createCompanionSession } = require('./session');
const { createCompanionServer } = require('./server');

function initCompanion({ store, engineManager, translateStream = null, logger, version = '', getPrivacyMode = () => 'standard', onStatus = () => {}, serverOptions = {}, sessionOptions = {} }) {
  let stopped = false;
  let lastSent = '';
  let server = null;

  const enabled = () => store.get('settings.companion.enabled') === true;

  function status() {
    return {
      enabled: enabled(),
      running: !!server && server.running(),
      port: server ? server.port() : null,
      pairingOpen: !!server && server.pairingOpen(),
      session: session.status(),
    };
  }

  function notify() {
    if (!server) return;
    const s = status();
    const key = JSON.stringify(s);
    if (key === lastSent) return;
    lastSent = key;
    try {
      onStatus(s);
    } catch (e) {
      logger.warn(`companion status push failed: ${e.message}`);
    }
  }

  const session = createCompanionSession({ engineManager, logger, onChange: notify, ...sessionOptions });
  server = createCompanionServer({
    store,
    session,
    translateStream,
    logger,
    version,
    getPrivacyMode,
    modelsPresent: () => !!engineManager.getInfo().modelName,
    onChange: notify,
    ...serverOptions,
  });

  // Start / stop run one after another, however fast the switch flips.
  let applying = Promise.resolve();
  function apply() {
    applying = applying.then(async () => {
      const on = !stopped && enabled();
      try {
        if (on) await server.start();
        else {
          session.closeActive('companion-disabled');
          await server.stop();
        }
      } catch (e) {
        logger.warn(`companion channel ${on ? 'start' : 'stop'} failed: ${e.message}`);
      }
      notify();
    });
    return applying;
  }

  const unsubscribe = store.onDidChange?.('settings.companion.enabled', () => apply());
  apply();

  return {
    status,
    openPairing() {
      server.openPairing();
      return status();
    },
    regenerateToken() {
      server.regenerateToken();
      return status();
    },
    // Settles once the latest start / stop has run.
    ready: () => applying,
    async stop() {
      stopped = true;
      if (typeof unsubscribe === 'function') unsubscribe();
      await apply();
    },
  };
}

module.exports = { initCompanion };
