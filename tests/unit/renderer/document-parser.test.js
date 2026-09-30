// Pure-function coverage for the 0.2.9 document-translation overhaul:
// timecode conversion, CSV splitting, SRT id stability, segmentation.

import { describe, it, expect, vi } from 'vitest';
import {
  parseDocument,
  toSRTTimecode,
  toVTTTimecode,
  splitCSVLine,
  parseSRT,
  parseVTT,
  splitIntoSegments,
  shouldSkipSegment,
  detectLanguage,
  exportSRT,
  exportVTT,
  detectHeadings,
  buildOutlineTree,
  clampedPdfScale,
  assertZipWithinDecompressedCap,
  segmentsFromParagraphs,
  exportBilingual,
  exportTranslatedOnly,
  exportDOCX,
  exportPDFHTML,
  MAX_PDF_CANVAS_EDGE,
  MAX_DECOMPRESSED_SIZE_BYTES,
} from '../../../src/document/document-parser.js';
import { splitSentences, endsSentence } from '../../../src/document/sentence-breaks.js';

describe('timecode conversion', () => {
  it('VTT dot becomes SRT comma', () => {
    expect(toSRTTimecode('00:00:01.000 --> 00:00:04.400'))
      .toBe('00:00:01,000 --> 00:00:04,400');
  });

  it('short-form VTT gets the 2-digit hour SRT requires', () => {
    expect(toSRTTimecode('01:02.500 --> 01:05.000'))
      .toBe('00:01:02,500 --> 00:01:05,000');
  });

  it('1-digit VTT hour is zero-padded', () => {
    expect(toSRTTimecode('1:02:03.500 --> 1:02:04.000'))
      .toBe('01:02:03,500 --> 01:02:04,000');
  });

  it('already-SRT timecode is unchanged', () => {
    expect(toSRTTimecode('00:00:01,000 --> 00:00:04,400'))
      .toBe('00:00:01,000 --> 00:00:04,400');
  });

  it('SRT comma becomes VTT dot', () => {
    expect(toVTTTimecode('00:00:01,000 --> 00:00:04,400'))
      .toBe('00:00:01.000 --> 00:00:04.400');
  });
});

describe('splitCSVLine', () => {
  it('splits plain fields', () => {
    expect(splitCSVLine('a,b,c')).toEqual(['a', 'b', 'c']);
  });

  it('keeps commas inside quoted cells', () => {
    expect(splitCSVLine('a,"b, with comma",c')).toEqual(['a', 'b, with comma', 'c']);
  });

  it('unescapes doubled quotes', () => {
    expect(splitCSVLine('x,"He said ""hi""",y')).toEqual(['x', 'He said "hi"', 'y']);
  });

  it('handles trailing empty field', () => {
    expect(splitCSVLine('a,b,')).toEqual(['a', 'b', '']);
  });
});

describe('parseSRT', () => {
  const srt = [
    '5', '00:00:01,000 --> 00:00:02,000', 'first', '',
    '5', '00:00:03,000 --> 00:00:04,000', 'second', '',
    '1', '00:00:05,000 --> 00:00:06,000', 'third',
  ].join('\n');

  it('assigns sequential ids even when cue numbers restart or duplicate', () => {
    const segments = parseSRT(srt);
    expect(segments.map(s => s.id)).toEqual([0, 1, 2]);
    expect(segments.map(s => s.index)).toEqual([5, 5, 1]);
  });

  it('exportSRT renumbers sequentially', () => {
    const out = exportSRT(parseSRT(srt));
    expect(out.split('\n\n').map(block => block.split('\n')[0])).toEqual(['1', '2', '3']);
  });
});

describe('parseVTT / exportVTT', () => {
  const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nhello\n\n00:00:03.000 --> 00:00:04.000\nworld';

  it('parses cues with sequential ids', () => {
    const segments = parseVTT(vtt);
    expect(segments).toHaveLength(2);
    expect(segments[0].original).toBe('hello');
  });

  it('VTT-loaded subtitles export valid SRT timecodes', () => {
    const out = exportSRT(parseVTT(vtt));
    expect(out).toContain('00:00:01,000 --> 00:00:02,000');
    expect(out).not.toContain('.000 -->');
  });

  it('SRT-loaded subtitles export valid VTT timecodes', () => {
    const srt = '1\n00:00:01,000 --> 00:00:02,000\nhi';
    const out = exportVTT(parseSRT(srt));
    expect(out.startsWith('WEBVTT')).toBe(true);
    expect(out).toContain('00:00:01.000 --> 00:00:02.000');
  });
});

describe('splitIntoSegments', () => {
  it('splits on blank lines and skips per filters', () => {
    const segments = splitIntoSegments('First paragraph here.\n\nSecond paragraph here.', {
      filters: { skipShort: false },
    });
    expect(segments).toHaveLength(2);
    expect(segments.every(s => s.status === 'pending')).toBe(true);
  });

  it('long paragraphs are split under maxCharsPerSegment', () => {
    const para = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} is here.`).join(' ');
    const segments = splitIntoSegments(para, { maxCharsPerSegment: 200, filters: { skipShort: false } });
    expect(segments.length).toBeGreaterThan(1);
    expect(segments.every(s => s.original.length <= 200)).toBe(true);
  });

  it('does not split long paragraphs at abbreviations, initials or decimals', () => {
    const para = 'Smith et al. showed that 3.75 holds in v1.8.0 for N.J. Lane, e.g. in dry years. '
      + 'The next sentence follows here. And a third one ends it.';
    const segments = splitIntoSegments(para, { maxCharsPerSegment: 90, filters: { skipShort: false } });
    expect(segments.map(s => s.original)).toEqual([
      'Smith et al. showed that 3.75 holds in v1.8.0 for N.J. Lane, e.g. in dry years.',
      'The next sentence follows here. And a third one ends it.',
    ]);
  });
});

describe('sentence breaks', () => {
  it('splitSentences keeps the text intact and breaks after CJK stops', () => {
    const text = '第一句。第二句！Third one? Fourth.';
    const pieces = splitSentences(text);
    expect(pieces.join('')).toBe(text);
    expect(pieces).toEqual(['第一句。', '第二句！', 'Third one? ', 'Fourth.']);
  });

  it('endsSentence ignores abbreviations and initials', () => {
    expect(endsSentence('It works.')).toBe(true);
    expect(endsSentence('as follows:')).toBe(true);
    expect(endsSentence('结束了。')).toBe(true);
    expect(endsSentence('the model by Smith et al.')).toBe(false);
    expect(endsSentence('Patrick N.J.')).toBe(false);
    expect(endsSentence('no stop here')).toBe(false);
  });
});

describe('shouldSkipSegment', () => {
  it('skips short / numeric / code / already-target-language text', () => {
    expect(shouldSkipSegment('hi', { skipShort: true, minLength: 10 }).skip).toBe(true);
    expect(shouldSkipSegment('12345', { skipNumbers: true }).skip).toBe(true);
    expect(shouldSkipSegment('```\ncode\n```', { skipCode: true }).skip).toBe(true);
    expect(shouldSkipSegment('这是一段中文文本内容', { skipTargetLang: true, targetLang: 'zh' }).skip).toBe(true);
  });

  it('skips letterless text as numbers only, CJK counts as letters', () => {
    const skip = (text) => shouldSkipSegment(text, { skipNumbers: true }).skip;
    expect(skip('0.82 | 0.85 | 0.81')).toBe(true);
    expect(skip('(3)')).toBe(true);
    expect(skip('Q3 results')).toBe(false);
    expect(skip('第三章')).toBe(false);
  });

  it('keeps normal translatable text', () => {
    expect(shouldSkipSegment('This is a normal English sentence.', {
      skipShort: true, minLength: 10, skipNumbers: true, skipCode: true,
      skipTargetLang: true, targetLang: 'zh',
    }).skip).toBe(false);
  });

  it('only skips paragraphs that read as the target language', () => {
    const skip = (text, targetLang) => shouldSkipSegment(text, { skipTargetLang: true, targetLang }).skip;
    expect(skip('In Chinese philosophy, yin and yang (阴阳) describes complementary forces.', 'zh')).toBe(false);
    expect(skip('在 Kubernetes 集群中部署 Docker 容器时，需要配置 Service。', 'zh')).toBe(true);
    expect(skip('Я не знаю, что ты имеешь в виду.', 'en')).toBe(false);
    // English or French: left for parseDocument to settle through the stack.
    expect(skip('This is a normal English sentence.', 'en')).toBe(false);
  });
});

describe('parseDocument target-language filter', () => {
  const file = () => new File([
    'Bonjour à tous, je suis très content de vous voir ici aujourd\'hui.\n\n'
    + 'Hello everyone, I am very happy to see you all here today.\n\n'
    + '这是一段中文。',
  ], 'mixed.txt', { type: 'text/plain' });
  const filters = { skipTargetLang: true, targetLang: 'en' };

  it('asks the stack only about paragraphs the scripts leave open', async () => {
    const detectLanguages = vi.fn(async (texts) => texts.map((text) => ({
      language: text.startsWith('Hello') ? 'en' : 'fr',
      inTarget: text.startsWith('Hello'),
    })));
    const result = await parseDocument(file(), { filters, detectLanguages });
    expect(detectLanguages).toHaveBeenCalledTimes(1);
    expect(detectLanguages.mock.calls[0][0]).toHaveLength(2);
    expect(result.segments.map((seg) => seg.status)).toEqual(['pending', 'skipped', 'pending']);
  });

  it('keeps open paragraphs when nothing settles them', async () => {
    const result = await parseDocument(file(), { filters });
    expect(result.segments.map((seg) => seg.status)).toEqual(['pending', 'pending', 'pending']);
  });
});

describe('detectLanguage', () => {
  it('classifies zh / ja / ko / en', () => {
    expect(detectLanguage('这是中文内容测试')).toBe('zh');
    expect(detectLanguage('これはにほんごのテストです')).toBe('ja');
    expect(detectLanguage('한국어 텍스트입니다')).toBe('ko');
    expect(detectLanguage('plain english text')).toBe('en');
  });
});

describe('outline detection', () => {
  it('builds a nested tree from markdown headings', () => {
    const segments = [
      { id: 0, original: '# Chapter One' },
      { id: 1, original: '## Section A' },
      { id: 2, original: 'Body text long enough to not be a heading match here.' },
      { id: 3, original: '# Chapter Two' },
    ];
    const tree = buildOutlineTree(detectHeadings(segments));
    expect(tree).toHaveLength(2);
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].segmentId).toBe(1);
  });

  it('uses parser heading marks instead of the text patterns when present', () => {
    const segments = [
      { id: 0, original: 'A Study of Things', heading: 1 },
      { id: 1, original: '1. A numbered line the patterns would catch' },
      { id: 2, original: 'II. BACKGROUND', heading: 2 },
    ];
    expect(detectHeadings(segments).map(h => [h.segmentId, h.level])).toEqual([[0, 1], [2, 2]]);
  });
});

describe('PDF paragraphs to segments', () => {
  it('translates short headings and carries the table-row mark', () => {
    const segments = segmentsFromParagraphs([
      { text: 'Methods', parts: [{ page: 1 }], heading: 2 },
      { text: 'Tiny', parts: [{ page: 1 }] },
      { text: 'Site | Area | Depth', parts: [{ page: 2 }], row: true },
    ], new Map(), { filters: { skipShort: true, minLength: 10 } });
    expect(segments.map(s => [s.status, s.heading || 0, !!s.row])).toEqual([
      ['pending', 2, false],
      ['skipped', 0, false],
      ['pending', 0, true],
    ]);
    expect(segments[2].loc).toEqual([{ page: 2 }]);
  });
});

describe('Word and EPUB keep their structure', () => {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const para = (text, style) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t>${text}</w:t></w:r></w:p>`;
  const cell = (text) => `<w:tc>${para(text)}</w:tc>`;

  async function zipFile(name, entries) {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    for (const [path, body] of Object.entries(entries)) zip.file(path, body);
    return new File([await zip.generateAsync({ type: 'arraybuffer' })], name);
  }

  it('Word headings, paragraphs and table rows come through', async () => {
    const file = await zipFile('sample.docx', {
      '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        + '<Default Extension="xml" ContentType="application/xml"/>'
        + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
        + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
      '_rels/.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      'word/_rels/document.xml.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
      'word/styles.xml': `<?xml version="1.0"?><w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style></w:styles>`,
      'word/document.xml': `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>`
        + para('Introduction', 'Heading1')
        + para('The first paragraph of body text.')
        + `<w:tbl><w:tr>${cell('Site')}${cell('Area')}</w:tr><w:tr>${cell('Pine Ck')}${cell('320')}</w:tr></w:tbl>`
        + '</w:body></w:document>',
    });
    const result = await parseDocument(file, { filters: { skipShort: true, minLength: 10, skipNumbers: true } });
    expect(result.success).toBe(true);
    expect(result.segments.map(s => [s.original, s.heading || 0, !!s.row, s.status])).toEqual([
      ['Introduction', 1, false, 'pending'],
      ['The first paragraph of body text.', 0, false, 'pending'],
      ['Site | Area', 0, true, 'pending'],
      ['Pine Ck | 320', 0, true, 'pending'],
    ]);
    expect(result.outline.map(h => h.text)).toEqual(['Introduction']);
  });

  it('EPUB chapters give headings and paragraphs with entities decoded', async () => {
    const file = await zipFile('book.epub', {
      'META-INF/container.xml': '<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>',
      'OEBPS/content.opf': '<?xml version="1.0"?><package><metadata><dc:title>A Small Book</dc:title></metadata>'
        + '<manifest><item id="c1" href="ch1.xhtml"/><item id="css" href="style.css"/></manifest><spine><itemref idref="c1"/></spine></package>',
      'OEBPS/ch1.xhtml': '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>ch1</title></head>'
        + '<body><h2>Chapter One</h2><p>Tom &amp; Jerry went out.</p><p>They came back late at night.</p></body></html>',
    });
    const result = await parseDocument(file, { filters: { skipShort: false } });
    expect(result.success).toBe(true);
    expect(result.title).toBe('A Small Book');
    expect(result.segments.map(s => [s.original, s.heading || 0])).toEqual([
      ['Chapter One', 2],
      ['Tom & Jerry went out.', 0],
      ['They came back late at night.', 0],
    ]);
  });
});

describe('structured export', () => {
  const segments = [
    { id: 0, original: 'Results', translated: '结果', status: 'completed', heading: 2 },
    { id: 1, original: 'Site | Area | Depth', translated: '地点 | 面积 | 深度', status: 'completed', row: true },
    { id: 2, original: '12 | 320 | 1.0', translated: '', status: 'skipped', row: true },
    { id: 3, original: 'Glendhu | 310 | 0.64', translated: 'Glendhu 310 0.64', status: 'completed', row: true },
    { id: 4, original: 'Body text here.', translated: '正文在这里。', status: 'completed' },
    { id: 5, original: 'Reply8', translated: '', status: 'skipped' },
  ];

  it('Markdown uses #, a table with paired cells, and quoted originals', () => {
    const md = exportBilingual(segments, { style: 'below', format: 'md' });
    expect(md).toContain('## 结果\n\n*Results*');
    expect(md).toContain([
      '| Site<br>地点 | Area<br>面积 | Depth<br>深度 |',
      '| --- | --- | --- |',
      '| 12 | 320 | 1.0 |',
      '| Glendhu | 310 | 0.64 |',
      '| Glendhu 310 0.64 |  |  |',
    ].join('\n'));
    expect(md).toContain('> Body text here.\n\n正文在这里。');
    expect(md).not.toContain('Reply8');
  });

  it('Word export has real headings and a table, full-width row when cells do not line up', async () => {
    const html = await exportDOCX(segments, { style: 'bilingual', title: 'demo' }).text();
    expect(html).toContain('<h3>结果</h3><p class="heading-original">Results</p>');
    expect(html).toContain('<td><span class="cell-original">Site</span><br>地点</td>');
    expect(html).toContain('<tr><td>12</td><td>320</td><td>1.0</td></tr>');
    expect(html).toContain('<td colspan="3">Glendhu 310 0.64</td>');
    expect(html).not.toContain('Reply8');
  });

  it('print export in translated-only mode shows translations in the cells', () => {
    const html = exportPDFHTML(segments, { style: 'translated-only', title: 'demo' });
    expect(html).toContain('<h3>结果</h3>');
    expect(html).not.toContain('heading-original">Results');
    expect(html).toContain('<tr><td>地点</td><td>面积</td><td>深度</td></tr>');
    expect(html).toContain('<tr><td colspan="3">Glendhu 310 0.64</td></tr>');
  });

  it('plain-text export keeps skipped headings and table rows', () => {
    const text = exportTranslatedOnly(segments);
    expect(text).toContain('12 | 320 | 1.0');
    expect(text).not.toContain('Reply8');
  });
});

// DoS hardening — a malicious PDF/EPUB/DOCX opened one-click from the context
// menu must not allocate an unbounded canvas or decompress past the cap.
describe('PDF canvas scale clamp', () => {
  it('keeps scale 2 for a normal page', () => {
    expect(clampedPdfScale(612, 792)).toBe(2); // US Letter @72dpi
  });

  it('scales an oversized page down so the longest edge fits the cap', () => {
    const scale = clampedPdfScale(200000, 100000);
    expect(scale).toBeLessThan(2);
    expect(200000 * scale).toBeLessThanOrEqual(MAX_PDF_CANVAS_EDGE);
  });

  it('never scales up a tiny page past the desired 2', () => {
    expect(clampedPdfScale(10, 10)).toBe(2);
  });

  it('survives a degenerate zero-size page', () => {
    expect(clampedPdfScale(0, 0)).toBe(2);
  });
});

describe('zip decompressed-size cap', () => {
  const zipOf = (sizes) => ({
    files: Object.fromEntries(
      sizes.map((s, i) => [`f${i}`, { dir: false, _data: { uncompressedSize: s } }])
    ),
  });

  it('passes a normal document', () => {
    expect(() => assertZipWithinDecompressedCap(zipOf([1_000_000, 2_000_000]))).not.toThrow();
  });

  it('throws when the declared total exceeds the cap (zip bomb)', () => {
    const huge = MAX_DECOMPRESSED_SIZE_BYTES + 1;
    expect(() => assertZipWithinDecompressedCap(zipOf([huge]))).toThrow();
  });

  it('sums entries — many mid-size files together trip the cap', () => {
    const each = Math.ceil(MAX_DECOMPRESSED_SIZE_BYTES / 4);
    expect(() => assertZipWithinDecompressedCap(zipOf([each, each, each, each, each]))).toThrow();
  });

  it('ignores directory entries and missing sizes', () => {
    const zip = { files: {
      d: { dir: true, _data: { uncompressedSize: 9e9 } },
      a: { dir: false, _data: {} },
      b: { dir: false },
      c: { dir: false, _data: { uncompressedSize: 5 } },
    } };
    expect(() => assertZipWithinDecompressedCap(zip)).not.toThrow();
  });

  it('tolerates an empty or malformed zip object', () => {
    expect(() => assertZipWithinDecompressedCap({})).not.toThrow();
    expect(() => assertZipWithinDecompressedCap({ files: null })).not.toThrow();
  });
});
