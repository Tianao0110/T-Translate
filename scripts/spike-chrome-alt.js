// scripts/spike-chrome-alt.js
//
// PHASE 0.5 SPIKE — Chrome Alt+drag verification
//
// 这是一个一次性 disposable 脚本。验证完之后可以删掉。
//
// === 目的 ===
// 在动手实现 v0.2.4 hotkey 之前，先确认 3 件事：
//   1. uIOhook 能不能在 Chrome 是前景窗口的时候看到 Alt 键和鼠标事件
//   2. Chrome 自己会不会拦截或破坏 Alt+drag 选词（最关键，是你 D2L 主场景）
//   3. 事件到达顺序符合预期 (mousedown → mouseup, altHeld 状态稳定)
//
// === 怎么运行 ===
//   在你的 git bash 里:
//     cd F:/T-Translate
//     npx electron scripts/spike-chrome-alt.js
//
//   终止: Ctrl+C
//
// === ⚠️ 运行前必读 ===
// 如果 T-Translate 主程序此刻正在运行（划词翻译开着），
// 必须先退出它（系统托盘 → Quit）。两个 uIOhook 实例会冲突。
//
// === 测试步骤（运行后照做）===
//   1. 看到终端打印 "uIOhook started successfully" 之后
//   2. 切到 Chrome（任何有英文文字的网页：维基百科、D2L、新闻都行）
//   3. 按住 LEFT Alt 键
//   4. 用鼠标按住左键拖过一个英文单词
//   5. 松开鼠标
//   6. 松开 Alt 键
//   7. **同时观察两个东西**：
//      (a) 这个终端：应该出现 KEYDOWN/MOUSEDOWN/MOUSEUP/KEYUP 事件
//      (b) Chrome 本身：应该什么都没发生（没弹保存链接的对话框、没激活菜单、
//          没出现矩形选区奇怪行为）
//
// === 5 个必测场景 ===
//   A) 维基百科文章纯文字段落 × 3 次
//   B) 一个 <a href> 链接里的文字 × 3 次
//   C) 一张图片旁边的文字 × 3 次
//   D) D2L 作业页面 × 3 次（如果没法登录用任何英文教育网站代替）
//   E) Edge 浏览器（顺便测一下，~3 次）
//
// === 终端输出示例（一次成功的 Alt+drag）===
//   12:34:56.789 KEYDOWN LeftAlt (keycode=56) altHeld=true
//   12:34:57.012 MOUSEDOWN at (450, 320) altHeld=true
//   12:34:57.234 MOUSEUP at (520, 320) altHeld=true (was true at down) samealt=true
//                 ↑ HOTKEY PATH WOULD TRIGGER (altHeld both at down and up)
//   12:34:57.456 KEYUP LeftAlt (keycode=56) altHeld=false
//
// === 决策矩阵（spike 跑完之后）===
//
//   ✓ PASS:   纯文字 + 链接 + 图片 + D2L 全部场景下 Chrome 行为正常，
//             终端事件也都正确。→ 按 v3 design doc 计划继续 Phase 0 → Phase 1
//
//   ⚠ PARTIAL: 纯文字场景 OK，但是链接/图片附近 Chrome 弹了什么东西。
//             → hotkey 仍然可行，但要在 CHANGELOG 里说明 "尽量在纯文字
//                区域使用 hotkey，链接和图片附近可能触发 Chrome 自身行为"
//
//   ✗ FAIL:   纯文字场景下 Chrome 也有奇怪行为，或者终端根本看不到事件。
//             → hotkey 在主场景废了。回到 design doc T2 备选方案：
//                Ctrl+Alt / 用户可配置 modifier。重新调整 Phase 1。
//
// =====================================================================

const { app } = require('electron');

// 加载 uiohook-napi。如果加载失败说明 native binding 有问题
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

// Win32 keycodes (uiohook-napi 映射的)
//   Left Alt:  56  (0x38)
//   Right Alt: 312 (0x138) — aka AltGr on international keyboards
const VK_LALT = 56;
const VK_RALT = 312;

// 状态追踪 —— 用 keydown/keyup 维护一个布尔
// （注：生产实现会用 GetAsyncKeyState via koffi。这里 spike 用 keydown/keyup
//      足够，因为我们只想确认 uIOhook 能不能 SEE 这些事件。如果 uIOhook 看不到
//      事件，GetAsyncKeyState 也救不了 — 它是不同的 Win32 API 但同样的 hook 层级。）
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
      console.log(''); // blank line between Alt cycles
    } else if (e.keycode === VK_RALT) {
      log(`KEYUP RightAlt (keycode=${e.keycode})`);
    }
  });

  uIOhook.on('mousedown', (e) => {
    if (e.button !== 1) return; // 只关注左键
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

// graceful shutdown
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

// 没有窗口，all-windows-closed 时不要 quit
app.on('window-all-closed', () => {
  // no-op: spike 是 windowless 的
});
