// HTML → paragraph list shared by the Word and EPUB parsers
// (src/document/html-blocks.js).

import { describe, it, expect } from 'vitest';
import { htmlToParagraphs } from '../../../src/document/html-blocks.js';

describe('htmlToParagraphs', () => {
  it('keeps heading levels and makes one paragraph per block', () => {
    const paras = htmlToParagraphs(`
      <h1>Chapter One</h1>
      <p>First
         paragraph with <em>inline</em> markup.</p>
      <h3>Details</h3>
      <blockquote>A quoted line.</blockquote>
    `);
    expect(paras).toEqual([
      { text: 'Chapter One', heading: 1 },
      { text: 'First paragraph with inline markup.' },
      { text: 'Details', heading: 3 },
      { text: 'A quoted line.' },
    ]);
  });

  it('splits nested lists into their own paragraphs and keeps <br> as a line break', () => {
    const paras = htmlToParagraphs(`
      <ul><li>Outer item<ul><li>Inner item</li></ul></li><li>Second item</li></ul>
      <p>Line one<br>Line two</p>
    `);
    expect(paras.map((p) => p.text)).toEqual(['Outer item', 'Inner item', 'Second item', 'Line one\nLine two']);
  });

  it('turns table rows into rows, one-cell rows into paragraphs, nested tables once', () => {
    const paras = htmlToParagraphs(`
      <table>
        <tr><th>Site</th><th>Area</th></tr>
        <tr><td>Pine Ck</td><td>320 <table><tr><td>x</td><td>y</td></tr></table></td></tr>
        <tr><td></td><td></td></tr>
        <tr><td>A boxed note on its own.</td></tr>
      </table>
    `);
    expect(paras).toEqual([
      { text: 'Site | Area', row: true },
      { text: 'Pine Ck | 320 x y', row: true },
      { text: 'A boxed note on its own.' },
    ]);
  });

  it('decodes entities and ignores scripts, styles and images', () => {
    const paras = htmlToParagraphs(`
      <head><title>Book</title><style>p { color: red }</style></head>
      <body><script>alert(1)</script><p>Tom &amp; Jerry &#128512; <img src="x.png" alt="pic"></p></body>
    `);
    expect(paras).toEqual([{ text: `Tom & Jerry ${String.fromCodePoint(128512)}` }]);
  });
});
