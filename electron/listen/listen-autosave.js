// Auto-saved subtitle files for listen mode: one .srt per session end in
// <data>\listen, named after the program that was captured and the local
// time, the newest MAX_FILES kept. The privacy gate (secure mode) and the
// user's switch live in the IPC handler; this module only files what it is
// given, so it can be exercised against a temp directory.
const fs = require('fs');
const path = require('path');

const MAX_FILES = 20;
const MAX_NAME = 40;

// Process image name -> file-name-safe stem: no extension, none of the
// characters Windows refuses in a name (or control characters), no
// leading/trailing dots or spaces.
function safeName(name) {
  const stem = String(name || '')
    .replace(/\.[A-Za-z0-9]{1,4}$/, '')
    .replace(/[<>:"/\\|?*]+|\p{Cc}+/gu, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.-]+|[\s.-]+$/g, '')
    .slice(0, MAX_NAME);
  return stem || 'system';
}

function stamp(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function createListenAutosave({ dir, maxFiles = MAX_FILES, now = () => new Date() }) {
  function listFiles() {
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch {
      return [];
    }
    return names
      .filter((n) => n.toLowerCase().endsWith('.srt'))
      .map((n) => {
        const p = path.join(dir, n);
        try {
          return { path: p, mtimeMs: fs.statSync(p).mtimeMs };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
  }

  // Newest first; anything past the cap goes.
  function prune() {
    const removed = [];
    for (const f of listFiles().slice(maxFiles)) {
      try {
        fs.unlinkSync(f.path);
        removed.push(f.path);
      } catch {
        // already gone
      }
    }
    return removed;
  }

  function save(content, sourceName) {
    fs.mkdirSync(dir, { recursive: true });
    const base = `${safeName(sourceName)}-${stamp(now())}`;
    let file = path.join(dir, `${base}.srt`);
    for (let n = 2; fs.existsSync(file); n++) file = path.join(dir, `${base}-${n}.srt`);
    fs.writeFileSync(file, content, 'utf8');
    prune();
    return file;
  }

  return { dir, save, prune, listFiles };
}

module.exports = { createListenAutosave, safeName, MAX_FILES };
