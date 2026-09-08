// koffi loading of the pinned llama.cpp DLLs. Every call here is a
// synchronous FFI call: this module belongs on the runtime worker_thread
// (runtime/worker.js), never on a thread that also services JS callbacks
// during an .async call. Knows nothing about models or prompts — that is
// llama-session.js.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ABI = require('./llama-abi');
const MANIFEST = require('./llama-manifest.json');

// OpenMP first (the CPU variants import it), then ggml-base, the backend
// registry, llama, mtmd. SetDllDirectoryW lets the registry's own
// LoadLibrary calls find the backend DLLs next to these.
const LOAD_ORDER = [
  ['libomp', 'libomp.dll'],
  ['ggmlBase', 'ggml-base.dll'],
  ['ggml', 'ggml.dll'],
  ['llama', 'llama.dll'],
  ['mtmd', 'mtmd.dll'],
];

const DEV_TYPE_NAMES = Object.fromEntries(Object.entries(ABI.ENUMS.DEV_TYPE).map(([k, v]) => [v, k.toLowerCase()]));

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

// The load probe: every manifest file present with the pinned size and hash.
// Hashing the set costs ~150 ms once per host start.
function verifyRuntime(dir, manifest = MANIFEST) {
  const missing = [];
  const mismatched = [];
  for (const f of manifest.files) {
    const p = path.join(dir, f.name);
    if (!fs.existsSync(p)) {
      missing.push(f.name);
      continue;
    }
    const buf = fs.readFileSync(p);
    if (buf.length !== f.size || sha256(buf) !== f.sha256) mismatched.push(f.name);
  }
  return { ok: missing.length === 0 && mismatched.length === 0, build: manifest.build, missing, mismatched };
}

// koffi struct and callback types are process-global and cannot be
// redefined, so a second loadRuntime in the same process reuses them.
const typesByKoffi = new WeakMap();
function defineStructs(koffi) {
  let defined = typesByKoffi.get(koffi);
  if (defined) return defined.structs;
  const structs = {};
  for (const [name, fields] of Object.entries(ABI.STRUCTS)) {
    structs[name] = koffi.struct(name, fields);
    const size = koffi.sizeof(structs[name]);
    if (size !== ABI.SIZES[name]) {
      throw fail('LLAMA_ABI_SIZE', `${name} is ${size} bytes, ABI says ${ABI.SIZES[name]}`);
    }
  }
  const callbacks = {};
  for (const [name, proto] of Object.entries(ABI.CALLBACKS)) callbacks[name] = koffi.proto(proto);
  defined = { structs, callbacks };
  typesByKoffi.set(koffi, defined);
  return structs;
}

function loadRuntime(dir, { koffi = require('koffi'), verify = true } = {}) {
  if (verify) {
    const v = verifyRuntime(dir);
    if (!v.ok) {
      throw fail('LLAMA_RUNTIME_INVALID', `runtime ${v.build} at ${dir}: missing [${v.missing.join(', ')}] mismatched [${v.mismatched.join(', ')}]`);
    }
  }
  const structs = defineStructs(koffi);

  const kernel32 = koffi.load('kernel32.dll');
  if (!kernel32.func('bool __stdcall SetDllDirectoryW(const char16_t *path)')(dir)) {
    throw fail('LLAMA_RUNTIME_INVALID', 'SetDllDirectoryW failed');
  }
  const libs = {};
  for (const [key, file] of LOAD_ORDER) {
    try {
      libs[key] = koffi.load(path.join(dir, file));
    } catch (e) {
      throw fail('LLAMA_RUNTIME_INVALID', `${file}: ${e.message}`);
    }
  }

  // Bind from the declared DLL first; a symbol that moved between DLLs on
  // a re-pin is still found, and the ABI test reports where it went.
  const order = ['ggml', 'ggmlBase', 'llama', 'mtmd'];
  const f = {};
  const homes = {};
  for (const [lib, protos] of Object.entries(ABI.FUNCS)) {
    for (const [key, proto] of Object.entries(protos)) {
      let bound = null;
      for (const cand of [lib, ...order.filter((o) => o !== lib)]) {
        try {
          bound = libs[cand].func(proto);
          homes[key] = cand;
          break;
        } catch {
          // not exported here
        }
      }
      if (!bound) throw fail('LLAMA_ABI_SYMBOL', `not exported by any runtime DLL: ${proto}`);
      f[key] = bound;
    }
  }

  const types = typesByKoffi.get(koffi).callbacks;

  // Registered callbacks must outlive every native call that may invoke
  // them; keep them for the life of the process.
  const keep = [];
  const register = (proto, fn) => {
    const cb = koffi.register(fn, koffi.pointer(proto));
    keep.push(cb);
    return cb;
  };

  let backendsLoaded = false;
  function loadBackends() {
    if (backendsLoaded) return;
    f.loadAll(dir);
    f.backendInit();
    backendsLoaded = true;
  }

  function devices() {
    loadBackends();
    const out = [];
    const n = Number(f.devCount());
    for (let i = 0; i < n; i++) {
      const dev = f.devGet(i);
      const free = [0n];
      const total = [0n];
      f.devMemory(dev, free, total);
      const type = f.devType(dev);
      out.push({
        index: i,
        handle: dev,
        name: f.devName(dev),
        description: (f.devDesc(dev) || '').trim(),
        type,
        typeName: DEV_TYPE_NAMES[type] || String(type),
        memory: { free: Number(free[0]), total: Number(total[0]) },
      });
    }
    return out;
  }

  // Level filter keeps ggml's per-tensor chatter out; CONT lines belong to
  // whatever preceded them, so they pass whenever the previous line did.
  function onLog(fn, minLevel = ABI.ENUMS.LOG_LEVEL.WARN) {
    let passing = false;
    const cb = register(types.LogCb, (level, text) => {
      if (level === ABI.ENUMS.LOG_LEVEL.CONT) {
        if (passing) fn(level, text);
        return;
      }
      passing = level >= minLevel;
      if (passing) fn(level, text);
    });
    f.logSet(cb, null);
  }

  return {
    dir,
    build: MANIFEST.build,
    koffi,
    f,
    structs,
    types,
    homes,
    register,
    loadBackends,
    devices,
    version: () => f.version(),
    systemInfo: () => f.systemInfo(),
    supportsGpuOffload: () => {
      loadBackends();
      return !!f.supportsGpuOffload();
    },
    onLog,
  };
}

module.exports = { verifyRuntime, loadRuntime, defineStructs, LOAD_ORDER };
