// Subtitle format detection and one entry point over the five parsers; the
// page hooks hand over whatever the site fetched.

import { parseVtt } from './vtt.js';
import { parseSrt } from './srt.js';
import { parseTtml } from './ttml.js';
import { parseJson3 } from './json3.js';
import { parseBcc } from './bcc.js';

export { parseVtt, parseSrt, parseTtml, parseJson3, parseBcc };

const PARSERS = { vtt: parseVtt, srt: parseSrt, ttml: parseTtml, json3: parseJson3, bcc: parseBcc };

const isBcc = (o) => Array.isArray(o?.body) && typeof o.body[0]?.from === 'number';
// Bilibili's body entries start with "from"; json3 has no "body" key.
const BCC_HEAD = /"body"\s*:\s*\[\s*\{[^{}]*"from"\s*:\s*-?\d/;

// From the content first; the Content-Type and URL only break a tie.
export function detectFormat(text, contentType = '', url = '') {
  if (text && typeof text === 'object') return Array.isArray(text.events) ? 'json3' : isBcc(text) ? 'bcc' : null;
  const head = typeof text === 'string' ? text.replace(/^\u{feff}/u, '').trimStart().slice(0, 65536) : '';
  if (/^WEBVTT(?:\s|$)/.test(head)) return 'vtt';
  if (head.startsWith('{') && /"events"\s*:/.test(head)) return 'json3';
  if (head.startsWith('{') && BCC_HEAD.test(head)) return 'bcc';
  if (head.startsWith('<') && (/<(?:[\w-]+:)?tt[\s>/]/.test(head) || head.includes('http://www.w3.org/ns/ttml'))) return 'ttml';
  if (head.includes('-->')) return /\d+:\d{2}:\d{2},\d+\s*-->/.test(head) ? 'srt' : 'vtt';

  const type = String(contentType || '').toLowerCase();
  if (type.includes('vtt')) return 'vtt';
  if (type.includes('subrip') || type.includes('srt')) return 'srt';
  if (type.includes('ttml') || type.includes('dfxp')) return 'ttml';
  const u = String(url || '').toLowerCase();
  const fmt = /[?&]fmt=(\w+)/.exec(u)?.[1];
  if (fmt === 'json3' || fmt === 'vtt' || fmt === 'ttml') return fmt;
  const ext = /\.(vtt|srt|ttml|dfxp)(?:[?#]|$)/.exec(u)?.[1];
  if (ext) return ext === 'dfxp' ? 'ttml' : ext;
  return null;
}

// Cues sorted by start; [] for an unknown format or anything unreadable.
export function parseSubtitles(text, format = detectFormat(text)) {
  const parse = Object.hasOwn(PARSERS, format) ? PARSERS[format] : null;
  if (!parse) return [];
  try {
    return parse(text);
  } catch {
    return [];
  }
}
