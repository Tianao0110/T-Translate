// The LLM model folder (<models>/llm-models). Nothing is downloaded here:
// the user follows the link, drops the file in, and this scanner decides
// what the file is. A whitelisted name with the pinned size is hashed (a
// few seconds per 2 GB, cached by size + mtime) and only a matching hash
// makes the pack "ready"; anything else is listed as unlisted and stays
// unusable unless the developer door is open. Never loads a file from
// outside this folder.

const nodeFs = require('fs');
const nodePath = require('path');
const crypto = require('crypto');
const { LLM_PACKS, packForFile, packByHash, defaultPack } = require('../shared/llm-packs');

const CACHE_FILE = '.tt-hashes.json';

function hashFile(fs, file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file)
      .on('data', (d) => h.update(d))
      .on('error', reject)
      .on('end', () => resolve(h.digest('hex')));
  });
}

function createLlmPackManager({ dir, packs = LLM_PACKS, allowUnlisted = () => false, fs = nodeFs, path = nodePath, now = Date.now, logger = null } = {}) {
  let last = null; // last scan result
  let scanning = null; // in-flight scan promise
  const cachePath = () => path.join(dir, CACHE_FILE);

  function readCache() {
    try {
      return JSON.parse(fs.readFileSync(cachePath(), 'utf8')) || {};
    } catch {
      return {};
    }
  }

  function writeCache(cache) {
    try {
      fs.writeFileSync(cachePath(), JSON.stringify(cache, null, 2));
    } catch (e) {
      logger?.warn?.(`hash cache not written: ${e.message}`);
    }
  }

  function ensureDir() {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (e) {
      logger?.warn?.(`model folder not created: ${e.message}`);
    }
    return dir;
  }

  async function sha256Of(name, size, mtimeMs, cache) {
    const hit = cache[name];
    if (hit && hit.size === size && hit.mtimeMs === mtimeMs && /^[0-9a-f]{64}$/.test(hit.sha256 || '')) return hit.sha256;
    const sha = await hashFile(fs, path.join(dir, name));
    cache[name] = { size, mtimeMs, sha256: sha };
    return sha;
  }

  async function doScan() {
    ensureDir();
    const cache = readCache();
    let cacheDirty = false;
    let names = [];
    try {
      names = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.gguf'));
    } catch (e) {
      logger?.warn?.(`model folder unreadable: ${e.message}`);
    }
    const found = new Map(); // pack id -> row
    const unlisted = [];
    for (const name of names) {
      let st;
      try {
        st = fs.statSync(path.join(dir, name));
      } catch {
        continue;
      }
      const entry = { file: name, path: path.join(dir, name), size: st.size, mtimeMs: st.mtimeMs };
      const candidate = packs.find((p) => p.file === name && p.size === st.size) || packForFile(name, st.size);
      if (!candidate || !packs.includes(candidate)) {
        unlisted.push(entry);
        continue;
      }
      const before = cache[name];
      let sha;
      try {
        sha = await sha256Of(name, st.size, st.mtimeMs, cache);
      } catch (e) {
        logger?.warn?.(`hash failed for ${name}: ${e.message}`);
        unlisted.push({ ...entry, error: e.message });
        continue;
      }
      if (cache[name] !== before) cacheDirty = true;
      const pack = packs.find((p) => p.sha256 === sha) || packByHash(sha);
      if (pack && pack.id === candidate.id) {
        found.set(pack.id, { ...entry, packId: pack.id, status: 'ready', sha256: sha });
      } else {
        // Right name and size, different bytes: refuse, and say so.
        found.set(candidate.id, { ...entry, packId: candidate.id, status: 'mismatch', sha256: sha });
      }
    }
    if (cacheDirty) writeCache(cache);
    const rows = packs.map((p) => {
      const f = found.get(p.id);
      return {
        id: p.id,
        role: p.role,
        default: !!p.default,
        name: p.name,
        vendor: p.vendor,
        file: p.file,
        size: p.size,
        license: p.license,
        source: p.source,
        minRamGb: p.minRamGb,
        status: f ? f.status : 'missing',
        path: f ? f.path : null,
      };
    });
    last = { dir, scannedAt: now(), packs: rows, unlisted, allowUnlisted: !!allowUnlisted() };
    return last;
  }

  function scan() {
    if (!scanning) {
      scanning = doScan().finally(() => {
        scanning = null;
      });
    }
    return scanning;
  }

  function resolvePack(packId) {
    if (!last) return null;
    const row = last.packs.find((p) => p.id === packId);
    if (!row || row.status !== 'ready') return null;
    const pack = packs.find((p) => p.id === packId);
    return { pack, path: row.path, trial: false };
  }

  function resolveDefault() {
    const d = packs.find((p) => p.default) || defaultPack();
    return d ? resolvePack(d.id) : null;
  }

  // A file outside the whitelist, by bare name, only while the developer
  // door is open and only from inside the folder.
  function resolveUnlisted(fileName) {
    if (!allowUnlisted() || !last) return null;
    const name = path.basename(String(fileName || ''));
    const row = last.unlisted.find((u) => u.file === name);
    return row ? { pack: null, path: row.path, trial: true } : null;
  }

  return {
    dir: () => dir,
    ensureDir,
    scan,
    scanning: () => !!scanning,
    status: () => last,
    resolvePack,
    resolveDefault,
    resolveUnlisted,
  };
}

module.exports = { createLlmPackManager, hashFile, CACHE_FILE };
