// The user guide's Markdown reader: block structure, inline markup, anchor
// ids and the chapter / section table of contents.

import { describe, it, expect } from 'vitest';
import { parseMarkdown, parseInline, buildToc, slugify } from '../../../src/components/SettingsPanel/manual-markdown.js';

describe('parseInline', () => {
  it('splits bold, code and links out of plain text', () => {
    expect(parseInline('Press **Ctrl+C**, then `paste` or read [docs](https://x.y/z).')).toEqual([
      { type: 'text', text: 'Press ' },
      { type: 'bold', text: 'Ctrl+C' },
      { type: 'text', text: ', then ' },
      { type: 'code', text: 'paste' },
      { type: 'text', text: ' or read ' },
      { type: 'link', text: 'docs', href: 'https://x.y/z' },
      { type: 'text', text: '.' },
    ]);
  });

  it('returns plain text untouched', () => {
    expect(parseInline('nothing special')).toEqual([{ type: 'text', text: 'nothing special' }]);
  });
});

describe('parseMarkdown', () => {
  const doc = [
    '# Title is dropped',
    '',
    '## 1. Chapter',
    '',
    'First paragraph',
    'continues here.',
    '',
    '### 1.1 Section',
    '',
    '- one',
    '- **two**',
    '',
    '1. first',
    '2. second',
    '',
    '```',
    'npm start',
    '```',
    '',
    '## 2. Chapter',
    '',
    '### 1.1 Section',
  ].join('\n');

  it('produces headings, paragraphs, lists and code in order', () => {
    const blocks = parseMarkdown(doc);
    expect(blocks.map((b) => b.type)).toEqual([
      'heading', 'paragraph', 'heading', 'list', 'list', 'code', 'heading', 'heading',
    ]);
    expect(blocks[1].inlines).toEqual([{ type: 'text', text: 'First paragraph continues here.' }]);
    expect(blocks[3]).toMatchObject({ ordered: false, items: [[{ type: 'text', text: 'one' }], [{ type: 'bold', text: 'two' }]] });
    expect(blocks[4]).toMatchObject({ ordered: true });
    expect(blocks[5]).toEqual({ type: 'code', text: 'npm start' });
  });

  it('gives every heading a unique anchor id, CRLF included', () => {
    const blocks = parseMarkdown(doc.replace(/\n/g, '\r\n'));
    const ids = blocks.filter((b) => b.type === 'heading').map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBe('1-chapter');
    expect(ids[3]).toBe('1-1-section-2');
  });

  it('keeps CJK heading text in the id', () => {
    expect(slugify('0.1 安装与首次启动')).toBe('0-1-安装与首次启动');
  });
});

describe('buildToc', () => {
  it('nests ### sections under their ## chapter', () => {
    const toc = buildToc(parseMarkdown('## A\n### A1\n### A2\n## B\n#### deep\n### B1'));
    expect(toc).toEqual([
      { id: 'a', text: 'A', children: [{ id: 'a1', text: 'A1' }, { id: 'a2', text: 'A2' }] },
      { id: 'b', text: 'B', children: [{ id: 'b1', text: 'B1' }] },
    ]);
  });
});
