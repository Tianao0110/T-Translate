#!/usr/bin/env node
// Compares the key shape of zh.js and en.js (and main-i18n.js) to surface:
//   - keys present in one locale but missing from the other
//   - keys whose value is the empty string
//
// Usage: npm run check:i18n
// CI:    node scripts/check-i18n.js --strict   (exits non-zero on drift)

const fs = require('fs');
const path = require('path');

const ZH_PATH = path.join(__dirname, '../src/i18n/locales/zh.js');
const EN_PATH = path.join(__dirname, '../src/i18n/locales/en.js');

// Main-process i18n is checked alongside the renderer locales.
const MAIN_I18N_PATH = path.join(__dirname, '../electron/shared/main-i18n.js');

const isStrict = process.argv.includes('--strict');
const showValues = process.argv.includes('--verbose');

const vm = require('vm');

// Reads a locale file and returns its translation object, flattened
// into dot-path keys.
function extractKeys(filePath) {
  let content = fs.readFileSync(filePath, 'utf-8');

  // Rewrite ESM into something vm can run as a CommonJS module:
  //   strip `export default xx;`
  //   turn `const xx = { ... }` into `module.exports = { ... }`
  content = content.replace(/export\s+default\s+\w+;\s*$/m, '');
  content = content.replace(/\bconst\s+\w+\s*=\s*\{/, 'module.exports = {');

  const sandbox = { module: { exports: {} }, exports: {} };

  try {
    vm.runInNewContext(content, sandbox, { filename: path.basename(filePath) });
    return sandbox.module.exports || {};
  } catch (e) {
    console.error(`  ⚠️  Parse failed for ${path.basename(filePath)}: ${e.message}`);
    return extractKeysByRegex(content);
  }
}

// Regex fallback when the vm parse fails — pulls flat key/value pairs.
function extractKeysByRegex(content) {
  const result = {};
  const regex = /(?:['"]?([\w.:-]+)['"]?\s*:\s*['"]([^'"]*)['"]\s*[,}])/g;
  let m;
  while ((m = regex.exec(content)) !== null) {
    result[m[1]] = m[2];
  }
  return result;
}

function flattenKeys(obj, prefix = '') {
  const result = {};

  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, flattenKeys(value, fullKey));
    } else {
      result[fullKey] = value;
    }
  }

  return result;
}

function extractMainI18nKeys(filePath) {
  if (!fs.existsSync(filePath)) return { zh: {}, en: {} };

  const content = fs.readFileSync(filePath, 'utf-8');

  const match = content.match(/const\s+messages\s*=\s*(\{[\s\S]*?\n\};)/);
  if (!match) return { zh: {}, en: {} };

  try {
    const obj = new Function(`return ${match[1]}`)();
    return {
      zh: obj.zh ? Object.keys(obj.zh) : [],
      en: obj.en ? Object.keys(obj.en) : [],
    };
  } catch (e) {
    console.error(`  ⚠️  Cannot parse main-i18n.js: ${e.message}`);
    return { zh: [], en: [] };
  }
}

function main() {
  console.log('🔍 Checking i18n key synchronization...\n');

  let hasError = false;
  let warningCount = 0;

  // ---- Renderer locales (zh.js vs en.js) ----
  console.log('📄 Renderer i18n (zh.js ↔ en.js)');
  console.log('─'.repeat(50));

  const zhObj = extractKeys(ZH_PATH);
  const enObj = extractKeys(EN_PATH);
  const zhKeys = flattenKeys(zhObj);
  const enKeys = flattenKeys(enObj);

  const zhKeySet = new Set(Object.keys(zhKeys));
  const enKeySet = new Set(Object.keys(enKeys));

  const missingInEn = [...zhKeySet].filter(k => !enKeySet.has(k));
  const missingInZh = [...enKeySet].filter(k => !zhKeySet.has(k));
  const emptyInZh = Object.entries(zhKeys).filter(([, v]) => v === '').map(([k]) => k);
  const emptyInEn = Object.entries(enKeys).filter(([, v]) => v === '').map(([k]) => k);

  console.log(`  zh.js: ${zhKeySet.size} keys`);
  console.log(`  en.js: ${enKeySet.size} keys`);
  console.log('');

  if (missingInEn.length > 0) {
    hasError = true;
    console.log(`  ❌ Missing in en.js (${missingInEn.length}):`);
    missingInEn.forEach(k => {
      const val = showValues ? ` = "${zhKeys[k]}"` : '';
      console.log(`     - ${k}${val}`);
    });
    console.log('');
  }

  if (missingInZh.length > 0) {
    hasError = true;
    console.log(`  ❌ Missing in zh.js (${missingInZh.length}):`);
    missingInZh.forEach(k => {
      const val = showValues ? ` = "${enKeys[k]}"` : '';
      console.log(`     - ${k}${val}`);
    });
    console.log('');
  }

  if (emptyInZh.length > 0) {
    warningCount += emptyInZh.length;
    console.log(`  ⚠️  Empty values in zh.js (${emptyInZh.length}):`);
    emptyInZh.forEach(k => console.log(`     - ${k}`));
    console.log('');
  }

  if (emptyInEn.length > 0) {
    warningCount += emptyInEn.length;
    console.log(`  ⚠️  Empty values in en.js (${emptyInEn.length}):`);
    emptyInEn.forEach(k => console.log(`     - ${k}`));
    console.log('');
  }

  if (missingInEn.length === 0 && missingInZh.length === 0) {
    console.log('  ✅ All keys are in sync!');
    console.log('');
  }

  // ---- Main-process locales ----
  if (fs.existsSync(MAIN_I18N_PATH)) {
    console.log('📄 Main process i18n (main-i18n.js)');
    console.log('─'.repeat(50));

    const mainKeys = extractMainI18nKeys(MAIN_I18N_PATH);
    const mainZhSet = new Set(mainKeys.zh);
    const mainEnSet = new Set(mainKeys.en);

    const mainMissingInEn = [...mainZhSet].filter(k => !mainEnSet.has(k));
    const mainMissingInZh = [...mainEnSet].filter(k => !mainZhSet.has(k));

    console.log(`  zh: ${mainZhSet.size} keys`);
    console.log(`  en: ${mainEnSet.size} keys`);
    console.log('');

    if (mainMissingInEn.length > 0) {
      hasError = true;
      console.log(`  ❌ Missing in en (${mainMissingInEn.length}):`);
      mainMissingInEn.forEach(k => console.log(`     - ${k}`));
      console.log('');
    }

    if (mainMissingInZh.length > 0) {
      hasError = true;
      console.log(`  ❌ Missing in zh (${mainMissingInZh.length}):`);
      mainMissingInZh.forEach(k => console.log(`     - ${k}`));
      console.log('');
    }

    if (mainMissingInEn.length === 0 && mainMissingInZh.length === 0) {
      console.log('  ✅ All keys are in sync!');
      console.log('');
    }
  }

  console.log('═'.repeat(50));
  if (hasError) {
    console.log('❌ i18n keys are OUT OF SYNC!');
    if (isStrict) process.exit(1);
  } else if (warningCount > 0) {
    console.log(`✅ Keys in sync, but ${warningCount} empty values found.`);
  } else {
    console.log('✅ All i18n keys are perfectly in sync!');
  }
}

main();
