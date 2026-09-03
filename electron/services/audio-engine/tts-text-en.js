// English text normalization for the neural TTS. The voice packs load Chinese
// rule FSTs (number-zh / date-zh / phone-zh) that rewrite every digit run into
// Chinese characters before phonemization, engine-wide and regardless of the
// surrounding language — so "2026" inside an English sentence came out in
// Chinese. Spelling numbers out as English words first leaves the FSTs nothing
// to rewrite. Applied by the worker to text without CJK characters only.

const CJK_RE = /[㐀-鿿豈-﫿]/;

const ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const SCALES = ['', 'thousand', 'million', 'billion', 'trillion'];
const ORDINAL_IRREGULAR = {
  one: 'first', two: 'second', three: 'third', five: 'fifth', eight: 'eighth',
  nine: 'ninth', twelve: 'twelfth',
};
const CURRENCY = { $: ['dollar', 'cent'], '£': ['pound', 'penny', 'pence'], '€': ['euro', 'cent'] };

function hasCjk(text) {
  return CJK_RE.test(text || '');
}

function belowThousand(n) {
  const parts = [];
  if (n >= 100) {
    parts.push(`${ONES[Math.floor(n / 100)]} hundred`);
    n %= 100;
  }
  if (n >= 20) {
    parts.push(n % 10 ? `${TENS[Math.floor(n / 10)]}-${ONES[n % 10]}` : TENS[Math.floor(n / 10)]);
  } else if (n > 0 || parts.length === 0) {
    parts.push(ONES[n]);
  }
  return parts.join(' ');
}

function integerWords(n) {
  if (n === 0) return 'zero';
  if (n >= 1e15) return digitWords(String(n));
  const groups = [];
  let scale = 0;
  while (n > 0) {
    const chunk = n % 1000;
    if (chunk) groups.unshift(`${belowThousand(chunk)}${SCALES[scale] ? ` ${SCALES[scale]}` : ''}`);
    n = Math.floor(n / 1000);
    scale++;
  }
  return groups.join(' ');
}

function digitWords(digits) {
  return digits.split('').map((d) => ONES[Number(d)]).join(' ');
}

function ordinalWords(n) {
  const words = integerWords(n);
  const lastSpace = Math.max(words.lastIndexOf(' '), words.lastIndexOf('-'));
  const head = words.slice(0, lastSpace + 1);
  const last = words.slice(lastSpace + 1);
  if (ORDINAL_IRREGULAR[last]) return head + ORDINAL_IRREGULAR[last];
  if (last.endsWith('y')) return `${head}${last.slice(0, -1)}ieth`;
  return `${head}${last}th`;
}

// 1100-2099 read the way people say years: "nineteen ninety-nine",
// "two thousand five", "twenty twenty-six".
function yearWords(n) {
  const hi = Math.floor(n / 100);
  const lo = n % 100;
  if (n >= 2000 && n < 2010) return lo ? `two thousand ${ONES[lo]}` : 'two thousand';
  if (lo === 0) return `${belowThousand(hi)} hundred`;
  if (lo < 10) return `${belowThousand(hi)} oh ${ONES[lo]}`;
  return `${belowThousand(hi)} ${belowThousand(lo)}`;
}

function parseInt10(s) {
  return parseInt(s.replace(/,/g, ''), 10);
}

// "1,234" or "1234" — thousands separators only in full groups so a sentence
// comma after a number is not swallowed.
const INT = '(?:\\d{1,3}(?:,\\d{3})+|\\d+)';

function plainNumberWords(intStr, allowYear) {
  const n = parseInt10(intStr);
  if (!intStr.includes(',') && intStr.length >= 7) return digitWords(intStr);
  if (allowYear && !intStr.includes(',') && intStr.length === 4 && n >= 1100 && n <= 2099) return yearWords(n);
  return integerWords(n);
}

function decimalWords(intStr, frac) {
  return `${integerWords(parseInt10(intStr))} point ${digitWords(frac)}`;
}

function plural(n, singular, pluralForm = `${singular}s`) {
  return n === 1 ? singular : pluralForm;
}

function verbalizeEnglishNumbers(text) {
  if (!text) return text;
  let out = text;

  // Currency: $3.50, £20, €1,000.99
  out = out.replace(new RegExp(`([$£€])(${INT})(?:\\.(\\d{1,2}))?`, 'g'), (m, sym, whole, cents) => {
    const [unit, minor, minorPlural] = CURRENCY[sym];
    const n = parseInt10(whole);
    let s = `${integerWords(n)} ${plural(n, unit)}`;
    if (cents) {
      const c = parseInt(cents.length === 1 ? `${cents}0` : cents, 10);
      if (c) s += ` and ${integerWords(c)} ${plural(c, minor, minorPlural)}`;
    }
    return s;
  });

  // Percent: 15%, 3.5 %
  out = out.replace(new RegExp(`(${INT})(?:\\.(\\d+))?\\s?%`, 'g'), (m, whole, frac) =>
    `${frac ? decimalWords(whole, frac) : integerWords(parseInt10(whole))} percent`
  );

  // Clock times: 10:30, 9:05, 12:00
  out = out.replace(/\b(\d{1,2}):(\d{2})\b/g, (m, h, mm) => {
    const hour = parseInt(h, 10);
    const min = parseInt(mm, 10);
    if (hour > 23 || min > 59) return m;
    if (min === 0) return `${integerWords(hour)} o'clock`;
    if (min < 10) return `${integerWords(hour)} oh ${ONES[min]}`;
    return `${integerWords(hour)} ${belowThousand(min)}`;
  });

  // Ordinals: 1st, 22nd, 15th
  out = out.replace(new RegExp(`\\b(${INT})(?:st|nd|rd|th)\\b`, 'g'), (m, whole) => ordinalWords(parseInt10(whole)));

  // Decimals: 3.14 (a trailing period is sentence punctuation, not a decimal)
  out = out.replace(new RegExp(`\\b(${INT})\\.(\\d+)\\b`, 'g'), (m, whole, frac) => decimalWords(whole, frac));

  // Negative numbers: " -5" (not a hyphen between words)
  out = out.replace(new RegExp(`(^|\\s)-(${INT})\\b`, 'g'), (m, lead, whole) => `${lead}minus ${plainNumberWords(whole, false)}`);

  // Everything else: integers, years, long digit strings
  out = out.replace(new RegExp(`\\b(${INT})\\b`, 'g'), (m, whole) => plainNumberWords(whole, true));

  return out;
}

// Packs do not share a natural pace: MeloTTS reads Chinese ~20% faster than
// kokoro at the same speed value. speedScale (per pack, a number or
// {zh, en}) rebases the user's slider so 1.0 sounds alike across packs.
function scaleSpeed(speed, speedScale, text) {
  const base = Number.isFinite(speed) && speed > 0 ? speed : 1;
  let scale = 1;
  if (typeof speedScale === 'number') scale = speedScale;
  else if (speedScale && typeof speedScale === 'object') {
    const v = hasCjk(text) ? speedScale.zh : speedScale.en;
    if (Number.isFinite(v)) scale = v;
  }
  if (!Number.isFinite(scale) || scale <= 0) scale = 1;
  return Math.min(3, Math.max(0.3, base * scale));
}

module.exports = { hasCjk, verbalizeEnglishNumbers, integerWords, ordinalWords, yearWords, scaleSpeed };
