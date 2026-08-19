// Asks Google to translate a sample into every code in the catalogue and
// reports the ones it rejects.
//
// Why this exists: config/languages.js carries ~134 codes that nothing in the
// app can validate. A wrong code does not throw — google-translate.js passes
// unmapped codes straight through, so a typo just comes back as untranslated
// text, silently, forever. This is the only way to know the table is real.
//
// One-off, NOT part of check:all — it makes one network request per language
// against Google's unofficial endpoint. Run it after editing the catalogue.
//
//   node scripts/verify-google-languages.mjs
//   node scripts/verify-google-languages.mjs --delay 500   (if throttled)

import { LANGUAGES } from '../src/config/languages.js';
import { configureRuntime } from '../src/stack/runtime.js';
import GoogleTranslateProvider from '../src/stack/providers/google-translate.js';

const SAMPLE = 'The quick brown fox jumps over the lazy dog.';
const delayArg = process.argv.indexOf('--delay');
const DELAY_MS = delayArg !== -1 ? Number(process.argv[delayArg + 1]) : 300;

configureRuntime({ fetch: (...args) => globalThis.fetch(...args) });

const provider = new GoogleTranslateProvider({ domain: 'com' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 'en' is the sample's own language — Google rightly echoes it back, which
// would otherwise read as an invalid code.
const SOURCE = 'en';
const targets = LANGUAGES.filter((l) => l.code !== 'auto' && l.code !== SOURCE);
const failed = [];
const untranslated = [];
let ok = 0;

console.log(`Verifying ${targets.length} language codes against Google (delay ${DELAY_MS}ms)...\n`);

for (const [i, lang] of targets.entries()) {
  const label = `${String(i + 1).padStart(3)}/${targets.length} ${lang.code.padEnd(9)} ${lang.en}`;
  try {
    const result = await provider.translate(SAMPLE, SOURCE, lang.code);

    if (!result.success) {
      failed.push({ ...lang, reason: result.error });
      console.log(`  ✗ ${label} — ${result.error}`);
    } else if (result.text?.trim() === SAMPLE) {
      // Google echoes the input when it does not recognise the target code.
      untranslated.push(lang);
      console.log(`  ? ${label} — 原样返回（码可能无效）`);
    } else {
      ok++;
      console.log(`  ✓ ${label} — ${result.text.slice(0, 40)}`);
    }
  } catch (error) {
    failed.push({ ...lang, reason: error.message });
    console.log(`  ✗ ${label} — ${error.message}`);
  }

  await sleep(DELAY_MS);
}

console.log(`\n${'='.repeat(60)}`);
console.log(`成功 ${ok} / 原样返回 ${untranslated.length} / 失败 ${failed.length}`);

if (untranslated.length) {
  console.log(`\n原样返回（Google 不认这个码，需要改）:`);
  untranslated.forEach((l) => console.log(`  ${l.code.padEnd(9)} ${l.en} (${l.name})`));
}
if (failed.length) {
  console.log(`\n请求失败（可能是限流，重跑或加大 --delay）:`);
  failed.forEach((l) => console.log(`  ${l.code.padEnd(9)} ${l.en} — ${l.reason}`));
}

process.exit(untranslated.length ? 1 : 0);
