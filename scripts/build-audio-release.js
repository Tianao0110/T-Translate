// Prepares the GitHub `audio-models` release: repackages locally extracted
// sherpa-onnx model trees into flat pack zips, archives each model's licence
// alongside the weights, computes sha256/size, and emits
// release-audio-models/ ready to upload as release assets.
//
//   node scripts/build-audio-release.js [--src <dir>] [--only <id,id>]
//
// --src defaults to %APPDATA%\t-translate\asr-models (where the probe reads
// manually placed models). Extract the upstream .tar.bz2 tarballs there first:
// Node has no bzip2, so extraction stays a manual step — the exact upstream
// URLs are in audio-model-sources.js and land in PROVENANCE.txt inside each
// pack, so a rebuild a year from now is a download + `tar -xjf` away.
//
// --only rebuilds just those packs; the others keep their entries from the
// existing release-audio-models/manifest.json, so a voice-pack rebuild from
// a different source tree never drops the ASR packs out of the manifest.
// Voice packs carry whole directories (`tree` sources): their files are
// zipped with relative paths, which the app's extractor preserves.
//
// Publishing steps (manual, one-time per model update):
//   1. GitHub -> Releases -> Draft new release, tag `audio-models`
//      (mark as PRE-RELEASE so electron-updater never treats it as "latest" —
//      the same rule that keeps the ocr-models tag out of the update channel)
//   2. Upload everything inside release-audio-models/
//   3. Publish. The app reads manifest.json from that release at runtime.
//   To ship a model update later: bump `version` in audio-model-sources.js,
//   re-run this script, replace the changed assets + manifest.json.
//
// Zip entries carry a fixed timestamp, so the same inputs always produce the
// same sha256 — re-run and diff to verify an asset was built from these files.
/* eslint-disable no-console */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const JSZip = require('jszip');
const { PACKS, RELEASE_BASE_URL } = require('./audio-model-sources');

const OUT_DIR = path.join(__dirname, '..', 'release-audio-models');
const LICENSE_DIR = path.join(__dirname, 'model-licenses');
// Any fixed date works; this one keeps zip metadata stable across rebuilds.
const ZIP_DATE = new Date('2020-01-01T00:00:00Z');

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function parseArgs(argv) {
  const o = argv.indexOf('--only');
  const only = o !== -1 && argv[o + 1] ? argv[o + 1].split(',').map((s) => s.trim()).filter(Boolean) : null;
  const i = argv.indexOf('--src');
  if (i !== -1 && argv[i + 1]) return { srcRoot: argv[i + 1], only };
  if (process.env.TT_AUDIO_MODEL_SRC) return { srcRoot: process.env.TT_AUDIO_MODEL_SRC, only };
  if (!process.env.APPDATA) {
    throw new Error('no --src given and APPDATA is unset (Windows-only default)');
  }
  return { srcRoot: path.join(process.env.APPDATA, 't-translate', 'asr-models'), only };
}

// Every file under <srcRoot>/<dir>/<tree>, as [relative-with-forward-slashes, buffer],
// sorted so the zip (and its hash) is the same on every rebuild.
function readTree(srcRoot, entry, packId) {
  const base = path.join(srcRoot, entry.dir, entry.tree);
  if (!fs.existsSync(base)) {
    throw new Error(`${packId}: missing directory ${entry.tree}\n  expected at: ${base}`);
  }
  const files = [];
  const walk = (dir) => {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, d.name);
      if (d.isDirectory()) walk(abs);
      else files.push(abs);
    }
  };
  walk(base);
  files.sort();
  return files.map((abs) => [
    `${entry.tree}/${path.relative(base, abs).split(path.sep).join('/')}`,
    fs.readFileSync(abs),
  ]);
}

function readSource(srcRoot, entry, packId) {
  const abs = entry.root
    ? path.join(srcRoot, entry.file)
    : path.join(srcRoot, entry.dir, entry.file);
  if (!fs.existsSync(abs)) {
    const looked = entry.root ? srcRoot : path.join(srcRoot, entry.dir);
    let listing = '(directory missing)';
    try {
      listing = fs.readdirSync(looked).join(', ') || '(empty)';
    } catch {
      /* keep the placeholder */
    }
    throw new Error(
      `${packId}: missing ${entry.file}\n  expected at: ${abs}\n  found in ${looked}: ${listing}\n` +
        '  extract the upstream tarball there (URLs in audio-model-sources.js) or pass --src'
    );
  }
  return fs.readFileSync(abs);
}

function provenanceText(pack, fileHashes) {
  const lines = [
    `${pack.id} v${pack.version}`,
    '',
    `Model: ${pack.model}`,
    `Licence: ${pack.license}`,
    '',
    'Upstream artifacts (this pack is a repackaging of these, not a retrain):',
    ...pack.upstream.map((u) => `  ${u}`),
    '',
    'Files (sha256 of the weights themselves, not of the zip):',
    ...Object.entries(fileHashes).map(([name, hash]) => `  ${hash}  ${name}`),
    '',
    'Redistributed by T-Translate (https://github.com/Tianao0110/T-Translate).',
    'The licence texts shipped next to this file govern the weights; the model',
    'names above are retained as those licences require.',
    '',
  ];
  return lines.join('\n');
}

async function buildPack(pack, srcRoot) {
  const zip = new JSZip();
  const fileHashes = {};
  let rawBytes = 0;

  for (const entry of pack.sources) {
    if (entry.tree) {
      // One provenance line per tree: the hash of its sorted (name, hash)
      // list, so a changed or missing file inside still changes the record.
      const files = readTree(srcRoot, entry, pack.id);
      const inner = [];
      for (const [name, buf] of files) {
        inner.push(`${sha256(buf)}  ${name}`);
        rawBytes += buf.length;
        zip.file(name, buf, { date: ZIP_DATE, createFolders: false });
      }
      fileHashes[`${entry.tree}/ (${files.length} files)`] = sha256(Buffer.from(inner.join('\n')));
      continue;
    }
    const buf = readSource(srcRoot, entry, pack.id);
    fileHashes[entry.file] = sha256(buf);
    rawBytes += buf.length;
    zip.file(entry.file, buf, { date: ZIP_DATE, createFolders: false });
  }

  for (const name of pack.licenses) {
    const abs = path.join(LICENSE_DIR, name);
    if (!fs.existsSync(abs)) throw new Error(`${pack.id}: licence text missing: ${abs}`);
    zip.file(name, fs.readFileSync(abs), { date: ZIP_DATE, createFolders: false });
  }

  zip.file('PROVENANCE.txt', provenanceText(pack, fileHashes), {
    date: ZIP_DATE,
    createFolders: false,
  });

  const buffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  fs.writeFileSync(path.join(OUT_DIR, pack.file), buffer);

  console.log(
    `  ${pack.file}: ${(buffer.length / 1024 / 1024).toFixed(1)} MB ` +
      `(${(rawBytes / 1024 / 1024).toFixed(1)} MB raw, ${Math.round((1 - buffer.length / rawBytes) * 100)}% saved)`
  );

  // Manifest entries carry no source paths — clients join baseUrl + file.
  // Voice-pack fields (engine, voiceGroups, ...) pass through untouched: the
  // app persists them into pack.json and builds its picker from there.
  return {
    id: pack.id,
    type: pack.type,
    version: pack.version,
    model: pack.model,
    file: pack.file,
    languages: pack.languages,
    files: pack.files,
    ...(pack.engine ? { engine: pack.engine } : {}),
    ...(pack.sampleRate ? { sampleRate: pack.sampleRate } : {}),
    ...(pack.voiceGroups ? { voiceGroups: pack.voiceGroups } : {}),
    ...(pack.featured ? { featured: pack.featured } : {}),
    ...(pack.preferMixed !== undefined ? { preferMixed: pack.preferMixed } : {}),
    license: pack.license,
    upstream: pack.upstream,
    size: buffer.length,
    sha256: sha256(buffer),
  };
}

function readExistingManifest() {
  try {
    return JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'manifest.json'), 'utf8'));
  } catch {
    return null;
  }
}

async function main() {
  const { srcRoot, only } = parseArgs(process.argv.slice(2));
  console.log(`Source models: ${srcRoot}`);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const selected = only ? PACKS.filter((p) => only.includes(p.id)) : PACKS;
  if (only && selected.length !== only.length) {
    const known = PACKS.map((p) => p.id).join(', ');
    throw new Error(`--only names an unknown pack; known: ${known}`);
  }

  const built = new Map();
  for (const pack of selected) {
    built.set(pack.id, await buildPack(pack, srcRoot));
  }

  // Packs not rebuilt keep their previous manifest entry (their zips are
  // still in OUT_DIR from the earlier run); a pack with neither is dropped
  // with a warning rather than invented.
  const previous = new Map((readExistingManifest()?.packs || []).map((p) => [p.id, p]));
  const packs = [];
  for (const pack of PACKS) {
    if (built.has(pack.id)) packs.push(built.get(pack.id));
    else if (previous.has(pack.id)) packs.push(previous.get(pack.id));
    else console.warn(`  ${pack.id}: not rebuilt and absent from the existing manifest — skipped`);
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
  console.log('Upload ALL files in that folder to the `audio-models` GitHub release (mark as pre-release).');
}

main().catch((e) => {
  console.error('build-audio-release failed:', e.message);
  process.exit(1);
});
