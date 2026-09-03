// What each privacy mode means per feature module, for the settings page.
// Pure data: the state drives the row colour, the text comes from i18n
// (privacy.modules.<module>.<mode>). Keep in step with the enforcement in
// src/stack/privacy-modes.js and the main-process gates — this table is the
// user-facing promise, those are the code that keeps it.

export const PRIVACY_MODULES = ['translators', 'ocr', 'listen', 'speak', 'downloads', 'history', 'updates'];

export const PRIVACY_MODE_ORDER = ['standard', 'secure', 'offline'];

// on = works as usual, part = works with restrictions, off = unavailable
export const MODULE_STATE = {
  translators: { standard: 'on', secure: 'on', offline: 'part' },
  ocr: { standard: 'on', secure: 'on', offline: 'part' },
  // Incognito keeps listen mode disabled until every module honours "no
  // logs at all" under it (user's call 2026-09-03).
  listen: { standard: 'on', secure: 'off', offline: 'on' },
  speak: { standard: 'on', secure: 'on', offline: 'part' },
  downloads: { standard: 'on', secure: 'on', offline: 'off' },
  history: { standard: 'on', secure: 'off', offline: 'on' },
  updates: { standard: 'on', secure: 'on', offline: 'off' },
};

export function moduleState(module, mode) {
  return MODULE_STATE[module]?.[mode] || 'off';
}
