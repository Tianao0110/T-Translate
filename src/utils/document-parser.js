// Document parsing helpers: format-specific loaders, smart segmentation,
// outline detection, batch grouping, and bilingual export.

import createLogger from './logger.js';
import i18n from '../i18n.js';
const logger = createLogger('DocumentParser');

const _t = (key, fallback) => {
  try { const r = i18n.t(key); return r === key ? fallback : r; } catch { return fallback; }
};

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const MAX_FILE_SIZE_LABEL = '20MB';

export const SUPPORTED_FORMATS = {
  txt: { name: '纯文本', mime: 'text/plain', parser: 'text' },
  md: { name: 'Markdown', mime: 'text/markdown', parser: 'text' },

  srt: { name: 'SRT 字幕', mime: 'text/plain', parser: 'srt' },
  vtt: { name: 'WebVTT 字幕', mime: 'text/vtt', parser: 'vtt' },

  pdf: { name: 'PDF 文档', mime: 'application/pdf', parser: 'pdf' },
  docx: { name: 'Word 文档', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', parser: 'docx' },

  csv: { name: 'CSV 表格', mime: 'text/csv', parser: 'csv' },

  json: { name: 'JSON 文件', mime: 'application/json', parser: 'json' },

  epub: { name: 'EPUB 电子书', mime: 'application/epub+zip', parser: 'epub' },
};

// Heading patterns tried in order. The first match wins per segment.
const HEADING_PATTERNS = [
  // Markdown ATX headings.
  { regex: /^(#{1,6})\s+(.+)$/m, level: (m) => m[1].length, text: (m) => m[2] },
  // Numeric (1. / 1.1 / 1.1.1 ...) — level = depth of dot chain.
  { regex: /^(\d+(?:\.\d+)*)[.、]\s*(.+)$/m, level: (m) => m[1].split('.').length, text: (m) => m[2] },
  // Chinese chapter markers (e.g. 第一章, 一、).
  { regex: /^(第?[一二三四五六七八九十百千]+[章节篇部])[、.\s]*(.*)$/m, level: () => 1, text: (m) => m[1] + (m[2] ? ' ' + m[2] : '') },
  // English Chapter/Section/Part numbering.
  { regex: /^(Chapter|Section|Part)\s+(\d+)[.:]\s*(.*)$/im, level: (m) => m[1].toLowerCase() === 'chapter' ? 1 : 2, text: (m) => `${m[1]} ${m[2]}${m[3] ? ': ' + m[3] : ''}` },
  // ALL CAPS line at least 11 chars long.
  { regex: /^([A-Z][A-Z\s]{10,})$/m, level: () => 1, text: (m) => m[1].trim() },
];

export function detectHeadings(segments) {
  const headings = [];

  for (const segment of segments) {
    const text = segment.original?.trim() || '';
    if (!text || text.length > 200) continue;  // headings shouldn't be paragraphs

    for (const pattern of HEADING_PATTERNS) {
      const match = text.match(pattern.regex);
      if (match) {
        headings.push({
          segmentId: segment.id,
          level: pattern.level(match),
          text: pattern.text(match),
          original: text,
        });
        break;
      }
    }
  }

  return headings;
}

export function buildOutlineTree(headings) {
  const tree = [];
  const stack = [{ level: 0, children: tree }];

  for (const heading of headings) {
    const node = {
      ...heading,
      children: [],
    };

    while (stack.length > 1 && stack[stack.length - 1].level >= heading.level) {
      stack.pop();
    }

    stack[stack.length - 1].children.push(node);
    stack.push(node);
  }

  return tree;
}

// Token estimate: CJK ≈ 2 tokens/char, Latin ≈ 0.35 tokens/char (~4 chars/word, 1.3 tokens/word).
export function estimateTokens(text) {
  if (!text) return 0;
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const otherChars = text.length - chineseChars;
  return Math.ceil(chineseChars * 2 + otherChars * 0.35);
}

export function detectLanguage(text) {
  if (!text) return 'unknown';
  const chineseRatio = (text.match(/[\u4e00-\u9fff]/g) || []).length / text.length;
  const japaneseRatio = (text.match(/[\u3040-\u309f\u30a0-\u30ff]/g) || []).length / text.length;
  const koreanRatio = (text.match(/[\uac00-\ud7af]/g) || []).length / text.length;

  if (chineseRatio > 0.3) return 'zh';
  if (japaneseRatio > 0.1) return 'ja';
  if (koreanRatio > 0.1) return 'ko';
  return 'en';
}

export function shouldSkipSegment(text, filters = {}) {
  if (!text || !text.trim()) {
    return { skip: true, reason: _t('docParser.emptySegment', 'Empty segment') };
  }

  const trimmed = text.trim();

  if (filters.skipShort && trimmed.length < (filters.minLength || 10)) {
    return { skip: true, reason: _t('docParser.tooShort', 'Too short') };
  }

  if (filters.skipNumbers && /^\d+$/.test(trimmed)) {
    return { skip: true, reason: _t('docParser.numbersOnly', 'Numbers only') };
  }

  if (filters.skipCode && /^```[\s\S]*```$/.test(trimmed)) {
    return { skip: true, reason: _t('docParser.codeBlock', 'Code block') };
  }

  if (filters.skipTargetLang && filters.targetLang) {
    const lang = detectLanguage(trimmed);
    if (lang === filters.targetLang) {
      return { skip: true, reason: _t('docParser.alreadyTargetLang', 'Already in target language') };
    }
  }

  if (filters.skipKeywords && filters.skipKeywords.length > 0) {
    for (const keyword of filters.skipKeywords) {
      if (trimmed.toLowerCase().includes(keyword.toLowerCase())) {
        return { skip: true, reason: _t('docParser.containsKeyword', 'Contains keyword') + `: ${keyword}` };
      }
    }
  }

  return { skip: false };
}

export function splitIntoSegments(text, options = {}) {
  const {
    maxCharsPerSegment = 800,
    filters = {},
  } = options;

  const segments = [];
  let segmentId = 0;

  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim());

  for (const para of paragraphs) {
    const trimmedPara = para.trim();

    const skipCheck = shouldSkipSegment(trimmedPara, filters);

    if (skipCheck.skip) {
      segments.push({
        id: segmentId++,
        original: trimmedPara,
        translated: '',
        status: 'skipped',
        tokens: 0,
        isFiltered: true,
        filterReason: skipCheck.reason,
      });
      continue;
    }

    if (trimmedPara.length <= maxCharsPerSegment) {
      segments.push({
        id: segmentId++,
        original: trimmedPara,
        translated: '',
        status: 'pending',
        tokens: estimateTokens(trimmedPara),
      });
    } else {
      // Paragraph too long — split on sentence boundaries first.
      const sentences = splitBySentence(trimmedPara, maxCharsPerSegment);
      for (const sentence of sentences) {
        if (sentence.trim()) {
          segments.push({
            id: segmentId++,
            original: sentence.trim(),
            translated: '',
            status: 'pending',
            tokens: estimateTokens(sentence),
          });
        }
      }
    }
  }

  return segments;
}

function splitBySentence(text, maxChars) {
  const sentenceEnders = /([.。!！?？]+[\s]*)/g;
  const parts = text.split(sentenceEnders);

  const result = [];
  let current = '';

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];

    if (current.length + part.length <= maxChars) {
      current += part;
    } else {
      if (current.trim()) {
        result.push(current.trim());
      }
      current = part;
    }
  }

  if (current.trim()) {
    result.push(current.trim());
  }

  // Last-resort hard split for sentences that exceed maxChars on their own.
  const finalResult = [];
  for (const segment of result) {
    if (segment.length <= maxChars) {
      finalResult.push(segment);
    } else {
      for (let i = 0; i < segment.length; i += maxChars) {
        finalResult.push(segment.slice(i, i + maxChars));
      }
    }
  }

  return finalResult;
}

export function parseSRT(content) {
  const segments = [];
  const blocks = content.trim().split(/\n\s*\n/);

  // ids are sequential, not the file's cue numbers — real-world SRT files
  // restart or duplicate numbering, which would collide React keys and
  // progress-restore mapping. The original cue number survives in `index`.
  let id = 0;
  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 3) continue;

    const index = parseInt(lines[0]);
    const timecode = lines[1];
    const text = lines.slice(2).join('\n');

    if (!isNaN(index) && timecode.includes('-->')) {
      segments.push({
        id: id++,
        index,
        timecode,
        original: text,
        translated: '',
        status: 'pending',
        tokens: estimateTokens(text),
        type: 'subtitle',
      });
    }
  }

  return segments;
}

export function parseVTT(content) {
  const segments = [];
  const body = content.replace(/^WEBVTT[\s\S]*?\n\n/, '');
  const blocks = body.trim().split(/\n\s*\n/);

  let index = 0;
  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 2) continue;

    let timecodeIndex = 0;
    if (!lines[0].includes('-->')) {
      timecodeIndex = 1;
    }

    const timecode = lines[timecodeIndex];
    const text = lines.slice(timecodeIndex + 1).join('\n');

    if (timecode && timecode.includes('-->')) {
      segments.push({
        id: index,
        index: index + 1,
        timecode,
        original: text,
        translated: '',
        status: 'pending',
        tokens: estimateTokens(text),
        type: 'subtitle',
      });
      index++;
    }
  }

  return segments;
}

// Render a PDF page to canvas and feed it through the OCR chain.
// Scale 2 keeps small print legible for local OCR without ballooning memory.
// Returns null on failure so callers can distinguish "no text" from "failed".
async function ocrPdfPage(page, ocrRecognize) {
  try {
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    const result = await ocrRecognize(canvas.toDataURL('image/png'));
    return result?.success && result.text ? result.text : null;
  } catch {
    return null;
  }
}

// Stray items (page number, watermark) still read as a scanned page;
// real text pages clear this easily.
const SCANNED_PAGE_MAX_CHARS = 20;

export async function parsePDF(file, options = {}) {
  const { password, maxCharsPerSegment = 800, filters = {}, ocrRecognize, onProgress } = options;

  const pdfjsLib = await import('pdfjs-dist');

  // Prefer the local worker; fall back to main-thread parsing if the
  // URL can't be resolved (slower but always works).
  if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
    try {
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/build/pdf.worker.min.mjs',
        import.meta.url
      ).toString();
    } catch {
      pdfjsLib.GlobalWorkerOptions.workerPort = null;
    }
  }

  const arrayBuffer = await file.arrayBuffer();

  const loadingTask = pdfjsLib.getDocument({
    data: arrayBuffer,
    password: password || undefined,
  });

  const pdf = await loadingTask.promise;
  const numPages = pdf.numPages;

  let allText = '';
  const pageTexts = [];
  let usedOcr = false;

  for (let i = 1; i <= numPages; i++) {
    onProgress?.({ page: i, total: numPages });
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();

    // Group text-run items into visual lines by Y coordinate.
    const lines = [];
    let currentLine = '';
    let lastY = null;
    let lastX = 0;

    for (const item of textContent.items) {
      if (!item.str) continue;

      const y = Math.round(item.transform[5]);
      const x = item.transform[4];

      if (lastY !== null && Math.abs(y - lastY) > 3) {
        if (currentLine.trim()) {
          lines.push(currentLine.trim());
        }
        currentLine = item.str;
      } else {
        // Same line: insert a space if there's a visible horizontal gap.
        if (currentLine && x - lastX > 10) {
          currentLine += ' ';
        }
        currentLine += item.str;
      }
      lastY = y;
      lastX = x + (item.width || item.str.length * 6);
    }
    if (currentLine.trim()) {
      lines.push(currentLine.trim());
    }

    // Stitch lines into paragraphs: keep newline at sentence-ending
    // punctuation or short lines (likely headings / list items),
    // otherwise join (a paragraph was wrapped mid-sentence in the PDF).
    let pageText = '';
    for (let j = 0; j < lines.length; j++) {
      const line = lines[j];
      const nextLine = lines[j + 1];

      // Drop suspected page numbers in headers/footers.
      if ((j === 0 || j === lines.length - 1) && /^\d{1,4}$/.test(line)) {
        continue;
      }

      pageText += line;

      const endsWithPunctuation = /[.!?。！？;:；：]$/.test(line);
      const isShortLine = line.length < 40;

      if (endsWithPunctuation || isShortLine || !nextLine) {
        pageText += '\n';
      } else {
        // CJK doesn't need a join space; Latin scripts do.
        const lastChar = line[line.length - 1];
        const isCJK = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/.test(lastChar);
        pageText += isCJK ? '' : ' ';
      }
    }

    // Image-only page (scanned PDF) — render it and run the OCR chain.
    if (pageText.trim().length < SCANNED_PAGE_MAX_CHARS && ocrRecognize) {
      onProgress?.({ page: i, total: numPages, ocr: true });
      const ocrText = await ocrPdfPage(page, ocrRecognize);
      if (ocrText?.trim()) {
        pageText = ocrText;
        usedOcr = true;
      }
    }

    pageTexts.push(pageText.trim());
  }

  allText = pageTexts.filter(t => t).join('\n\n');

  const segments = splitIntoSegments(allText, {
    maxCharsPerSegment,
    filters,
  });

  const result = {
    segments,
    pageCount: numPages,
    isPdf: true,
  };
  if (usedOcr) {
    result.usedOcr = true;
  }
  // Nothing extractable and OCR didn't save it — tell the user why the
  // document came back empty instead of showing "0 segments".
  if (segments.length === 0) {
    result.warning = 'scanned_no_ocr';
  }
  return result;
}

export async function parseDOCX(file, options = {}) {
  const { maxCharsPerSegment = 800, filters = {} } = options;

  const mammoth = await import('mammoth');
  const arrayBuffer = await file.arrayBuffer();

  const result = await mammoth.extractRawText({ arrayBuffer });
  const text = result.value;

  const segments = splitIntoSegments(text, {
    maxCharsPerSegment,
    filters,
  });

  const warnings = result.messages
    .filter(m => m.type === 'warning')
    .map(m => m.message);

  return {
    segments,
    warnings,
  };
}

// Quote-aware single-line CSV field splitter (handles embedded commas and
// doubled quotes). Multi-line quoted cells are out of scope — rows are
// pre-split on newlines.
export function splitCSVLine(line) {
  const cells = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      cells.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells;
}

export async function parseCSV(file, options = {}) {
  const { filters = {} } = options;

  const text = await readAsText(file);
  const lines = text.split('\n');
  const segments = [];
  let segmentId = 0;

  // Skip the header row if line 0 looks like comma-delimited.
  const startLine = lines[0]?.includes(',') ? 1 : 0;

  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Extracts text-bearing cells joined with " | ".
    const cells = splitCSVLine(line).map(c => c.trim());
    const textContent = cells.filter(c => c.length > 5 && !/^\d+$/.test(c)).join(' | ');

    if (textContent && textContent.length >= (filters.minLength || 5)) {
      segments.push({
        id: segmentId++,
        original: textContent,
        translated: '',
        status: 'pending',
        tokens: estimateTokens(textContent),
      });
    }
  }

  return { segments };
}

// Extracts string leaves from arbitrary JSON, skipping URLs/dates/UUIDs.
export async function parseJSON(file, options = {}) {
  const { filters = {} } = options;

  const text = await readAsText(file);
  const data = JSON.parse(text);
  const segments = [];
  let segmentId = 0;

  function extractStrings(obj) {
    if (typeof obj === 'string' && obj.length >= (filters.minLength || 5)) {
      if (!/^(https?:\/\/|[\dT:Z-]+$|[a-f0-9-]{36}$)/i.test(obj)) {
        segments.push({
          id: segmentId++,
          original: obj,
          translated: '',
          status: 'pending',
          tokens: estimateTokens(obj),
        });
      }
    } else if (Array.isArray(obj)) {
      obj.forEach(item => extractStrings(item));
    } else if (obj && typeof obj === 'object') {
      Object.values(obj).forEach(value => extractStrings(value));
    }
  }

  extractStrings(data);

  return { segments };
}

// EPUB is a ZIP of (X)HTML — we follow container.xml → OPF → spine.
export async function parseEPUB(file, options = {}) {
  const { maxCharsPerSegment = 800, filters = {} } = options;

  const JSZip = (await import('jszip')).default;
  const arrayBuffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);

  const containerXml = await zip.file('META-INF/container.xml')?.async('text');
  if (!containerXml) {
    throw new Error(_t('docParser.epubNoContainer', 'Invalid EPUB: missing container.xml'));
  }

  const rootfileMatch = containerXml.match(/full-path="([^"]+)"/);
  if (!rootfileMatch) {
    throw new Error(_t('docParser.epubNoRootfile', 'Invalid EPUB: rootfile not found'));
  }

  const rootfilePath = rootfileMatch[1];
  const rootfileDir = rootfilePath.substring(0, rootfilePath.lastIndexOf('/') + 1);

  const opfContent = await zip.file(rootfilePath)?.async('text');
  if (!opfContent) {
    throw new Error(_t('docParser.epubNoOpf', 'Invalid EPUB: OPF file not found'));
  }

  const titleMatch = opfContent.match(/<dc:title[^>]*>([^<]+)<\/dc:title>/i);
  const title = titleMatch ? titleMatch[1].trim() : file.name.replace(/\.epub$/i, '');

  const spineMatch = opfContent.match(/<spine[^>]*>([\s\S]*?)<\/spine>/i);
  const itemrefMatches = spineMatch ? spineMatch[1].matchAll(/idref="([^"]+)"/g) : [];
  const spineIds = [...itemrefMatches].map(m => m[1]);

  const manifestMatch = opfContent.match(/<manifest[^>]*>([\s\S]*?)<\/manifest>/i);
  const itemTags = manifestMatch ? (manifestMatch[1].match(/<item\b[^>]*>/gi) || []) : [];

  // Attribute order varies between EPUB generators — extract separately
  // instead of assuming id comes before href.
  const manifest = {};
  for (const tag of itemTags) {
    const id = tag.match(/\bid="([^"]+)"/i)?.[1];
    const href = tag.match(/\bhref="([^"]+)"/i)?.[1];
    if (id && href) manifest[id] = href;
  }

  let allText = '';
  let chapterCount = 0;

  for (const id of spineIds) {
    const href = manifest[id];
    if (!href) continue;

    if (!/\.(x?html?|xml)$/i.test(href)) continue;

    const filePath = rootfileDir + decodeURIComponent(href);
    const content = await zip.file(filePath)?.async('text');

    if (content) {
      chapterCount++;
      const text = extractTextFromHTML(content);
      if (text.trim()) {
        allText += text + '\n\n';
      }
    }
  }

  if (!allText.trim()) {
    throw new Error(_t('docParser.epubNoContent', 'No translatable text found in EPUB'));
  }

  const segments = splitIntoSegments(allText, {
    maxCharsPerSegment,
    filters,
  });

  return {
    segments,
    title,
    chapterCount,
  };
}

function extractTextFromHTML(html) {
  let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

  // Convert block-level tags to newlines.
  text = text.replace(/<\/(p|div|h[1-6]|br|li|tr)>/gi, '\n');
  text = text.replace(/<(p|div|h[1-6]|br|li|tr)[^>]*>/gi, '\n');

  text = text.replace(/<[^>]+>/g, '');

  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&quot;/g, '"');
  // fromCodePoint, not fromCharCode — numeric entities can be astral (emoji).
  const decodeCodePoint = (code) => {
    try { return String.fromCodePoint(code); } catch { return ''; }
  };
  text = text.replace(/&#(\d+);/g, (_, code) => decodeCodePoint(Number(code)));
  text = text.replace(/&#x([0-9a-f]+);/gi, (_, code) => decodeCodePoint(parseInt(code, 16)));

  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n\s*\n/g, '\n\n');

  return text.trim();
}

export async function parseDocument(file, options = {}) {
  const ext = file.name.split('.').pop().toLowerCase();
  const format = SUPPORTED_FORMATS[ext];

  if (!format) {
    throw new Error(_t('docParser.unsupportedFormat', 'Unsupported file format') + `: .${ext}`);
  }

  // Whole file goes through arrayBuffer; an unbounded PDF would freeze or
  // OOM the renderer.
  if (file.size > MAX_FILE_SIZE) {
    return {
      success: false,
      error: _t('documentTranslator.notify.fileTooLarge', `File too large (max ${MAX_FILE_SIZE_LABEL})`),
    };
  }

  try {
    let content;
    let segments;
    const extra = {};

    switch (format.parser) {
      case 'text':
        content = await readAsText(file);
        segments = splitIntoSegments(content, options);
        break;

      case 'srt':
        content = await readAsText(file);
        segments = parseSRT(content);
        break;

      case 'vtt':
        content = await readAsText(file);
        segments = parseVTT(content);
        break;

      case 'pdf': {
        const pdfResult = await parsePDF(file, options);
        segments = pdfResult.segments;
        extra.pageCount = pdfResult.pageCount;
        extra.isPdf = true;
        if (pdfResult.usedOcr) extra.usedOcr = true;
        if (pdfResult.warning === 'scanned_no_ocr') {
          extra.isScanned = true;
          extra.warning = 'scanned_no_ocr';
        }
        break;
      }

      case 'docx': {
        const docxResult = await parseDOCX(file, options);
        segments = docxResult.segments;
        if (docxResult.warnings?.length > 0) {
          extra.warnings = docxResult.warnings;
        }
        break;
      }

      case 'csv': {
        const csvResult = await parseCSV(file, options);
        segments = csvResult.segments;
        break;
      }

      case 'json': {
        const jsonResult = await parseJSON(file, options);
        segments = jsonResult.segments;
        break;
      }

      case 'epub': {
        const epubResult = await parseEPUB(file, options);
        segments = epubResult.segments;
        extra.title = epubResult.title;
        extra.chapterCount = epubResult.chapterCount;
        break;
      }

      default:
        throw new Error(_t('docParser.unimplementedParser', 'Unimplemented parser') + ': ' + format.parser);
    }

    const headings = detectHeadings(segments);
    const outline = buildOutlineTree(headings);

    const stats = calculateStats(segments);

    return {
      success: true,
      filename: file.name,
      format: ext,
      formatName: format.name,
      segments,
      stats,
      outline,
      headings,
      ...extra,
    };

  } catch (error) {
    logger.error('Error:', error);

    if (error.message?.includes('password') ||
        error.name === 'PasswordException' ||
        error.message?.includes('Incorrect Password')) {
      return {
        success: false,
        needPassword: true,
        message: _t('docParser.passwordRequired', 'File requires a password'),
      };
    }

    return {
      success: false,
      error: error.message,
    };
  }
}

// FileReader.readAsText is UTF-8-only; legacy Chinese subtitles/novels are
// frequently GBK, and some Windows tools emit UTF-16. Decode by evidence:
// BOM first, then UTF-8 unless GBK produces strictly fewer replacement chars.
async function readAsText(file) {
  let buffer;
  try {
    buffer = await file.arrayBuffer();
  } catch {
    throw new Error(_t('docParser.readFailed', 'Failed to read file'));
  }
  const bytes = new Uint8Array(buffer);

  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(buffer);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(buffer);

  const utf8 = new TextDecoder('utf-8').decode(buffer);
  const utf8Bad = (utf8.match(/�/g) || []).length;
  if (utf8Bad === 0) return utf8;

  try {
    const gbk = new TextDecoder('gbk').decode(buffer);
    const gbkBad = (gbk.match(/�/g) || []).length;
    if (gbkBad < utf8Bad) return gbk;
  } catch { /* decoder unavailable */ }
  return utf8;
}

function calculateStats(segments) {
  const total = segments.length;
  const pending = segments.filter(s => s.status === 'pending').length;
  const skipped = segments.filter(s => s.status === 'skipped').length;
  const totalChars = segments.reduce((sum, s) => sum + (s.original?.length || 0), 0);
  const totalTokens = segments.reduce((sum, s) => sum + (s.tokens || 0), 0);

  return {
    total,
    pending,
    skipped,
    totalChars,
    totalTokens,
    estimatedTime: Math.ceil(pending * 1.5),
  };
}

export function batchSegments(segments, options = {}) {
  const {
    maxTokensPerBatch = 2000,
    maxSegmentsPerBatch = 5,
    separator = '\n[SEP]\n',
  } = options;

  const batches = [];
  let currentBatch = [];
  let currentTokens = 0;

  for (const segment of segments) {
    if (segment.status !== 'pending') continue;

    const canAdd =
      currentBatch.length < maxSegmentsPerBatch &&
      currentTokens + segment.tokens <= maxTokensPerBatch;

    if (canAdd) {
      currentBatch.push(segment);
      currentTokens += segment.tokens;
    } else {
      if (currentBatch.length > 0) {
        batches.push({
          segments: currentBatch,
          tokens: currentTokens,
          text: currentBatch.map(s => s.original).join(separator),
        });
      }
      currentBatch = [segment];
      currentTokens = segment.tokens;
    }
  }

  if (currentBatch.length > 0) {
    batches.push({
      segments: currentBatch,
      tokens: currentTokens,
      text: currentBatch.map(s => s.original).join(separator),
    });
  }

  return batches;
}

export function exportBilingual(segments, options = {}) {
  const {
    style = 'below',
    includeSkipped = false,
  } = options;

  let output = '';

  for (const segment of segments) {
    if (!includeSkipped && segment.status === 'skipped') continue;

    const original = segment.original || '';
    const translated = segment.translated || '';

    switch (style) {
      case 'below':
        output += original + '\n';
        if (translated) {
          output += translated + '\n';
        }
        output += '\n';
        break;

      case 'side-by-side':
        output += `| ${original.replace(/\|/g, '\\|').replace(/\n/g, ' ')} | ${translated.replace(/\|/g, '\\|').replace(/\n/g, ' ')} |\n`;
        break;
    }
  }

  if (style === 'side-by-side') {
    output = '| 原文 | 译文 |\n|------|------|\n' + output;
  }

  return output;
}

export function exportTranslatedOnly(segments, options = {}) {
  const { includeSkipped = false } = options;

  return segments
    .filter(s => includeSkipped || s.status !== 'skipped')
    .map(s => s.translated || s.original)
    .join('\n\n');
}

// Timecodes are kept verbatim from the source file, so a VTT-loaded doc
// exported as SRT (or vice versa) needs the millisecond separator converted —
// players and <track> parsers reject the wrong one. SRT also requires a
// 2-digit hour field, which short-form VTT times omit.
export function toSRTTimecode(timecode) {
  return timecode.replace(/(?:(\d{1,2}):)?(\d{2}):(\d{2})[.,](\d{3})/g, (_, h, m, s, ms) =>
    `${(h || '0').padStart(2, '0')}:${m}:${s},${ms}`);
}

export function toVTTTimecode(timecode) {
  return timecode.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
}

export function exportSRT(segments) {
  // Renumbered sequentially — source cue numbers may restart or duplicate.
  return segments
    .filter(s => s.type === 'subtitle')
    .map((s, i) => `${i + 1}\n${toSRTTimecode(s.timecode)}\n${s.translated || s.original}`)
    .join('\n\n');
}

export function exportVTT(segments) {
  const body = segments
    .filter(s => s.type === 'subtitle')
    .map(s => `${toVTTTimecode(s.timecode)}\n${s.translated || s.original}`)
    .join('\n\n');

  return `WEBVTT\n\n${body}`;
}

// Exports a Word-compatible HTML document — Word opens it directly.
export function exportDOCX(segments, options = {}) {
  const {
    style = 'bilingual',
    title = _t('documentTranslator.defaultDocTitle', '翻译文档'),
    includeSkipped = false,
  } = options;

  const now = new Date().toLocaleString('zh-CN');

  let content = '';

  for (const segment of segments) {
    if (!includeSkipped && segment.status === 'skipped') continue;

    // Multi-line text (subtitles) collapses in HTML without explicit breaks.
    const original = escapeHtml(segment.original || '').replace(/\n/g, '<br>');
    const translated = escapeHtml(segment.translated || '').replace(/\n/g, '<br>');

    if (style === 'bilingual') {
      content += `
        <p style="color: #666; margin-bottom: 8px; font-size: 11pt;">${original}</p>
        ${translated ? `<p style="color: #000; margin-bottom: 24px; font-size: 12pt;">${translated}</p>` : ''}
      `;
    } else if (style === 'translated-only') {
      content += `<p style="margin-bottom: 16px;">${translated || original}</p>`;
    } else {
      content += `<p style="margin-bottom: 16px;">${original}</p>`;
    }
  }

  const html = `
<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(title)}</title>
  <!--[if gte mso 9]>
  <xml>
    <w:WordDocument>
      <w:View>Print</w:View>
      <w:Zoom>100</w:Zoom>
    </w:WordDocument>
  </xml>
  <![endif]-->
  <style>
    @page {
      margin: 2cm;
      size: A4;
    }
    body {
      font-family: "Microsoft YaHei", "SimSun", serif;
      font-size: 12pt;
      line-height: 1.8;
      color: #333;
    }
    h1 {
      text-align: center;
      font-size: 22pt;
      margin-bottom: 10px;
      color: #1a1a1a;
    }
    .meta {
      text-align: center;
      color: #666;
      font-size: 10pt;
      margin-bottom: 30px;
      padding-bottom: 20px;
      border-bottom: 1px solid #ddd;
    }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <div class="meta">导出时间: ${now}</div>
  ${content}
</body>
</html>`;

  return new Blob([html], { type: 'application/msword' });
}

// Exports an HTML document for the browser print-to-PDF flow.
export function exportPDFHTML(segments, options = {}) {
  const {
    style = 'bilingual',
    title = _t('documentTranslator.defaultDocTitle', '翻译文档'),
    includeSkipped = false,
  } = options;

  const now = new Date().toLocaleString('zh-CN');

  let content = '';

  for (const segment of segments) {
    if (!includeSkipped && segment.status === 'skipped') continue;

    const original = escapeHtml(segment.original || '').replace(/\n/g, '<br>');
    const translated = escapeHtml(segment.translated || '').replace(/\n/g, '<br>');

    if (style === 'bilingual') {
      content += `
        <div class="segment">
          <p class="original">${original}</p>
          ${translated ? `<p class="translated">${translated}</p>` : ''}
        </div>
      `;
    } else if (style === 'translated-only') {
      content += `<p class="text">${translated || original}</p>`;
    } else {
      content += `<p class="text">${original}</p>`;
    }
  }

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(title)}</title>
  <style>
    @page {
      margin: 2cm;
      size: A4;
    }
    body {
      font-family: "Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", sans-serif;
      font-size: 12pt;
      line-height: 1.8;
      color: #333;
      max-width: 800px;
      margin: 0 auto;
      padding: 20px;
    }
    h1 {
      text-align: center;
      font-size: 24pt;
      margin-bottom: 10px;
      color: #1a1a1a;
    }
    .meta {
      text-align: center;
      color: #666;
      font-size: 10pt;
      margin-bottom: 30px;
      padding-bottom: 20px;
      border-bottom: 1px solid #ddd;
    }
    .segment {
      margin-bottom: 24px;
      page-break-inside: avoid;
    }
    .original {
      color: #666;
      font-size: 11pt;
      margin-bottom: 8px;
      padding-left: 12px;
      border-left: 3px solid #ddd;
    }
    .translated {
      color: #1a1a1a;
      font-size: 12pt;
    }
    .text {
      margin-bottom: 16px;
    }
    @media print {
      body { padding: 0; }
      .segment { page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <div class="meta">导出时间: ${now}</div>
  ${content}
</body>
</html>`;
}

function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

export default {
  SUPPORTED_FORMATS,
  parseDocument,
  parsePDF,
  parseDOCX,
  parseCSV,
  parseJSON,
  parseEPUB,
  splitIntoSegments,
  batchSegments,
  estimateTokens,
  detectLanguage,
  detectHeadings,
  buildOutlineTree,
  shouldSkipSegment,
  exportBilingual,
  exportTranslatedOnly,
  exportSRT,
  exportVTT,
  exportDOCX,
  exportPDFHTML,
};
