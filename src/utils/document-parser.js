// src/utils/document-parser.js
// 文档解析工具 - 支持多种格式的文件解析和智能分段

import createLogger from './logger.js';
const logger = createLogger('DocumentParser');

/**
 * 支持的文件格式
 */
export const SUPPORTED_FORMATS = {
  // 文本
  txt: { name: '纯文本', mime: 'text/plain', parser: 'text' },
  md: { name: 'Markdown', mime: 'text/markdown', parser: 'text' },
  
  // 字幕
  srt: { name: 'SRT 字幕', mime: 'text/plain', parser: 'srt' },
  vtt: { name: 'WebVTT 字幕', mime: 'text/vtt', parser: 'vtt' },
  
  // 文档
  pdf: { name: 'PDF 文档', mime: 'application/pdf', parser: 'pdf' },
  docx: { name: 'Word 文档', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', parser: 'docx' },
  
  // 表格
  csv: { name: 'CSV 表格', mime: 'text/csv', parser: 'csv' },
  
  // 结构化
  json: { name: 'JSON 文件', mime: 'application/json', parser: 'json' },
  
  // 电子书
  epub: { name: 'EPUB 电子书', mime: 'application/epub+zip', parser: 'epub' },
};

/**
 * 章节识别模式
 */
const HEADING_PATTERNS = [
  // Markdown 标题
  { regex: /^(#{1,6})\s+(.+)$/m, level: (m) => m[1].length, text: (m) => m[2] },
  // 数字编号标题 (1. 1.1 1.1.1)
  { regex: /^(\d+(?:\.\d+)*)[.、]\s*(.+)$/m, level: (m) => m[1].split('.').length, text: (m) => m[2] },
  // 中文编号 (一、 第一章)
  { regex: /^(第?[一二三四五六七八九十百千]+[章节篇部])[、.\s]*(.*)$/m, level: () => 1, text: (m) => m[1] + (m[2] ? ' ' + m[2] : '') },
  // 英文编号 (Chapter 1, Section 1)
  { regex: /^(Chapter|Section|Part)\s+(\d+)[.:]\s*(.*)$/im, level: (m) => m[1].toLowerCase() === 'chapter' ? 1 : 2, text: (m) => `${m[1]} ${m[2]}${m[3] ? ': ' + m[3] : ''}` },
  // 全大写标题 (至少3个单词)
  { regex: /^([A-Z][A-Z\s]{10,})$/m, level: () => 1, text: (m) => m[1].trim() },
];

/**
 * 识别章节标题
 */
export function detectHeadings(segments) {
  const headings = [];
  
  for (const segment of segments) {
    const text = segment.original?.trim() || '';
    if (!text || text.length > 200) continue; // 标题不应太长
    
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

/**
 * 生成大纲树
 */
export function buildOutlineTree(headings) {
  const tree = [];
  const stack = [{ level: 0, children: tree }];
  
  for (const heading of headings) {
    const node = {
      ...heading,
      children: [],
    };
    
    // 找到合适的父节点
    while (stack.length > 1 && stack[stack.length - 1].level >= heading.level) {
      stack.pop();
    }
    
    stack[stack.length - 1].children.push(node);
    stack.push(node);
  }
  
  return tree;
}

/**
 * Token 估算
 * 中文：1字 ≈ 2 tokens
 * 英文：1词 ≈ 1.3 tokens，约 4字符/词
 */
export function estimateTokens(text) {
  if (!text) return 0;
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const otherChars = text.length - chineseChars;
  return Math.ceil(chineseChars * 2 + otherChars * 0.35);
}

/**
 * 检测文本主要语言
 */
export function detectLanguage(text) {
  if (!text) return 'unknown';
  const chineseRatio = (text.match(/[\u4e00-\u9fff]/g) || []).length / text.length;
  const japaneseRatio = (text.match(/[\u3040-\u309f\u30a0-\u30ff]/g) || []).length / text.length;
  const koreanRatio = (text.match(/[\uac00-\ud7af]/g) || []).length / text.length;
  
  if (chineseRatio > 0.3) return 'zh';
  if (japaneseRatio > 0.1) return 'ja';
  if (koreanRatio > 0.1) return 'ko';
  return 'en'; // 默认英文
}

/**
 * 检查是否应该跳过该段落
 */
export function shouldSkipSegment(text, filters = {}) {
  if (!text || !text.trim()) {
    return { skip: true, reason: '空段落' };
  }
  
  const trimmed = text.trim();
  
  // 跳过过短段落
  if (filters.skipShort && trimmed.length < (filters.minLength || 10)) {
    return { skip: true, reason: '过短' };
  }
  
  // 跳过纯数字
  if (filters.skipNumbers && /^\d+$/.test(trimmed)) {
    return { skip: true, reason: '纯数字' };
  }
  
  // 跳过代码块
  if (filters.skipCode && /^```[\s\S]*```$/.test(trimmed)) {
    return { skip: true, reason: '代码块' };
  }
  
  // 跳过已是目标语言
  if (filters.skipTargetLang && filters.targetLang) {
    const lang = detectLanguage(trimmed);
    if (lang === filters.targetLang) {
      return { skip: true, reason: '已是目标语言' };
    }
  }
  
  // 自定义关键词跳过
  if (filters.skipKeywords && filters.skipKeywords.length > 0) {
    for (const keyword of filters.skipKeywords) {
      if (trimmed.toLowerCase().includes(keyword.toLowerCase())) {
        return { skip: true, reason: `包含关键词: ${keyword}` };
      }
    }
  }
  
  return { skip: false };
}

/**
 * 智能分段
 */
export function splitIntoSegments(text, options = {}) {
  const {
    maxCharsPerSegment = 800,
    filters = {},
  } = options;
  
  const segments = [];
  let segmentId = 0;
  
  // 按段落分割（双换行）
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim());
  
  for (const para of paragraphs) {
    const trimmedPara = para.trim();
    
    // 检查是否跳过
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
    
    // 段落长度合适，直接添加
    if (trimmedPara.length <= maxCharsPerSegment) {
      segments.push({
        id: segmentId++,
        original: trimmedPara,
        translated: '',
        status: 'pending',
        tokens: estimateTokens(trimmedPara),
      });
    } else {
      // 过长段落，按句子分割
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

/**
 * 按句子分割长段落
 */
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
  
  // 强制分割过长片段
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

/**
 * 解析 SRT 字幕
 */
export function parseSRT(content) {
  const segments = [];
  const blocks = content.trim().split(/\n\s*\n/);
  
  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 3) continue;
    
    const index = parseInt(lines[0]);
    const timecode = lines[1];
    const text = lines.slice(2).join('\n');
    
    if (!isNaN(index) && timecode.includes('-->')) {
      segments.push({
        id: index - 1,
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

/**
 * 解析 VTT 字幕
 */
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

/**
 * 解析 PDF 文档
 */
export async function parsePDF(file, options = {}) {
  const { password, maxCharsPerSegment = 800, filters = {} } = options;
  
  // 动态导入 pdfjs-dist
  const pdfjsLib = await import('pdfjs-dist');
  
  // 设置 worker
  pdfjsLib.GlobalWorkerOptions.workerSrc = 
    `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;
  
  const arrayBuffer = await file.arrayBuffer();
  
  const loadingTask = pdfjsLib.getDocument({
    data: arrayBuffer,
    password: password || undefined,
  });
  
  const pdf = await loadingTask.promise;
  const numPages = pdf.numPages;
  
  let allText = '';
  
  for (let i = 1; i <= numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    
    let pageText = '';
    let lastY = null;
    
    for (const item of textContent.items) {
      if (item.str) {
        if (lastY !== null && Math.abs(item.transform[5] - lastY) > 5) {
          pageText += '\n';
        }
        pageText += item.str;
        lastY = item.transform[5];
      }
    }
    
    allText += pageText + '\n\n';
  }
  
  const segments = splitIntoSegments(allText, {
    maxCharsPerSegment,
    filters,
  });
  
  return {
    segments,
    pageCount: numPages,
  };
}

/**
 * 解析 DOCX 文档
 */
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

/**
 * 解析 CSV 文件
 */
export async function parseCSV(file, options = {}) {
  const { maxCharsPerSegment = 800, filters = {} } = options;
  
  const text = await readAsText(file);
  const lines = text.split('\n');
  const segments = [];
  let segmentId = 0;
  
  // 跳过表头
  const startLine = lines[0]?.includes(',') ? 1 : 0;
  
  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    // 简单解析 CSV 行，提取文本列
    const cells = line.split(',').map(c => c.trim().replace(/^["']|["']$/g, ''));
    const textContent = cells.filter(c => c.length > 5 && !/^\d+$/.test(c)).join(' | ');
    
    if (textContent && textContent.length >= (filters.minLength || 5)) {
      segments.push({
        id: segmentId++,
        original: textContent,
        translated: '',
        status: 'pending',
        tokens: estimateTokens(textContent),
        row: i + 1,
      });
    }
  }
  
  return { segments };
}

/**
 * 解析 JSON 文件（提取字符串值）
 */
export async function parseJSON(file, options = {}) {
  const { filters = {} } = options;
  
  const text = await readAsText(file);
  const data = JSON.parse(text);
  const segments = [];
  let segmentId = 0;
  
  // 递归提取字符串
  function extractStrings(obj, path = '') {
    if (typeof obj === 'string' && obj.length >= (filters.minLength || 5)) {
      // 跳过看起来像 URL、日期、ID 的字符串
      if (!/^(https?:\/\/|[\d\-T:Z]+$|[a-f0-9\-]{36}$)/i.test(obj)) {
        segments.push({
          id: segmentId++,
          original: obj,
          translated: '',
          status: 'pending',
          tokens: estimateTokens(obj),
          path,
        });
      }
    } else if (Array.isArray(obj)) {
      obj.forEach((item, i) => extractStrings(item, `${path}[${i}]`));
    } else if (obj && typeof obj === 'object') {
      Object.entries(obj).forEach(([key, value]) => {
        extractStrings(value, path ? `${path}.${key}` : key);
      });
    }
  }
  
  extractStrings(data);
  
  return { segments };
}

/**
 * 解析 EPUB 电子书
 * EPUB 本质是 ZIP 压缩包，包含 HTML/XHTML 内容
 */
export async function parseEPUB(file, options = {}) {
  const { maxCharsPerSegment = 800, filters = {} } = options;
  
  const JSZip = (await import('jszip')).default;
  const arrayBuffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);
  
  // 解析 container.xml 获取 rootfile 路径
  const containerXml = await zip.file('META-INF/container.xml')?.async('text');
  if (!containerXml) {
    throw new Error('无效的 EPUB 文件：缺少 container.xml');
  }
  
  // 提取 rootfile 路径
  const rootfileMatch = containerXml.match(/full-path="([^"]+)"/);
  if (!rootfileMatch) {
    throw new Error('无效的 EPUB 文件：找不到 rootfile');
  }
  
  const rootfilePath = rootfileMatch[1];
  const rootfileDir = rootfilePath.substring(0, rootfilePath.lastIndexOf('/') + 1);
  
  // 解析 OPF 文件获取内容顺序
  const opfContent = await zip.file(rootfilePath)?.async('text');
  if (!opfContent) {
    throw new Error('无效的 EPUB 文件：找不到 OPF 文件');
  }
  
  // 提取书名
  const titleMatch = opfContent.match(/<dc:title[^>]*>([^<]+)<\/dc:title>/i);
  const title = titleMatch ? titleMatch[1].trim() : file.name.replace(/\.epub$/i, '');
  
  // 提取 spine 中的阅读顺序
  const spineMatch = opfContent.match(/<spine[^>]*>([\s\S]*?)<\/spine>/i);
  const itemrefMatches = spineMatch ? spineMatch[1].matchAll(/idref="([^"]+)"/g) : [];
  const spineIds = [...itemrefMatches].map(m => m[1]);
  
  // 提取 manifest 中的文件映射
  const manifestMatch = opfContent.match(/<manifest[^>]*>([\s\S]*?)<\/manifest>/i);
  const itemMatches = manifestMatch ? manifestMatch[1].matchAll(/<item[^>]+id="([^"]+)"[^>]+href="([^"]+)"[^>]*>/g) : [];
  
  const manifest = {};
  for (const match of itemMatches) {
    manifest[match[1]] = match[2];
  }
  
  // 按顺序读取内容文件
  let allText = '';
  let chapterCount = 0;
  
  for (const id of spineIds) {
    const href = manifest[id];
    if (!href) continue;
    
    // 只处理 HTML/XHTML 文件
    if (!/\.(x?html?|xml)$/i.test(href)) continue;
    
    const filePath = rootfileDir + decodeURIComponent(href);
    const content = await zip.file(filePath)?.async('text');
    
    if (content) {
      chapterCount++;
      // 移除 HTML 标签，提取纯文本
      const text = extractTextFromHTML(content);
      if (text.trim()) {
        allText += text + '\n\n';
      }
    }
  }
  
  if (!allText.trim()) {
    throw new Error('EPUB 文件中没有找到可翻译的文本内容');
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

/**
 * 从 HTML 内容提取纯文本
 */
function extractTextFromHTML(html) {
  // 移除 script 和 style 标签及其内容
  let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  
  // 将块级标签转换为换行
  text = text.replace(/<\/(p|div|h[1-6]|br|li|tr)>/gi, '\n');
  text = text.replace(/<(p|div|h[1-6]|br|li|tr)[^>]*>/gi, '\n');
  
  // 移除所有其他 HTML 标签
  text = text.replace(/<[^>]+>/g, '');
  
  // 解码 HTML 实体
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(code));
  text = text.replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
  
  // 清理多余空白
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n\s*\n/g, '\n\n');
  
  return text.trim();
}

/**
 * 主解析函数
 */
export async function parseDocument(file, options = {}) {
  const { password } = options;
  
  const ext = file.name.split('.').pop().toLowerCase();
  const format = SUPPORTED_FORMATS[ext];
  
  if (!format) {
    throw new Error(`不支持的文件格式: .${ext}`);
  }
  
  try {
    let content;
    let segments;
    let extra = {};
    
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
        
      case 'pdf':
        const pdfResult = await parsePDF(file, options);
        segments = pdfResult.segments;
        extra.pageCount = pdfResult.pageCount;
        break;
        
      case 'docx':
        const docxResult = await parseDOCX(file, options);
        segments = docxResult.segments;
        if (docxResult.warnings?.length > 0) {
          extra.warnings = docxResult.warnings;
        }
        break;
        
      case 'csv':
        const csvResult = await parseCSV(file, options);
        segments = csvResult.segments;
        break;
        
      case 'json':
        const jsonResult = await parseJSON(file, options);
        segments = jsonResult.segments;
        break;
        
      case 'epub':
        const epubResult = await parseEPUB(file, options);
        segments = epubResult.segments;
        extra.title = epubResult.title;
        extra.chapterCount = epubResult.chapterCount;
        break;
        
      default:
        throw new Error(`未实现的解析器: ${format.parser}`);
    }
    
    // 识别章节
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
        message: '文件需要密码',
      };
    }
    
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * 读取文件为文本
 */
function readAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsText(file);
  });
}

/**
 * 计算文档统计信息
 */
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

/**
 * 批量合并短段落
 */
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

/**
 * 导出为双语文本
 */
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

/**
 * 导出为纯译文
 */
export function exportTranslatedOnly(segments, options = {}) {
  const { includeSkipped = false } = options;
  
  return segments
    .filter(s => includeSkipped || s.status !== 'skipped')
    .map(s => s.translated || s.original)
    .join('\n\n');
}

/**
 * 导出为 SRT 字幕
 */
export function exportSRT(segments) {
  return segments
    .filter(s => s.type === 'subtitle')
    .map(s => `${s.index}\n${s.timecode}\n${s.translated || s.original}`)
    .join('\n\n');
}

/**
 * 导出为 VTT 字幕
 */
export function exportVTT(segments) {
  const body = segments
    .filter(s => s.type === 'subtitle')
    .map(s => `${s.timecode}\n${s.translated || s.original}`)
    .join('\n\n');
  
  return `WEBVTT\n\n${body}`;
}

/**
 * 导出为 DOCX 文档（使用 HTML 格式，Word 可直接打开）
 * @param {Array} segments - 翻译段落
 * @param {object} options - 导出选项
 * @returns {Blob} Word 文件 Blob
 */
export function exportDOCX(segments, options = {}) {
  const {
    style = 'bilingual',  // 'bilingual' | 'translated-only' | 'source-only'
    title = '翻译文档',
    includeSkipped = false,
  } = options;
  
  const now = new Date().toLocaleString('zh-CN');
  
  let content = '';
  
  for (const segment of segments) {
    if (!includeSkipped && segment.status === 'skipped') continue;
    
    const original = escapeHtml(segment.original || '');
    const translated = escapeHtml(segment.translated || '');
    
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
  
  // 生成 Word 兼容的 HTML 文档
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

/**
 * 导出为 PDF（生成 HTML 供打印）
 * @param {Array} segments - 翻译段落
 * @param {object} options - 导出选项
 * @returns {string} HTML 内容
 */
export function exportPDFHTML(segments, options = {}) {
  const {
    style = 'bilingual',
    title = '翻译文档',
    includeSkipped = false,
  } = options;
  
  const now = new Date().toLocaleString('zh-CN');
  
  let content = '';
  
  for (const segment of segments) {
    if (!includeSkipped && segment.status === 'skipped') continue;
    
    const original = segment.original || '';
    const translated = segment.translated || '';
    
    if (style === 'bilingual') {
      content += `
        <div class="segment">
          <p class="original">${escapeHtml(original)}</p>
          ${translated ? `<p class="translated">${escapeHtml(translated)}</p>` : ''}
        </div>
      `;
    } else if (style === 'translated-only') {
      content += `<p class="text">${escapeHtml(translated || original)}</p>`;
    } else {
      content += `<p class="text">${escapeHtml(original)}</p>`;
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

/**
 * HTML 转义
 */
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
