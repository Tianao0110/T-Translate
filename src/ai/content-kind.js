// What kind of passage the reader picked, so the explain action can answer it
// in the right shape: 'code', 'error' (a stack trace), 'formula' or 'text'.
// Tuned to miss rather than misfire: anything unclear stays 'text' and is
// translated as usual (docs/design/renderer.md §6).

const CJK = /[぀-ヿ㐀-䶿一-鿿가-힯]/g;

// A stack frame or traceback line; two of them make an error report.
const STACK_LINE = [
  /^\s*at\s+[\w$.<>[\]]+(?:\s*\[as [\w$]+\])?\s*\(.*:\d+(?::\d+)?\)\s*$/, // JS / Java with location
  /^\s*at\s+[\w$.<>/\\-]+:\d+:\d+\s*$/, // JS anonymous frame
  /^\s*File ".+", line \d+/, // Python
  /^\s*Traceback \(most recent call last\):/,
  /^\s*at\s+[\w$.]+\([\w$]+\.(?:java|kt|scala):\d+\)/,
  /^\s*Exception in thread "/,
  /^\s*(?:Caused by|--- End of inner exception stack trace ---)/,
  /^\s*#\d+\s+0x[0-9a-f]+ in /i, // native backtrace
];

const CODE_LINE = [
  /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\b[\s*]*[\w$]*\s*\(/,
  /^\s*(?:const|let|var)\s+[\w${}[\],\s]+=/,
  /^\s*(?:async\s+)?def\s+\w+\s*\(/,
  /^\s*class\s+\w+[\s({:]/,
  /^\s*import\s+(?:[\w*{}\s,]+\s+from\s+)?['"]/,
  /^\s*import\s+[\w.]+(?:\s+as\s+\w+)?\s*;?\s*$/,
  /^\s*from\s+[\w.]+\s+import\s+/,
  /^\s*(?:return|yield|await|throw)\b.*[;)\]}\w]\s*$/,
  /^\s*(?:if|for|while|switch|catch)\s*\(.*\)\s*\{?\s*$/,
  /^\s*(?:if|for|while)\s*\(.*\)\s*\S.*;\s*$/,
  /^\s*\/\/(?!\/)/,
  /^\s*(?:if|elif|for|while|with|try|except)\b.*:\s*$/,
  /^\s*\}?\s*(?:else|finally)\b.*\{?\s*$/,
  /^\s*(?:public|private|protected|internal)\s+(?:static\s+)?[\w<>[\],\s]+\(/,
  /^\s*(?:fn|func|fun)\s+\w+\s*[(<]/,
  /^\s*(?:package|using|namespace)\s+[\w.]+\s*[;{]?\s*$/,
  /^\s*#include\s*[<"]/,
  /^\s*#!\//,
  /^\s*@\w+(?:\(.*\))?\s*$/,
  /^\s*<\/?[a-zA-Z][\w-]*(?:\s+[\w:-]+(?:=(?:"[^"]*"|'[^']*'|[^\s>]+))?)*\s*\/?>/,
  /^\s*[\w$.[\]]+\s*(?:[+\-*/%]?=|===?|!==?)\s*.+;\s*$/,
  /^\s*[\w$.]+\(.*\)\s*;\s*$/,
  /^\s*[}\])]+[;,)]*\s*$/,
];

const SQL = /^\s*(?:SELECT\b[\s\S]+\bFROM\b|INSERT\s+INTO\b|UPDATE\b[\s\S]+\bSET\b|DELETE\s+FROM\b|CREATE\s+(?:TABLE|INDEX|VIEW)\b|ALTER\s+TABLE\b)/i;

// Tokens that hardly occur outside code.
const CODE_TOKEN = /=>|===|!==|&&|\|\||::|->\w|\$\{|\+\+|\+=|-=|<\/|\/>|\bconsole\.|\bSystem\.out\b|\bstd::|\bself\.|\bthis\.|\bnull\b|\bundefined\b|\bNone\b|\bnullptr\b/g;

const SYMBOLS = /[{}()[\];=<>&|!*/+%^~$#@\\]/g;

function nonSpaceLength(s) {
  return s.replace(/\s+/g, '').length;
}

function looksLikeError(lines) {
  let frames = 0;
  for (const line of lines) {
    if (STACK_LINE.some((re) => re.test(line))) frames++;
  }
  return frames >= 2;
}

function codeScore(text, lines) {
  let score = 0;
  let keywordLines = 0;
  for (const line of lines) {
    if (CODE_LINE.some((re) => re.test(line))) keywordLines++;
  }
  score += Math.min(keywordLines, 6) * 2;
  score += Math.min((text.match(CODE_TOKEN) || []).length, 4) * 2;
  // Either one alone settles it.
  if (SQL.test(text) || /^#!\//.test(text)) score += 8;
  const indented = lines.filter((l) => /^(?: {2,}|\t)\S/.test(l)).length;
  if (lines.length >= 3 && indented >= 2) score += 2;
  return score;
}

const MATH_FUNCTION = /\b(?:sin|cos|tan|cot|sec|csc|arcsin|arccos|arctan|sinh|cosh|tanh|log|ln|lg|exp|lim|max|min|det|sup|inf|gcd|lcm|mod)\b/;
const LATEX = /\\(?:frac|dfrac|sum|prod|int|iint|oint|partial|sqrt|alpha|beta|gamma|delta|epsilon|varepsilon|theta|lambda|mu|sigma|pi|omega|phi|varphi|psi|rho|tau|infty|cdot|times|div|pm|leq?|geq?|neq|approx|equiv|to|mathbb|mathrm|mathbf|vec|hat|bar|left|right|begin|nabla|lim|log|ln|sin|cos|tan|exp)\b|\^\{|_\{/;
const MATH_SYMBOL = /[∑∏∫∮∂√∞≤≥≠≈≡∈∉∀∃∇±×÷⋅→⇒⇔∝∠⊥∥∪∩⊂⊆αβγδεζηθλμνξπρστφχψωΓΔΘΛΞΠΣΦΨΩ²³ⁿ⁻⁺₀₁₂₃ₙ]/;
// A relation, a power or a function call: what turns symbols into a formula.
const MATH_STRUCTURE = /[=≤≥<>≠≈^²³√]|\b[a-zA-Z]\s*\(\s*[a-zA-Z0-9]/;
// A lone letter used as a variable: x, y, a, n; or a coefficient form like 5x.
const VARIABLE = /(?<![A-Za-z0-9_])[a-zA-Z](?![A-Za-z0-9_])|\d[a-zA-Z](?![A-Za-z0-9_])/;
const WORD = /[A-Za-z]{3,}/g;

function looksLikeFormula(text) {
  const t = text.trim();
  const len = nonSpaceLength(t);
  if (len < 3 || len > 200) return false;
  if ((t.match(CJK) || []).length > 6) return false;
  const words = (t.match(WORD) || []).filter((w) => !MATH_FUNCTION.test(w.toLowerCase()) && !LATEX.test(`\\${w}`));
  if (words.length > 2) return false;
  if (LATEX.test(t)) return true;
  if (!MATH_STRUCTURE.test(t) && !MATH_SYMBOL.test(t)) return false;
  return VARIABLE.test(t) || MATH_SYMBOL.test(t) || MATH_FUNCTION.test(t);
}

export function classifyContent(text) {
  const s = typeof text === 'string' ? text.replace(/\r\n?/g, '\n').trim() : '';
  if (!s) return 'text';
  const lines = s.split('\n').filter((l) => l.trim());
  if (looksLikeError(lines)) return 'error';

  const len = nonSpaceLength(s);
  const cjk = (s.match(CJK) || []).length;
  // Prose in a CJK script with a few symbols in it stays prose.
  const mostlyCjk = cjk / Math.max(len, 1) > 0.3;
  if (len >= 12 && !mostlyCjk) {
    const score = codeScore(s, lines);
    const density = (s.match(SYMBOLS) || []).length / len;
    if (score >= 8 || (score >= 4 && density >= 0.05)) return 'code';
  }
  if (looksLikeFormula(s)) return 'formula';
  return 'text';
}
