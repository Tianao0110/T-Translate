// Unified selected-text capture over the clipboard. Single owner of:
//   - a module-level mutex, so only one Ctrl+C-and-read runs at a time
//     (the mouseup selection probe and the icon-click fetch used to interleave
//     and clobber each other's restore);
//   - full-format snapshot/restore, so a probe never destroys the user's
//     clipboard image/files/rich text (a passive probe overwriting an unpasted
//     screenshot was a real data-loss path);
//   - a short-lived success cache, so a fetch within 500ms of a capture reuses
//     the text instead of firing a second redundant Ctrl+C.

const { clipboard } = require('electron');
const { simulateCtrlC } = require('./native-helper');
const logger = require('./logger')('ClipboardCapture');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Mutex: captures append to this chain so they run strictly one at a time.
let chain = Promise.resolve();

// Success cache (root-fix): a capture that landed <500ms ago is reused rather
// than re-probing. Fixes the "press but no content" second fetch after focus
// moves, and collapses probe+fetch on the same selection into one Ctrl+C.
let lastText = null;
let lastTextAt = 0;
const CACHE_TTL = 500;

const FILE_FORMAT_HINTS = ['FileNameW', 'FileContents', 'CF_HDROP', 'text/uri-list'];

function hasFileFormat(formats) {
  return (formats || []).some((f) => FILE_FORMAT_HINTS.some((h) => f.includes(h)));
}

function hasImageFormat(formats) {
  return (formats || []).some(
    (f) => f.includes('image') || f.includes('Bitmap') || f.includes('DIB') || f.includes('PNG')
  );
}

// Snapshot every format we can put back. Image is only read when present
// (readImage on an empty clipboard is wasted work).
function snapshotClipboard() {
  const formats = clipboard.availableFormats();
  return {
    formats,
    text: clipboard.readText(),
    html: clipboard.readHTML(),
    rtf: clipboard.readRTF(),
    image: hasImageFormat(formats) ? clipboard.readImage() : null,
  };
}

function restoreClipboard(snap) {
  try {
    const data = {};
    if (snap.text) data.text = snap.text;
    if (snap.html) data.html = snap.html;
    if (snap.rtf) data.rtf = snap.rtf;

    if (Object.keys(data).length > 0) {
      clipboard.write(data);
    } else if (snap.image && !snap.image.isEmpty()) {
      clipboard.writeImage(snap.image);
    } else {
      clipboard.clear();
    }
  } catch (e) {
    logger.warn('restore failed:', e.message);
  }
}

/**
 * Capture the currently selected text via a clipboard round-trip.
 * Serialized against every other capture; original clipboard is restored.
 *
 * @param {Object} [options]
 * @param {boolean} [options.isComplexApp] extend the deadline for slow apps (Office)
 * @returns {Promise<{ text: string|null, formats: string[], fileClipboard?: boolean, fromCache?: boolean }>}
 *   fileClipboard=true means the clipboard held files we refused to clobber (no probe ran).
 */
function captureSelectedText(options = {}) {
  const job = chain.catch(() => {}).then(() => runCapture(options));
  // Keep the chain alive even if this job rejects, so the next capture still runs.
  chain = job.catch(() => {});
  return job;
}

async function runCapture({ isComplexApp = false } = {}) {
  if (lastText && Date.now() - lastTextAt < CACHE_TTL) {
    logger.debug('Reusing cached capture');
    return { text: lastText, formats: [], fromCache: true };
  }

  const snap = snapshotClipboard();

  // Files can't be restored through the clipboard API, so a probe would destroy
  // them irreversibly. Refuse to probe when the clipboard holds files and no
  // text. (Images we snapshot and best-effort restore below.)
  if (hasFileFormat(snap.formats) && !snap.text) {
    return { text: null, formats: snap.formats, fileClipboard: true };
  }

  try {
    clipboard.clear();
    simulateCtrlC();

    const timeoutMs = isComplexApp ? 1000 : 800;
    const deadline = Date.now() + timeoutMs;
    let text = '';
    let formats = [];

    // Poll until the copy lands: non-empty text, or a file copy's format shows
    // up (Explorer file selection produces CF_HDROP, often without text).
    while (Date.now() < deadline) {
      await sleep(50);
      const current = clipboard.readText();
      const currentFormats = clipboard.availableFormats();
      if ((current && current.trim()) || hasFileFormat(currentFormats)) {
        text = current;
        formats = currentFormats;
        break;
      }
    }

    // Formats produced by the copy, read BEFORE restore so callers get fresh
    // data (reading them post-restore was the file-drop misdetection bug).
    if (formats.length === 0) formats = clipboard.availableFormats();

    restoreClipboard(snap);

    const trimmed = text && text.trim() ? text.trim() : null;
    if (trimmed) {
      lastText = trimmed;
      lastTextAt = Date.now();
    }
    return { text: trimmed, formats };
  } catch (e) {
    logger.error('capture failed:', e);
    restoreClipboard(snap);
    return { text: null, formats: [] };
  }
}

// Drop the success cache. Called on each fresh mousedown so a cached capture
// can only ever be reused within the same selection gesture, never across two
// quick consecutive selections.
function invalidateCache() {
  lastText = null;
  lastTextAt = 0;
}

// Detection wrapper for the mouseup probe: only the yes/no + text matters.
// fileClipboard → null (undetermined; don't show a false "no selection").
async function detectSelectionViaClipboard(options = {}) {
  const res = await captureSelectedText(options);
  if (res.fileClipboard) return { hasSelection: null, text: '' };
  return { hasSelection: res.text ? true : false, text: res.text || '' };
}

module.exports = {
  captureSelectedText,
  detectSelectionViaClipboard,
  invalidateCache,
  hasFileFormat,
};
