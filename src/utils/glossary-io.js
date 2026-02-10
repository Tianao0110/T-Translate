// src/utils/glossary-io.js
// 术语库导入/导出工具
// 支持格式：JSON, CSV, TBX

/**
 * 导出为 JSON 格式
 * @param {Array} items - 术语列表
 * @returns {string} JSON 字符串
 */
export function exportToJSON(items) {
  const data = {
    format: 'T-Translate Glossary',
    version: '1.0',
    exportDate: new Date().toISOString(),
    count: items.length,
    terms: items.map(item => ({
      source: item.sourceText,
      target: item.translatedText,
      note: item.note || '',
      tags: item.tags || [],
      createdAt: item.createdAt,
    })),
  };
  return JSON.stringify(data, null, 2);
}

/**
 * 从 JSON 导入
 * @param {string} jsonString - JSON 字符串
 * @returns {Array} 术语列表
 */
export function importFromJSON(jsonString) {
  try {
    const data = JSON.parse(jsonString);
    
    // 支持两种格式：我们的格式和简单数组
    let terms = [];
    
    if (data.terms && Array.isArray(data.terms)) {
      // 我们的格式
      terms = data.terms;
    } else if (Array.isArray(data)) {
      // 简单数组格式
      terms = data;
    } else {
      throw new Error('不支持的 JSON 格式');
    }
    
    return terms.map((term, index) => ({
      id: `imported_${Date.now()}_${index}`,
      sourceText: term.source || term.sourceText || term.原文 || '',
      translatedText: term.target || term.translatedText || term.译文 || '',
      note: term.note || term.备注 || '',
      tags: term.tags || [],
      folderId: 'glossary',
      createdAt: term.createdAt || new Date().toISOString(),
    })).filter(t => t.sourceText && t.translatedText);
  } catch (e) {
    throw new Error(`JSON 解析失败: ${e.message}`);
  }
}

/**
 * 导出为 CSV 格式
 * @param {Array} items - 术语列表
 * @returns {string} CSV 字符串
 */
export function exportToCSV(items) {
  // CSV 头
  const header = '原文,译文,备注,标签';
  
  // 转义 CSV 字段
  const escapeCSV = (str) => {
    if (!str) return '';
    // 如果包含逗号、引号或换行，用引号包裹
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };
  
  const rows = items.map(item => {
    const source = escapeCSV(item.sourceText);
    const target = escapeCSV(item.translatedText);
    const note = escapeCSV(item.note || '');
    const tags = escapeCSV((item.tags || []).join(';'));
    return `${source},${target},${note},${tags}`;
  });
  
  // 添加 BOM 以支持 Excel 打开中文
  return '\ufeff' + header + '\n' + rows.join('\n');
}

/**
 * 从 CSV 导入
 * @param {string} csvString - CSV 字符串
 * @returns {Array} 术语列表
 */
export function importFromCSV(csvString) {
  // 移除 BOM
  const content = csvString.replace(/^\ufeff/, '');
  
  const lines = content.split(/\r?\n/).filter(line => line.trim());
  if (lines.length < 2) {
    throw new Error('CSV 文件为空或格式错误');
  }
  
  // 解析 CSV 行
  const parseCSVLine = (line) => {
    const result = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current);
    return result;
  };
  
  // 跳过标题行
  const terms = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = parseCSVLine(lines[i]);
    if (fields.length >= 2 && fields[0] && fields[1]) {
      terms.push({
        id: `imported_${Date.now()}_${i}`,
        sourceText: fields[0].trim(),
        translatedText: fields[1].trim(),
        note: fields[2]?.trim() || '',
        tags: fields[3] ? fields[3].split(';').map(t => t.trim()).filter(Boolean) : [],
        folderId: 'glossary',
        createdAt: new Date().toISOString(),
      });
    }
  }
  
  return terms;
}

/**
 * 导出为 TBX 格式 (TermBase eXchange)
 * @param {Array} items - 术语列表
 * @param {string} sourceLang - 源语言代码
 * @param {string} targetLang - 目标语言代码
 * @returns {string} TBX XML 字符串
 */
export function exportToTBX(items, sourceLang = 'en', targetLang = 'zh') {
  const escapeXML = (str) => {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  };
  
  const termEntries = items.map((item, index) => {
    const note = item.note ? `\n        <descrip type="definition">${escapeXML(item.note)}</descrip>` : '';
    return `
    <termEntry id="term_${index + 1}">
      <langSet xml:lang="${sourceLang}">
        <tig>
          <term>${escapeXML(item.sourceText)}</term>
        </tig>
      </langSet>
      <langSet xml:lang="${targetLang}">
        <tig>
          <term>${escapeXML(item.translatedText)}</term>
        </tig>${note}
      </langSet>
    </termEntry>`;
  }).join('\n');
  
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE martif SYSTEM "TBXcoreStructV02.dtd">
<martif type="TBX" xml:lang="${sourceLang}">
  <martifHeader>
    <fileDesc>
      <titleStmt>
        <title>T-Translate Glossary Export</title>
      </titleStmt>
      <sourceDesc>
        <p>Exported from T-Translate</p>
      </sourceDesc>
    </fileDesc>
    <encodingDesc>
      <p type="XCSURI">TBXXCSV02.xcs</p>
    </encodingDesc>
  </martifHeader>
  <text>
    <body>
${termEntries}
    </body>
  </text>
</martif>`;
}

/**
 * 从 TBX 导入
 * @param {string} tbxString - TBX XML 字符串
 * @returns {Array} 术语列表
 */
export function importFromTBX(tbxString) {
  const terms = [];
  
  // 简单的 XML 解析（不使用 DOMParser 以兼容 Node.js）
  // 匹配 termEntry
  const termEntryRegex = /<termEntry[^>]*>([\s\S]*?)<\/termEntry>/gi;
  const langSetRegex = /<langSet[^>]*xml:lang="([^"]*)"[^>]*>([\s\S]*?)<\/langSet>/gi;
  const termRegex = /<term>([\s\S]*?)<\/term>/i;
  const descripRegex = /<descrip[^>]*type="definition"[^>]*>([\s\S]*?)<\/descrip>/i;
  
  const unescapeXML = (str) => {
    return str
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&');
  };
  
  let termEntryMatch;
  let index = 0;
  
  while ((termEntryMatch = termEntryRegex.exec(tbxString)) !== null) {
    const termEntryContent = termEntryMatch[1];
    const langSets = {};
    let note = '';
    
    let langSetMatch;
    while ((langSetMatch = langSetRegex.exec(termEntryContent)) !== null) {
      const lang = langSetMatch[1];
      const langSetContent = langSetMatch[2];
      
      const termMatch = termRegex.exec(langSetContent);
      if (termMatch) {
        langSets[lang] = unescapeXML(termMatch[1].trim());
      }
      
      const descripMatch = descripRegex.exec(langSetContent);
      if (descripMatch) {
        note = unescapeXML(descripMatch[1].trim());
      }
    }
    
    // 找出源语言和目标语言
    const langs = Object.keys(langSets);
    if (langs.length >= 2) {
      // 假设第一个是源语言，第二个是目标语言
      const source = langSets[langs[0]];
      const target = langSets[langs[1]];
      
      if (source && target) {
        terms.push({
          id: `imported_${Date.now()}_${index}`,
          sourceText: source,
          translatedText: target,
          note: note,
          tags: [],
          folderId: 'glossary',
          createdAt: new Date().toISOString(),
        });
        index++;
      }
    }
    
    // 重置正则
    langSetRegex.lastIndex = 0;
  }
  
  return terms;
}

/**
 * 根据文件扩展名自动选择导入方法
 * @param {string} content - 文件内容
 * @param {string} filename - 文件名
 * @returns {Array} 术语列表
 */
export function autoImport(content, filename) {
  const ext = filename.toLowerCase().split('.').pop();
  
  switch (ext) {
    case 'json':
      return importFromJSON(content);
    case 'csv':
    case 'tsv':
      return importFromCSV(content);
    case 'tbx':
    case 'xml':
      return importFromTBX(content);
    default:
      // 尝试 JSON
      try {
        return importFromJSON(content);
      } catch {
        // 尝试 CSV
        try {
          return importFromCSV(content);
        } catch {
          throw new Error('无法识别文件格式，请使用 JSON、CSV 或 TBX 格式');
        }
      }
  }
}

/**
 * 下载文件
 * @param {string} content - 文件内容
 * @param {string} filename - 文件名
 * @param {string} mimeType - MIME 类型
 */
export function downloadFile(content, filename, mimeType = 'text/plain') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
