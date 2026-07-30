// Imported AI action configs. They live in electron-store next to the rest of
// the settings, and every read re-validates them: config.json is a plain file a
// user can hand-edit, and the runtime trusts nothing the import gate did not
// already check.
//
// Cached because three windows and the capture pipeline all ask for the same
// list; refreshImportedActions() is the settings-save hook.

import { normalizeActionConfig } from '@config/ai-actions';
import createLogger from '../utils/logger.js';

const logger = createLogger('AIActionStore');

const IMPORTED_ACTIONS_KEY = 'settings.aiActions.imported';

let cache = [];
let pending = null;

// Exported for the settings panel, which validates a file before storing it and
// wants the same verdicts the runtime would reach.
export function validateImportedActions(raw) {
  if (!Array.isArray(raw)) return [];
  const actions = [];
  for (const entry of raw) {
    const { ok, action, error } = normalizeActionConfig(entry);
    if (ok) actions.push(action);
    else logger.warn(`Dropped a stored action config: ${error}`);
  }
  return actions;
}

async function load() {
  try {
    const raw = await window.electron?.store?.get?.(IMPORTED_ACTIONS_KEY);
    cache = validateImportedActions(raw);
  } catch (e) {
    logger.error('Failed to read imported actions:', e);
    cache = [];
  }
  return cache;
}

// Loads once per window; concurrent callers share the same read.
export function ensureImportedActions() {
  if (!pending) pending = load();
  return pending;
}

export function refreshImportedActions() {
  pending = load();
  return pending;
}

