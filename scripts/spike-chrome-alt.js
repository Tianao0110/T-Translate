// PHASE 0.5 SPIKE — Chrome Alt+drag verification
//
// One-shot disposable spike. Delete after the matrix below is filled in.
//
// === Goal ===
// Before implementing the v0.2.4 hotkey, confirm three things:
//   1. uIOhook can see Alt key and mouse events while Chrome is focused
//   2. Chrome itself doesn't intercept or break Alt+drag selection
//      (this is the critical case — D2L is the main scenario)
//   3. Event order is sane (mousedown → mouseup, altHeld stays consistent)
//
// === How to run ===
//   In git bash:
//     cd F:/T-Translate
//     npx electron scripts/spike-chrome-alt.js
//   Stop with Ctrl+C.
//
// === ⚠️ Before running ===
// If T-Translate main app is running (selection translator on), quit it
// from the system tray first. Two uIOhook instances will conflict.
//
// === Manual test steps ===
//   1. Wait for "uIOhook started successfully"
//   2. Switch to Chrome on a page with English text (Wikipedia, D2L, news)
//   3. Hold LEFT Alt
//   4. Drag-select a word with the left mouse button
//   5. Release the mouse
//   6. Release Alt
//   7. Watch both:
//      (a) this terminal: should see KEYDOWN/MOUSEDOWN/MOUSEUP/KEYUP
//      (b) Chrome itself: nothing odd should happen (no save-link dialog,
//          no menu activation, no weird rectangle selection)
//
// === Required scenarios ===
//   A) Plain Wikipedia paragraph × 3
//   B) Text inside an <a href> link × 3
//   C) Text next to an image × 3
//   D) D2L assignment page × 3 (any English ed-site if D2L isn't available)
//   E) Edge browser × ~3
//
// === Sample successful run ===
//   12:34:56.789 KEYDOWN LeftAlt (keycode=56) altHeld=true
//   12:34:57.012 MOUSEDOWN at (450, 320) altHeld=true
//   12:34:57.234 MOUSEUP at (520, 320) altHeld=true (was true at down) samealt=true
//                 ↑ HOTKEY PATH WOULD TRIGGER (altHeld both at down and up)
//   12:34:57.456 KEYUP LeftAlt (keycode=56) altHeld=false
//
// === Decision matrix ===
//
//   ✓ PASS:    Plain text + links + images + D2L all behave; events look right.
//              → Proceed with the v3 design doc plan (Phase 0 → Phase 1).
//
//   ⚠ PARTIAL: Plain text OK, but Chrome misbehaves near links/images.
//              → Hotkey is still viable; document in CHANGELOG that hotkey
//                works best in plain-text regions.
//
//   ✗ FAIL:    Even plain text misbehaves, or no events show up in the terminal.
//              → Hotkey is dead in the main scenario. Fall back to T2 in the
//                design doc: Ctrl+Alt or user-configurable modifier.
//
// =====================================================================

const { app } = require('electron');

// Load uiohook-napi. If this throws, the native binding is bad.
let uIOhook;
try {
  ({ uIOhook } = require('uiohook-napi'));
} catch (err) {
  console.error('FATAL: cannot load uiohook-napi');
  console.error(err);
  console.error('');
  console.error('If you see "module compiled against different Node version":');
  console.error('  cd F:/T-Translate');
  console.error('  npx electron-rebuild -f -w uiohook-napi');
  console.error('Or:');
  console.error('  npm rebuild uiohook-napi --runtime=electron --target=$(npx electron -v | tr -d v)');
  process.exit(1);
}

// Win32 keycodes (as remapped by uiohook-napi)
//   Left Alt:  56  (0x38)
//   Right Alt: 312 (0x138) — aka AltGr on international keyboards
const VK_LALT = 56;
const VK_RALT = 312;

// Spike tracks Alt with keydown/keyup state. Production will use
// GetAsyncKeyState via koffi, but if uIOhook can't see these events at all,
// GetAsyncKeyState wouldn't help — same hook layer, different Win32 API.
let altHeld = false;
let mouseDownAltState = false;
let eventCount = 0;

const ts = () => new Date().toISOString().slice(11, 23);
const log = (msg) => {
  console.log(`${ts()} ${msg}`);
  eventCount++;
};

app.whenReady().then(() => {
  console.log('====================================================================');
  console.log('  Phase 0.5 SPIKE -- Chrome Alt+drag verification');
  console.log('====================================================================');
  console.log('');
  console.log('  Make sure T-Translate main app is QUIT (avoid uIOhook conflict)');
  console.log('');
  console.log('  Now: switch to Chrome -> HOLD Alt -> drag-select text -> release');
  console.log('  Watch BOTH this terminal AND Chrome itself.');
  console.log('  Ctrl+C to stop.');
  console.log('');
  console.log('====================================================================');
  console.log('');

  uIOhook.on('keydown', (e) => {
    if (e.keycode === VK_LALT) {
      // Only log the FIRST keydown of a hold session, not the OS auto-repeat
      // (Windows fires keydown every ~30ms while a key is held -- super noisy.
      //  Production code uses GetAsyncKeyState polling which doesn't see this.)
      if (!altHeld) {
        altHeld = true;
        log(`KEYDOWN LeftAlt (keycode=${e.keycode}) altHeld=true`);
      }
    } else if (e.keycode === VK_RALT) {
      log(`KEYDOWN RightAlt/AltGr (keycode=${e.keycode}) -- IGNORED (international keyboard AltGr, not used as hotkey)`);
    }
  });

  uIOhook.on('keyup', (e) => {
    if (e.keycode === VK_LALT) {
      altHeld = false;
      log(`KEYUP LeftAlt (keycode=${e.keycode}) altHeld=false`);
      console.log('');
    } else if (e.keycode === VK_RALT) {
      log(`KEYUP RightAlt (keycode=${e.keycode})`);
    }
  });

  uIOhook.on('mousedown', (e) => {
    if (e.button !== 1) return;  // only left button
    mouseDownAltState = altHeld;
    log(`MOUSEDOWN at (${e.x}, ${e.y}) altHeld=${altHeld}`);
  });

  uIOhook.on('mouseup', (e) => {
    if (e.button !== 1) return;
    const samealt = mouseDownAltState && altHeld;
    log(`MOUSEUP at (${e.x}, ${e.y}) altHeld=${altHeld} (was ${mouseDownAltState} at down) samealt=${samealt}`);
    if (samealt) {
      console.log('             ^^ HOTKEY PATH WOULD TRIGGER (altHeld true at both mousedown and mouseup)');
    } else if (mouseDownAltState && !altHeld) {
      console.log('             ^^ FELL BACK to normal flow (Alt released mid-drag, FSM handles normally)');
    } else if (altHeld && !mouseDownAltState) {
      console.log('             ^^ Alt pressed AFTER mousedown -- hotkey will NOT trigger (correct)');
    } else {
      console.log('             ^^ NORMAL flow (no Alt at mousedown)');
    }
  });

  try {
    uIOhook.start();
    console.log(`${ts()} uIOhook started successfully. Now switch to Chrome and test Alt+drag.`);
    console.log('');
  } catch (err) {
    console.error('FATAL: uIOhook.start() failed:', err);
    console.error('');
    console.error('Possible causes:');
    console.error('  - T-Translate main app is still running (quit it from system tray)');
    console.error('  - Win32 hook permission denied (rare, may need admin)');
    process.exit(1);
  }
});

const shutdown = () => {
  console.log('');
  console.log('====================================================================');
  console.log(`  Spike done. ${eventCount} events captured.`);
  console.log('====================================================================');
  console.log('');
  console.log('  Now recall:');
  console.log('    1. Did Chrome do anything weird while you held Alt + dragged?');
  console.log('    2. Did terminal events match your mouse/keyboard actions?');
  console.log('    3. Did samealt=true ever appear?');
  console.log('');
  console.log('  Decide PASS / PARTIAL / FAIL based on the matrix at the top of this file.');
  console.log('');
  try {
    uIOhook.stop();
  } catch (e) {
    // ignore
  }
  app.quit();
  setTimeout(() => process.exit(0), 100);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Windowless spike: don't quit when all windows close (we never opened any).
app.on('window-all-closed', () => {
  // no-op
});
