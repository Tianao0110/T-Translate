#!/usr/bin/env node
// Keeps the language tables from drifting apart.
//
// The catalogue itself now lives in one place (src/config/languages.js, shared
// by the renderer and the stack), so the drift that remains is at the edges:
// the named-constant enum, and each traditional provider's own code map.
//
// Providers legitimately support a SUBSET — DeepL has no Thai. The reverse, a
// provider mapping a code the app cannot even offer, is a real error.

const fs = require('fs');
const path = require('path');

const read = (rel) => fs.readFileSync(path.join(__dirname, rel), 'utf-8');

function block(content, startRe, endToken) {
  const start = content.match(startRe);
  if (!start) return null;
  const from = start.index + start[0].length;
  const to = content.indexOf(endToken, from);
  return to === -1 ? null : content.slice(from, to);
}

function catalogue() {
  const b = block(read('../src/config/languages.js'), /export const LANGUAGES = \[/, '\n];');
  return b && [...b.matchAll(/code: '([^']+)'/g)].map((m) => m[1]);
}

// Not a mirror of the catalogue — it only names the handful of codes written
// literally in code (AUTO, ZH). Its invariant is "subset", not "equal".
function enumCodes() {
  const b = block(read('../src/config/constants.js'), /export const LANGUAGE_CODES = \{/, '};');
  return b ? [...b.matchAll(/: '([^']+)'/g)].map((m) => m[1]) : [];
}

const PROVIDERS = [
  // `unmapped` = what the mapper does with a code it has no entry for.
  //   passthrough — sends the code as-is (right for ISO-code APIs)
  //   reject      — returns null and the caller reports "unsupported"
  { id: 'deepl', file: '../src/stack/providers/deepl.js', fn: '_convertLangCode', unmapped: 'reject' },
  { id: 'google', file: '../src/stack/providers/google-translate.js', fn: '_mapLanguageCode', unmapped: 'passthrough' },
  { id: 'microsoft', file: '../src/stack/providers/microsoft-translator.js', fn: '_mapLanguageCode', unmapped: 'passthrough' },
  { id: 'baidu', file: '../src/stack/providers/baidu-translate.js', fn: '_mapLanguageCode', unmapped: 'passthrough' },
];

// The OCR language list exists twice on purpose: the engine resolves model
// packs in the main process, the settings select renders in the renderer, and
// the renderer cannot import main-process code. Equal, not subset — a code in
// only one of them is either a language the UI offers and the engine
// mis-routes, or one the engine knows and nobody can pick.
function ocrPackMaps() {
  const ui = block(read('../src/config/ocr-languages.js'), /export const OCR_LANGUAGE_GROUPS = \[/, '\n];');
  const engine = block(read('../electron/shared/ocr-packs.js'), /const LANGUAGE_TO_PACK = \{/, '\n};');
  if (!ui || !engine) return null;

  const uiMap = { auto: 'base-v6' };
  for (const g of ui.matchAll(/packId: '([^']+)',[\s\S]*?languages: \[([\s\S]*?)\]/g)) {
    for (const c of g[2].matchAll(/'([^']+)'/g)) uiMap[c[1]] = g[1];
  }

  const engineMap = {};
  for (const m of engine.matchAll(/'([^']+)':\s*(BASE_PACK_ID|'[^']+')/g)) {
    engineMap[m[1]] = m[2] === 'BASE_PACK_ID' ? 'base-v6' : m[2].replace(/'/g, '');
  }
  return { uiMap, engineMap };
}

function providerCodes(meta) {
  const content = read(meta.file);
  // The DEFINITION, not the first call site — google-translate.js calls its
  // mapper 90 lines above where it defines it, and slicing from the call site
  // swept up the request headers as if they were language codes.
  const at = content.indexOf(`\n  ${meta.fn}(`);
  if (at === -1) return null;
  const body = content.slice(at, content.indexOf('\n  }', at));
  return [...body.matchAll(/'([^']+)':/g)].map((m) => m[1]);
}

function main() {
  console.log('🌐 Checking language tables...\n');
  let hasError = false;

  const codes = catalogue();
  if (!codes || codes.length === 0) {
    console.log('  ❌ 没读到 src/config/languages.js 的目录表（结构变了？）');
    process.exit(1);
  }
  const ref = new Set(codes);
  console.log(`  ✅ 共享目录 — ${ref.size} 种语言`);

  const dupes = codes.filter((c, i) => codes.indexOf(c) !== i);
  if (dupes.length) {
    hasError = true;
    console.log(`  ❌ 目录里有重复的语言码: ${[...new Set(dupes)].join(', ')}`);
  }

  // The Chinese letter index reads the pinyin initial off the name's first
  // character. An unmapped character silently lands the language in the '#'
  // group, where nobody will look for it.
  const src = read('../src/config/languages.js');
  const initials = block(src, /const PINYIN_INITIALS = \{/, '};') || '';
  const mappedChars = new Set([...initials.matchAll(/(\S): '/g)].map((m) => m[1]));
  const namesBlock = block(src, /export const LANGUAGES = \[/, '\n];') || '';
  const unmapped = [...namesBlock.matchAll(/name: '([^']+)'/g)]
    .map((m) => m[1])
    .filter((n) => n !== '自动检测' && !mappedChars.has(n[0]));
  if (unmapped.length) {
    hasError = true;
    console.log(`  ❌ 这些语言名的首字没有拼音映射，中文索引会漏: ${unmapped.join(', ')}`);
  } else {
    console.log(`  ✅ 拼音首字母索引 — ${mappedChars.size} 个字覆盖全部语言名`);
  }

  const orphanEnum = enumCodes().filter((c) => !ref.has(c));
  if (orphanEnum.length) {
    hasError = true;
    console.log(`  ❌ LANGUAGE_CODES 枚举引用了目录里没有的语言: ${orphanEnum.join(', ')}`);
  } else {
    console.log(`  ✅ LANGUAGE_CODES 枚举 — 均在目录内`);
  }

  const ocr = ocrPackMaps();
  if (!ocr) {
    hasError = true;
    console.log('  ❌ 没读到 OCR 语言表（结构变了？）');
  } else {
    const { uiMap, engineMap } = ocr;
    const mismatched = Object.keys(uiMap).filter((c) => uiMap[c] !== engineMap[c]);
    const engineOnly = Object.keys(engineMap).filter((c) => !uiMap[c]);
    // Names come from the shared catalogue; a code outside it renders as the
    // raw code in the settings select.
    const nameless = Object.keys(uiMap)
      .filter((c) => !['auto', 'zh-Hans', 'zh-Hant'].includes(c) && !ref.has(c));

    if (mismatched.length || engineOnly.length) {
      hasError = true;
      if (mismatched.length) console.log(`  ❌ OCR 语言表不同步 — 选择器与引擎对不上: ${mismatched.join(', ')}`);
      if (engineOnly.length) console.log(`  ❌ OCR 语言表不同步 — 引擎认得但选择器没放出: ${engineOnly.join(', ')}`);
    } else if (nameless.length) {
      hasError = true;
      console.log(`  ❌ OCR 可选语言不在共享目录里，名字会显示成语言码: ${nameless.join(', ')}`);
    } else {
      const packs = new Set(Object.values(uiMap)).size;
      console.log(`  ✅ OCR 语言表 — ${Object.keys(uiMap).length - 1} 种，分属 ${packs} 个模型包，两端一致`);
    }
  }

  console.log('');
  for (const meta of PROVIDERS) {
    const mapped = providerCodes(meta);
    if (!mapped) {
      console.log(`  ⚠️  ${meta.id}: 没找到 ${meta.fn}`);
      continue;
    }
    const orphans = mapped.filter((c) => !ref.has(c));
    if (orphans.length) {
      hasError = true;
      console.log(`  ❌ ${meta.id} 映射了程序并不提供的语言: ${orphans.join(', ')}`);
      continue;
    }
    const uncovered = ref.size - mapped.length;
    const fate = meta.unmapped === 'reject'
      ? `其余 ${uncovered} 种报「不支持」`
      : `其余 ${uncovered} 种直传语言码`;
    console.log(`  ✅ ${meta.id} — 显式映射 ${mapped.length} 种，${fate}`);
  }

  console.log('');
  if (hasError) {
    console.log('❌ 语言表不同步');
    process.exit(1);
  }
  console.log('✅ 语言表一致');
  process.exit(0);
}

main();
