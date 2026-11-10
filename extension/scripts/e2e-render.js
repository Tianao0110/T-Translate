// Caption rendering in a real browser. A headless Chrome / Edge with a
// throwaway profile opens a page served from 127.0.0.1 whose <video> plays a
// canvas stream (light left half, dark right half); the renderer and parsers
// are bundled to an IIFE with esbuild and loaded by the page. Three cues (one
// long enough to wrap) go in as parsed VTT, then translation events for the
// second; activeCues are read over CDP and the page is screenshotted in track
// mode, overlay mode, translation only and fullscreen (entered by a CDP mouse
// click on a page button).
//
//   node extension/scripts/e2e-render.js [--browser <exe>] [--out <dir for screenshots>]
//
// The profile is left for the recycle bin.
/* eslint-disable no-console */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const esbuild = require('esbuild');
const { arg, checklist } = require('../../scripts/lib/electron-smoke');
const { findBrowser, launchBrowser, sleep } = require('./lib/browser');

const CONTENT = path.join(__dirname, '..', 'src', 'content');
const TTML = fs.readFileSync(path.join(__dirname, '..', 'test', 'fixtures', 'subtitles', 'sample.ttml'), 'utf8');
const { step, summary } = checklist();

const LONG =
  'This second caption is deliberately long, so that it has to wrap onto another line the way real speech runs on without a pause.';
const TRANSLATION = '这第二条字幕故意写得很长，好让它像真实的口语那样一口气说下去、不得不折到下一行。';

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>T-Caption render</title>
<style>
  body { margin: 0; background: #2a2d33; font: 14px system-ui, sans-serif; }
  #stage { padding: 16px; background: #1b1d22; }
  #wrap { position: relative; width: 960px; height: 540px; }
  #v { display: block; width: 100%; height: 100%; background: #000; }
  #fs { margin-top: 10px; padding: 6px 18px; font: inherit; }
  #stage:fullscreen { display: flex; flex-direction: column; padding: 0; }
  #stage:fullscreen #wrap { width: 100%; height: auto; flex: 1; }
  #stage:fullscreen #fs { margin: 6px; align-self: flex-start; }
</style></head>
<body>
<div id="stage"><div id="wrap"><video id="v" muted autoplay playsinline></video></div><button id="fs">Fullscreen</button></div>
<script src="/renderer.js"></script>
<script>
  const v = document.getElementById('v');
  const c = Object.assign(document.createElement('canvas'), { width: 960, height: 540 });
  const g = c.getContext('2d');
  (function draw(t) {
    g.fillStyle = '#f1ede2'; g.fillRect(0, 0, 480, 540);
    g.fillStyle = '#14161b'; g.fillRect(480, 0, 480, 540);
    g.fillStyle = '#d9822b'; g.fillRect(((t / 8) % 1000) - 40, 40, 40, 40);
    requestAnimationFrame(draw);
  })(0);
  v.srcObject = c.captureStream(30);
  document.getElementById('fs').addEventListener('click', () => document.getElementById('stage').requestFullscreen());
</script>
</body></html>`;

// VTT clock for t seconds.
const clock = (t) => {
  const ms = Math.round(t * 1000);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)}.${p(ms % 1000, 3)}`;
};

async function bundle() {
  const r = await esbuild.build({
    stdin: {
      contents: "export { createCaptionRenderer, applyMediaEvent } from './caption-renderer.js'; export { parseSubtitles } from './parsers/index.js';",
      resolveDir: CONTENT,
      loader: 'js',
    },
    bundle: true,
    format: 'iife',
    globalName: 'TCaption',
    target: 'chrome120',
    write: false,
    logLevel: 'silent',
  });
  return r.outputFiles[0].text;
}

function serve(js) {
  const server = http.createServer((req, res) => {
    if (req.url === '/renderer.js') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      res.end(js);
    } else if (req.url === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(PAGE);
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function main() {
  const exe = findBrowser(arg('--browser'));
  if (!exe) {
    console.error('no Chrome / Edge found; pass --browser <exe>');
    return 2;
  }
  const out = path.resolve(arg('--out') || fs.mkdtempSync(path.join(os.tmpdir(), 'tcaption-render-shots-')));
  fs.mkdirSync(out, { recursive: true });
  const tag = path.basename(exe, '.exe');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tcaption-render-'));
  const server = await serve(await bundle());
  const { port } = server.address();
  console.log(`browser: ${exe}\npage: http://127.0.0.1:${port}/\nscreenshots: ${out}\n`);

  let browser;
  try {
    browser = await launchBrowser({ exe, profile, args: ['--window-size=1280,900'] });
  } catch (e) {
    server.close();
    throw e;
  }
  console.log(`browser pid ${browser.child.pid}`);
  const { cdp, evaluate, open } = browser;
  const readings = {};
  const shots = [];
  try {
    const { sessionId: page } = await open(`http://127.0.0.1:${port}/`);
    const problems = [];
    cdp.listen((m) => {
      if (m.sessionId !== page) return;
      if (m.method === 'Runtime.exceptionThrown') problems.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') problems.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
    });
    const js = (expr) => evaluate(page, expr);
    // Polls expr (errors count as not yet: the page may still be loading).
    const until = async (expr, ms = 10000) => {
      for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(50)) if (await js(expr).catch(() => false)) return true;
      return false;
    };
    const shoot = async (name, clip) => {
      const params = { format: 'png', ...(clip ? { clip: { ...clip, scale: 2 } } : {}) };
      const { data } = await cdp.send('Page.captureScreenshot', params, page);
      const file = path.join(out, `t-caption-s3-${tag}-${name}.png`);
      fs.writeFileSync(file, Buffer.from(data, 'base64'));
      shots.push(file);
    };
    // The bottom third of the video, where the captions sit.
    const captionClip = async () =>
      js(`(() => { const r = document.getElementById('v').getBoundingClientRect(); return { x: r.left, y: r.top + r.height * 0.55, width: r.width, height: r.height * 0.45 }; })()`);
    const active = () =>
      js(`(() => { const t = document.getElementById('v').textTracks[0]; return { mode: t.mode, active: Array.from(t.activeCues || []).map((c) => ({ id: c.id, text: c.text })) }; })()`);
    const overlayLines = () =>
      js(`(() => { const h = document.querySelector('.tc-cap-host'); return h ? { parent: h.parentElement.id, lines: [...h.shadowRoot.querySelectorAll('.tc-cap-line')].map((l) => l.textContent), box: h.getBoundingClientRect().toJSON() } : null; })()`);

    step('canvas stream plays in the <video>', await until(`document.getElementById('v').currentTime > 0.3`), `currentTime ${await js(`document.getElementById('v').currentTime.toFixed(2)`)} s`);

    const ttml = await js(`TCaption.parseSubtitles(${JSON.stringify(TTML)}).map((c) => c.id + ':' + c.text)`);
    step('TTML parses with the browser DOMParser', ttml.length === 6 && ttml[0] === 'sub1:Plain clock with nested spans', ttml.join(' | '));

    const t0 = await js(`document.getElementById('v').currentTime`);
    const vtt = [
      'WEBVTT',
      '',
      `1\n${clock(t0 + 0.6)} --> ${clock(t0 + 3)} line:90%\n<v Host>First caption, &amp; a tag</v>`,
      '',
      `2\n${clock(t0 + 3)} --> ${clock(t0 + 300)}\n${LONG}`,
      '',
      `3\n${clock(t0 + 300)} --> ${clock(t0 + 305)}\nThird caption`,
    ].join('\n');
    const count = await js(`(() => {
      const cues = TCaption.parseSubtitles(${JSON.stringify(vtt)});
      window.__r = TCaption.createCaptionRenderer({ video: document.getElementById('v'), lang: 'en' });
      window.__r.setCues(cues);
      return cues.length;
    })()`);
    step('three cues from VTT into the renderer', count === 3);

    await until(`document.getElementById('v').currentTime > ${t0 + 0.8}`);
    readings.first = await active();
    step('track showing, first cue active', readings.first.mode === 'showing' && readings.first.active.length === 1 && readings.first.active[0].text === 'First caption, &amp; a tag', JSON.stringify(readings.first));
    await shoot('1-track-first');

    await until(`document.getElementById('v').currentTime > ${t0 + 3.2}`);
    readings.second = await active();
    step('second (long) cue active', readings.second.active.length === 1 && readings.second.active[0].text === LONG, JSON.stringify(readings.second.active.map((c) => c.id)));
    await shoot('2-track-long');

    await js(`TCaption.applyMediaEvent(window.__r, { type: 'translation', id: 2, text: 'pending', done: false })`);
    const afterPending = await active();
    await js(`TCaption.applyMediaEvent(window.__r, { type: 'translation', id: 2, text: '这第二条字幕', done: false })`);
    readings.partial = await active();
    await js(`TCaption.applyMediaEvent(window.__r, { type: 'translation', id: 2, text: ${JSON.stringify(TRANSLATION)}, done: true })`);
    readings.bilingual = await active();
    step(
      'translation events update the active cue (pending ignored, partial, done)',
      afterPending.active[0].text === LONG && readings.partial.active[0].text === `${LONG}\n这第二条字幕` && readings.bilingual.active[0].text === `${LONG}\n${TRANSLATION}`,
      JSON.stringify(readings.bilingual.active[0].text)
    );
    await sleep(150);
    await shoot('3-track-bilingual');
    await shoot('3-track-bilingual-zoom', await captionClip());

    await js(`window.__r.setMode('overlay')`);
    await sleep(150);
    readings.overlay = { track: await active(), overlay: await overlayLines() };
    step(
      'overlay mode: track disabled, overlay over the video with both lines',
      readings.overlay.track.mode === 'disabled' && readings.overlay.overlay?.parent === 'wrap' && readings.overlay.overlay.lines.join('\n') === `${LONG}\n${TRANSLATION}`,
      JSON.stringify(readings.overlay.overlay?.box)
    );
    await shoot('4-overlay-bilingual');
    await shoot('4-overlay-bilingual-zoom', await captionClip());

    await js(`window.__r.setDisplay('translation')`);
    await sleep(100);
    readings.translationOnly = await overlayLines();
    step('display translation: one line, the translation', readings.translationOnly?.lines.join('|') === TRANSLATION);
    await shoot('5-overlay-translation');

    await js(`window.__r.setDisplay('bilingual')`);
    const btn = await js(`(() => { const r = document.getElementById('fs').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
      await cdp.send('Input.dispatchMouseEvent', { type, x: btn.x, y: btn.y, button: 'left', clickCount: type === 'mouseMoved' ? 0 : 1 }, page);
    }
    const inFs = await until(`document.fullscreenElement && document.fullscreenElement.id === 'stage'`, 5000);
    await sleep(400);
    readings.fullscreen = {
      overlay: await overlayLines(),
      video: await js(`document.getElementById('v').getBoundingClientRect().toJSON()`),
      viewport: await js(`({ w: innerWidth, h: innerHeight })`),
    };
    const { overlay: fo, video: fv } = readings.fullscreen;
    step(
      'a click enters fullscreen; the overlay moves into the fullscreen element and covers the resized video',
      inFs && fo?.parent === 'stage' && ['x', 'y', 'width', 'height'].every((k) => Math.abs(fo.box[k] - fv[k]) <= 1),
      JSON.stringify(readings.fullscreen)
    );
    await shoot('6-overlay-fullscreen');

    await js(`window.__r.setMode('track')`);
    await sleep(200);
    readings.fullscreenTrack = await active();
    step('back to track mode in fullscreen: same track, cue active again', readings.fullscreenTrack.mode === 'showing' && readings.fullscreenTrack.active[0]?.id === '2' && (await js(`document.getElementById('v').textTracks.length`)) === 1);
    await shoot('7-track-fullscreen');

    await js(`window.__r.setMode('overlay'); document.exitFullscreen()`);
    await until(`!document.fullscreenElement`, 5000);
    await sleep(200);
    readings.exited = await overlayLines();
    step('leaving fullscreen puts the overlay back next to the video', readings.exited?.parent === 'wrap');

    await js(`window.__r.destroy()`);
    const after = await js(`({ host: !!document.querySelector('.tc-cap-host'), tracks: document.getElementById('v').textTracks.length, mode: document.getElementById('v').textTracks[0].mode })`);
    step('destroy: no overlay left, the track disabled', !after.host && after.tracks === 1 && after.mode === 'disabled', JSON.stringify(after));
    step('no exceptions or console errors on the page', problems.length === 0, problems.join(' || '));
    console.log(`\n  readings: ${JSON.stringify(readings, null, 1)}`);
    console.log(`  screenshots:\n    ${shots.join('\n    ')}`);
  } finally {
    const how = await browser.close();
    step('browser closed', true, `pid ${browser.child.pid} via ${how}`);
    await new Promise((r) => server.close(r));
    console.log(`  server on port ${port} closed; profile left for the recycle bin: ${profile}`);
  }
  return summary();
}

main().then(
  (code) => {
    process.exitCode = Number(code) || 0;
  },
  (e) => {
    console.error(e);
    process.exitCode = 1;
  }
);
