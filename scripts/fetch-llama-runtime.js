// Fetches the pinned llama.cpp runtime DLLs into resources/llama (gitignored)
// and verifies every file against electron/tengine/runtime/llama-manifest.json.
// Run after clone and before packaging:
//   node scripts/fetch-llama-runtime.js [--force]
// Annual re-pin: download the new build, rewrite the manifest, extract.
//   node scripts/fetch-llama-runtime.js --pin b12345 [--zip path/to/local.zip]
/* eslint-disable no-console */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const REPO = 'ggml-org/llama.cpp';
const MANIFEST = path.join(__dirname, '..', 'electron', 'tengine', 'runtime', 'llama-manifest.json');
const DEST = path.join(__dirname, '..', 'resources', 'llama');

// The Vulkan zip is a superset of the CPU zip (same llama/ggml DLLs plus the
// Vulkan backend, verified byte-identical on b10853), so one download covers
// both backends.
const zipName = (build) => `llama-${build}-bin-win-vulkan-x64.zip`;
const zipUrl = (build) => `https://github.com/${REPO}/releases/download/${build}/${zipName(build)}`;

// What leaves the zip: the C API, the multimodal helper, the ggml core, every
// CPU variant (picked at runtime), the Vulkan backend, OpenMP and its licence.
// Tools, the server, rpc and llama-common stay out.
const TAKE = /^(llama|mtmd|ggml|ggml-base|ggml-vulkan|ggml-cpu-[a-z0-9]+|libomp)\.dll$|^LICENSE-LLVM-OpenMP$/;
const REQUIRED = ['libomp.dll', 'ggml-base.dll', 'ggml.dll', 'llama.dll', 'mtmd.dll', 'ggml-vulkan.dll', 'ggml-cpu-x64.dll'];

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : null;
};

function readManifest() {
  return JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
}

// True when every manifest file is on disk with the right size and hash.
function installed(manifest) {
  for (const f of manifest.files) {
    const p = path.join(DEST, f.name);
    if (!fs.existsSync(p)) return false;
    const buf = fs.readFileSync(p);
    if (buf.length !== f.size || sha256(buf) !== f.sha256) return false;
  }
  return true;
}

async function download(url) {
  console.log(`Downloading ${url} ...`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  console.log(`Downloaded ${mb(buf.length)}`);
  return buf;
}

// GitHub publishes a sha256 digest per release asset. It is a second opinion
// while pinning; later fetches trust the manifest hash only.
async function publishedDigest(build, name) {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/tags/${build}`, {
      headers: { 'user-agent': 't-translate-fetch-llama-runtime' },
    });
    if (!res.ok) return null;
    const rel = await res.json();
    const asset = (rel.assets || []).find((a) => a.name === name);
    return asset?.digest ? asset.digest.replace(/^sha256:/, '') : null;
  } catch {
    return null;
  }
}

async function entries(zipBuf) {
  const JSZip = require('jszip');
  const zip = await JSZip.loadAsync(zipBuf);
  const out = [];
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    const base = path.basename(name);
    if (!TAKE.test(base)) continue;
    out.push({ name: base, buf: await entry.async('nodebuffer') });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

function extract(files) {
  fs.rmSync(DEST, { recursive: true, force: true });
  fs.mkdirSync(DEST, { recursive: true });
  for (const f of files) fs.writeFileSync(path.join(DEST, f.name), f.buf);
}

async function pin(build) {
  const name = zipName(build);
  const local = arg('--zip');
  const zipBuf = local ? fs.readFileSync(local) : await download(zipUrl(build));
  const zipHash = sha256(zipBuf);
  const digest = await publishedDigest(build, name);
  if (digest && digest !== zipHash) {
    throw new Error(`zip sha256 ${zipHash} does not match the GitHub release digest ${digest}`);
  }
  console.log(digest ? 'zip sha256 matches the GitHub release digest' : 'GitHub release digest unavailable; pinning the local hash as-is');

  const files = await entries(zipBuf);
  for (const r of REQUIRED) {
    if (!files.some((f) => f.name === r)) throw new Error(`zip lacks ${r}`);
  }
  const manifest = {
    build,
    pinnedAt: new Date().toISOString().slice(0, 10),
    zip: { name, url: zipUrl(build), size: zipBuf.length, sha256: zipHash },
    files: files.map((f) => ({ name: f.name, size: f.buf.length, sha256: sha256(f.buf) })),
  };
  fs.mkdirSync(path.dirname(MANIFEST), { recursive: true });
  fs.writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  extract(files);
  const total = files.reduce((n, f) => n + f.buf.length, 0);
  console.log(`Pinned ${build}: ${files.length} files, ${mb(total)} extracted to ${DEST}`);
  console.log(`Manifest written to ${MANIFEST}`);
}

async function fetchPinned(force) {
  const manifest = readManifest();
  if (!force && installed(manifest)) {
    console.log(`llama.cpp ${manifest.build} already present at ${DEST} (use --force to re-fetch)`);
    return;
  }
  const zipBuf = await download(manifest.zip.url);
  const zipHash = sha256(zipBuf);
  if (zipHash !== manifest.zip.sha256) {
    throw new Error(`zip sha256 mismatch: got ${zipHash}, manifest says ${manifest.zip.sha256}`);
  }
  const byName = new Map((await entries(zipBuf)).map((f) => [f.name, f]));
  const picked = [];
  for (const want of manifest.files) {
    const f = byName.get(want.name);
    if (!f) throw new Error(`zip lacks ${want.name}`);
    if (f.buf.length !== want.size || sha256(f.buf) !== want.sha256) {
      throw new Error(`${want.name} does not match the manifest`);
    }
    picked.push(f);
  }
  extract(picked);
  console.log(`llama.cpp ${manifest.build} ready at ${DEST} (${picked.length} files)`);
}

async function main() {
  const build = arg('--pin');
  if (build) {
    if (!/^b\d+$/.test(build)) throw new Error('--pin expects a build tag like b10853');
    return pin(build);
  }
  return fetchPinned(process.argv.includes('--force'));
}

main().catch((e) => {
  console.error('fetch-llama-runtime failed:', e.message);
  process.exit(1);
});
