// Page hooks end to end on a real YouTube page: the real companion server
// and listen engine in a sandbox Electron, the built extension in Chrome with
// a throwaway profile, everything read through the extension's own messages
// (TAB_EVIDENCE / TAB_COMMAND from its options page) and the page over CDP.
//
//   (a) the <video> is found and reported playing
//   (b) MSE audio init segment and appends reach the worker (WebM / Opus),
//       bytes and media times grow; lead = buffered audio ahead of playback
//   (c) yt-captions-on makes the player fetch timedtext, and it is copied
//   (d) mse-capture on: real recognized sentences come back as cues and the
//       video's T-Caption track shows them (screenshot)
//   (e) a click on a related video (yt-navigate-finish) resets the evidence
//       and it is reported again for the new video
//   (f) a page we serve at a youtube.com URL (CDP Fetch interception) asks
//       for com.widevine.alpha, sets MediaKeys, fires 'encrypted', and
//       fetches a VTT and an XHR json3 timedtext, all reported and parsed
//
//   npx electron extension/scripts/e2e-hooks.js --packs <installed asr-models dir> [--browser <exe>] [--out <screenshots dir>] [--headed] [--video <id>]
//
// Set TEMP to a folder on the packs' drive so they are hard-linked, not
// copied. --headed opens a real browser window (still driven only over CDP).
// The sandbox is left in place for the recycle bin.
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
const TEST_PAGE = 'https://www.youtube.com/tc-e2e/eme';

const VTT = 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nServed caption one\n\n00:00:03.000 --> 00:00:05.000\nServed caption two\n';
const JSON3 = JSON.stringify({ events: [{ tStartMs: 500, dDurationMs: 1500, segs: [{ utf8: 'json3 ' }, { utf8: 'over XHR' }] }, { tStartMs: 2000, dDurationMs: 1000, segs: [{ utf8: 'second' }] }] });
const EME_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>T-Caption hooks test</title></head>
<body style="font: 16px system-ui; padding: 24px"><h1>T-Caption hooks test page</h1><video id="v" width="320" height="180"></video><pre id="log"></pre>
<script>
  const log = (s) => (document.getElementById('log').textContent += s + '\\n');
  window.__done = (async () => {
    const out = {};
    const vtt = await fetch('/tc-e2e/subs.vtt');
    out.vtt = (await vtt.text()).length;
    out.json3 = await new Promise((resolve) => {
      const x = new XMLHttpRequest();
      x.open('GET', '/api/timedtext?v=tcE2Etest01&lang=en&fmt=json3&pot=e2e');
      x.onload = () => resolve(x.responseText.length);
      x.send();
    });
    const config = [{ initDataTypes: ['cenc'], audioCapabilities: [{ contentType: 'audio/mp4; codecs="mp4a.40.2"' }], videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.42E01E"' }] }];
    try { await navigator.requestMediaKeySystemAccess('com.widevine.alpha', config); out.widevine = 'granted'; } catch (e) { out.widevine = e.name; }
    try {
      const access = await navigator.requestMediaKeySystemAccess('org.w3.clearkey', [{ initDataTypes: ['keyids'], videoCapabilities: [{ contentType: 'video/webm; codecs="vp8"' }] }]);
      await document.getElementById('v').setMediaKeys(await access.createMediaKeys());
      out.clearkey = 'set';
    } catch (e) { out.clearkey = e.name; }
    document.getElementById('v').dispatchEvent(new MediaEncryptedEvent('encrypted', { initDataType: 'cenc', initData: new Uint8Array(8).buffer }));
    log(JSON.stringify(out));
    return out;
  })();
</script></body></html>`;

async function main() {
  const packsDir = arg('--packs');
  const exe = findBrowser(arg('--browser'));
  if (!packsDir || !fs.existsSync(packsDir) || !exe) {
    console.error('usage: --packs <dir with asr-base-sense-voice/ etc.> [--browser <chrome.exe>] [--out <dir>] [--headed]');
    return 2;
  }
  const box = sandbox('tt-caption-hooks');
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
  const companion = initCompanion({ store, engineManager, translateStream, logger, version: 'e2e-s4', getPrivacyMode: () => 'standard' });
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

  try {
    const { id, sw } = await loadExtension(browser, outDir);
    await attach(sw.targetId);
    step('extension loaded', true, id);
    const { sessionId: opt } = await open(`chrome-extension://${id}/options.html`);
    await sleep(500);
    companion.openPairing();
    const paired = await evaluate(opt, `chrome.runtime.sendMessage({ type: 'companion/pair' })`);
    step('paired through the extension', paired?.ok && paired.result.status === 'ready', paired?.result?.status || JSON.stringify(paired?.error));
    await evaluate(opt, `chrome.storage.local.set({ prefs: { mode: 'track' } }).then(() => true)`);
    await evaluate(opt, `(() => { window.__media = []; chrome.runtime.onMessage.addListener((m) => { if (m && m.type === 'media/event') window.__media.push({ at: Date.now(), ...m.payload }); }); })()`);

    const ext = (type, payload) => evaluate(opt, `chrome.runtime.sendMessage(${JSON.stringify({ type, payload })})`);
    const evidence = async (tabId) => (await ext('tab/evidence', { tabId }))?.result;
    const command = (tabId, cmd) => ext('tab/command', { tabId, command: cmd });
    const tabIdOf = (prefix) => evaluate(opt, `chrome.tabs.query({}).then((ts) => ts.find((t) => (t.url || t.pendingUrl || '').startsWith(${JSON.stringify(prefix)}))?.id ?? null)`);
    const until = async (fn, ms, every = 250) => {
      for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(every)) {
        const v = await fn().catch(() => null);
        if (v) return v;
      }
      return null;
    };

    // ---- the real YouTube page ----
    const watchUrl = `https://www.youtube.com/watch?v=${VIDEO}`;
    const { sessionId: page } = await open('about:blank');
    cdp.listen((m) => {
      if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails;
        const where = `${d.url || ''} ${d.stackTrace?.callFrames?.map((f) => f.url).join(' ') || ''}`;
        const text = d.exception?.description || d.text;
        if (where.includes('chrome-extension://') || /content-(main|isolated)/.test(where)) (m.sessionId === page ? pageExceptions.ours : extProblems).push(text);
        else if (m.sessionId === page) pageExceptions.site++;
        else extProblems.push(text);
      }
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error' && m.sessionId !== page) extProblems.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
    });
    const js = (expr) => evaluate(page, expr);
    const shoot = async (name, clip) => {
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) }, page);
      const file = path.join(shotsDir, `t-caption-s4-${name}.png`);
      fs.writeFileSync(file, Buffer.from(data, 'base64'));
      shots.push(file);
    };
    const tOpen = Date.now();
    await cdp.send('Page.navigate', { url: watchUrl }, page);
    const tab = await until(() => tabIdOf('https://www.youtube.com/watch'), 15000);
    step('YouTube tab known to the extension', Number.isInteger(tab), `tab ${tab}`);

    // An ad (if any) plays first through the same element; wait it out.
    const adGone = await until(() => js(`!document.querySelector('#movie_player.ad-showing') && !!document.querySelector('#movie_player')`), 90000, 500);
    if (!adGone) console.log('  [note] the player still shows an ad after 90 s');

    // (a)
    const playing = await until(async () => {
      const ev = await evidence(tab);
      const m = ev?.media?.find((x) => x.elId === ev.primaryElId && x.state === 'playing' && x.currentTime > 0.5);
      return m ? { ev, m } : null;
    }, 45000);
    numbers.firstPlayMs = playing ? Date.now() - tOpen : null;
    step('(a) the <video> is found and reported playing', !!playing, playing ? `elId ${playing.m.elId}, ${playing.m.width}×${playing.m.height}, duration ${playing.m.duration} s, src ${playing.m.src.slice(0, 40)}…, after ${numbers.firstPlayMs} ms` : '');
    step('(a) hooks report ok in the page world', playing && playing.ev.hooks?.main === 'ok' && playing.ev.hooks.mse === 'ok' && playing.ev.hooks.fetch === 'ok' && playing.ev.hooks.xhr === 'ok', JSON.stringify(playing?.ev.hooks));
    await shoot('1-youtube-playing');

    // (b)
    const audio1 = await until(async () => {
      const ev = await evidence(tab);
      return ev?.mse?.audio?.init && ev.mse.audio.chunks >= 3 ? ev : null;
    }, 30000);
    const a1 = audio1?.mse.audio;
    const m1 = audio1?.media.find((x) => x.elId === audio1.primaryElId);
    const t1 = Date.now();
    await sleep(10000);
    const audio2 = await evidence(tab);
    const a2 = audio2?.mse.audio;
    const m2 = audio2?.media.find((x) => x.elId === audio2.primaryElId);
    const dt = (Date.now() - t1) / 1000;
    const pageView = await js(`(() => { const v = document.querySelector('video'); return { t: v.currentTime, end: v.buffered.length ? v.buffered.end(v.buffered.length - 1) : null, error: v.error && v.error.code, rate: v.playbackRate, tcGlobal: typeof window.__tCaption, fetchNative: /\\[native code\\]/.test(Function.prototype.toString.call(window.fetch)), state: document.getElementById('movie_player')?.getPlayerState?.() }; })()`);
    Object.assign(numbers, {
      audioMime: a2?.mime,
      appendsIn10s: a2 && a1 ? a2.chunks - a1.chunks : null,
      bytesPerS: a2 && a1 ? Math.round((a2.bytes - a1.bytes) / dt) : null,
      avgAppendKB: a2 ? +(a2.bytes / a2.chunks / 1024).toFixed(1) : null,
      audioBytesTotal: a2?.bytes,
      audioChunksTotal: a2?.chunks,
      leadAudioS: a2 && m2 ? +(a2.lastTimeS - m2.currentTime).toFixed(1) : null,
      leadBufferedS: m2?.bufferedEndS != null ? +(m2.bufferedEndS - m2.currentTime).toFixed(1) : null,
      playbackRateSeen: m1 && m2 ? +((m2.currentTime - m1.currentTime) / dt).toFixed(2) : null,
      siteExceptionsSoFar: pageExceptions.site,
    });
    step('(b) audio init segment and appends reach the worker as WebM / Opus', a1 && /audio\/webm/.test(a1.mime) && a1.codec === 'opus' && a1.forward && a1.init, `${a1?.mime}, ${a1?.chunks} appends, ${a1?.bytes} bytes, ${a1?.firstTimeS}–${a1?.lastTimeS} s`);
    step('(b) bytes and media times keep growing', a2 && a2.bytes > a1.bytes && a2.lastTimeS > a1.lastTimeS, `+${numbers.appendsIn10s} appends / ${dt.toFixed(1)} s, ${numbers.bytesPerS} B/s, lastTimeS ${a1?.lastTimeS} → ${a2?.lastTimeS}`);
    step('(b) playback undisturbed (rate ~1, no media error, nothing on window)', numbers.playbackRateSeen > 0.8 && !pageView.error && pageView.tcGlobal === 'undefined' && pageView.fetchNative && pageExceptions.ours.length === 0, JSON.stringify(pageView));
    console.log(`  lead: audio ${numbers.leadAudioS} s, buffered ${numbers.leadBufferedS} s ahead of currentTime ${m2?.currentTime}`);

    // (c)
    const subsBefore = (await evidence(tab))?.subtitles?.length || 0;
    const t0c = Date.now();
    const cap = await command(tab, { cmd: 'yt-captions-on' });
    const subs = await until(async () => {
      const ev = await evidence(tab);
      const list = (ev?.subtitles || []).filter((s) => s.mediaId === VIDEO && s.at >= t0c - 50);
      return list.length ? list : null;
    }, 10000);
    numbers.captionsOn = cap?.result || cap?.error;
    numbers.timedtext = subs?.map((s) => ({ lang: s.lang, kind: s.kind, status: s.status, via: s.via, format: s.format, cueCount: s.cueCount, pot: /[?&]pot=/.test(s.url) }));
    step('(c) yt-captions-on: the player fetched timedtext itself and it was copied (with its pot)', cap?.ok && cap.result.method && subs?.some((s) => /[?&]pot=/.test(s.url) && s.status === 200), `${JSON.stringify(cap?.result || cap?.error)}; before ${subsBefore}; ${JSON.stringify(numbers.timedtext)}`);
    if (subs && subs.every((s) => s.cueCount === 0)) console.log('  [note] the timedtext body was empty: YouTube answers this automated browser with an empty 200 (cues come in a normal browser); parsing is checked in (f)');
    await command(tab, { cmd: 'site-captions', value: 'hide' });

    // (d)
    const tCap = Date.now();
    const on = await command(tab, { cmd: 'mse-capture', on: true, lang: 'en', targetLang: 'zh' });
    step('(d) mse-capture on opens the stream and starts forwarding', on?.ok && on.result.init && on.result.backlogBytes > 0, JSON.stringify(on?.result || on?.error));
    const firstSeg = await until(async () => {
      const evs = await evaluate(opt, 'window.__media');
      return evs.find((e) => e.event.type === 'segment');
    }, 60000, 200);
    numbers.firstSegmentMs = firstSeg ? firstSeg.at - tCap : null;
    const active = await until(async () => {
      const r = await js(`(() => { const v = document.querySelector('video'); const t = Array.from(v.textTracks).find((x) => x.label === 'T-Caption'); return t && t.activeCues && t.activeCues.length ? { mode: t.mode, cues: t.cues.length, t: v.currentTime, active: Array.from(t.activeCues).map((c) => ({ id: c.id, start: c.startTime, end: c.endTime, text: c.text })) } : null; })()`);
      return r && r.active.some((c) => c.text.includes('\n')) ? r : null;
    }, 60000, 300);
    numbers.firstActiveCueMs = active ? Date.now() - tCap : null;
    const evs = await evaluate(opt, 'window.__media');
    const segs = evs.filter((e) => e.event.type === 'segment').map((e) => e.event);
    numbers.segments = segs.length;
    numbers.firstSegments = segs.slice(0, 4).map((s) => `[${s.start}–${s.end}] ${s.text}`);
    step('(d) MEDIA_EVENT brings real recognized sentences on the media timeline', segs.length >= 2 && segs.every((s) => s.text && s.end > s.start), `${segs.length} so far, first after ${numbers.firstSegmentMs} ms: ${numbers.firstSegments.join(' | ')}`);
    step('(d) the cues command shows them on the video’s T-Caption track (with translation)', !!active, JSON.stringify(active));
    if (active) {
      await sleep(300);
      await shoot('2-track-captions');
      const box2 = await js(`(() => { const r = document.querySelector('video').getBoundingClientRect(); return { x: r.left, y: r.top + r.height * 0.6, width: r.width, height: r.height * 0.4 }; })()`);
      await shoot('3-track-captions-zoom', box2);
    }
    const capEv = (await evidence(tab))?.capture;
    numbers.capture = capEv && { pushes: capEv.pushes, bytes: capEv.bytes, segments: capEv.segments, translations: capEv.translations };
    const off = await command(tab, { cmd: 'mse-capture', on: false });
    step('(d) mse-capture off closes the stream', off?.ok && off.result.on === false && off.result.stats?.blocks > 0, JSON.stringify(off?.result?.stats || off?.error));

    // (e)
    const before = await evidence(tab);
    // The title link of a related video (the thumbnail may turn into a hover preview).
    const findLink = `(() => {
      const a = [...document.querySelectorAll('#secondary a[href*="/watch?v="], ytd-watch-next-secondary-results-renderer a[href*="/watch?v="]')].find((x) => {
        const r = x.getBoundingClientRect();
        return r.width > 40 && r.height > 12 && r.top > 0 && r.bottom < innerHeight && !x.href.includes(${JSON.stringify(VIDEO)}) && !x.querySelector('img');
      });
      if (!a) return null;
      const r = a.getBoundingClientRect();
      const x = r.left + Math.min(r.width / 2, 40);
      const y = r.top + r.height / 2;
      const hit = document.elementFromPoint(x, y);
      return { href: a.href, x, y, hit: hit && hit.closest('a') === a };
    })()`;
    const link = await until(() => js(findLink), 20000, 500);
    const navigated = async (ms) =>
      until(async () => {
        const ev = await evidence(tab);
        return ev && ev.navSeq === before.navSeq + 1 ? ev : null;
      }, ms);
    let navOk = null;
    let navBy = null;
    if (link) {
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, x: link.x, y: link.y, button: 'left', clickCount: type === 'mouseMoved' ? 0 : 1 }, page);
      navOk = await navigated(8000);
      navBy = navOk ? 'cdp-mouse' : null;
      if (!navOk) {
        await js(`[...document.querySelectorAll('a')].find((x) => x.href === ${JSON.stringify(link.href)})?.click()`);
        navOk = await navigated(12000);
        navBy = navOk ? 'element.click' : null;
      }
    }
    const nextId = navOk?.mediaId;
    numbers.navigation = { link: link?.href, hitTest: link?.hit, by: navBy };
    step('(e) a related-video click navigates in page: new navSeq and media id, old subtitles gone', navOk && nextId && nextId !== VIDEO && navOk.subtitles.every((s) => s.mediaId === nextId) && navOk.capture === null, `${link?.href} by ${navBy} → navSeq ${navOk?.navSeq}, mediaId ${nextId}, subtitles ${navOk?.subtitles.length}`);
    const again = await until(async () => {
      const ev = await evidence(tab);
      const m = ev?.media?.find((x) => x.elId === ev.primaryElId && x.state === 'playing' && x.currentTime > 0.5);
      const a = ev?.mse.audio;
      return ev && ev.mediaId === nextId && m && a?.init && a.lastTimeS !== null ? { ev, m } : null;
    }, 60000, 500);
    const firstAudio = before.mse.audio;
    numbers.afterNav = again && {
      mediaId: again.ev.mediaId,
      currentTime: again.m.currentTime,
      src: again.m.src.slice(0, 60),
      sameMediaSource: again.m.src === before.media.find((x) => x.elId === before.primaryElId)?.src,
      audio: again.ev.mse.audio,
      streams: again.ev.mse.streams.map((s) => ({ id: s.streamId, ms: s.msId, kind: s.kind, inits: s.inits, chunks: s.chunks, alive: s.alive })),
      sameAudioStream: firstAudio && again.ev.mse.audio.streamId === firstAudio.streamId,
    };
    step('(e) the new video is reported again: playing, with MSE audio and an init segment', !!again && nextId && again.ev.hooks?.main === 'ok', JSON.stringify(numbers.afterNav));
    if (again) await shoot('4-after-navigation');

    // (f)
    const { sessionId: test } = await open('about:blank');
    // YouTube's own service worker would answer before the interception.
    await cdp.send('Network.enable', {}, test);
    await cdp.send('Network.setBypassServiceWorker', { bypass: true }, test);
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: 'https://www.youtube.com/tc-e2e/*' }, { urlPattern: 'https://www.youtube.com/api/timedtext?v=tcE2Etest01*' }] }, test);
    const served = [];
    const unlisten = cdp.listen((m) => {
      if (m.method !== 'Fetch.requestPaused' || m.sessionId !== test) return;
      const u = m.params.request.url;
      const [type, body] = u.endsWith('/eme') ? ['text/html; charset=utf-8', EME_PAGE] : u.endsWith('.vtt') ? ['text/vtt; charset=utf-8', VTT] : ['application/json; charset=UTF-8', JSON3];
      served.push(u);
      cdp.send('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: type }], body: Buffer.from(body).toString('base64') }, test).catch(() => {});
    });
    await cdp.send('Page.navigate', { url: TEST_PAGE }, test);
    const testTab = await until(() => tabIdOf(TEST_PAGE), 10000);
    const result = await until(() => evaluate(test, 'window.__done'), 15000);
    const fev = await until(async () => {
      const ev = await evidence(testTab);
      return ev?.eme?.count >= 3 && ev.subtitles.length >= 2 ? ev : null;
    }, 10000);
    unlisten();
    numbers.emePage = { result, served: served.length, eme: fev?.eme, subtitles: fev?.subtitles.map((s) => ({ via: s.via, format: s.format, cueCount: s.cueCount, lang: s.lang })) };
    step(
      '(f) EME use is reported: key systems asked for, setMediaKeys and encrypted',
      fev?.eme?.keySystem === 'com.widevine.alpha' && fev.eme.keySystems.includes('org.w3.clearkey') && ['request', 'setMediaKeys', 'encrypted'].every((v) => fev.eme.seen.includes(v)) && fev.hooks?.eme === 'ok',
      `${JSON.stringify(fev?.eme)}; page saw ${JSON.stringify(result)}`
    );
    step('(f) fetch VTT and XHR json3 responses are copied and parsed', fev?.subtitles.some((s) => s.via === 'fetch' && s.format === 'vtt' && s.cueCount === 2) && fev.subtitles.some((s) => s.via === 'xhr' && s.format === 'json3' && s.cueCount === 2 && s.mediaId === 'tcE2Etest01'), JSON.stringify(numbers.emePage.subtitles));

    numbers.siteExceptions = pageExceptions.site;
    step('no exceptions from our scripts on the page, none in extension contexts', pageExceptions.ours.length === 0 && extProblems.length === 0, [...pageExceptions.ours, ...extProblems].join(' || '));
    console.log(`\n  numbers: ${JSON.stringify(numbers, null, 1)}`);
    console.log(`  screenshots:\n    ${shots.join('\n    ')}`);
  } finally {
    const how = await browser.close();
    step('browser closed', true, `pid ${browser.child.pid} via ${how}`);
    await companion.stop();
    await engineManager.stopSessionAndWait?.('e2e-s4');
    console.log(`  sandbox left for the recycle bin: ${box.dir}`);
  }
  return summary();
}

run(main);
