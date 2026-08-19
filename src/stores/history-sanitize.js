// Guards the persisted text fields of history / favorites entries.
//
// A 0.3.x stack bug returned the whole result object ({text:"",from,to}) as a
// translation when the model replied empty. v0.3.4 stopped that at the cache,
// and cache entries self-heal — but by then addToHistory had already written
// the object to disk, where nothing repairs it. Rendering a non-string as a
// React child throws (#31), so a single bad row takes down the whole panel.
//
// Two shapes, two policies:
//   history   — auto-recorded. A row whose translation cannot be recovered is
//               not data, it is a failed translation that should never have
//               been logged. Drop it.
//   favorites — user-curated. Never delete silently; blank the unusable field
//               and keep the row.

const TEXT_FIELDS = ['sourceText', 'translatedText'];

// Pull a usable string out of whatever was stored. The known poison carries an
// empty `text`, but a future shape might hold the real translation.
function asText(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && typeof value.text === 'string') {
    return value.text;
  }
  return null;
}

function isClean(entry) {
  return TEXT_FIELDS.every(f => typeof entry?.[f] === 'string');
}

/**
 * @param {Array} list          persisted entries
 * @param {'drop'|'blank'} onUnrecoverable  what to do with a row we cannot repair
 * @returns {{entries: Array, repaired: number, dropped: number}}
 */
export function sanitizeTextEntries(list, onUnrecoverable = 'drop') {
  if (!Array.isArray(list)) return { entries: [], repaired: 0, dropped: 0 };

  let repaired = 0, dropped = 0;
  const entries = [];

  for (const entry of list) {
    if (!entry || typeof entry !== 'object') { dropped++; continue; }
    if (isClean(entry)) { entries.push(entry); continue; }

    const fixed = { ...entry };
    let lost = false;
    for (const field of TEXT_FIELDS) {
      if (typeof fixed[field] === 'string') continue;
      const text = asText(fixed[field]);
      if (text) {
        fixed[field] = text;
      } else {
        lost = true;
        fixed[field] = '';
      }
    }

    if (lost && onUnrecoverable === 'drop') { dropped++; continue; }
    repaired++;
    entries.push(fixed);
  }

  return { entries, repaired, dropped };
}

// Write-side guard, so nothing new reaches disk in a shape the panels cannot
// render. Mirrors the stack's _cachedText single exit.
export function toStoredText(value) {
  const text = asText(value);
  return text === null ? '' : text;
}
