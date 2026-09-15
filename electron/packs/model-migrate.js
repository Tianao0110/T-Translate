// Moves model packs a pre-v0.4.0 build left in userData into the active models
// root (the install directory since v0.4.0). Copy, size-check, then delete:
// the old copy is removed only once every byte of a pack has landed, so a
// failure mid-way leaves the user with what they had. Dependency-injected so
// the unit test runs on temp directories with no Electron around.

const nodeFs = require('fs');
const nodePath = require('path');

const FAMILIES = ['ocr-models', 'asr-models', 'tts-models'];

function isDir(fs, p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function dirBytes(fs, path, dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) total += dirBytes(fs, path, p);
    else if (entry.isFile()) total += fs.statSync(p).size;
  }
  return total;
}

// A pack is a directory carrying pack.json; anything else under a family
// folder (half-written downloads, stray files) is left where it is.
function packDirs(fs, path, familyDir) {
  if (!isDir(fs, familyDir)) return [];
  return fs
    .readdirSync(familyDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(familyDir, e.name, 'pack.json')))
    .map((e) => e.name)
    .sort();
}

// What the legacy root still holds. Synchronous: a handful of stat calls.
function scanLegacy({ legacyRoot, activeRoot, families = FAMILIES, fs = nodeFs, path = nodePath }) {
  const packs = [];
  if (!legacyRoot || !activeRoot || path.resolve(legacyRoot) === path.resolve(activeRoot)) {
    return { packs, bytes: 0 };
  }
  for (const family of families) {
    const familyDir = path.join(legacyRoot, family);
    for (const name of packDirs(fs, path, familyDir)) {
      const dir = path.join(familyDir, name);
      packs.push({
        family,
        name,
        dir,
        bytes: dirBytes(fs, path, dir),
        // Already present in the active root (downloaded again after the
        // move): the legacy copy is only removed, never copied over.
        duplicate: isDir(fs, path.join(activeRoot, family, name)),
      });
    }
  }
  return { packs, bytes: packs.reduce((n, p) => n + p.bytes, 0) };
}

async function copyTree(fsp, path, copyFile, src, dst, onBytes) {
  await fsp.mkdir(dst, { recursive: true });
  for (const entry of await fsp.readdir(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      await copyTree(fsp, path, copyFile, from, to, onBytes);
    } else if (entry.isFile()) {
      await copyFile(from, to);
      onBytes((await fsp.stat(from)).size);
    }
  }
}

async function removeIfEmpty(fsp, dir) {
  try {
    if ((await fsp.readdir(dir)).length === 0) await fsp.rmdir(dir);
  } catch {
    // not there, or not empty — either way nothing to do
  }
}

// Moves every legacy pack. Progress is reported in bytes across the whole
// job so one bar covers OCR, listen and voice packs alike. Throws on the first
// pack that cannot be copied, after discarding its partial target.
async function migrateLegacy({
  legacyRoot,
  activeRoot,
  families = FAMILIES,
  onProgress = () => {},
  fs = nodeFs,
  path = nodePath,
  copyFile = (from, to) => nodeFs.promises.copyFile(from, to),
}) {
  const fsp = fs.promises;
  const { packs, bytes: total } = scanLegacy({ legacyRoot, activeRoot, families, fs, path });
  let done = 0;
  let moved = 0;
  let removed = 0;
  const report = (name) => onProgress({ done, total, pack: name });

  for (const pack of packs) {
    const dst = path.join(activeRoot, pack.family, pack.name);
    if (pack.duplicate) {
      await fsp.rm(pack.dir, { recursive: true, force: true });
      done += pack.bytes;
      removed++;
      report(pack.name);
      continue;
    }
    try {
      await copyTree(fsp, path, copyFile, pack.dir, dst, (n) => {
        done += n;
        report(pack.name);
      });
      const landed = dirBytes(fs, path, dst);
      if (landed !== pack.bytes) throw new Error(`size mismatch for ${pack.name}: ${landed} != ${pack.bytes}`);
    } catch (e) {
      await fsp.rm(dst, { recursive: true, force: true }).catch(() => {});
      throw e;
    }
    await fsp.rm(pack.dir, { recursive: true, force: true });
    moved++;
    report(pack.name);
  }

  for (const family of families) await removeIfEmpty(fsp, path.join(legacyRoot, family));
  return { moved, removed, bytes: done };
}

module.exports = { FAMILIES, scanLegacy, migrateLegacy };
