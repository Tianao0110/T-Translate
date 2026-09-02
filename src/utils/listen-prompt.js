// System prompt for translating one listen-mode subtitle line, carrying the
// previous lines as context. Sentence-by-sentence translation loses pronoun
// referents, topic and register; a couple of preceding lines restores most of
// that at zero extra latency. The context goes in the SYSTEM message and the
// user message stays the single line, so small models do not translate the
// context along with it. Only LLM providers read `systemPrompt`; MT engines
// (Google, DeepL, …) ignore it and behave as before.

const TARGET_NAMES = {
  zh: { zh: '中文', en: 'Chinese' },
  en: { zh: '英文', en: 'English' },
  ja: { zh: '日文', en: 'Japanese' },
  ko: { zh: '韩文', en: 'Korean' },
};

const MAX_CONTEXT_LINES = 2;
const MAX_CONTEXT_CHARS = 300;

function trimContext(context) {
  const lines = (context || []).map((s) => (s || '').trim()).filter(Boolean).slice(-MAX_CONTEXT_LINES);
  let total = 0;
  const kept = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    total += lines[i].length;
    if (total > MAX_CONTEXT_CHARS) break;
    kept.unshift(lines[i]);
  }
  return kept;
}

/**
 * @param {object} p
 * @param {string} p.targetLang   'zh' | 'en' | 'ja' | 'ko'
 * @param {string[]} [p.context]  earlier finals, oldest first
 * @param {string} [p.uiLang]     i18n language of the UI ('zh-CN', 'en', …)
 * @returns {{ content: string, mode: 'system' }}
 */
export function buildListenSystemPrompt({ targetLang, context = [], uiLang = 'zh' }) {
  const isZh = String(uiLang || '').toLowerCase().startsWith('zh');
  const name = (TARGET_NAMES[targetLang] || {})[isZh ? 'zh' : 'en'] || targetLang;
  const lines = trimContext(context);
  const ctx = lines.map((l) => `- ${l}`).join('\n');
  const content = isZh
    ? [
        `你是实时字幕的译员。把用户发来的这一句话翻译成${name}，只输出译文，不要解释、不要加引号。`,
        '这是连续语音里的一句，语气与人称要和上下文一致。',
        lines.length ? `前面几句（只作上下文，不要翻译它们）：\n${ctx}` : '',
      ]
    : [
        `You translate live subtitles. Translate the user's line into ${name}. Output only the translation, no explanations, no quotes.`,
        'It is one line of continuous speech; keep tone and person consistent with the context.',
        lines.length ? `Preceding lines (context only, do not translate them):\n${ctx}` : '',
      ];
  return { content: content.filter(Boolean).join('\n\n'), mode: 'system' };
}
