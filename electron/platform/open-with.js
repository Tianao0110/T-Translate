// "Open with T-Translate" argv parsing. The Explorer context menu launches
// the exe with the file path as an argument; a running instance receives the
// same argv via second-instance. Both paths funnel through here.
//
// Only the extensions the context menu registers (installer/installer.nsh)
// are accepted — this is also what keeps dev-mode argv noise (electron.exe,
// main.js, --flags) from ever being mistaken for a document.

const fs = require('fs');
const path = require('path');

const OPENABLE_EXTENSIONS = new Set(['.pdf', '.docx', '.txt']);

// Returns the first existing, supported file in argv, or null.
// `exists` is injectable for tests.
function extractOpenableFile(argv, exists = fs.existsSync) {
  if (!Array.isArray(argv)) return null;

  for (const arg of argv) {
    if (typeof arg !== 'string' || !arg || arg.startsWith('-')) continue;
    const ext = path.extname(arg).toLowerCase();
    if (!OPENABLE_EXTENSIONS.has(ext)) continue;
    try {
      if (exists(arg)) return arg;
    } catch { /* unreadable path — skip */ }
  }

  return null;
}

module.exports = { extractOpenableFile, OPENABLE_EXTENSIONS };
