// Firefox spike (S10), real browser: the Firefox build (build.mjs --target
// firefox) as a temporary add-on in release Firefox, driven over WebDriver
// BiDi (lib/firefox.js), with the real companion server and listen engine in
// a sandbox Electron (lib/e2e-shell.js). Evidence for the port, not a full
// acceptance run:
//
//   (a) it installs; the background page answers and has WebCodecs
//   (b) pairing from the options page: hello / pair / the event stream run in the background page
//   (c) the event page's lifetime while idle (its performance.timeOrigin over
//       --idle-s) and the channel after it came back
//   (d) YouTube hands off: hooks at document_start in MAIN, the MSE audio
//       codec, tier 2, bilingual cues on the track (screenshots). YouTube
//       stops playing after about 50 s in an automated Firefox (with or
//       without the extension), so lifetime is measured on (g) instead
//   (e) site access on a local page: SITE_ALLOW injects into the open tab,
//       the registered pair runs at document_start after a reload
//   (g) with --ffmpeg: a local page plays a progressive MP4 (SAPI speech):
//       the worker fetches it by range, captions come; the background
//       page's lifetime while capturing (--capture-s)
//   (e) SITE_REVOKE
//   (f) permissions: request without a gesture, with BiDi's user activation,
//       with a BiDi click; the channel once 127.0.0.1 is taken back
//
//   npx electron extension/scripts/e2e-firefox.js --packs <installed asr-models dir> [--ffmpeg <ffmpeg.exe>] [--firefox <exe>] [--out <dir>] [--headed] [--video <id>] [--idle-s 75] [--capture-s 150]
//
// Set TEMP to a folder on the packs' drive so they are hard-linked, not copied.
/* eslint-disable no-console */

const path = require('path');
const fs = require('fs');
const http = require('http');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');
const { REPO, arg, has, sleep, checklist, run } = require('../../scripts/lib/electron-smoke');
const { startCompanion, until } = require('./lib/e2e-shell');
const { synthesizeWav } = require('./lib/speech');
const { findFirefox, launchFirefox } = require('./lib/firefox');

const { step, summary } = checklist();
const VIDEO = arg('--video') || 'UF8uR6Z6KLc';
const IDLE_S = Number(arg('--idle-s') || 75);
const CAPTURE_S = Number(arg('--capture-s') || 150);
const UUID = '7c0a1d2e-3b4f-4a5b-8c6d-7e8f9a0b1c2d';
const BASE = `moz-extension://${UUID}/`;

// The inline script fetches a subtitle file at once: the hooks saw it only if they ran before it.
const PAGE_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>T-Caption Firefox page</title>
<script>fetch('/sub.vtt').then((r) => r.text()).then((t) => (window.__vtt = t.length));</script></head>
<body><video id="v" muted width="480" height="270"></video></body></html>`;
const VTT = 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nHello from the page.\n\n00:00:04.000 --> 00:00:06.000\nSecond line.\n';
const SPEECH_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>T-Caption Firefox direct</title></head>
<body style="margin:0;background:#1b1d22"><video id="v" src="/speech.mp4" autoplay preload="auto" style="display:block;margin:16px;width:960px;height:540px;background:#000"></video></body></html>`;

// SAPI speech looped past the capture window, over a test picture (H.264 / AAC, moov first).
function makeMedia(dir, ffmpeg, seconds) {
  const wav = synthesizeWav(path.join(dir, 'speech.wav'));
  const out = path.join(dir, 'speech.mp4');
  // prettier-ignore
  execFileSync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=25',
    '-stream_loop', '-1', '-i', wav, '-t', String(seconds),
    '-map', '0:v', '-map', '1:a',
    '-c:v', 'libx264', '-preset', 'veryfast', '-b:v', '800k', '-pix_fmt', 'yuv420p', '-g', '50',
    '-c:a', 'aac', '-ar', '48000', '-ac', '1', '-b:a', '96k', '-map_metadata', '-1',
    '-movflags', '+faststart', out,
  ]);
  return out;
}

// The pages, the subtitle file and the MP4 by range.
function serve(mp4) {
  const server = http.createServer((req, res) => {
    const name = new URL(req.url, 'http://x').pathname;
    if (name === '/sub.vtt') {
      res.writeHead(200, { 'content-type': 'text/vtt; charset=utf-8' });
      return res.end(VTT);
    }
    if (name === '/speech.mp4' && mp4) {
      const size = fs.statSync(mp4).size;
      const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
      const start = m ? Number(m[1]) : 0;
      const end = m && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
      if (start >= size) {
        res.writeHead(416, { 'content-range': `bytes */${size}` });
        return res.end();
      }
      res.writeHead(m ? 206 : 200, { 'content-type': 'video/mp4', 'accept-ranges': 'bytes', 'content-length': end - start + 1, ...(m && { 'content-range': `bytes ${start}-${end}/${size}` }) });
      return fs.createReadStream(mp4, { start, end }).pipe(res);
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(name === '/speech.html' ? SPEECH_HTML : PAGE_HTML);
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}

async function main() {
  const packsDir = arg('--packs');
  const exe = findFirefox(arg('--firefox'));
  if (!packsDir || !fs.existsSync(packsDir) || !exe) {
    console.error('usage: --packs <dir with asr-base-sense-voice/ etc.> [--ffmpeg <ffmpeg.exe>] [--firefox <firefox.exe>] [--out <dir>] [--headed]');
    return 2;
  }
  const { box, shotsDir, companion, engineManager } = await startCompanion({ name: 'tt-caption-firefox', step, version: 'e2e-s10', packsDir, browserExe: exe });
  const ffmpeg = arg('--ffmpeg');
  const mp4 = ffmpeg && fs.existsSync(ffmpeg) ? makeMedia(box.dir, ffmpeg, CAPTURE_S + 60) : null;
  const { build, GECKO_ID } = await import(pathToFileURL(path.join(REPO, 'extension/scripts/build.mjs')).href);
  const { outDir } = await build({ target: 'firefox', outDir: path.join(box.dir, 'dist-firefox'), logLevel: 'silent', extraHosts: ['http://localhost/*'] });

  const ff = await launchFirefox({ exe, profile: path.join(box.dir, 'profile'), headless: !has('--headed'), uuids: { [GECKO_ID]: UUID } });
  console.log(`firefox ${ff.version} pid ${ff.child.pid}, BiDi port ${ff.port}`);
  const { evaluate, open } = ff;
  const numbers = {};
  const shots = [];
  const server = await serve(mp4);
  const pagePort = server.address().port;

  try {
    const tInstall = Date.now();
    const id = await ff.installExtension(outDir);
    step('(a) installs as a temporary add-on over BiDi', id === GECKO_ID, `${id} in ${Date.now() - tInstall} ms`);
    const opt = await open(`${BASE}options.html`);
    const ext = (type, payload) => evaluate(opt, `chrome.runtime.sendMessage(${JSON.stringify({ type, payload })})`);
    const bg = (expr) => evaluate(opt, `chrome.runtime.getBackgroundPage().then(async (bg) => (${expr}))`);
    const evidence = async (tabId) => (await ext('tab/evidence', { tabId }))?.result;
    const state = async (tabId) => (await ext('tab/state', { tabId }))?.result;
    const tabIdOf = (prefix) => evaluate(opt, `chrome.tabs.query({}).then((ts) => ts.find((t) => (t.url || '').startsWith(${JSON.stringify(prefix)}))?.id ?? null)`);
    const shoot = async (context, name, clip) => {
      const file = await ff.screenshot(context, path.join(shotsDir, `t-caption-s10-${name}.png`), clip);
      shots.push(file);
    };
    const trackInfo = (context) =>
      evaluate(context, `(() => { const v = document.querySelector('video'); if (!v) return null; const t = Array.from(v.textTracks).find((x) => x.label === 'T-Caption'); return { t: v.currentTime, paused: v.paused, cues: t && t.cues ? t.cues.length : 0, active: t && t.activeCues ? Array.from(t.activeCues).map((c) => c.text) : [] }; })()`);
    const dump = async (tabId) => {
      const s = await state(tabId);
      const ev = await evidence(tabId);
      const hist = (s?.history || []).map((h) => `${new Date(h.at).toISOString().slice(11, 23)} ${h.state}${h.detail ? ' ' + JSON.stringify(h.detail) : ''}`).join(' | ');
      const streams = (ev?.mse?.streams || []).map((x) => `${x.streamId}:${x.kind}/${x.codec || '?'}${x.alive ? '' : '†'} ${x.chunks}ch`).join(', ');
      const m = ev?.media?.find((x) => x.elId === ev.primaryElId);
      console.log(`  [dump tab ${tabId}] state ${s?.state} block ${s?.block} run ${JSON.stringify(s?.run)}\n    history: ${hist}\n    media: ${m ? `${m.state} t=${m.currentTime} dur=${m.duration} vis=${m.pageVisible}` : 'none'}; streams: ${streams}\n    capture: ${JSON.stringify(ev?.capture)}\n    hooks: ${JSON.stringify(ev?.hooks)} eme: ${JSON.stringify(ev?.eme)} subtitles: ${JSON.stringify((ev?.subtitles || []).map((x) => x.cueCount))}`);
      const evs = await evaluate(opt, 'window.__media');
      console.log(`    media events: ${evs.map((e) => `${e.key} ${e.event.type}${e.event.reason ? ':' + e.event.reason : ''}${e.event.state ? ':' + e.event.state : ''}${e.event.code ? ':' + e.event.code : ''}`).join(', ')}`);
    };

    const bgInfo = await bg(`{ href: bg.location.href, audioDecoder: typeof bg.AudioDecoder, opus: await bg.AudioDecoder.isConfigSupported({ codec: 'opus', sampleRate: 48000, numberOfChannels: 2 }).then((r) => r.supported) }`);
    step('(a) the background page has WebCodecs (Opus)', bgInfo?.opus === true, JSON.stringify(bgInfo));
    numbers.permissionsAtInstall = await evaluate(opt, `chrome.permissions.getAll()`);
    console.log(`  permissions at install: ${JSON.stringify(numbers.permissionsAtInstall)}`);

    // ---- (b) pairing ----
    await evaluate(opt, `(() => { window.__media = []; window.__states = []; chrome.runtime.onMessage.addListener((m) => { if (m && m.type === 'media/event') window.__media.push({ at: Date.now(), ...m.payload }); if (m && m.type === 'companion/state-changed') window.__states.push(m.payload.status); }); return true; })()`);
    companion.openPairing();
    const tPair = Date.now();
    const paired = await ext('companion/pair');
    step('(b) paired through the options page (background page client)', paired?.ok && paired.result.status === 'ready', `${paired?.result?.status || JSON.stringify(paired?.error)} in ${Date.now() - tPair} ms, app ${paired?.result?.appVersion}`);
    await sleep(500);
    const states = await evaluate(opt, 'window.__states');
    step('(b) state broadcasts reach the options page', states.includes('ready'), JSON.stringify(states));
    const tr = await ext('companion/translate', { items: [{ id: 'x', text: 'hello' }], source: 'en', target: 'zh' });
    step('(b) translate through the channel', tr?.ok, JSON.stringify(tr?.result || tr?.error).slice(0, 160));

    // ---- (c) idle lifetime ----
    if (IDLE_S > 0) {
      const idle0 = await bg('bg.performance.timeOrigin');
      console.log(`  idle for ${IDLE_S} s (background started at ${new Date(idle0).toISOString().slice(11, 19)})`);
      await sleep(IDLE_S * 1000);
      const idle1 = await bg('bg.performance.timeOrigin');
      numbers.idleRestarted = idle1 !== idle0;
      const tBack = Date.now();
      const back = await until(async () => ((await ext('companion/state'))?.result?.status === 'ready' ? true : null), 15000);
      numbers.channelBackMs = back ? Date.now() - tBack : null;
      step('(c) idle: what happened to the event page; the channel comes back by itself', back, `${numbers.idleRestarted ? 'restarted' : 'same page'} after ${IDLE_S} s (timeOrigin ${idle0} → ${idle1}); channel ready ${numbers.channelBackMs} ms after the check`);
    }

    // ---- (d) YouTube ----
    await evaluate(opt, `chrome.storage.local.set({ prefs: { targetLang: 'zh', mode: 'track' } }).then(() => true)`);
    const yt = await open(null);
    const tOpen = Date.now();
    await ff.navigate(yt, `https://www.youtube.com/watch?v=${VIDEO}`, 'interactive');
    const tab1 = await until(() => tabIdOf('https://www.youtube.com/watch'), 15000);
    step('(d) YouTube tab known to the extension', Number.isInteger(tab1), `tab ${tab1}`);
    const hooked = await until(async () => {
      const ev = await evidence(tab1);
      return ev?.hooks ? ev : null;
    }, 20000);
    step('(d) MAIN-world hooks report at document_start', !!hooked?.hooks, JSON.stringify(hooked?.hooks));
    const captions = await until(async () => {
      const s = await state(tab1);
      return s && s.state === 'captions' ? s : null;
    }, 90000);
    numbers.captionsStateMs = captions ? Date.now() - tOpen : null;
    step('(d) the orchestrator starts captions on its own (tier 2)', !!captions && captions.run?.tier === 2, `${numbers.captionsStateMs} ms; ${JSON.stringify(captions?.run)}`);
    const ev1 = await evidence(tab1);
    numbers.mseStreams = (ev1?.mse?.streams || []).map((x) => ({ kind: x.kind, codec: x.codec, mime: x.mime, chunks: x.chunks }));
    console.log(`  MSE streams: ${JSON.stringify(numbers.mseStreams)}`);
    const firstSeg = await until(async () => (await evaluate(opt, 'window.__media')).find((e) => e.key.startsWith(`tab:${tab1}:`) && e.event.type === 'segment'), 60000, 200);
    numbers.firstSegmentMs = firstSeg ? firstSeg.at - tOpen : null;
    const active1 = await until(async () => {
      const r = await trackInfo(yt);
      return r && r.active.some((t) => t.includes('\n')) ? r : null;
    }, 30000, 300);
    numbers.firstActiveCueMs = active1 ? Date.now() - tOpen : null;
    step('(d) real sentences come back and show on the track, bilingual', !!firstSeg && !!active1, `first sentence ${numbers.firstSegmentMs} ms, first cue ${numbers.firstActiveCueMs} ms after opening; ${JSON.stringify(active1?.active)}`);
    if (!active1) await dump(tab1);
    else {
      await shoot(yt, '1-youtube-captions');
      const box2 = await evaluate(yt, `(() => { const r = document.querySelector('video').getBoundingClientRect(); return { x: r.left, y: r.top + r.height * 0.6, width: r.width, height: r.height * 0.4 }; })()`);
      await shoot(yt, '2-youtube-captions-zoom', box2);
    }
    const [badgeText] = (await evaluate(opt, `Promise.all([chrome.action.getBadgeText({ tabId: ${tab1} }), chrome.action.getTitle({ tabId: ${tab1} })])`)) || [];
    step('(d) the badge says captions', badgeText === 'CC', badgeText);
    await ff.bidi.send('browsingContext.close', { context: yt });

    // ---- (e) site access ----
    const pageUrl = `http://localhost:${pagePort}/page.html`;
    const page = await open(pageUrl);
    const tab2 = await until(() => tabIdOf(pageUrl), 10000);
    const before = await evidence(tab2);
    step('(e) a page not allowed has no T-Caption', !before, JSON.stringify(before?.hooks ?? null));
    const allow = await ext('site/allow', { pattern: 'http://localhost/*', tabId: tab2 });
    step('(e) SITE_ALLOW injects into the open tab (executeScript MAIN + isolated)', allow?.ok && allow.result.injected === 'injected', JSON.stringify(allow?.result || allow?.error));
    const injected = await until(async () => (await evidence(tab2))?.hooks, 8000);
    step('(e) the injected hooks report', !!injected, JSON.stringify(injected));
    const regs = await evaluate(opt, `chrome.scripting.getRegisteredContentScripts()`);
    console.log(`  registered: ${JSON.stringify(regs)}`);
    step('(e) the pair is registered (MAIN + ISOLATED)', regs?.length === 2 && regs.some((r) => r.world === 'MAIN'), regs?.map((r) => `${r.id}:${r.world}:${r.persistAcrossSessions}`).join(' '));
    await ff.navigate(page, pageUrl);
    const reloaded = await until(async () => {
      const ev = await evidence(tab2);
      return ev?.hooks && ev.subtitles?.length ? ev : null;
    }, 8000);
    step('(e) after a reload the registered scripts run at document_start (saw the inline script’s fetch)', !!reloaded, `hooks ${JSON.stringify(reloaded?.hooks)}; subtitles ${JSON.stringify((reloaded?.subtitles || []).map((s) => s.cueCount))}`);
    await ff.bidi.send('browsingContext.close', { context: page });

    // ---- (g) a progressive MP4 on the allowed site; lifetime while capturing ----
    if (mp4) {
      const speechUrl = `http://localhost:${pagePort}/speech.html`;
      const tSpeech = Date.now();
      const sp = await open(speechUrl, { wait: 'interactive' });
      const tab3 = await until(() => tabIdOf(speechUrl), 10000);
      await evaluate(sp, `document.getElementById('v').play().then(() => true, (e) => e.name)`, { timeoutMs: 15000 }).catch(() => null);
      const direct = await until(async () => {
        const s = await state(tab3);
        return s && s.state === 'captions' ? s : null;
      }, 30000);
      step('(g) the orchestrator runs the direct source', !!direct && direct.run?.kind === 'direct', JSON.stringify(direct?.run));
      const segs = async () => (await evaluate(opt, 'window.__media')).filter((e) => e.key.startsWith(`tab:${tab3}:`) && e.event.type === 'segment');
      const first = await until(async () => (await segs())[0], 45000, 300);
      const cue = await until(async () => {
        const r = await trackInfo(sp);
        return r && r.active.some((t) => t.includes('\n')) ? r : null;
      }, 30000, 300);
      step('(g) sentences from the fetched file show on the track', !!first && !!cue, `first sentence ${first ? first.at - tSpeech : null} ms after opening; ${JSON.stringify(cue?.active)}`);
      if (cue) await shoot(sp, '3-direct-captions');
      else await dump(tab3);
      const cap0 = await bg('bg.performance.timeOrigin');
      const seg0 = (await segs()).length;
      const v0 = (await trackInfo(sp))?.t;
      console.log(`  capturing for ${CAPTURE_S} s`);
      await sleep(CAPTURE_S * 1000);
      const cap1 = await bg('bg.performance.timeOrigin');
      const s2 = await state(tab3);
      const track2 = await trackInfo(sp);
      numbers.capture = { restarted: cap1 !== cap0, segments: (await segs()).length - seg0, state: s2?.state, videoFrom: v0, videoTo: track2?.t, cues: track2?.cues };
      step('(g) the background page lives through the capture', cap1 === cap0 && numbers.capture.segments > 0 && s2?.state === 'captions', JSON.stringify(numbers.capture));
      await shoot(sp, '4-direct-after-capture');
      await ff.bidi.send('browsingContext.close', { context: sp });
    }

    // ---- (e) the site removed ----
    const revoke = await ext('site/revoke', { pattern: 'http://localhost/*' });
    const regsAfter = await evaluate(opt, `chrome.scripting.getRegisteredContentScripts()`);
    step('(e) SITE_REVOKE unregisters and gives the permission back', revoke?.ok && regsAfter.length === 0, JSON.stringify(revoke?.result || revoke?.error));

    // ---- (f) permissions ----
    const ask = `chrome.permissions.request({ origins: ['https://example.com/*'] }).then((r) => 'resolved ' + r, (e) => 'rejected ' + e.message)`;
    const noGesture = await evaluate(opt, ask);
    const activation = await evaluate(opt, ask, { userActivation: true });
    await evaluate(opt, `(() => { const b = document.createElement('button'); b.id = 'tc-ask'; b.textContent = 'ask'; b.style.cssText = 'position:fixed;left:10px;top:10px;width:120px;height:40px;z-index:99999'; b.onclick = () => { window.__asked = 'pending'; ${ask}.then((r) => (window.__asked = r)); }; document.body.append(b); return true; })()`);
    await ff.click(opt, 70, 30);
    await sleep(3000);
    const clicked = await evaluate(opt, 'window.__asked ?? "no click"');
    console.log(`  permissions.request: without a gesture → ${noGesture}; BiDi userActivation → ${activation}; BiDi click → ${clicked} (3 s later)`);
    step('(f) permissions.request needs a real click', /rejected/.test(noGesture), `click: ${clicked}`);
    numbers.permissionRequest = { noGesture, activation, clicked };
    const removed = await evaluate(opt, `chrome.permissions.remove({ origins: ['http://127.0.0.1/*'] }).then((r) => r, (e) => 'rejected ' + e.message)`);
    const contains = await evaluate(opt, `chrome.permissions.contains({ origins: ['http://127.0.0.1/*'] })`);
    const reconnect = await ext('companion/connect');
    const tr2 = await ext('companion/translate', { items: [{ id: 'y', text: 'world' }], source: 'en', target: 'zh' });
    numbers.withoutLoopback = { removed, contains, connect: reconnect?.result?.status || reconnect?.error, translate: tr2?.ok ? 'ok' : tr2?.error };
    step('(f) the channel with 127.0.0.1 taken back', true, JSON.stringify(numbers.withoutLoopback));
  } catch (e) {
    step('no exception', false, e.stack || e.message);
  } finally {
    const how = await ff.close();
    step('firefox closed', true, `pid ${ff.child.pid} via ${how}`);
    server.close();
    await companion.stop();
    await engineManager.stopSessionAndWait?.('e2e-s10');
    const ours = ff.logs.filter((l) => /T-Caption|moz-extension:\/\//.test(`${l.text} ${l.url}`));
    const errors = ff.logs.filter((l) => l.level === 'error' && !ours.includes(l));
    console.log(`\n  log entries: ${ff.logs.length}; ours ${ours.length} (last 30):\n    ${ours.slice(-30).map((l) => `[${l.level}] ${l.text.slice(0, 240)} @ ${l.url.slice(-60)}`).join('\n    ')}\n  other errors: ${errors.length} (first 10):\n    ${errors.slice(0, 10).map((l) => `${l.text.slice(0, 200)} @ ${l.url.slice(-60)}`).join('\n    ')}`);
  }
  console.log(`\nnumbers: ${JSON.stringify(numbers, null, 2)}\nscreenshots:\n  ${shots.join('\n  ')}\n  sandbox left for the recycle bin: ${box.dir}`);
  return summary();
}

run(main);
