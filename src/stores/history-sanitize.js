// Guards the persisted text fields of history / favorites entries against
// non-string translations (docs/design/renderer.md §2). history rows that
// cannot be recovered are dropped; favorites keep the row with the field
// blanked.

const TEXT_FIELDS = ['sourceText', 'translatedText'];

// Pull a usable string out of whatever was stored.
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

// Write-side guard, so nothing new reaches disk in a shape the panels
// cannot render.
export function toStoredText(value) {
  const text = asText(value);
  return text === null ? '' : text;
}
