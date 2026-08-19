#!/usr/bin/env node
// Keeps the language tables from drifting apart.
//
// A language lives in five places: the picker list, the code enum, the
// cross-provider name table the LLM prompts read, and each traditional
// provider's own code map. Nothing tied them together, so a language could sit
// in the UI while a provider silently shipped a code it had never heard of.
//
// Providers legitimately support a SUBSET (DeepL has no Thai). The reverse —
// a provider mapping a code the app cannot even offer — is a real error.

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

const SOURCES = [
  {
    label: 'LANGUAGES (选择器)',
    read: () => {
      const b = block(read('../src/config/constants.js'), /export const LANGUAGES = \[/, '];');
      return b && [...b.matchAll(/code:\s*'([^']+)'/g)].map((m) => m[1]);
    },
  },
  {
    label: 'LANGUAGE_CODES (枚举)',
    read: () => {
      const b = block(read('../src/config/constants.js'), /export const LANGUAGE_CODES = \{/, '};');
      return b && [...b.matchAll(/:\s*'([^']+)'/g)].map((m) => m[1]);
    },
  },
  {
    label: 'LANGUAGE_CODES (栈内名称表)',
    read: () => {
      const b = block(read('../src/stack/providers/base.js'), /export const LANGUAGE_CODES = \{/, '\n};');
      return b && [...b.matchAll(/'([^']+)':\s*\{/g)].map((m) => m[1]);
    },
  },
];

const PROVIDERS = [
  { id: 'deepl', file: '../src/stack/providers/deepl.js', fn: '_convertLangCode' },
  { id: 'microsoft', file: '../src/stack/providers/microsoft-translator.js', fn: '_mapLanguageCode' },
  { id: 'baidu', file: '../src/stack/providers/baidu-translate.js', fn: '_mapLanguageCode' },
];

function providerCodes(meta) {
  const content = read(meta.file);
  const at = content.indexOf(meta.fn);
  if (at === -1) return null;
  const body = content.slice(at, content.indexOf('\n  }', at));
  return [...body.matchAll(/'([^']+)':/g)].map((m) => m[1]);
}

function main() {
  console.log('🌐 Checking language tables...\n');
  let hasError = false;

  const sets = [];
  for (const src of SOURCES) {
    const codes = src.read();
    if (!codes || codes.length === 0) {
      console.log(`  ⚠️  ${src.label}: 没找到表（结构变了？）`);
      hasError = true;
      continue;
    }
    sets.push({ label: src.label, codes: new Set(codes) });
  }

  if (sets.length === 0) {
    console.log('\n❌ 一张语言表都没读到');
    process.exit(1);
  }

  const ref = sets[0];
  console.log(`  基准：${ref.label}（${ref.codes.size} 种）`);

  for (const s of sets.slice(1)) {
    const missing = [...ref.codes].filter((c) => !s.codes.has(c));
    const extra = [...s.codes].filter((c) => !ref.codes.has(c));
    if (missing.length || extra.length) {
      hasError = true;
      console.log(`  ❌ ${s.label} 与基准不一致`);
      if (missing.length) console.log(`       缺少: ${missing.join(', ')}`);
      if (extra.length) console.log(`       多出: ${extra.join(', ')}`);
    } else {
      console.log(`  ✅ ${s.label}`);
    }
  }

  console.log('');
  for (const meta of PROVIDERS) {
    const codes = providerCodes(meta);
    if (!codes) {
      console.log(`  ⚠️  ${meta.id}: 没找到 ${meta.fn}`);
      continue;
    }
    const orphans = codes.filter((c) => !ref.codes.has(c));
    if (orphans.length) {
      hasError = true;
      console.log(`  ❌ ${meta.id} 映射了程序并不提供的语言: ${orphans.join(', ')}`);
      continue;
    }
    // Informational: an unmapped code falls through to `|| code`, which is
    // right for ISO-code APIs (Microsoft) and wrong for Baidu's custom ones.
    const uncovered = [...ref.codes].filter((c) => !codes.includes(c));
    console.log(`  ✅ ${meta.id} — ${uncovered.length ? `未映射 ${uncovered.length} 种: ${uncovered.join(', ')}` : '全覆盖'}`);
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
