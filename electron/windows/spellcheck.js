// Spellcheck for the main window's source box. On Windows, Chromium's
// spellchecker is the OS spellchecker, so no dictionary files are needed;
// the Hunspell download URL is pinned to a dead local address so a language
// the OS lacks fails on this machine instead of reaching any CDN. Also hangs
// the right-click menu (suggestions, add to dictionary, cut / copy / paste)
// on the main window; labels come from shared/main-i18n.
const { app, session, Menu } = require('electron');
const { t } = require('../shared/main-i18n');

const DEAD_DICTIONARY_URL = 'http://127.0.0.1:9/';
const FALLBACK_LANGUAGE = 'en-US';
const MAX_SUGGESTIONS = 5;

// Preferred OS languages that Chromium's spellchecker knows: exact tag first,
// then the base language; never empty.
function pickSpellcheckLanguages(preferred, available) {
  const known = new Set(available || []);
  const picked = [];
  for (const tag of preferred || []) {
    const base = String(tag).split('-')[0];
    const hit = known.has(tag) ? tag : known.has(base) ? base : null;
    if (hit && !picked.includes(hit)) picked.push(hit);
  }
  return picked.length ? picked : [FALLBACK_LANGUAGE];
}

function buildMenu(contents, params) {
  const template = [];
  if (params.misspelledWord) {
    const suggestions = (params.dictionarySuggestions || []).slice(0, MAX_SUGGESTIONS);
    for (const word of suggestions) {
      template.push({ label: word, click: () => contents.replaceMisspelling(word) });
    }
    if (!suggestions.length) template.push({ label: t('menu.noSuggestions'), enabled: false });
    template.push({
      label: t('menu.addToDictionary'),
      click: () => contents.session.addWordToSpellCheckerDictionary(params.misspelledWord),
    });
    template.push({ type: 'separator' });
  }
  template.push(
    { label: t('menu.cut'), role: 'cut', enabled: !!params.editFlags?.canCut },
    { label: t('menu.copy'), role: 'copy', enabled: !!params.editFlags?.canCopy },
    { label: t('menu.paste'), role: 'paste', enabled: !!params.editFlags?.canPaste },
  );
  return Menu.buildFromTemplate(template);
}

// Call once after app ready and before the main window exists.
function setupSpellcheck({ getMainWindow, logger }) {
  const ses = session.defaultSession;
  ses.setSpellCheckerDictionaryDownloadURL(DEAD_DICTIONARY_URL);
  const languages = pickSpellcheckLanguages(app.getPreferredSystemLanguages(), ses.availableSpellCheckerLanguages);
  try {
    ses.setSpellCheckerLanguages(languages);
    logger?.info('Spellcheck languages:', languages.join(', '));
  } catch (err) {
    logger?.warn('Spellcheck languages rejected:', languages.join(', '), err?.message);
  }

  app.on('web-contents-created', (_event, contents) => {
    contents.on('context-menu', (_e, params) => {
      if (!params.isEditable) return;
      const win = getMainWindow();
      if (!win || win.isDestroyed() || contents !== win.webContents) return;
      buildMenu(contents, params).popup({ window: win });
    });
  });
}

module.exports = { setupSpellcheck, pickSpellcheckLanguages, DEAD_DICTIONARY_URL };
