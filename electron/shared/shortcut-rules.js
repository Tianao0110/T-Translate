// Global-shortcut binding rules, shared by the shortcuts IPC (reject on update)
// and startup registration (heal already-persisted bindings).
//
// A binding without a strong modifier (bare Backspace / Space / a letter…)
// registers fine with the OS but then swallows that key system-wide while the
// app runs. Shift alone is not enough: Shift+letter still hijacks typing.

// Both renderer format (Ctrl/Meta) and Electron accelerator aliases, so a
// hand-edited config in either spelling is judged the same way.
const STRONG_MODIFIERS = [
  'Ctrl', 'Control', 'CommandOrControl', 'CmdOrCtrl', 'Command', 'Cmd',
  'Meta', 'Super', 'Alt', 'AltGr', 'Option',
];

// F1-F24 have no typing role, so they are safe to bind without a modifier.
const F_KEY_RE = /^F([1-9]|1[0-9]|2[0-4])$/;

function isAllowedGlobalShortcut(shortcut) {
  if (typeof shortcut !== 'string') return false;

  const parts = shortcut.split('+').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return false;

  const isModifier = (p) => p === 'Shift' || STRONG_MODIFIERS.includes(p);
  const keys = parts.filter((p) => !isModifier(p));
  if (keys.length !== 1) return false;

  return parts.some((p) => STRONG_MODIFIERS.includes(p)) || F_KEY_RE.test(keys[0]);
}

module.exports = { isAllowedGlobalShortcut, F_KEY_RE };
