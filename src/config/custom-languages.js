// User-added languages.
//
// The built-in catalogue is Google's set, so anything reaching here is a
// language Google cannot do: a dialect, a minority language, something a user
// loaded a specialised local model for. Only the LLM providers have any chance
// with it, and whether they manage depends entirely on the model.
//
// THE CODE IS THE PROMPT NAME. Every LLM provider builds its instruction as
// `LANGUAGE_CODES[code]?.name || code`, so a custom code falls through to the
// code itself — which means storing the model-facing name AS the code makes
// the prompt come out right with no plumbing into the stack at all.
//
// Two names because they answer to different readers:
//   name        what the picker shows — the user's own language
//   promptName  what the model is told, and the code
// A local model may know 藏语 and not Tibetan, or the reverse. Only the person
// who loaded it knows which, so they get to say.

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

  // The code doubles as the prompt text, so it carries the name verbatim —
  // no slug, no case folding. Collisions are compared the same way.
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
      // `en` drives the letter index in an English UI; the user's own name is
      // the only thing we have to file it under.
      en: name,
      nativeName: promptName !== name ? promptName : undefined,
      custom: true,
    },
  };
}

// Built-ins first: a custom entry must never shadow a verified language.
export function mergeLanguages(builtIn, custom = []) {
  const known = new Set(builtIn.map((l) => l.code));
  return [...builtIn, ...custom.filter((l) => l && l.code && !known.has(l.code))];
}

export function customCodesOf(custom = []) {
  return custom.map((l) => l?.code).filter(Boolean);
}
