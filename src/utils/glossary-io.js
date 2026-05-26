// Glossary import/export — JSON, CSV, TBX (TermBase eXchange) formats.

import i18n from '../i18n.js';
const _t = (key, fallback) => {
  try { const r = i18n.t(key); return r === key ? fallback : r; } catch { return fallback; }
};

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

// Accepts both our wrapper shape ({terms: []}) and a bare array. Also tolerates
// Chinese field names (原文/译文/备注) for exports from other tools.
export function importFromJSON(jsonString) {
  try {
    const data = JSON.parse(jsonString);

    let terms = [];

    if (data.terms && Array.isArray(data.terms)) {
      terms = data.terms;
    } else if (Array.isArray(data)) {
      terms = data;
    } else {
      throw new Error(_t('glossary.unsupportedJson', '不支持的 JSON 格式'));
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
    throw new Error(_t('glossary.jsonParseFailed', 'JSON 解析失败') + ': ' + e.message);
  }
}

export function exportToCSV(items) {
  const header = [_t('translation.source', '原文'), _t('translation.target', '译文'), _t('favorites.note', '备注'), _t('favorites.tags', '标签')].join(',');

  // RFC 4180-ish quoting: wrap in quotes when field contains comma/quote/newline
  const escapeCSV = (str) => {
    if (!str) return '';
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

  // BOM prefix so Excel opens the file as UTF-8 (otherwise CJK chars get mangled)
  return '﻿' + header + '\n' + rows.join('\n');
}

export function importFromCSV(csvString) {
  const content = csvString.replace(/^﻿/, '');

  const lines = content.split(/\r?\n/).filter(line => line.trim());
  if (lines.length < 2) {
    throw new Error(_t('glossary.csvEmpty', 'CSV 文件为空或格式错误'));
  }

  // RFC 4180 parser: handles quoted fields with embedded commas/quotes
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

  const terms = [];
  // Start at i=1 to skip header
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

// Regex-based parser (no DOMParser, so this runs in Node tests too).
// Assumes first langSet is source, second is target.
export function importFromTBX(tbxString) {
  const terms = [];

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

    const langs = Object.keys(langSets);
    if (langs.length >= 2) {
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

    // /g regex needs explicit reset between termEntry iterations
    langSetRegex.lastIndex = 0;
  }

  return terms;
}

// Picks parser by extension, falls back to JSON-then-CSV sniffing
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
      try {
        return importFromJSON(content);
      } catch {
        try {
          return importFromCSV(content);
        } catch {
          throw new Error(_t('glossary.unknownFormat', '无法识别文件格式，请使用 JSON、CSV 或 TBX 格式'));
        }
      }
  }
}

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
