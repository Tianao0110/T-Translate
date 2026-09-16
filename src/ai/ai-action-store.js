// Imported AI action configs, from electron-store, re-validated on every
// read. Cached; refreshImportedActions() is the settings-save hook.

import { normalizeActionConfig } from '../config/ai-actions.js';
import createLogger from '../core/logger.js';

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

