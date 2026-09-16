// Shared harness for the Electron-driven smokes and benches: argv reading,
// the PASS / FAIL checklist, a throwaway userData + models sandbox, hard-link
// or copy of model files into it, a fake electron-store, and the runner that
// turns the checklist into the exit code. Node-only smokes use worker-driver.
/* eslint-disable no-console */

const path = require('path');
const fs = require('fs');
const os = require('os');

const REPO = path.resolve(__dirname, '..', '..');
const LLAMA_RUNTIME_DIR = path.join(REPO, 'resources', 'llama');
const VISION_HEALTH_IMAGE = path.join(REPO, 'electron', 'tengine', 'runtime', 'assets', 'vision-health.png');

function arg(name, def = null) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : def;
}
const has = (name) => process.argv.includes(name);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Polls until pred() is true; false when the tries run out.
async function waitFor(pred, { tries = 200, everyMs = 100 } = {}) {
  for (let i = 0; i < tries; i++) {
    if (pred()) return true;
    await sleep(everyMs);
  }
  return pred();
}

function checklist() {
  const results = [];
  function step(label, ok, detail = '') {
    results.push({ label, ok: !!ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
  }
  const failed = () => results.filter((r) => !r.ok).length;
  // Prints the tally and returns the failure count (the exit code for run()).
  function summary() {
    const f = failed();
    console.log(`\n==== ${results.length - f}/${results.length} passed ====`);
    return f;
  }
  return { step, failed, summary, results };
}

// Fresh userData and models root under the temp dir. Call before requiring
// any main-process module: state.js freezes the store path on load.
function sandbox(name) {
  const { app } = require('electron');
  const dir = path.join(os.tmpdir(), name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  app.setPath('userData', dir);
  process.env.TT_MODELS_ROOT = path.join(dir, 'models');
  return {
    dir,
    // Chromium keeps session files open until exit, so a failed rm is not a
    // test failure: the next run's rmSync gets them.
    cleanup() {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch (e) {
        console.log(`sandbox kept (${e.code || e.message}): ${dir}`);
      }
    },
  };
}

// Hard link when the sandbox shares a volume with the source, else a real
// copy (removed again with the sandbox).
function place(dir, src, name = path.basename(src)) {
  const dst = path.join(dir, name);
  try {
    fs.linkSync(src, dst);
  } catch {
    console.log(`copying ${path.basename(src)} into the sandbox (${Math.round(fs.statSync(src).size / 1048576)} MB, no hard link across drives)`);
    fs.copyFileSync(src, dst);
  }
  return dst;
}

function fakeStore(seed = {}) {
  const data = { ...seed };
  return {
    get: (k, d) => (k in data ? data[k] : d),
    set: (k, v) => {
      data[k] = v;
    },
    onDidChange: () => () => {},
  };
}

// Runs main once Electron is ready. main resolves to the exit code (the
// checklist's failure count, or 2 for a usage error); a throw exits 1.
function run(main) {
  const { app } = require('electron');
  app.on('window-all-closed', () => {});
  app.whenReady().then(() => main()).then(
    (code) => app.exit(Number(code) || 0),
    (e) => {
      console.error('smoke failed:', e && e.stack ? e.stack : e);
      app.exit(1);
    },
  );
}

module.exports = { REPO, LLAMA_RUNTIME_DIR, VISION_HEALTH_IMAGE, arg, has, sleep, waitFor, checklist, sandbox, place, fakeStore, run };
