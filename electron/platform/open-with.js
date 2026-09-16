// "Open with T-Translate" argv parsing (cold start and second-instance).
// Only the extensions installer/installer.nsh registers are accepted.

const fs = require('fs');
const path = require('path');

const OPENABLE_EXTENSIONS = new Set(['.pdf', '.docx', '.txt']);

// The first existing, supported file in argv, or null; `exists` is injectable.
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

module.exports = { extractOpenableFile, };
