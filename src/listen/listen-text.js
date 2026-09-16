// The streaming draft engine (zipformer) emits Latin text in upper case; the
// SenseVoice final replaces it with proper casing moments later. Lower the
// shout for the draft's short life so a line does not flicker between
// "LEVEL MEETING" and "Level meeting". Mixed-case drafts are left alone.
export function normalizeDraftCase(text) {
  if (!text) return text;
  const letters = text.replace(/[^A-Za-z]/g, '');
  // Under four letters it is an acronym ("OK", "USA"), not a shouted draft.
  if (letters.length < 4 || letters !== letters.toUpperCase()) return text;
  return text
    .toLowerCase()
    .replace(/(^\s*|[.!?]\s+)([a-z])/g, (m, lead, c) => lead + c.toUpperCase())
    .replace(/\bi\b/g, 'I');
}
