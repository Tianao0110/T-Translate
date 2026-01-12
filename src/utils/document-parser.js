// src/utils/document-parser.js
// 文档解析工具 - 支持多种格式的文件解析和智能分段

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
  
  // 文档 (Phase 5)
  pdf: { name: 'PDF 文档', mime: 'application/pdf', parser: 'pdf' },
  docx: { name: 'Word 文档', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', parser: 'docx' },
};

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
    preserveParagraphs = true,
    filters = {},
  } = options;
  
  const segments = [];
  let segmentId = 0;
  
  // 第一步：按段落分割（双换行）
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
  // 句子分隔符：中英文句号、问号、感叹号
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
  
  // 如果还有过长的，强制按字符数分割
  const finalResult = [];
  for (const segment of result) {
    if (segment.length <= maxChars) {
      finalResult.push(segment);
    } else {
      // 强制分割
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
  // 移除 WEBVTT 头部
  const body = content.replace(/^WEBVTT[\s\S]*?\n\n/, '');
  const blocks = body.trim().split(/\n\s*\n/);
  
  let index = 0;
  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 2) continue;
    
    // VTT 可能有或没有序号
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
 * 主解析函数
 */
export async function parseDocument(file, options = {}) {
  const { password } = options;
  
  // 获取文件扩展名
  const ext = file.name.split('.').pop().toLowerCase();
  const format = SUPPORTED_FORMATS[ext];
  
  if (!format) {
    throw new Error(`不支持的文件格式: .${ext}`);
  }
  
  try {
    let content;
    let segments;
    
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
        // Phase 5 实现
        throw new Error('PDF 支持即将推出');
        
      case 'docx':
        // Phase 5 实现
        throw new Error('DOCX 支持即将推出');
        
      default:
        throw new Error(`未实现的解析器: ${format.parser}`);
    }
    
    // 计算统计信息
    const stats = calculateStats(segments);
    
    return {
      success: true,
      filename: file.name,
      format: ext,
      formatName: format.name,
      segments,
      stats,
    };
    
  } catch (error) {
    // 检查是否是密码错误
    if (error.message?.includes('password') || error.name === 'PasswordException') {
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
    estimatedTime: Math.ceil(pending * 1.5), // 粗略估计：每段 1.5 秒
  };
}

/**
 * 批量合并短段落（减少 API 调用）
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
    
    // 检查是否可以加入当前批次
    const canAdd = 
      currentBatch.length < maxSegmentsPerBatch &&
      currentTokens + segment.tokens <= maxTokensPerBatch;
    
    if (canAdd) {
      currentBatch.push(segment);
      currentTokens += segment.tokens;
    } else {
      // 保存当前批次，开始新批次
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
  
  // 添加最后一个批次
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
    format = 'txt',
    style = 'below', // below | inline | side-by-side
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
        
      case 'inline':
        output += original;
        if (translated) {
          output += ` (${translated})`;
        }
        output += '\n\n';
        break;
        
      case 'side-by-side':
        // Markdown 表格格式
        output += `| ${original.replace(/\|/g, '\\|')} | ${translated.replace(/\|/g, '\\|')} |\n`;
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

export default {
  SUPPORTED_FORMATS,
  parseDocument,
  splitIntoSegments,
  batchSegments,
  estimateTokens,
  detectLanguage,
  shouldSkipSegment,
  exportBilingual,
  exportTranslatedOnly,
  exportSRT,
  exportVTT,
};
