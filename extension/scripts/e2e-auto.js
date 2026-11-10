// The whole thing, hands off, on a real YouTube page: the real companion
// server and listen engine in a sandbox Electron, the built extension in
// Chrome with a throwaway profile, and no command from the outside: the
// worker's orchestrator decides. Read through the extension's own messages
// (TAB_STATE / TAB_EVIDENCE from its options page) and the page over CDP.
//
//   (a) open a video: captions appear by themselves (tier 2, since YouTube
//       answers this automated browser with empty site captions), with the
//       time to the first sentence and the first cue on the track
//   (b) pause: capture stops after the grace; play: it starts again
//   (c) a second tab with a video takes over when it is the active tab, the
//       first stops; switching back hands it over again
//   (d) switching the site off in prefs stops it and marks the badge; on again resumes
//   (e) a DRM page we serve at a youtube.com URL gets the notice; its button
//       opens a listen session (the app's system capture); pausing closes it
//   (f) translate through the channel (what tier 1 uses) answers
//
//   npx electron extension/scripts/e2e-auto.js --packs <installed asr-models dir> [--browser <exe>] [--out <screenshots dir>] [--headed] [--video <id>] [--video2 <id>]
//
// Set TEMP to a folder on the packs' drive so they are hard-linked, not
// copied. The sandbox is left in place for the recycle bin.
/* eslint-disable no-console */

const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { REPO, arg, has, sleep, checklist, sandbox, fakeStore, run } = require('../../scripts/lib/electron-smoke');
const { fakeWindow } = require('../../scripts/lib/listen-sandbox');
const { linkPacks } = require('./lib/speech');
const { findBrowser, launchBrowser, loadExtension } = require('./lib/browser');

const { step, summary } = checklist();
const VIDEO = arg('--video') || 'UF8uR6Z6KLc';
const VIDEO2 = arg('--video2') || 'Hd_ptbiPoXM';
const DRM_PAGE = 'https://www.youtube.com/tc-e2e/drm';

// A playing video (canvas stream, so no file is needed) whose page asks for Widevine.
const DRM_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>T-Caption DRM test</title>
<style>body{margin:0;background:#222;font:14px system-ui}#wrap{position:relative;width:960px;height:540px;margin:20px}video{display:block;width:100%;height:100%;background:#000}</style></head>
<body><div id="wrap"><video id="v" autoplay></video></div>
<script>
  const c = Object.assign(document.createElement('canvas'), { width: 960, height: 540 });
  const g = c.getContext('2d');
  let n = 0;
  setInterval(() => { g.fillStyle = n++ % 2 ? '#345' : '#543'; g.fillRect(0, 0, 960, 540); }, 500);
  const v = document.getElementById('v');
  v.srcObject = c.captureStream(30);
  v.play().catch(() => {});
  window.__eme = (async () => {
    const config = [{ initDataTypes: ['cenc'], audioCapabilities: [{ contentType: 'audio/mp4; codecs="mp4a.40.2"' }], videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.42E01E"' }] }];
    try { await navigator.requestMediaKeySystemAccess('com.widevine.alpha', config); return 'granted'; } catch (e) { return e.name; }
  })();
</script></body></html>`;

async function main() {
  const packsDir = arg('--packs');
  const exe = findBrowser(arg('--browser'));
  if (!packsDir || !fs.existsSync(packsDir) || !exe) {
    console.error('usage: --packs <dir with asr-base-sense-voice/ etc.> [--browser <chrome.exe>] [--out <dir>] [--headed]');
    return 2;
  }
  const box = sandbox('tt-caption-auto');
  const shotsDir = path.resolve(arg('--out') || path.join(box.dir, 'shots'));
  fs.mkdirSync(shotsDir, { recursive: true });
  linkPacks(packsDir, path.join(process.env.TT_MODELS_ROOT, 'asr-models'));
  console.log(`sandbox: ${box.dir}\nbrowser: ${exe}${has('--headed') ? ' (window)' : ' (headless)'}\nscreenshots: ${shotsDir}\n`);

  const engineManager = require('../../electron/listen/audio-engine-manager');
  const { initCompanion } = require('../../electron/companion');
  const store = fakeStore({ 'settings.companion.enabled': true });
  engineManager.init({ store, getWindow: () => fakeWindow({}) });
  const translateStream = async (text, _o, onChunk) => {
    onChunk(`[译] ${text}`);
    return { success: true, text: `[译] ${text}` };
  };
  engineManager.configureTranslation({ translateStream });
  const logger = { info: () => {}, warn: (m) => console.log('  [warn]', m), error: (m) => console.log('  [error]', m), debug: () => {} };
  const companion = initCompanion({ store, engineManager, translateStream, logger, version: 'e2e-s5', getPrivacyMode: () => 'standard' });
  await companion.ready();
  step('companion channel up', companion.status().running === true, `port ${companion.status().port}`);

  const { build } = await import(pathToFileURL(path.join(REPO, 'extension/scripts/build.mjs')).href);
  const { outDir } = await build({ outDir: path.join(box.dir, 'dist'), logLevel: 'silent' });

  const browser = await launchBrowser({ exe, profile: path.join(box.dir, 'profile'), headless: !has('--headed'), args: ['--window-size=1280,900'] });
  const { cdp, attach, evaluate, open } = browser;
  console.log(`browser pid ${browser.child.pid}`);
  const extProblems = [];
  const pageExceptions = { ours: [], site: 0 };
  const numbers = {};
  const shots = [];
  const pages = new Set();

  try {
    const { id, sw } = await loadExtension(browser, outDir);
    await attach(sw.targetId);
    step('extension loaded', true, id);
    const { sessionId: opt } = await open(`chrome-extension://${id}/options.html`);
    await sleep(500);
    companion.openPairing();
    const paired = await evaluate(opt, `chrome.runtime.sendMessage({ type: 'companion/pair' })`);
    step('paired through the extension', paired?.ok && paired.result.status === 'ready', paired?.result?.status || JSON.stringify(paired?.error));
    await evaluate(opt, `(() => { window.__media = []; chrome.runtime.onMessage.addListener((m) => { if (m && m.type === 'media/event') window.__media.push({ at: Date.now(), ...m.payload }); }); })()`);

    const ext = (type, payload) => evaluate(opt, `chrome.runtime.sendMessage(${JSON.stringify({ type, payload })})`);
    const evidence = async (tabId) => (await ext('tab/evidence', { tabId }))?.result;
    const state = async (tabId) => (await ext('tab/state', { tabId }))?.result;
    const tabIdOf = (prefix) => evaluate(opt, `chrome.tabs.query({}).then((ts) => ts.find((t) => (t.url || t.pendingUrl || '').startsWith(${JSON.stringify(prefix)}))?.id ?? null)`);
    const activate = (tabId) => evaluate(opt, `chrome.tabs.update(${tabId}, { active: true }).then(() => true)`);
    const badge = (tabId) => evaluate(opt, `Promise.all([chrome.action.getBadgeText({ tabId: ${tabId} }), chrome.action.getTitle({ tabId: ${tabId} })])`);
    const setPrefs = (prefs) => evaluate(opt, `chrome.storage.local.set({ prefs: ${JSON.stringify(prefs)} }).then(() => true)`);
    const until = async (fn, ms, every = 250) => {
      for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(every)) {
        const v = await fn().catch(() => null);
        if (v) return v;
      }
      return null;
    };
    const stateIs = (tabId, want, ms) => until(async () => {
      const s = await state(tabId);
      return s && s.state === want ? s : null;
    }, ms);
    // What the worker knows about a tab, for a failed step.
    const dump = async (tabId) => {
      const s = await state(tabId);
      const ev = await evidence(tabId);
      const hist = (s?.history || []).map((h) => `${new Date(h.at).toISOString().slice(11, 23)} ${h.state}${h.detail ? ' ' + JSON.stringify(h.detail) : ''}`).join(' | ');
      const streams = (ev?.mse?.streams || []).map((x) => `${x.streamId}:${x.kind}/${x.codec || '?'}${x.alive ? '' : '†'} ${x.chunks}ch ${x.firstTimeS ?? '?'}–${x.lastTimeS ?? '?'}s${x.lastOp ? ' ' + x.lastOp.op : ''}`).join(', ');
      const m = ev?.media?.find((x) => x.elId === ev.primaryElId);
      console.log(`  [dump tab ${tabId}] state ${s?.state} block ${s?.block} run ${JSON.stringify(s?.run)}\n    history: ${hist}\n    media: ${m ? `${m.state} t=${m.currentTime} dur=${m.duration} src=${m.src.slice(0, 30)} vis=${m.pageVisible}` : 'none'}; streams: ${streams}\n    capture: ${JSON.stringify(ev?.capture)}\n    listen: ${JSON.stringify(ev?.listen)}\n    hooks: ${JSON.stringify(ev?.hooks)} eme: ${JSON.stringify(ev?.eme)} subtitles: ${JSON.stringify((ev?.subtitles || []).map((x) => x.cueCount))}`);
    };

    cdp.listen((m) => {
      if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails;
        const where = `${d.url || ''} ${d.stackTrace?.callFrames?.map((f) => f.url).join(' ') || ''}`;
        const text = d.exception?.description || d.text;
        if (where.includes('chrome-extension://') || /content-(main|isolated)/.test(where)) (pages.has(m.sessionId) ? pageExceptions.ours : extProblems).push(text);
        else if (pages.has(m.sessionId)) pageExceptions.site++;
        else extProblems.push(text);
      }
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error' && !pages.has(m.sessionId)) extProblems.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
    });
    const shoot = async (session, name, clip) => {
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) }, session);
      const file = path.join(shotsDir, `t-caption-s5-${name}.png`);
      fs.writeFileSync(file, Buffer.from(data, 'base64'));
      shots.push(file);
    };
    const trackInfo = (session) =>
      evaluate(session, `(() => { const v = document.querySelector('video'); if (!v) return null; const t = Array.from(v.textTracks).find((x) => x.label === 'T-Caption'); return { t: v.currentTime, paused: v.paused, cues: t ? t.cues.length : 0, active: t ? Array.from(t.activeCues || []).map((c) => c.text) : [] }; })()`);

    // The browser's UI language is English, like the test video's speech; a
    // Chinese target makes the translation show on the track.
    await setPrefs({ targetLang: 'zh' });

    // ---- (a) hands off ----
    const { sessionId: page1 } = await open('about:blank');
    pages.add(page1);
    const tOpen = Date.now();
    await cdp.send('Page.navigate', { url: `https://www.youtube.com/watch?v=${VIDEO}` }, page1);
    const tab1 = await until(() => tabIdOf('https://www.youtube.com/watch'), 15000);
    step('YouTube tab known to the extension', Number.isInteger(tab1), `tab ${tab1}`);
    const adGone = await until(() => evaluate(page1, `!document.querySelector('#movie_player.ad-showing') && !!document.querySelector('#movie_player')`), 90000, 500);
    if (!adGone) console.log('  [note] the player still shows an ad after 90 s');

    const captions = await stateIs(tab1, 'captions', 45000);
    numbers.captionsStateMs = captions ? Date.now() - tOpen : null;
    step('(a) the orchestrator starts captions on its own', !!captions && captions.run?.tier === 2 && captions.active, JSON.stringify(captions));
    const firstSeg = await until(async () => (await evaluate(opt, 'window.__media')).find((e) => e.event.type === 'segment'), 60000, 200);
    numbers.firstSegmentMs = firstSeg ? firstSeg.at - tOpen : null;
    const active1 = await until(async () => {
      const r = await trackInfo(page1);
      return r && r.active.some((t) => t.includes('\n')) ? r : null;
    }, 60000, 300);
    numbers.firstActiveCueMs = active1 ? Date.now() - tOpen : null;
    const ev1 = await evidence(tab1);
    numbers.capture = ev1?.capture && { on: ev1.capture.on, key: ev1.capture.key, pushes: ev1.capture.pushes, segments: ev1.capture.segments };
    numbers.emptySiteCaptions = (ev1?.subtitles || []).map((s) => s.cueCount);
    numbers.videoDuration = ev1?.media?.find((x) => x.elId === ev1.primaryElId)?.duration ?? null;
    step('(a) real sentences come back and show on the video’s track, bilingual', !!firstSeg && !!active1 && ev1?.capture?.on === true, `first sentence ${numbers.firstSegmentMs} ms, first cue on track ${numbers.firstActiveCueMs} ms after opening; ${JSON.stringify(active1?.active)}`);
    if (!active1) {
      await dump(tab1);
      console.log(`    track: ${JSON.stringify(await trackInfo(page1))}`);
      const evs = await evaluate(opt, 'window.__media');
      console.log(`    media events: ${evs.map((e) => `${e.key.split(':').pop()} ${e.event.type}${e.event.reason ? ':' + e.event.reason : ''}${e.event.state ? ':' + e.event.state : ''}`).join(', ')}`);
    }
    if (active1) {
      await shoot(page1, '1-auto-captions');
      const box2 = await evaluate(page1, `(() => { const r = document.querySelector('video').getBoundingClientRect(); return { x: r.left, y: r.top + r.height * 0.6, width: r.width, height: r.height * 0.4 }; })()`);
      await shoot(page1, '2-auto-captions-zoom', box2);
    }
    const [badgeText1, badgeTitle1] = (await badge(tab1)) || [];
    step('(a) the badge says captions', badgeText1 === 'CC', `${badgeText1} · ${badgeTitle1}`);

    // ---- (b) pause / play ----
    await evaluate(page1, `(document.querySelector('video').pause(), true)`);
    const tPause = Date.now();
    const stillOn = await sleep(3500).then(() => state(tab1));
    const stopped = await until(async () => {
      const ev = await evidence(tab1);
      return ev?.capture && !ev.capture.on ? ev.capture : null;
    }, 8000);
    numbers.pauseToStopMs = stopped ? Date.now() - tPause : null;
    step('(b) pausing stops capture after the grace, not before', stillOn?.state === 'captions' && !!stopped && numbers.pauseToStopMs >= 4500, `after 3.5 s: ${stillOn?.state}; stopped after ${numbers.pauseToStopMs} ms (${stopped?.reason})`);
    if (!(stillOn?.state === 'captions' && stopped)) await dump(tab1);
    // Not awaited: play() never settles while the player is between videos.
    await evaluate(page1, `(document.querySelector('video').play().catch(() => {}), true)`);
    const tPlay = Date.now();
    const resumed = await until(async () => {
      const ev = await evidence(tab1);
      return ev?.capture?.on && ev.capture.key !== numbers.capture?.key ? ev.capture : null;
    }, 15000);
    numbers.playToResumeMs = resumed ? Date.now() - tPlay : null;
    step('(b) playing again restarts capture under a new key', !!resumed, `${resumed?.key} after ${numbers.playToResumeMs} ms`);

    // ---- (c) a second tab ----
    const { sessionId: page2 } = await open(`https://www.youtube.com/watch?v=${VIDEO2}`);
    pages.add(page2);
    const tab2 = await until(async () => {
      const t = await tabIdOf(`https://www.youtube.com/watch?v=${VIDEO2}`);
      return t && t !== tab1 ? t : null;
    }, 15000);
    const tSwitch = Date.now();
    const tab1Stopped = await until(async () => {
      const s = await state(tab1);
      return s && s.state !== 'captions' && !s.run ? s : null;
    }, 15000);
    numbers.tab1StopMs = tab1Stopped ? Date.now() - tSwitch : null;
    const tab2On = await stateIs(tab2, 'captions', 60000);
    numbers.tab2StartMs = tab2On ? Date.now() - tSwitch : null;
    step('(c) the new active tab takes over; the first stops', !!tab1Stopped && !!tab2On && tab2On.active, `tab ${tab1} → ${tab1Stopped?.state} (${tab1Stopped?.block}) after ${numbers.tab1StopMs} ms; tab ${tab2} captions after ${numbers.tab2StartMs} ms`);
    if (!tab2On) await dump(tab2);
    await activate(tab1);
    const back = await stateIs(tab1, 'captions', 30000);
    const tab2Off = await until(async () => {
      const s = await state(tab2);
      return s && !s.run ? s : null;
    }, 15000);
    step('(c) switching back hands captions back to the first tab', !!back && !!tab2Off, `tab ${tab1} ${back?.state}, tab ${tab2} ${tab2Off?.state} (${tab2Off?.block})`);
    await cdp.send('Target.closeTarget', { targetId: (await cdp.send('Target.getTargets')).targetInfos.find((t) => t.url.includes(VIDEO2))?.targetId });

    // ---- (d) prefs ----
    await setPrefs({ siteOff: { youtube: true } });
    const off = await stateIs(tab1, 'off', 10000);
    const [badgeOff, titleOff] = (await badge(tab1)) || [];
    const evOff = await evidence(tab1);
    step('(d) site switched off: capture stops, badge says off', !!off && evOff?.capture?.on === false && badgeOff === 'off', `${off?.state}; badge ${badgeOff} · ${titleOff}`);
    await setPrefs({ siteOff: {} });
    const onAgain = await stateIs(tab1, 'captions', 20000);
    step('(d) switched on again: captions resume', !!onAgain, JSON.stringify(onAgain?.run));
    await ext('tab/command', { tabId: tab1, command: { cmd: 'query' } });

    // ---- (e) DRM page ----
    const { sessionId: page3 } = await open('about:blank');
    pages.add(page3);
    await cdp.send('Network.enable', {}, page3);
    await cdp.send('Network.setBypassServiceWorker', { bypass: true }, page3);
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: 'https://www.youtube.com/tc-e2e/*' }] }, page3);
    const unlisten = cdp.listen((m) => {
      if (m.method !== 'Fetch.requestPaused' || m.sessionId !== page3) return;
      cdp.send('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'text/html; charset=utf-8' }], body: Buffer.from(DRM_HTML).toString('base64') }, page3).catch(() => {});
    });
    await cdp.send('Page.navigate', { url: DRM_PAGE }, page3);
    const tab3 = await until(() => tabIdOf(DRM_PAGE), 10000);
    const emeResult = await until(() => evaluate(page3, 'window.__eme'), 10000);
    const prompt = await stateIs(tab3, 'prompt', 20000);
    const bar = await until(() => evaluate(page3, `(() => { const h = document.querySelector('.tc-nt-host'); const b = h && h.shadowRoot.querySelector('.tc-nt-bar'); if (!b || b.hidden) return null; const r = h.shadowRoot.querySelector('.tc-nt-btn').getBoundingClientRect(); return { text: h.shadowRoot.querySelector('.tc-nt-text').textContent, button: h.shadowRoot.querySelector('.tc-nt-btn').textContent, x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`), 10000);
    step('(e) a DRM page gets the notice in the page, nothing opened yet', !!prompt && !!bar && !(await evidence(tab3))?.listen, `eme ${emeResult}; ${JSON.stringify(bar)}; state ${prompt?.state}`);
    if (!prompt || !bar) await dump(tab3);
    if (bar) await shoot(page3, '3-drm-notice');
    const [badgePrompt] = (await badge(tab3)) || [];
    if (bar) {
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, x: bar.x, y: bar.y, button: 'left', clickCount: type === 'mouseMoved' ? 0 : 1 }, page3);
    }
    const listening = await stateIs(tab3, 'listening', 20000);
    const listenEv = await until(async () => {
      const ev = await evidence(tab3);
      return ev?.listen?.on && ev.listen.lastStatus ? ev.listen : null;
    }, 20000);
    const [badgeL, titleL] = (await badge(tab3)) || [];
    numbers.listen = listenEv && { key: listenEv.key, mediaStartS: listenEv.mediaStartS, lastStatus: listenEv.lastStatus };
    step('(e) the button opens a listen session in the app; the badge says listening', !!listening && !!listenEv && badgeL === 'L', `${JSON.stringify(numbers.listen)}; badge ${badgePrompt} → ${badgeL} · ${titleL}; bar hidden: ${await evaluate(page3, `document.querySelector('.tc-nt-host').shadowRoot.querySelector('.tc-nt-bar').hidden`)}`);
    await evaluate(page3, `document.getElementById('v').pause()`);
    const tPause3 = Date.now();
    const listenClosed = await until(async () => {
      const ev = await evidence(tab3);
      return ev?.listen && !ev.listen.on ? ev.listen : null;
    }, 10000);
    numbers.listenPauseToCloseMs = listenClosed ? Date.now() - tPause3 : null;
    step('(e) pausing closes the listen session at once', !!listenClosed && listenClosed.reason === 'paused' && numbers.listenPauseToCloseMs < 2000, `${listenClosed?.reason} after ${numbers.listenPauseToCloseMs} ms`);
    unlisten();

    // ---- (f) translate through the channel ----
    const tr = await ext('companion/translate', { items: [{ id: 'a', text: 'hello' }, { id: 'b', text: 'world' }], source: 'en', target: 'zh' });
    step('(f) translate through the channel answers in order', tr?.ok && tr.result?.[0]?.text === '[译] hello' && tr.result?.[1]?.text === '[译] world', JSON.stringify(tr?.result || tr?.error));

    numbers.siteExceptions = pageExceptions.site;
    step('no exceptions from our scripts on the pages, none in extension contexts', pageExceptions.ours.length === 0 && extProblems.length === 0, [...pageExceptions.ours, ...extProblems].join(' || '));
    console.log(`\n  numbers: ${JSON.stringify(numbers, null, 1)}`);
    console.log(`  screenshots:\n    ${shots.join('\n    ')}`);
  } finally {
    const how = await browser.close();
    step('browser closed', true, `pid ${browser.child.pid} via ${how}`);
    await companion.stop();
    await engineManager.stopSessionAndWait?.('e2e-s5');
    console.log(`  sandbox left for the recycle bin: ${box.dir}`);
  }
  return summary();
}

run(main);
