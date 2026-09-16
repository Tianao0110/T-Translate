// User-added languages: the code is the prompt name (LLM providers build
// their instruction as `LANGUAGE_CODES[code]?.name || code`). `name` is
// what the picker shows, `promptName` what the model is told.
// Design notes: docs/design/renderer.md §8.

const MAX_NAME = 40;
const MAX_ENTRIES = 30;

/**
 * @returns {{ok: true, language: object} | {ok: false, reason: string}}
 */
export function normalizeCustomLanguage(input = {}, existing = []) {
  const name = String(input.name ?? '').trim();
  const promptName = String(input.promptName ?? '').trim() || name;

  if (!name) return { ok: false, reason: 'emptyName' };
  if (name.length > MAX_NAME || promptName.length > MAX_NAME) {
    return { ok: false, reason: 'tooLong' };
  }
  if (existing.length >= MAX_ENTRIES) return { ok: false, reason: 'tooMany' };

  // The code carries the name verbatim; collisions are compared the same way.
  const code = promptName;
  if (existing.some((l) => l.code === code)) {
    return { ok: false, reason: 'duplicate' };
  }

  return {
    ok: true,
    language: {
      code,
      name,
      promptName,
      // Shaped like a catalogue entry so the picker needs no special case.
      en: name,
      nativeName: promptName !== name ? promptName : undefined,
      custom: true,
    },
  };
}

// Built-ins first: a custom entry never shadows a built-in.
export function mergeLanguages(builtIn, custom = []) {
  const known = new Set(builtIn.map((l) => l.code));
  return [...builtIn, ...custom.filter((l) => l && l.code && !known.has(l.code))];
}

export function customCodesOf(custom = []) {
  return custom.map((l) => l?.code).filter(Boolean);
}
