// Cleanup applied to every text the selection capture returns (pure; unit
// tested). Line endings, ligatures and spacing: docs/design/selection.md §4.

const LIGATURES = { 'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl', 'ﬅ': 'st', 'ﬆ': 'st' };

function normalizeCapturedText(text) {
  return String(text)
    .replace(/\r\n?/g, '\n')
    .replace(/[ﬀ-ﬆ]/g, (ch) => LIGATURES[ch] || ch)
    .replace(/\u00A0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
}

module.exports = { normalizeCapturedText, };
