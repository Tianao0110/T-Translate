// HTML → paragraph list for the Word (mammoth HTML) and EPUB (chapter XHTML)
// parsers: headings keep their level, table rows join their cells with
// " | " and carry `row`, every other block element is one paragraph.
// document-parser.js turns the list into segments (segmentsFromParagraphs).

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

const SKIP = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'TITLE', 'SVG', 'MATH',
  'IMG', 'PICTURE', 'VIDEO', 'AUDIO', 'IFRAME', 'OBJECT', 'EMBED', 'CANVAS', 'HR',
]);
const BLOCKS = new Set([
  'P', 'DIV', 'SECTION', 'ARTICLE', 'MAIN', 'HEADER', 'FOOTER', 'ASIDE', 'NAV',
  'BLOCKQUOTE', 'UL', 'OL', 'LI', 'DL', 'DT', 'DD', 'FIGURE', 'FIGCAPTION',
  'ADDRESS', 'CENTER', 'BODY', 'CAPTION',
]);

function tidy(text) {
  return text
    .replace(/[^\S\n]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}

function push(out, text, extra) {
  const clean = tidy(text);
  if (clean) out.push(extra ? { text: clean, ...extra } : { text: clean });
}

// Text of an element with a space at every block boundary ("x" "y" in two
// nested cells stay two words) and skipped elements left out.
function textOf(el) {
  let out = '';
  for (const node of el.childNodes) {
    if (node.nodeType === TEXT_NODE) {
      out += node.textContent;
    } else if (node.nodeType === ELEMENT_NODE) {
      const tag = node.tagName.toUpperCase();
      if (SKIP.has(tag)) continue;
      const block = BLOCKS.has(tag) || /^(H[1-6]|TABLE|TR|TD|TH|BR|PRE)$/.test(tag);
      out += block ? ` ${textOf(node)} ` : textOf(node);
    }
  }
  return out;
}

function inlineText(el) {
  return textOf(el).replace(/\s+/g, ' ').trim();
}

// Rows of two or more cells become table rows; a one-cell row (a boxed
// note) reads as a plain paragraph.
function tableRows(table, out) {
  for (const tr of table.querySelectorAll('tr')) {
    if (tr.closest('table') !== table) continue;
    const cells = [...tr.children].filter((c) => c.tagName === 'TD' || c.tagName === 'TH').map(inlineText);
    if (!cells.some(Boolean)) continue;
    if (cells.length >= 2) push(out, cells.join(' | '), { row: true });
    else push(out, cells[0]);
  }
}

function flow(el, out) {
  let inline = '';
  const flush = () => {
    push(out, inline);
    inline = '';
  };
  for (const node of el.childNodes) {
    if (node.nodeType === TEXT_NODE) {
      inline += node.textContent.replace(/\s+/g, ' ');
      continue;
    }
    if (node.nodeType !== ELEMENT_NODE) continue;
    const tag = node.tagName.toUpperCase();
    if (SKIP.has(tag)) continue;
    if (tag === 'BR') {
      inline += '\n';
    } else if (/^H[1-6]$/.test(tag)) {
      flush();
      push(out, inlineText(node), { heading: Number(tag[1]) });
    } else if (tag === 'TABLE') {
      flush();
      tableRows(node, out);
    } else if (tag === 'PRE') {
      flush();
      push(out, node.textContent || '');
    } else if (BLOCKS.has(tag)) {
      flush();
      flow(node, out);
    } else {
      inline += textOf(node).replace(/\s+/g, ' ');
    }
  }
  flush();
}

// One HTML document (or fragment) → [{ text, heading?, row? }] in order.
export function htmlToParagraphs(html) {
  const doc = new DOMParser().parseFromString(html || '', 'text/html');
  const out = [];
  if (doc.body) flow(doc.body, out);
  return out;
}
