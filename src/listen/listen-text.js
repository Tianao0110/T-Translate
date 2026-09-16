// The streaming draft engine emits Latin text in upper case; lower the
// shout for the draft's short life. Mixed-case drafts are left alone.
export function normalizeDraftCase(text) {
  if (!text) return text;
  const letters = text.replace(/[^A-Za-z]/g, '');
  // Under four letters it is an acronym.
  if (letters.length < 4 || letters !== letters.toUpperCase()) return text;
  return text
    .toLowerCase()
    .replace(/(^\s*|[.!?]\s+)([a-z])/g, (m, lead, c) => lead + c.toUpperCase())
    .replace(/\bi\b/g, 'I');
}
