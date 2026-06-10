// Downloads the bundled base OCR models into resources/ocr/base (gitignored).
// Run once after clone and before packaging:
//   node scripts/fetch-ocr-models.js [--force]
/* eslint-disable no-console */

const path = require('path');
const fs = require('fs');
const { BASE_PACK } = require('./ocr-model-sources');

const DEST = path.join(__dirname, '..', 'resources', 'ocr', 'base');

async function main() {
  const force = process.argv.includes('--force');
  const marker = path.join(DEST, 'pack.json');

  if (!force && fs.existsSync(marker)) {
    const existing = JSON.parse(fs.readFileSync(marker, 'utf8'));
    if (existing.version === BASE_PACK.version) {
      console.log(`Base models ${existing.version} already present at ${DEST} (use --force to re-fetch)`);
      return;
    }
  }

  console.log(`Downloading ${BASE_PACK.url} ...`);
  const res = await fetch(BASE_PACK.url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  console.log(`Downloaded ${(buffer.length / 1024 / 1024).toFixed(1)} MB`);

  const JSZip = require('jszip');
  const zip = await JSZip.loadAsync(buffer);
  fs.rmSync(DEST, { recursive: true, force: true });
  fs.mkdirSync(DEST, { recursive: true });

  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    const fileName = path.basename(name);
    fs.writeFileSync(path.join(DEST, fileName), await entry.async('nodebuffer'));
    console.log(`  extracted ${fileName}`);
  }

  // Same shape the pack manager writes for downloaded packs
  const { url, file, ...packMeta } = BASE_PACK;
  fs.writeFileSync(marker, JSON.stringify({ ...packMeta, source: url }, null, 2));
  console.log(`Base pack ready at ${DEST}`);
}

main().catch((e) => {
  console.error('fetch-ocr-models failed:', e.message);
  process.exit(1);
});
