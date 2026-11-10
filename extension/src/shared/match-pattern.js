// Chrome match patterns (scheme://host/path with *), for the worker and the
// extension pages alike.

// A pattern as a URL test; <all_urls> stands for any http(s) page here.
export function matchPattern(pattern) {
  if (pattern === '<all_urls>') return (url) => typeof url === 'string' && /^https?:\/\//i.test(url);
  const m = /^(\*|https?):\/\/(\*|(?:\*\.)?[^/*]+)(\/.*)$/.exec(pattern);
  if (!m) return () => false;
  const [, scheme, host, path] = m;
  const esc = (s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  const hostRe = host === '*' ? '[^/]+' : host.startsWith('*.') ? `(?:[^/]+\\.)?${esc(host.slice(2))}` : esc(host);
  const re = new RegExp(`^${scheme === '*' ? 'https?' : scheme}://${hostRe}(?::\\d+)?${esc(path).replace(/\*/g, '.*')}$`, 'i');
  return (url) => typeof url === 'string' && re.test(url);
}

// One host, every path: what T-Caption asks the browser for (direct-fetch.js hostPattern makes them).
export const isHostPattern = (p) => typeof p === 'string' && p.length <= 300 && /^https?:\/\/[^/*:\s]+\/\*$/i.test(p);

// The host a pattern is for, to show: 'http://localhost/*' → 'localhost'.
export function patternHost(pattern) {
  if (pattern === '<all_urls>') return '*';
  return String(pattern ?? '')
    .replace(/^[^:]*:\/\//, '')
    .replace(/\/.*$/, '');
}
