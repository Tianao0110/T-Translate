// Puts the GPU-capable sherpa-onnx runtime in place of the npm package's
// CPU-only DLLs (Windows x64). Runs on postinstall and before packaging.
//
// What it lays over node_modules/sherpa-onnx-win-x64/:
//   sherpa-onnx-c-api.dll, sherpa-onnx-cxx-api.dll
//       — from native/sherpa-onnx-webgpu/bin: sherpa-onnx v1.13.7 built with
//         the `webgpu` provider patch (recipe in that folder's README)
//   onnxruntime.dll, dxcompiler.dll, dxil.dll
//       — from onnxruntime-node: the only prebuilt ORT with the WebGPU EP
//         (official NuGet/GitHub builds do not carry it)
//
// Why an overlay and not a fork of the npm package: the addon (.node) stays
// upstream's; only the C-API DLL it links and the ORT it loads change. The
// addon resolves both next to itself, which is why the copies must sit in
// the sherpa package directory rather than on PATH. Idempotent by sha256.
//
//   node scripts/overlay-sherpa-runtime.js           apply
//   node scripts/overlay-sherpa-runtime.js --check   report only, exit 1 if stale
//   node scripts/overlay-sherpa-runtime.js --restore put the npm originals back
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const TARGET = path.join(ROOT, 'node_modules', 'sherpa-onnx-win-x64');
const NATIVE = path.join(ROOT, 'native', 'sherpa-onnx-webgpu', 'bin');
const ORT_NODE = path.join(ROOT, 'node_modules', 'onnxruntime-node', 'bin', 'napi-v6', 'win32', 'x64');
const BACKUP = path.join(TARGET, '.npm-original');

// Versions the overlay was built against. A different addon or ORT means
// the DLLs must be rebuilt, not copied.
const EXPECTED = { 'sherpa-onnx-node': '1.13.7', 'onnxruntime-node': '1.26.0' };

const SOURCES = [
  { name: 'sherpa-onnx-c-api.dll', from: NATIVE },
  { name: 'sherpa-onnx-cxx-api.dll', from: NATIVE },
  { name: 'onnxruntime.dll', from: ORT_NODE },
  { name: 'dxcompiler.dll', from: ORT_NODE },
  { name: 'dxil.dll', from: ORT_NODE },
];

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const same = (a, b) => fs.existsSync(a) && fs.existsSync(b) && sha256(a) === sha256(b);

function versionOf(pkg) {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', pkg, 'package.json'), 'utf8')).version;
  } catch {
    return null;
  }
}

function main() {
  const mode = process.argv.includes('--restore') ? 'restore' : process.argv.includes('--check') ? 'check' : 'apply';
  if (process.platform !== 'win32') {
    console.log('overlay-sherpa-runtime: Windows only, nothing to do');
    return 0;
  }
  if (!fs.existsSync(TARGET)) {
    console.log('overlay-sherpa-runtime: sherpa-onnx-win-x64 not installed, nothing to do');
    return 0;
  }

  if (mode === 'restore') {
    if (!fs.existsSync(BACKUP)) {
      console.log('overlay-sherpa-runtime: no backup, package is already original');
      return 0;
    }
    for (const f of fs.readdirSync(BACKUP)) fs.copyFileSync(path.join(BACKUP, f), path.join(TARGET, f));
    for (const s of SOURCES) {
      if (!fs.existsSync(path.join(BACKUP, s.name))) fs.rmSync(path.join(TARGET, s.name), { force: true });
    }
    fs.rmSync(BACKUP, { recursive: true, force: true });
    console.log('overlay-sherpa-runtime: restored the npm originals');
    return 0;
  }

  for (const [pkg, want] of Object.entries(EXPECTED)) {
    const have = versionOf(pkg);
    if (have !== want) {
      console.error(`overlay-sherpa-runtime: ${pkg} is ${have}, the overlay was built for ${want} — rebuild native/sherpa-onnx-webgpu first`);
      return 1;
    }
  }
  for (const s of SOURCES) {
    if (!fs.existsSync(path.join(s.from, s.name))) {
      console.error(`overlay-sherpa-runtime: missing ${path.join(s.from, s.name)}`);
      return 1;
    }
  }

  const stale = SOURCES.filter((s) => !same(path.join(s.from, s.name), path.join(TARGET, s.name)));
  if (mode === 'check') {
    console.log(stale.length ? `overlay-sherpa-runtime: stale — ${stale.map((s) => s.name).join(', ')}` : 'overlay-sherpa-runtime: up to date');
    return stale.length ? 1 : 0;
  }
  if (!stale.length) {
    console.log('overlay-sherpa-runtime: up to date');
    return 0;
  }

  // Keep the untouched originals once, so --restore and a clean diff are
  // always possible without reinstalling.
  if (!fs.existsSync(BACKUP)) {
    fs.mkdirSync(BACKUP);
    for (const s of SOURCES) {
      const orig = path.join(TARGET, s.name);
      if (fs.existsSync(orig)) fs.copyFileSync(orig, path.join(BACKUP, s.name));
    }
  }
  for (const s of stale) fs.copyFileSync(path.join(s.from, s.name), path.join(TARGET, s.name));
  console.log(`overlay-sherpa-runtime: applied ${stale.map((s) => s.name).join(', ')}`);
  return 0;
}

process.exitCode = main();
