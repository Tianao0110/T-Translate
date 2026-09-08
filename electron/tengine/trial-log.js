// Trial logs for models outside the whitelist (docs/T-ENGINE.md §5, "试模型
// 模式"): one file per model per month under data\logs, richer than the
// metrics log (probe steps with their raw errors, every request's shape),
// optionally with prompt and output text when the developer switch is on.
// Files older than two months are deleted when the host starts; a model
// that makes the whitelist stops writing. Secure mode writes nothing.

const nodeFs = require('fs');
const nodePath = require('path');

const MAX_AGE_DAYS = 61;
const DAY_MS = 24 * 60 * 60 * 1000;

function safeStem(modelFile) {
  return String(modelFile)
    .replace(/\.gguf$/i, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .slice(0, 80);
}

function monthStamp(now) {
  return new Date(now()).toISOString().slice(0, 7);
}

function trialFileName(modelFile, now) {
  return `tengine-trial-${safeStem(modelFile)}-${monthStamp(now)}.jsonl`;
}

function pruneTrialLogs({ dir, now = Date.now, maxAgeDays = MAX_AGE_DAYS, fs = nodeFs, path = nodePath } = {}) {
  const removed = [];
  let names;
  try {
    names = fs.readdirSync(dir).filter((f) => f.startsWith('tengine-trial-') && f.endsWith('.jsonl'));
  } catch {
    return removed;
  }
  const cutoff = now() - maxAgeDays * DAY_MS;
  for (const name of names) {
    const p = path.join(dir, name);
    try {
      if (fs.statSync(p).mtimeMs < cutoff) {
        fs.unlinkSync(p);
        removed.push(name);
      }
    } catch {
      // gone already
    }
  }
  return removed;
}

function createTrialLog({ dir, modelFile, now = Date.now, isSecure = () => false, logText = () => false, fs = nodeFs, path = nodePath, logger = null } = {}) {
  function target() {
    return path.join(dir, trialFileName(modelFile, now));
  }

  // record: { kind, ...numbers, text?: { prompt, output } } — the text
  // block is dropped unless the developer switch is on.
  function write(record) {
    if (isSecure()) return false;
    const { text, ...rest } = record;
    const line = { at: now(), model: modelFile, ...rest };
    if (text && logText()) line.text = text;
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(target(), `${JSON.stringify(line)}\n`);
      return true;
    } catch (e) {
      logger?.warn?.(`trial log write failed: ${e.message}`);
      return false;
    }
  }

  return { write, path: target, modelFile };
}

// The trial report: every line of that model's files folded into counts and
// averages, the same shape the settings page shows and the JSON it saves.
function summarizeTrialLogs({ dir, modelFile, fs = nodeFs, path = nodePath } = {}) {
  const stem = `tengine-trial-${safeStem(modelFile)}-`;
  let names;
  try {
    names = fs.readdirSync(dir).filter((f) => f.startsWith(stem) && f.endsWith('.jsonl')).sort();
  } catch {
    names = [];
  }
  const s = {
    model: modelFile,
    files: names,
    loads: 0,
    loadFailures: 0,
    requests: 0,
    failures: 0,
    stalls: 0,
    cancels: 0,
    empty: 0,
    loops: 0,
    noEog: 0,
    thinkLeaks: 0,
    tokPerSecAvg: null,
    firstMsAvg: null,
    rssPeak: 0,
    probes: 0,
    lastProbeVerdict: null,
    firstAt: null,
    lastAt: null,
  };
  let tokSum = 0;
  let tokN = 0;
  let firstSum = 0;
  let firstN = 0;
  for (const name of names) {
    let lines;
    try {
      lines = fs.readFileSync(path.join(dir, name), 'utf8').split('\n');
    } catch {
      continue;
    }
    for (const raw of lines) {
      if (!raw.trim()) continue;
      let r;
      try {
        r = JSON.parse(raw);
      } catch {
        continue;
      }
      if (r.at) {
        if (!s.firstAt || r.at < s.firstAt) s.firstAt = r.at;
        if (!s.lastAt || r.at > s.lastAt) s.lastAt = r.at;
      }
      if (r.rss && r.rss > s.rssPeak) s.rssPeak = r.rss;
      switch (r.kind) {
        case 'model-loaded':
          s.loads++;
          break;
        case 'model-load-failed':
          s.loadFailures++;
          break;
        case 'request':
          s.requests++;
          if (r.stop === 'stall') s.stalls++;
          if (r.stop === 'cancel') s.cancels++;
          if (r.stop === 'loop') s.loops++;
          if (r.stop === 'limit') s.noEog++;
          if (!r.genTokens) s.empty++;
          if (r.thinkLeak) s.thinkLeaks += r.thinkLeak;
          if (typeof r.tokPerSec === 'number') {
            tokSum += r.tokPerSec;
            tokN++;
          }
          if (typeof r.firstMs === 'number') {
            firstSum += r.firstMs;
            firstN++;
          }
          break;
        case 'request-failed':
          s.failures++;
          break;
        case 'probe':
          s.probes++;
          s.lastProbeVerdict = r.verdict || null;
          break;
        default:
          break;
      }
    }
  }
  if (tokN) s.tokPerSecAvg = Math.round((tokSum / tokN) * 10) / 10;
  if (firstN) s.firstMsAvg = Math.round(firstSum / firstN);
  return s;
}

module.exports = { createTrialLog, pruneTrialLogs, summarizeTrialLogs, trialFileName, safeStem, MAX_AGE_DAYS };
