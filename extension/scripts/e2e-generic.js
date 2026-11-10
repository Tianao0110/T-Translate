// Ordinary sites in a real browser, hands off except for the popup's button:
// the real companion server and listen engine in a sandbox Electron, the
// built extension in Chrome with a throwaway profile (lib/e2e-shell.js), a
// local server reached as localhost, 127.0.0.1 and media.localhost, pages
// whose <video src> is a progressive MP4 (SAPI speech, H.264 test video).
//
// A headless browser never answers the permission dialog (permissions.request
// stays pending; with a window the dialog waits for a person), so this build
// lists localhost and media.localhost as host permissions (build.mjs
// extraHosts): asking for a host the browser already grants resolves at
// once, as after the user accepted. media.localhost is then held back on
// chrome://extensions (developerPrivate.removeHostPermission, what the
// extension's "site access" setting does) and granted there again
// (addHostPermission) as the stand-in for the user accepting the dialog.
//
//   (a) a page on localhost: no scripts (fetch untouched), no evidence; the
//       popup says T-Caption is not on here and offers "Allow on this site"
//   (b) that button clicked (CDP mouse events, a user gesture): the request
//       resolves, the scripts are registered and in the page at once, the
//       orchestrator opens direct by itself, bilingual captions on the track
//   (d) a seek past 3 s: direct closed and opened again from the new place
//       (a new key, fromS near it), new captions there
//   (c) a page on 127.0.0.1 (allowed from its popup) whose video is on
//       media.localhost: prompt for that host, the page notice, the '!'
//       badge, the popup's "Allow"; its click records what the request does,
//       then the grant arrives: captions start by themselves
//   (e) the overlay on a portrait (720×1280) video: text size before / after
//       side by side; a 16:9 box keeps the old size
//   (f) the site removed in the options page: evidence gone, captions off the
//       page, the badge cleared; reloaded: no scripts, "Allow on this site" again
//
//   npx electron extension/scripts/e2e-generic.js --packs <installed asr-models dir> --ffmpeg <ffmpeg.exe> [--browser <exe>] [--out <screenshots dir>] [--headed]
//
// Set TEMP to a folder on the packs' drive so they are hard-linked, not
// copied. The sandbox is left in place for the recycle bin.
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { execFileSync } = require('child_process');
const { REPO, arg, sleep, checklist, run } = require('../../scripts/lib/electron-smoke');
const { startShell } = require('./lib/e2e-shell');
const { synthesizeWav } = require('./lib/speech');

const { step, summary } = checklist();
const MEDIA_HOST = 'http://media.localhost/*';
const OLD_SIZE = 'clamp(14px, 4.6cqh, 52px)';

const LOCALE = /^zh/i.test(arg('--lang') || 'en-US') ? 'zh_CN' : 'en';
const MESSAGES = JSON.parse(fs.readFileSync(path.join(REPO, `extension/_locales/${LOCALE}/messages.json`), 'utf8'));
const msg = (k, subs = []) => subs.reduce((s, v, i) => s.replace(new RegExp(`\\$${Object.keys(MESSAGES[k].placeholders || {})[i]}\\$`, 'i'), v), MESSAGES[k].message);

const LINES = [
  'Good evening everyone, and welcome to the city council briefing for this week.',
  'Our first topic is the new bus schedule that starts on the first of next month.',
  'Buses on the main line will now come every eight minutes during rush hour.',
  'The night service will run until two in the morning on Fridays and Saturdays.',
  'Our second topic is the road work on River Street near the old library.',
  'One lane will be closed for about three weeks while the pipes are replaced.',
  'Drivers should use Park Avenue instead, and cyclists can keep using the bike lane.',
  'Our third topic is the summer festival in the central park.',
  'There will be music, food trucks and games for children every weekend in July.',
  'Volunteers are welcome, and you can sign up at the community center.',
  'Finally, the public pool will open again after the repairs are finished.',
  'The new opening hours are from seven in the morning until nine at night.',
  'Thank you for listening, and we hope to see you at the next meeting.',
  'That is all for tonight, good night and take care.',
];

function makeMedia(dir, ffmpeg) {
  const wav = synthesizeWav(path.join(dir, 'speech.wav'), LINES);
  // prettier-ignore
  const enc = (size, loops, out) => execFileSync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=25`,
    '-stream_loop', String(loops), '-i', wav,
    '-map', '0:v', '-map', '1:a', '-shortest',
    '-c:v', 'libx264', '-preset', 'veryfast', '-b:v', '1500k', '-pix_fmt', 'yuv420p', '-g', '50',
    '-c:a', 'aac', '-ar', '48000', '-ac', '1', '-b:a', '96k', '-map_metadata', '-1',
    '-movflags', '+faststart', path.join(dir, out),
  ]);
  enc('640x360', 1, 'speech.mp4');
  enc('720x1280', 0, 'portrait.mp4');
}

const STYLE = '<style>body{margin:0;background:#1b1d22;font:14px system-ui}#v{display:block;margin:16px;background:#000}</style>';
const PAGES = {
  'fast.html': () => `<video id="v" src="/speech.mp4" controls preload="auto" style="width:960px;height:540px"></video>`,
  'cross.html': (port) => `<video id="v" src="http://media.localhost:${port}/speech.mp4" controls preload="auto" style="width:960px;height:540px"></video>`,
  'portrait.html': () => `<video id="v" src="/portrait.mp4" controls preload="auto" style="width:360px;height:640px"></video>`,
};

// Pages and the MP4s by range; logs which host each MP4 request came in on.
function serve(dir) {
  const srv = { log: [] };
  const server = http.createServer((req, res) => {
    const name = new URL(req.url, 'http://x').pathname.slice(1);
    const port = server.address().port;
    if (Object.hasOwn(PAGES, name)) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(`<!doctype html><html><head><meta charset="utf-8"><title>T-Caption generic</title>${STYLE}</head><body>${PAGES[name](port)}</body></html>`);
    }
    if (!/^(speech|portrait)\.mp4$/.test(name)) {
      res.writeHead(404);
      return res.end();
    }
    const file = path.join(dir, name);
    const size = fs.statSync(file).size;
    const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
    srv.log.push({ name, host: String(req.headers.host || '').split(':')[0], ext: req.headers['sec-fetch-dest'] === 'empty', at: Date.now() });
    if (!m) {
      res.writeHead(200, { 'content-type': 'video/mp4', 'accept-ranges': 'bytes', 'content-length': size });
      return fs.createReadStream(file).pipe(res);
    }
    const start = Number(m[1]);
    const end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (start >= size) {
      res.writeHead(416, { 'content-range': `bytes */${size}` });
      return res.end();
    }
    res.writeHead(206, { 'content-type': 'video/mp4', 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
    fs.createReadStream(file, { start, end }).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(Object.assign(srv, { server, port: server.address().port }))));
}

async function main() {
  const ffmpeg = arg('--ffmpeg');
  if (!ffmpeg || !fs.existsSync(ffmpeg)) {
    console.error('usage: --packs <asr-models dir> --ffmpeg <ffmpeg.exe> [--browser <exe>] [--out <dir>] [--headed]');
    return 2;
  }
  const shell = await startShell({ name: 'tt-caption-generic', step, version: 'e2e-s9b-generic', shotPrefix: 't-caption-s9b', extraHosts: ['http://localhost/*', MEDIA_HOST] });
  if (!shell) return 2;
  const { cdp, evaluate, ext, evidence, state, until, shoot, trackInfo, opt, dump, badge } = shell;
  // Our scripts in a page: an execution context of the extension's origin
  // (the page-world hooks leave no trace by design: fetch still reads native).
  const contexts = new Map(); // sessionId → Map(contextId → origin)
  cdp.listen((m) => {
    if (!m.sessionId || !String(m.method).startsWith('Runtime.executionContext')) return;
    if (!contexts.has(m.sessionId)) contexts.set(m.sessionId, new Map());
    const c = contexts.get(m.sessionId);
    if (m.method === 'Runtime.executionContextCreated') c.set(m.params.context.id, { origin: m.params.context.origin, type: m.params.context.auxData?.type, frameId: m.params.context.auxData?.frameId });
    else if (m.method === 'Runtime.executionContextDestroyed') c.delete(m.params.executionContextId);
    else if (m.method === 'Runtime.executionContextsCleared') c.clear();
  });
  const ourContexts = (session) => [...(contexts.get(session)?.entries() || [])].filter(([, c]) => c.origin === `chrome-extension://${shell.extId}`);
  // A live page agent in one of our contexts (an isolated world may outlive its scripts' use).
  const agentIn = async (session) => {
    for (const [contextId] of ourContexts(session)) {
      const r = await cdp.send('Runtime.evaluate', { expression: '!!(globalThis.__tcAgent && globalThis.__tcAgent.alive)', contextId, returnByValue: true }, session).catch(() => null);
      if (r?.result?.value === true) return true;
    }
    return false;
  };
  const contextsOf = (session) => JSON.stringify([...(contexts.get(session)?.values() || [])]);
  const swTarget = (await cdp.send('Target.getTargets')).targetInfos.find((t) => t.type === 'service_worker' && t.url.startsWith(`chrome-extension://${shell.extId}/`));
  const sw = await shell.browser.attach(swTarget.targetId);

  const mediaDir = path.join(shell.box.dir, 'media');
  fs.mkdirSync(mediaDir, { recursive: true });
  const t0media = Date.now();
  makeMedia(mediaDir, ffmpeg);
  console.log(`  media made in ${((Date.now() - t0media) / 1000).toFixed(1)} s`);
  const srv = await serve(mediaDir);
  const LOCAL = `http://localhost:${srv.port}`;
  const LOOP = `http://127.0.0.1:${srv.port}`;
  const numbers = {};

  const openBg = async (url) => {
    const { targetId } = await cdp.send('Target.createTarget', { url, background: true });
    const sessionId = await shell.browser.attach(targetId);
    await cdp.send('Page.enable', {}, sessionId);
    return { targetId, sessionId };
  };
  const contains = (o) => evaluate(opt, `chrome.permissions.contains({ origins: [${JSON.stringify(o)}] })`);
  const registered = () => evaluate(sw, `chrome.scripting.getRegisteredContentScripts().then((l) => l.map((r) => ({ id: r.id, matches: r.matches, world: r.world, runAt: r.runAt })))`);
  const sites = async () => (await ext('site/list'))?.result;
  const player = (session, js) => evaluate(session, `(() => { const v = document.getElementById('v'); ${js} })()`);
  const bilingual = (r) => (r && r.active.some((t) => t.includes('\n') && t.includes('[译]')) ? r : null);
  const genOf = (key) => /:d(\d+)$/.exec(key || '')?.[1];
  const cuesOf = async (tabId, prefix) => ((await ext('tab/command', { tabId, command: { cmd: 'cues', op: 'list' } }))?.result?.cues || []).filter((c) => String(c.id).startsWith(prefix));
  const query = async (tabId) => (await ext('tab/command', { tabId, command: { cmd: 'query' } }))?.result;
  const devPrivate = async (fn, pattern) => {
    const { targetId, sessionId } = await openBg('chrome://extensions');
    await sleep(800);
    const r = await evaluate(sessionId, `chrome.developerPrivate.${fn}(${JSON.stringify(shell.extId)}, ${JSON.stringify(pattern)}).then(() => 'ok', (e) => 'rejected: ' + e.message)`);
    await cdp.send('Target.closeTarget', { targetId });
    return r;
  };

  // The popup for a tab in a background tab (a foreground one would hide the video).
  const openPopup = async (tabId) => {
    const p = await openBg(`chrome-extension://${shell.extId}/popup.html?tab=${tabId}`);
    // What permissions.request does once the button calls it.
    await until(() => evaluate(p.sessionId, `document.readyState === 'complete'`), 5000, 100);
    await evaluate(p.sessionId, `(() => { const orig = chrome.permissions.request.bind(chrome.permissions); window.__req = []; chrome.permissions.request = (o) => { const e = { origins: o.origins, at: Date.now(), state: 'pending' }; window.__req.push(e); const pr = orig(o); pr.then((v) => { e.state = 'resolved ' + v; e.doneAt = Date.now(); }, (err) => { e.state = 'rejected ' + err.message; }); return pr; }; return true; })()`);
    return p;
  };
  const popupView = (pop) => evaluate(pop, `({ status: document.getElementById('status-text').textContent, tone: document.getElementById('status').dataset.tone, allowShown: !document.getElementById('allow-row').hidden, allow: document.getElementById('allow').textContent, note: document.getElementById('allow-note').textContent, site: document.getElementById('site-row').hidden ? null : document.getElementById('site-label').textContent, requests: window.__req })`);
  const popupIs = (pop, want, ms = 10000) =>
    until(async () => {
      const v = await popupView(pop);
      return v.status === want ? v : null;
    }, ms);
  const popBox = (pop) => evaluate(pop, `(() => { const r = document.body.getBoundingClientRect(); return { x: 0, y: 0, width: Math.ceil(r.width), height: Math.ceil(r.height) }; })()`);
  // A real click on the popup's button (mouse events through CDP: a user gesture).
  const clickAllow = async (pop) => {
    const c = await evaluate(pop, `(() => { const r = document.getElementById('allow').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    for (const type of ['mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, x: c.x, y: c.y, button: 'left', clickCount: 1 }, pop);
    return Date.now();
  };
  const overlayInfo = (session) =>
    evaluate(session, `(() => { const h = document.querySelector('.tc-cap-host'); const box = h && h.shadowRoot && h.shadowRoot.querySelector('.tc-cap-box'); const v = document.getElementById('v'); if (!box) return null; const r = box.getBoundingClientRect(); const vr = v.getBoundingClientRect(); return { lines: box.querySelectorAll('.tc-cap-line').length, chars: box.textContent.length, hidden: box.hidden, fontSize: parseFloat(getComputedStyle(box).fontSize), boxH: Math.round(r.height), videoW: Math.round(vr.width), videoH: Math.round(vr.height) }; })()`);
  const setOverlaySize = (session, value) => evaluate(session, `(() => { const h = document.querySelector('.tc-cap-host'); if (!h) return false; if (${JSON.stringify(value)}) h.style.setProperty('--tc-cap-size', ${JSON.stringify(value)}); else h.style.removeProperty('--tc-cap-size'); return true; })()`);

  async function sideBySide(name, files, labels) {
    const imgs = files.map((f) => `data:image/png;base64,${fs.readFileSync(f).toString('base64')}`);
    const html = `<div id="w" style="display:inline-flex;gap:16px;padding:16px;background:#1b1d22;color:#e6e8eb;font:15px system-ui">${imgs.map((src, i) => `<figure style="margin:0"><figcaption style="padding:0 0 8px">${labels[i]}</figcaption><img src="${src}" style="display:block"></figure>`).join('')}</div>`;
    const { targetId, sessionId } = await openBg('about:blank');
    await evaluate(sessionId, `(() => { document.body.style.margin = '0'; document.body.innerHTML = ${JSON.stringify(html)}; return true; })()`);
    // (decode() never settles in a background tab)
    await until(() => evaluate(sessionId, `[...document.images].every((i) => i.complete && i.naturalWidth > 0)`), 5000, 100);
    const box = await evaluate(sessionId, `(() => { const r = document.getElementById('w').getBoundingClientRect(); return { x: 0, y: 0, width: Math.ceil(r.width), height: Math.ceil(r.height) }; })()`);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: box.width, height: box.height, deviceScaleFactor: 1, mobile: false }, sessionId);
    const file = await shoot(sessionId, name, box);
    await cdp.send('Target.closeTarget', { targetId });
    return file;
  }

  try {
    await shell.setPrefs({ targetLang: 'zh' });
    const held = await devPrivate('removeHostPermission', MEDIA_HOST);
    const start = { localhost: await contains('http://localhost/*'), media: await contains(MEDIA_HOST), loopback: await contains('http://127.0.0.1/*') };
    step('setup: localhost readable, media.localhost held back (chrome://extensions)', held === 'ok' && start.localhost && !start.media && start.loopback, `${held}; ${JSON.stringify(start)}`);
    step('setup: nothing allowed yet, nothing registered', (await sites())?.length === 0 && (await registered()).length === 0, JSON.stringify(await registered()));

    // ---- (a) ----
    const { sessionId: page, targetId: pageTarget } = await shell.open(`${LOCAL}/fast.html`);
    shell.pages.add(page);
    const tab = await until(() => shell.tabIdOf(`${LOCAL}/fast.html`), 10000);
    await until(() => player(page, 'return v.readyState >= 2;'), 15000);
    await player(page, 'v.currentTime = 20; v.play().catch(() => {}); return true;');
    await until(() => player(page, 'return !v.paused && v.currentTime > 20;'), 10000);
    await sleep(1500);
    const evA = await evidence(tab);
    const agentA = await agentIn(page);
    step('(a) a page on localhost: no agent of ours, no evidence', evA === null && !agentA && contexts.get(page)?.size > 0, `evidence ${JSON.stringify(evA)}; agent ${agentA}; contexts ${contextsOf(page)}`);
    const { sessionId: pop1, targetId: pop1Target } = await openPopup(tab);
    const vA = await popupIs(pop1, msg('tabNotEnabled'));
    step('(a) the popup: “not on for this site” and the allow button', !!vA && vA.allowShown && vA.allow === msg('allowSite') && !vA.site, JSON.stringify(vA || (await popupView(pop1))));
    if (vA) await shoot(pop1, '1-popup-not-enabled', await popBox(pop1));

    // ---- (b) ----
    const tClick = await clickAllow(pop1);
    const req = await until(async () => {
      const v = await popupView(pop1);
      return v.requests?.length && v.requests[0].state !== 'pending' ? v.requests[0] : null;
    }, 5000, 50);
    step('(b) the click calls permissions.request for this host; granted already, it resolves at once', req?.state === 'resolved true' && req.origins?.[0] === 'http://localhost/*', `${JSON.stringify(req || (await popupView(pop1)).requests)}${req?.doneAt ? `, ${req.doneAt - tClick} ms after the click` : ''}`);
    const evB0 = await until(() => evidence(tab), 5000, 50);
    numbers.b = { clickToEvidenceMs: evB0 ? Date.now() - tClick : null };
    const regB = await registered();
    step('(b) registered for the site (one pair, document_start) and in the page at once', !!evB0 && (await sites())?.includes('http://localhost/*') && regB.length === 2 && regB.every((r) => r.matches.includes('http://localhost/*') && r.runAt === 'document_start') && regB.some((r) => r.world === 'MAIN') && (await agentIn(page)) && evB0.hooks?.main === 'ok', `evidence after ≤${numbers.b.clickToEvidenceMs} ms; sites ${JSON.stringify(await sites())}; ${JSON.stringify(regB)}; agent ${await agentIn(page)}; hooks ${JSON.stringify(evB0?.hooks)}`);
    let sawB = null;
    const runB = await until(async () => {
      const ev = await evidence(tab);
      sawB ??= bilingual(await trackInfo(page)) && Date.now();
      return ev?.direct?.on && ev.direct.segments > 0 && sawB ? ev : null;
    }, 60000, 250);
    const sB = await state(tab);
    numbers.b = {
      ...numbers.b,
      clickToDirectOnS: runB ? (runB.direct.startedAt - tClick) / 1000 : null,
      clickToFirstSentenceS: runB ? (runB.direct.firstSegmentAt - tClick) / 1000 : null,
      clickToBilingualOnTrackS: sawB ? (sawB - tClick) / 1000 : null,
      fromS: runB?.direct?.fromS,
    };
    step('(b) the orchestrator opened direct by itself; bilingual captions on the track', !!runB && sB?.state === 'captions' && sB.run?.kind === 'direct' && runB.direct.fromS >= 14 && runB.direct.fromS <= 22, `${sB?.state} ${JSON.stringify(sB?.run)}; fromS ${runB?.direct?.fromS?.toFixed(1)}; ${JSON.stringify(numbers.b)}`);
    if (!runB) await dump(tab);
    const vB = await popupIs(pop1, msg('tabCaptionsAudio'));
    const [badgeB] = (await badge(tab)) || [];
    step('(b) the popup says it recognizes, the button gone, the host’s own switch shown; badge', !!vB && !vB.allowShown && vB.site === msg('popupSite', ['localhost']) && badgeB === msg('badgeCaptions'), `${JSON.stringify(vB)}; badge ${badgeB}`);
    if (bilingual(await until(async () => bilingual(await trackInfo(page)), 15000, 100))) {
      await shoot(page, '2-allowed-captions');
      await shoot(page, '2-allowed-captions-zoom', { x: 16, y: 380, width: 960, height: 176 });
    }
    await cdp.send('Target.closeTarget', { targetId: pop1Target });

    // ---- (d) ----
    const genB = genOf(runB?.direct?.key);
    const tSeek = Date.now();
    await player(page, 'v.currentTime = 100; return true;');
    let sawD = null;
    const runD = await until(async () => {
      const ev = await evidence(tab);
      if (!ev?.direct?.on || genOf(ev.direct.key) === genB) return null;
      const t = await trackInfo(page);
      if (!sawD && bilingual(t) && t.t > 99) sawD = Date.now();
      return ev.direct.segments > 0 && sawD ? ev : null;
    }, 60000, 250);
    const genD = genOf(runD?.direct?.key);
    const cuesD = genD ? await cuesOf(tab, `d${genD}-`) : [];
    const firstD = cuesD.length ? Math.min(...cuesD.map((c) => c.start)) : null;
    const histD = ((await state(tab))?.history || []).filter((h) => h.at >= tSeek).map((h) => `${((h.at - tSeek) / 1000).toFixed(1)}s ${h.state}${h.detail ? ` ${JSON.stringify(h.detail)}` : ''}`);
    numbers.d = { seekToReopenS: runD ? (runD.direct.startedAt - tSeek) / 1000 : null, seekToFirstSentenceS: runD ? (runD.direct.firstSegmentAt - tSeek) / 1000 : null, seekToBilingualOnTrackS: sawD ? (sawD - tSeek) / 1000 : null, fromS: runD?.direct?.fromS, firstCueAtS: firstD, states: histD };
    step('(d) a seek to 100 s: direct closed and opened again (new key, fromS near 95), new captions from there', !!runD && runD.direct.fromS >= 93 && runD.direct.fromS <= 100 && firstD >= 93 && firstD < 115, `${runB?.direct?.key} → ${runD?.direct?.key}; ${JSON.stringify(numbers.d)}`);
    if (!runD) await dump(tab);
    await player(page, 'v.pause(); return true;');

    // ---- (c) ----
    const { sessionId: page2, targetId: page2Target } = await shell.open(`${LOOP}/cross.html`);
    shell.pages.add(page2);
    const tab2 = await until(() => shell.tabIdOf(`${LOOP}/cross.html`), 10000);
    await until(() => player(page2, 'return v.readyState >= 2;'), 15000);
    await player(page2, 'v.currentTime = 20; v.play().catch(() => {}); return true;');
    await until(() => player(page2, 'return !v.paused && v.currentTime > 20;'), 10000);
    const { sessionId: pop2, targetId: pop2Target } = await openPopup(tab2);
    await popupIs(pop2, msg('tabNotEnabled'));
    await clickAllow(pop2);
    const evC0 = await until(() => evidence(tab2), 5000, 50);
    step('(c) 127.0.0.1 allowed from its popup (the manifest grants the host: no dialog)', !!evC0 && (await sites())?.includes('http://127.0.0.1/*'), `${JSON.stringify((await popupView(pop2)).requests)}; sites ${JSON.stringify(await sites())}`);
    const sC = await until(async () => {
      const s = await state(tab2);
      return s?.state === 'prompt' && s.needs?.origin ? s : null;
    }, 20000);
    const qC = await query(tab2);
    const [badgeC, titleC] = (await badge(tab2)) || [];
    step('(c) the video on media.localhost: prompt for that host, the page notice, the ! badge', sC?.needs?.origin === MEDIA_HOST && qC?.notice === 'permission' && badgeC === '!' && String(titleC).includes(msg('titlePermission')), `${sC?.state} ${JSON.stringify(sC?.needs)}; notice ${qC?.notice}; badge ${badgeC} “${titleC}”; last state ${JSON.stringify(sC?.history?.at(-1))}`);
    if (!sC) await dump(tab2);
    if (qC?.notice === 'permission') await shoot(page2, '3-permission-notice');
    const vC = await popupIs(pop2, msg('tabPermission', ['media.localhost']));
    step('(c) the popup: needs to read media.localhost, “Allow”', !!vC && vC.allowShown && vC.allow === msg('allowRead') && vC.tone === 'warn', JSON.stringify(vC || (await popupView(pop2))));
    if (vC) await shoot(pop2, '4-popup-permission', await popBox(pop2));
    const nReq = (await popupView(pop2)).requests.length;
    await clickAllow(pop2);
    await sleep(3000);
    const reqC = (await popupView(pop2)).requests[nReq];
    numbers.c = { requestAfter3s: reqC?.state ?? 'not called' };
    console.log(`  (c) permissions.request for ${MEDIA_HOST} (held back) after 3 s: ${numbers.c.requestAfter3s}`);
    const tGrant = Date.now();
    const granted = await devPrivate('addHostPermission', MEDIA_HOST);
    let sawC = null;
    const runC = await until(async () => {
      const ev = await evidence(tab2);
      sawC ??= bilingual(await trackInfo(page2)) && Date.now();
      return ev?.direct?.on && ev.direct.segments > 0 && sawC ? ev : null;
    }, 60000, 250);
    const sC2 = await state(tab2);
    const qC2 = await query(tab2);
    const [badgeC2] = (await badge(tab2)) || [];
    const mediaReq = srv.log.filter((e) => e.ext && e.host === 'media.localhost' && e.at >= tGrant).length;
    numbers.c = { ...numbers.c, grantToDirectOnS: runC ? (runC.direct.startedAt - tGrant) / 1000 : null, grantToFirstSentenceS: runC ? (runC.direct.firstSegmentAt - tGrant) / 1000 : null, grantToBilingualOnTrackS: sawC ? (sawC - tGrant) / 1000 : null, workerRequestsToMediaHost: mediaReq, requestAtEnd: (await popupView(pop2)).requests[nReq]?.state };
    step('(c) granted: the click’s pending allow finishes in the worker, captions start by themselves, the notice goes', granted === 'ok' && !!runC && sC2?.state === 'captions' && sC2.run?.kind === 'direct' && !sC2.needs && qC2?.notice === null && badgeC2 === msg('badgeCaptions') && (await sites())?.includes(MEDIA_HOST) && mediaReq > 0, `${granted}; ${sC2?.state} ${JSON.stringify(sC2?.run)}; notice ${qC2?.notice}; badge ${badgeC2}; ${JSON.stringify(numbers.c)}`);
    if (!runC) await dump(tab2);
    if (sawC) await shoot(page2, '5-cross-host-captions');
    await cdp.send('Target.closeTarget', { targetId: pop2Target });

    // ---- (e) ----
    await shell.setPrefs({ targetLang: 'zh', mode: 'overlay' });
    await cdp.send('Page.navigate', { url: `${LOCAL}/portrait.html` }, page2);
    await until(() => player(page2, 'return location.pathname === "/portrait.html" && v.readyState >= 2;'), 15000);
    await player(page2, 'v.currentTime = 4; v.play().catch(() => {}); return true;');
    const evE = await until(() => evidence(tab2), 10000, 100);
    const longCue = await until(async () => {
      const o = await overlayInfo(page2);
      return o && !o.hidden && o.lines >= 2 && o.chars > 110 ? o : null;
    }, 60000, 200);
    await player(page2, 'v.pause(); return true;');
    await sleep(300);
    const shotBox = { x: 16, y: 16, width: 360, height: 640 };
    let after = null;
    let before = null;
    if (longCue) {
      after = await overlayInfo(page2);
      const fAfter = await shoot(page2, '6-portrait-after', shotBox);
      await setOverlaySize(page2, OLD_SIZE);
      await sleep(200);
      before = await overlayInfo(page2);
      const fBefore = await shoot(page2, '6-portrait-before', shotBox);
      // The same text in a 16:9 box: the old and new rule agree.
      await player(page2, `v.style.width = '960px'; v.style.height = '540px'; return true;`);
      await sleep(400);
      const wideOld = await overlayInfo(page2);
      await setOverlaySize(page2, null);
      await sleep(200);
      const wideNew = await overlayInfo(page2);
      await player(page2, `v.style.width = '360px'; v.style.height = '640px'; return true;`);
      numbers.e = { portrait: { before, after }, wide: { old: wideOld?.fontSize, now: wideNew?.fontSize } };
      await sideBySide('6-portrait-compare', [fBefore, fAfter], [`before: 4.6cqh → ${before.fontSize}px`, `after: min(4.6cqh, 4.5cqw) → ${after.fontSize}px`]);
      // Candidates for the width factor, the current rule first (any factor
      // from 3.45 up leaves 4:3 and wider as they are).
      await sleep(400);
      const shots = [fBefore];
      const labels = [`now: 4.6cqh · ${before.fontSize}px · ${Math.round((before.boxH / before.videoH) * 100)}%`];
      numbers.e.options = {};
      for (const [tag, factor] of [['A', 3.5], ['B', 4.5], ['C', 5.5], ['D', 6.5]]) {
        await setOverlaySize(page2, `clamp(14px, min(4.6cqh, ${factor}cqw), 52px)`);
        await sleep(200);
        const o = await overlayInfo(page2);
        numbers.e.options[tag] = { factor, fontSize: o?.fontSize, boxH: o?.boxH };
        shots.push(await shoot(page2, `6-portrait-option-${tag}`, shotBox));
        labels.push(`${tag}: ${factor}cqw · ${o?.fontSize}px · ${Math.round((o?.boxH / o?.videoH) * 100)}%`);
      }
      await setOverlaySize(page2, null);
      await sideBySide('6-portrait-options', shots, labels);
    }
    step('(e) portrait overlay: smaller text, a smaller share of the picture; 16:9 unchanged', !!evE && !!after && after.fontSize < before.fontSize && after.boxH / after.videoH < before.boxH / before.videoH && numbers.e?.wide.old === numbers.e?.wide.now, JSON.stringify(numbers.e || (await overlayInfo(page2))));

    // ---- (f) ----
    const optList = () => evaluate(opt, `[...document.querySelectorAll('#allowed-sites li')].map((li) => li.firstChild.textContent)`);
    const listF = await until(async () => {
      const l = await optList();
      return l.length === 3 ? l : null;
    }, 5000);
    step('(f) the options page lists the allowed sites', JSON.stringify(listF) === JSON.stringify(['http://127.0.0.1', 'http://localhost', 'http://media.localhost']), JSON.stringify(listF || (await optList())));
    const card = await evaluate(opt, `(() => { const r = document.getElementById('allowed-sites').closest('.card').getBoundingClientRect(); return { x: Math.floor(r.x), y: Math.floor(r.y + scrollY), width: Math.ceil(r.width), height: Math.ceil(r.height) }; })()`);
    await shoot(opt, '7-options-sites', card);
    await evaluate(opt, `(() => { const li = [...document.querySelectorAll('#allowed-sites li')].find((x) => x.firstChild.textContent === 'http://localhost'); li.querySelector('button').click(); return true; })()`);
    const listAfter = await until(async () => {
      const l = await optList();
      return l.length === 2 ? l : null;
    }, 5000);
    const goneF = await until(async () => ((await evidence(tab2)) === null && (await evidence(tab)) === null ? true : null), 5000, 100);
    const overlayGone = await until(() => evaluate(page2, `!document.querySelector('.tc-cap-host')`), 3000, 100);
    const [badgeF] = (await badge(tab2)) || [];
    const regF = await registered();
    step('(f) removed: off the list and the registration, the tabs’ evidence gone, captions off the page, badge cleared', !!listAfter && !listAfter.includes('http://localhost') && regF.every((r) => !r.matches.includes('http://localhost/*')) && !!goneF && overlayGone && badgeF === '', `${JSON.stringify(listAfter)}; ${JSON.stringify(regF.map((r) => r.matches))}; overlay gone ${!!overlayGone}; badge “${badgeF}”; permission kept (a manifest host in this build): ${await contains('http://localhost/*')}`);
    await cdp.send('Page.reload', {}, page2);
    await until(() => player(page2, 'return v.readyState >= 1;'), 15000);
    await sleep(1500);
    const evF = await evidence(tab2);
    const agentF = await agentIn(page2);
    const { sessionId: pop3 } = await openPopup(tab2);
    const vF = await popupIs(pop3, msg('tabNotEnabled'));
    step('(f) reloaded: no scripts, no evidence, the popup offers “Allow on this site” again', evF === null && !agentF && !!vF && vF.allowShown && vF.allow === msg('allowSite'), `evidence ${JSON.stringify(evF)}; agent ${agentF}; contexts ${contextsOf(page2)}; ${JSON.stringify(vF || (await popupView(pop3)))}`);
    if (vF) await shoot(pop3, '8-popup-removed', await popBox(pop3));
    void pageTarget;
    void page2Target;

    step('no exceptions from our scripts on the pages, none in extension contexts', shell.pageExceptions.ours.length === 0 && shell.extProblems.length === 0, [...shell.pageExceptions.ours, ...shell.extProblems].join(' || '));
    console.log(`\n  numbers: ${JSON.stringify(numbers, null, 1)}`);
    console.log(`  screenshots:\n    ${shell.shots.join('\n    ')}`);
  } finally {
    srv.server.close();
    await shell.close();
  }
  return summary();
}

run(main);
