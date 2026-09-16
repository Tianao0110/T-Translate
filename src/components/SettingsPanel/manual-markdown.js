// Minimal Markdown reader for the in-app user guide (docs/MANUAL.*.md):
// headings, paragraphs, lists, fenced code, and bold / code / link inline.
// Pure functions; ManualSection.jsx renders the blocks.

const HEADING = /^(#{1,4})\s+(.*)$/;
const ORDERED = /^\s*\d+[.)]\s+(.*)$/;
const BULLET = /^\s*[-*]\s+(.*)$/;
const FENCE = /^```/;

// Heading text -> stable anchor id; duplicates get a numeric suffix.
export function slugify(text, taken = new Set()) {
  const base = text
    .toLowerCase()
    .replace(/[`*_[\]()]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '') || 'section';
  let id = base;
  let n = 2;
  while (taken.has(id)) id = `${base}-${n++}`;
  taken.add(id);
  return id;
}

// Inline markup -> [{ type: 'text'|'bold'|'code'|'link', text, href? }].
export function parseInline(text) {
  const out = [];
  const re = /(\*\*(.+?)\*\*)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)\s]+)\))/g;
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ type: 'text', text: text.slice(last, m.index) });
    if (m[1]) out.push({ type: 'bold', text: m[2] });
    else if (m[3]) out.push({ type: 'code', text: m[4] });
    else out.push({ type: 'link', text: m[6], href: m[7] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last) });
  return out;
}

// Markdown text -> block list. The document title (#) is dropped: the page
// carries its own heading.
export function parseMarkdown(source) {
  const lines = String(source || '').replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  const taken = new Set();
  let para = [];
  let list = null;
  let code = null;

  const flushPara = () => {
    if (para.length) {
      blocks.push({ type: 'paragraph', inlines: parseInline(para.join(' ')) });
      para = [];
    }
  };
  const flushList = () => {
    if (list) {
      blocks.push(list);
      list = null;
    }
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');

    if (code) {
      if (FENCE.test(line)) {
        blocks.push({ type: 'code', text: code.join('\n') });
        code = null;
      } else {
        code.push(raw);
      }
      continue;
    }
    if (FENCE.test(line)) {
      flushPara();
      flushList();
      code = [];
      continue;
    }

    const h = line.match(HEADING);
    if (h) {
      flushPara();
      flushList();
      const level = h[1].length;
      if (level === 1) continue;
      const text = h[2].trim();
      blocks.push({ type: 'heading', level, text, id: slugify(text, taken) });
      continue;
    }

    const li = line.match(ORDERED) || line.match(BULLET);
    if (li) {
      flushPara();
      const ordered = ORDERED.test(line);
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { type: 'list', ordered, items: [] };
      }
      list.items.push(parseInline(li[1]));
      continue;
    }

    if (line.trim() === '') {
      flushPara();
      flushList();
      continue;
    }

    flushList();
    para.push(line.trim());
  }
  if (code) blocks.push({ type: 'code', text: code.join('\n') });
  flushPara();
  flushList();
  return blocks;
}

// Chapters (##) with their sections (###), for the side table of contents.
export function buildToc(blocks) {
  const toc = [];
  for (const b of blocks) {
    if (b.type !== 'heading') continue;
    if (b.level === 2) toc.push({ id: b.id, text: b.text, children: [] });
    else if (b.level === 3 && toc.length) toc[toc.length - 1].children.push({ id: b.id, text: b.text });
  }
  return toc;
}
