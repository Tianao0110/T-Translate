// Selected-text capture over the clipboard: one mutex, a full-format
// snapshot / restore around the synthetic Ctrl+C, and a short success cache.
// Why each exists: docs/design/selection.md §3.

const { clipboard } = require('electron');
const { simulateCtrlC } = require('../platform/native-helper');
const logger = require('../platform/logger')('ClipboardCapture');
const { normalizeCapturedText } = require('./captured-text');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Mutex: captures append to this chain so they run strictly one at a time.
let chain = Promise.resolve();

// Success cache: a capture that landed within CACHE_TTL is reused.
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

// Snapshot every format we can put back.
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

// Captures the selected text via a clipboard round-trip, serialized against
// every other capture, clipboard restored. isComplexApp extends the deadline.
// Returns { text, formats, fileClipboard?, fromCache? }; fileClipboard means
// the clipboard held files and no probe ran.
function captureSelectedText(options = {}) {
  const job = chain.catch(() => {}).then(() => runCapture(options));
  chain = job.catch(() => {});
  return job;
}

async function runCapture({ isComplexApp = false } = {}) {
  if (lastText && Date.now() - lastTextAt < CACHE_TTL) {
    logger.debug('Reusing cached capture');
    return { text: lastText, formats: [], fromCache: true };
  }

  const snap = snapshotClipboard();

  // Files cannot be restored through the clipboard API: no probe.
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

    // Poll until the copy lands: text, or a file format (Explorer selections).
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

    // Formats produced by the copy, read before the restore.
    if (formats.length === 0) formats = clipboard.availableFormats();

    restoreClipboard(snap);

    let trimmed = text && text.trim() ? text.trim() : null;
    if (trimmed) {
      trimmed = normalizeCapturedText(trimmed);
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

// Called on each fresh mousedown: a cache never crosses two gestures.
function invalidateCache() {
  lastText = null;
  lastTextAt = 0;
}

// Detection wrapper for the mouseup probe; fileClipboard reads as undetermined.
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
