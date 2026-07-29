// AI action results are shown in a selection card, not in a window of this
// module's own: the card already carries the three themes, grows to fit its
// text, and knows how to be a pinned standalone overlay. Reusing it means an
// AI result looks and behaves like every other card in the app.
//
// The card is born pinned, beside the window that asked for it. It belongs to
// the user from then on — the source card or floating window can go away
// without taking the result with it.

const { CHANNELS } = require('../shared/channels');
const makeLogger = require('../utils/logger');

const logger = makeLogger('IPC:AIResult');

function register(ctx = {}) {
  const { ipcMain, BrowserWindow } = ctx.electron || require('electron');
  const windowManager = ctx.windowManager || require('../managers/window-manager');
  const { store } = ctx;

  ipcMain.handle(CHANNELS.AI_RESULT.SHOW, (event, payload = {}) => {
    const requester = BrowserWindow.fromWebContents(event.sender);
    let anchor = null;
    try {
      anchor = requester && !requester.isDestroyed() ? requester.getBounds() : null;
    } catch (e) { /* window died mid-call */ }

    const created = windowManager.createAiResultWindow(anchor);
    if (!created.success) return created;

    const { window: card, windowId } = created;
    const settings = store?.get('settings', {}) || {};

    // Display-only path (Mode 3 of SHOW_RESULT): the text is already final, so
    // the card must not run it through the translator again.
    card.webContents.once('did-finish-load', () => {
      if (card.isDestroyed()) return;
      card.webContents.send(CHANNELS.SELECTION.SHOW_RESULT, {
        sourceText: payload.sourceText || '',
        translatedText: payload.content || '',
        sourceLanguage: payload.sourceLanguage || 'auto',
        targetLanguage: payload.targetLanguage || 'zh',
        theme: settings.interface?.theme || 'light',
        // Marks it a standalone pinned card: it ignores later triggers and
        // closes itself through the pinned-card channel.
        frozen: true,
        windowId,
        aiAction: payload.actionLabel || '',
      });
      card.showInactive();
    });

    logger.debug(`AI result card ${windowId} opened for "${payload.actionLabel || 'ai'}"`);
    return { success: true, windowId };
  });

  logger.info('AI result IPC handlers registered');
}

module.exports = register;
