// Fits the reading notes behind the document digest into the chat model's
// context: one request when they fit; otherwise consecutive groups (cut at
// section starts where possible) are condensed first and the condensed parts
// merged. Design notes: docs/design/renderer.md §5.

// Budgets in estimated tokens for the notes of one request. The built-in
// model runs a 4096 context and keeps 1024 for the answer (stack/providers/tengine.js).
export const LOCAL_BUDGET = 2400;
export const ONLINE_BUDGET = 32000;
const MIN_BUDGET = 600;
const MAX_ROUNDS = 4;
// Numbering and the blank line between notes.
const ITEM_OVERHEAD = 4;
// A group at least this full is cut at the next section start.
const SECTION_CUT_FILL = 0.6;

const CJK = /[\u{3040}-\u{30FF}\u{3400}-\u{4DBF}\u{4E00}-\u{9FFF}\u{AC00}-\u{D7AF}\u{F900}-\u{FAFF}]/u;

// Built-in context errors and the usual online ones.
const CONTEXT_ERROR = /context|too long|too many tokens|maximum number of tokens/i;

// Over-counts on purpose: one token per CJK character, one per three others.
export function estimateTokens(text) {
  let cjk = 0;
  let other = 0;
  for (const ch of String(text || '')) {
    if (CJK.test(ch)) cjk++;
    else if (!/\s/u.test(ch)) other++;
  }
  return cjk + Math.ceil(other / 3);
}

function cost(item) {
  return estimateTokens(item.text) + ITEM_OVERHEAD;
}

function totalCost(items) {
  return items.reduce((sum, item) => sum + cost(item), 0);
}

export function numbered(items) {
  return items.map((item, i) => `${i + 1}. ${item.text}`).join('\n\n');
}

// Segment ids that open a section in the parsed outline.
export function sectionStartIds(outline) {
  const ids = new Set();
  const walk = (nodes) => {
    for (const node of nodes || []) {
      if (node?.segmentId != null) ids.add(node.segmentId);
      walk(node?.children);
    }
  };
  walk(outline);
  return ids;
}

// Consecutive groups within the budget; every group holds at least one item.
export function groupNotes(items, budget) {
  const groups = [];
  let current = [];
  let used = 0;
  for (const item of items) {
    const c = cost(item);
    const full = used + c > budget;
    const sectionCut = item.sectionStart && used >= budget * SECTION_CUT_FILL;
    if (current.length && (full || sectionCut)) {
      groups.push(current);
      current = [];
      used = 0;
    }
    current.push(item);
    used += c;
  }
  if (current.length) groups.push(current);
  return groups;
}

export function isContextError(message) {
  return CONTEXT_ERROR.test(String(message || ''));
}

async function digestWithin(items, budget, run) {
  if (totalCost(items) <= budget) return run('whole', numbered(items));
  let current = items;
  for (let round = 0; round < MAX_ROUNDS && totalCost(current) > budget; round++) {
    const next = [];
    for (const group of groupNotes(current, budget)) {
      const r = await run('part', numbered(group));
      if (!r?.success) return r;
      next.push({ text: r.content, sectionStart: false });
    }
    current = next;
  }
  return run('merge', numbered(current));
}

// items: [{ text, sectionStart }] in document order. run(stage, sourceText)
// sends one request; stage is 'whole' | 'part' | 'merge'. A context error
// means the estimate was short: retry with a smaller budget.
export async function digestNotes(items, { budget, run }) {
  if (!items?.length) return null;
  let b = budget;
  for (;;) {
    const r = await digestWithin(items, b, run);
    if (r?.success || !isContextError(r?.error) || b <= MIN_BUDGET) return r;
    b = b > LOCAL_BUDGET ? LOCAL_BUDGET : Math.max(MIN_BUDGET, Math.floor(b / 2));
  }
}
