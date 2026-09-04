// Cleanup applied to every text the selection capture returns. Pure, so the
// unit test can run it without Electron.
//
// Line endings matter more than they look: Outlook and other Windows apps
// copy CRLF, and Chromium renders a stray CR in `white-space: pre-wrap` as a
// line break of its own — every paragraph gap showed up doubled in the
// selection window, and the provider saw the same noise in its prompt.

// PDF viewers copy typographic ligature codepoints verbatim (ﬁ ﬂ ﬀ …) — fonts
// without those glyphs render tofu and providers see garbage. Standard Unicode
// ligatures expand losslessly; PUA codepoints (custom ligatures like "ti") are
// unrecoverable at the text layer and left as-is.
const LIGATURES = { 'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl', 'ﬅ': 'st', 'ﬆ': 'st' };

function normalizeCapturedText(text) {
  return String(text)
    .replace(/\r\n?/g, '\n')
    .replace(/[ﬀ-ﬆ]/g, (ch) => LIGATURES[ch] || ch)
    .replace(/\u00A0/g, ' ') // NBSP → plain space (common in PDF copies)
    .replace(/[ \t]+\n/g, '\n') // trailing spaces before a break (Outlook)
    .replace(/\n{3,}/g, '\n\n'); // stacked blank lines → one paragraph gap
}

module.exports = { normalizeCapturedText, LIGATURES };
