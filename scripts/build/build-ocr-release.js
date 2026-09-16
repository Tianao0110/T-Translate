// Prepares the GitHub `ocr-models` release: downloads every pack zip from
// upstream, computes sha256/size, and emits release-ocr-models/ containing
// the zips + manifest.json ready to upload as release assets.
//   node scripts/build/build-ocr-release.js
//
// Publishing steps: docs/OCR_MODELS.md and docs/design/tooling.md §2.
/* eslint-disable no-console */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { BASE_PACK, HQ_PACK, LANG_PACKS, LEGACY_PACKS, RELEASE_BASE_URL } = require('../fetch/ocr-model-sources');

const OUT_DIR = path.join(__dirname, '..', '..', 'release-ocr-models');

async function fetchPack(pack) {
  const dest = path.join(OUT_DIR, pack.file);
  let buffer;

  if (fs.existsSync(dest)) {
    buffer = fs.readFileSync(dest);
    console.log(`  ${pack.file}: reusing local copy`);
  } else {
    console.log(`  ${pack.file}: downloading ${pack.url}`);
    const res = await fetch(pack.url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${pack.url}`);
    buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(dest, buffer);
  }

  // Manifest entries carry no url — clients join baseUrl + file instead.
  const entry = { ...pack };
  delete entry.url;
  return {
    ...entry,
    size: buffer.length,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
  };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const packs = [];
  // Legacy entries first: pre-v6 clients pick their base pack via
  // find(type === 'base').
  for (const pack of [...LEGACY_PACKS, BASE_PACK, HQ_PACK, ...LANG_PACKS]) {
    packs.push(await fetchPack(pack));
  }

  const manifest = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString().slice(0, 10),
    baseUrl: RELEASE_BASE_URL,
    packs,
  };

  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));

  const total = packs.reduce((s, p) => s + p.size, 0);
  console.log(`\nmanifest.json + ${packs.length} packs (${(total / 1024 / 1024).toFixed(1)} MB) ready in ${OUT_DIR}`);
  console.log('Upload ALL files in that folder to the `ocr-models` GitHub release (mark as pre-release).');
}

main().catch((e) => {
  console.error('build-ocr-release failed:', e.message);
  process.exit(1);
});
