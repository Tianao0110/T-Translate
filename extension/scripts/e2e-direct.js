// Files played by URL (no MSE), in a real browser: the real companion server
// and listen engine in a sandbox Electron, the built extension in Chrome
// with a throwaway profile, a page on 127.0.0.1 whose <video src> is a
// progressive MP4 (about 70 s of SAPI speech, twice, with H.264 test video)
// and a <track>. Content scripts do not match 127.0.0.1: they are injected
// from the options page with chrome.scripting. The site is switched off in
// prefs, so the orchestrator stays out; every step is a TAB_COMMAND. The
// server logs each range asked for; the worker's own requests are also
// watched over CDP (Network on its target) to tell a request stuck in the
// browser from one the server never answered.
//
//   (a) evidence: the media src is http, no MSE stream, the <track> file
//       reached the worker as subtitle-parsed (via 'track')
//   (b) direct on { url, fromS: 20 } with the playhead fed every second:
//       the first audio range starts at the 20 s sample, the lead stays
//       within 60 s, a refill once the lead is short, segments come back
//       and the track shows them bilingual; bytes and requests
//   (c) no playhead fed: fetching stops at the lead; off, then on from
//       45 s: the new cues start near 45 s
//   (d) the moov-last file: the head, the tail, then the audio; captions
//   (e) off while a request is in flight (the server stalls it): aborted,
//       the stream closed with its stats
//   (f) a media URL on a host the extension may not read: no-permission
//
//   npx electron extension/scripts/e2e-direct.js --packs <installed asr-models dir> --ffmpeg <ffmpeg.exe> [--browser <exe>] [--out <screenshots dir>] [--headed]
//
// Set TEMP to a folder on the packs' drive so they are hard-linked, not
// copied. The sandbox is left in place for the recycle bin.
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { pathToFileURL } = require('url');
const { execFileSync } = require('child_process');
const { arg, sleep, checklist, run } = require('../../scripts/lib/electron-smoke');
const { startShell } = require('./lib/e2e-shell');
const { synthesizeWav } = require('./lib/speech');

const { step, summary } = checklist();

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

const VTT = `WEBVTT

00:00:01.000 --> 00:00:05.000
${LINES[0]}

00:00:06.000 --> 00:00:10.000
${LINES[1]}

00:00:11.000 --> 00:00:15.000
${LINES[2]}
`;

function makeMedia(dir, ffmpeg) {
  const wav = synthesizeWav(path.join(dir, 'speech.wav'), LINES);
  // prettier-ignore
  const common = [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=25',
    '-stream_loop', '1', '-i', wav,
    '-map', '0:v', '-map', '1:a', '-shortest',
    '-c:v', 'libx264', '-preset', 'veryfast', '-b:v', '2M', '-pix_fmt', 'yuv420p', '-g', '50',
    '-c:a', 'aac', '-ar', '48000', '-ac', '1', '-b:a', '96k', '-map_metadata', '-1',
  ];
  execFileSync(ffmpeg, [...common, '-movflags', '+faststart', path.join(dir, 'speech.mp4')]);
  execFileSync(ffmpeg, [...common, path.join(dir, 'speech-last.mp4')]);
}

const pageHtml = (file, port) => `<!doctype html><html><head><meta charset="utf-8"><title>T-Caption direct</title>
<style>body{margin:0;background:#1b1d22;font:14px system-ui}#wrap{width:960px;height:540px;margin:16px}#v{display:block;width:960px;height:540px;background:#000}#o{width:160px;height:90px;margin:0 16px}</style></head>
<body><div id="wrap"><video id="v" src="/${file}" controls preload="auto"><track kind="subtitles" src="speech.vtt" srclang="en"></video></div>
<video id="o" src="http://localhost:${port}/${file}" preload="none" muted></video>
</body></html>`;

// Pages, the track file and the MP4s by range; logs every MP4 request and
// whether the extension (sec-fetch-dest empty) or the player asked.
function serve(dir) {
  const srv = { log: [], stall: false };
  const server = http.createServer((req, res) => {
    const { pathname } = new URL(req.url, 'http://x');
    const name = pathname.slice(1);
    const port = server.address().port;
    if (name === 'fast.html' || name === 'last.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(pageHtml(name === 'fast.html' ? 'speech.mp4' : 'speech-last.mp4', port));
    }
    if (name === 'speech.vtt') {
      res.writeHead(200, { 'content-type': 'text/vtt; charset=utf-8' });
      return res.end(VTT);
    }
    if (!/^speech(-last)?\.mp4$/.test(name)) {
      res.writeHead(404);
      return res.end();
    }
    const file = path.join(dir, name);
    const size = fs.statSync(file).size;
    const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
    const ext = req.headers['sec-fetch-dest'] === 'empty';
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
    const entry = { name, start, end: end + 1, ext, at: Date.now(), done: false, aborted: false };
    srv.log.push(entry);
    res.on('close', () => {
      entry.done = res.writableFinished;
      entry.aborted = !res.writableFinished;
    });
    res.writeHead(206, { 'content-type': 'video/mp4', 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
    if (ext && srv.stall) return; // held until the client gives up
    fs.createReadStream(file, { start, end }).pipe(res);
  });
  srv.sockets = 0;
  server.on('connection', (sock) => {
    srv.sockets++;
    sock.on('close', () => srv.sockets--);
  });
  // Player responses still being sent (a player holding its connection).
  srv.open = () => srv.log.filter((e) => !e.ext && !e.done && !e.aborted).length;
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(Object.assign(srv, { server, port: server.address().port }))));
}

async function main() {
  const ffmpeg = arg('--ffmpeg');
  if (!ffmpeg || !fs.existsSync(ffmpeg)) {
    console.error('usage: --packs <asr-models dir> --ffmpeg <ffmpeg.exe> [--browser <exe>] [--out <dir>] [--headed]');
    return 2;
  }
  const shell = await startShell({ name: 'tt-caption-direct', step, version: 'e2e-s9a-direct', shotPrefix: 't-caption-s9a' });
  if (!shell) return 2;
  const { evaluate, ext, evidence, until, shoot, trackInfo, opt, cdp } = shell;
  // The worker's own requests for the MP4s, as the browser saw them.
  const net = [];
  const { targetInfos } = await cdp.send('Target.getTargets');
  const swTarget = targetInfos.find((t) => t.type === 'service_worker' && t.url.startsWith(`chrome-extension://${shell.extId}/`));
  const swSession = swTarget && (await shell.browser.attach(swTarget.targetId));
  if (swSession) {
    await cdp.send('Network.enable', {}, swSession);
    cdp.listen((m) => {
      if (m.sessionId !== swSession) return;
      const p = m.params || {};
      if (m.method === 'Network.requestWillBeSent' && /speech/.test(p.request?.url || '')) net.push({ id: p.requestId, range: p.request.headers?.Range, at: Date.now(), state: 'sent' });
      const r = net.find((x) => x.id === p.requestId);
      if (!r) return;
      if (m.method === 'Network.responseReceived') r.state = `response ${p.response.status}`;
      if (m.method === 'Network.loadingFinished') r.state = 'finished';
      if (m.method === 'Network.loadingFailed') r.state = `failed ${p.errorText}${p.canceled ? ' (canceled)' : ''}`;
    });
  }
  const netNotDone = () => net.filter((r) => r.state !== 'finished').map((r) => `${r.range} ${r.state} ${((Date.now() - r.at) / 1000).toFixed(1)}s`);
  const { parseMoov, offsetAt, probeHead } = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'shared', 'mp4-table.js')).href);

  const mediaDir = path.join(shell.box.dir, 'media');
  fs.mkdirSync(mediaDir, { recursive: true });
  const t0 = Date.now();
  makeMedia(mediaDir, ffmpeg);
  const files = {};
  for (const name of ['speech.mp4', 'speech-last.mp4']) {
    const u8 = new Uint8Array(fs.readFileSync(path.join(mediaDir, name)));
    const table = parseMoov(u8);
    const s = table.samples;
    let runs = 1;
    let big = 0;
    for (let i = 1; i < s.length; i++) {
      const gap = s[i].offset - (s[i - 1].offset + s[i - 1].size);
      if (gap > 0) runs++;
      if (gap > 64 * 1024) big++;
    }
    const probe = probeHead(u8.subarray(0, 65536));
    const audio = s.reduce((a, x) => a + x.size, 0);
    // Where the audio bytes are: after the moov (faststart), or before where mdat ends (moov last).
    const isData = probe.where === 'head' ? (e) => e.start >= probe.moov.offset + probe.moov.size : (e) => e.start > 0 && e.start < table.mdat.end;
    files[name] = { size: u8.length, table, where: probe.where, isData };
    console.log(`  ${name}: ${(u8.length / 1e6).toFixed(1)} MB, ${(table.durationMs / 1000).toFixed(1)} s audio (${((audio / u8.length) * 100).toFixed(1)}% of the bytes), ${s.length} frames in ${runs} runs, ${big} gaps over 64 KB, moov at the ${probe.where}`);
  }
  console.log(`  media made in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

  const srv = await serve(mediaDir);
  const BASE = `http://127.0.0.1:${srv.port}`;
  const numbers = {};
  const command = (tabId, c) => ext('tab/command', { tabId, command: c });
  const extRequests = (name, since = 0) => srv.log.filter((e) => e.ext && e.name === name && e.at >= since);
  const dataRequests = (name, since) => extRequests(name, since).filter(files[name].isData);
  const sizeOf = (list) => list.reduce((a, e) => a + (e.end - e.start), 0);
  // File bytes from the sample at fromS to the one at toS (the file's end past the last).
  const spanOf = (file, fromS, toS) => (offsetAt(file.table, toS - 0.001) ?? file.table.mdat?.end ?? file.size) - offsetAt(file.table, fromS);
  const player = (session, js) => evaluate(session, `(() => { const v = document.getElementById('v'); ${js} })()`);
  const cuesOf = async (tabId, prefix) => {
    const r = await command(tabId, { cmd: 'cues', op: 'list' });
    return (r?.result?.cues || []).filter((c) => String(c.id).startsWith(prefix));
  };
  const bilingual = (r) => (r && r.active.some((t) => t.includes('\n') && t.includes('[译]')) ? r : null);
  const genOf = (key) => /:d(\d+)$/.exec(key || '')?.[1];

  async function inject(tabId) {
    return evaluate(
      opt,
      `(async () => {
        await chrome.scripting.executeScript({ target: { tabId: ${tabId} }, files: ['content-main.js'], world: 'MAIN', injectImmediately: true });
        await chrome.scripting.executeScript({ target: { tabId: ${tabId} }, files: ['content-isolated.js'], injectImmediately: true });
        return true;
      })()`
    );
  }

  // Feeds the playhead every second until done(ev, t) or ms; returns the last { ev, t }.
  async function feed(tabId, session, ms, done) {
    let last = null;
    for (const until0 = Date.now() + ms; Date.now() < until0; await sleep(1000)) {
      const t = await player(session, 'return v.currentTime;');
      await command(tabId, { cmd: 'direct', position: t });
      const ev = await evidence(tabId);
      last = { ev, t };
      if (await done(ev, t)) break;
    }
    return last;
  }

  try {
    await shell.setPrefs({ targetLang: 'zh', siteOff: { '127.0.0.1': true } });
    numbers.permissionProbe = await evaluate(
      opt,
      `Promise.all([chrome.permissions.contains({ origins: ['http://127.0.0.1/*'] }), chrome.permissions.contains({ origins: ['http://127.0.0.1:${srv.port}/*'] }).catch((e) => 'throws: ' + e.message), chrome.permissions.contains({ origins: ['http://localhost/*'] })])`
    );
    console.log(`  permissions.contains [127.0.0.1/*, 127.0.0.1:port/*, localhost/*]: ${JSON.stringify(numbers.permissionProbe)}`);

    // ---- (a) ----
    const { sessionId: page } = await shell.open(`${BASE}/fast.html`);
    shell.pages.add(page);
    const tab = await until(() => shell.tabIdOf(`${BASE}/fast.html`), 10000);
    await until(() => player(page, 'return v.readyState >= 1;'), 15000);
    step('page loaded, scripts injected from the options page', (await inject(tab)) === true, `tab ${tab}`);
    const evA = await until(async () => {
      const ev = await evidence(tab);
      return ev?.media?.length && ev.subtitles?.some((s) => s.via === 'track') ? ev : null;
    }, 15000);
    const primaryA = evA?.media?.find((m) => m.elId === evA.primaryElId) || evA?.media?.[0];
    const sub = evA?.subtitles?.find((s) => s.via === 'track');
    step('(a) evidence: the media src is http, no MSE stream', !!primaryA && primaryA.src === `${BASE}/speech.mp4` && evA.mse.streams.length === 0 && evA.site === 'generic', `${primaryA?.src}; streams ${evA?.mse?.streams?.length}; site ${evA?.site}; hooks ${JSON.stringify(evA?.hooks)}`);
    step('(a) the <track> file reached the worker as subtitle-parsed', !!sub && sub.format === 'vtt' && sub.cueCount === 3 && sub.lang === 'en', JSON.stringify(sub));
    const stateA = await shell.state(tab);
    console.log(`  orchestrator: ${stateA?.state} (site switched off for this test)`);

    // ---- (b) ----
    await player(page, 'v.currentTime = 20; v.play().catch(() => {}); return true;');
    await until(() => player(page, 'return !v.paused && v.currentTime >= 20;'), 10000);
    const since = Date.now();
    const opened = await command(tab, { cmd: 'direct', on: true, url: primaryA.src, fromS: 20, lang: 'en', targetLang: 'zh' });
    const r = opened?.result;
    const fast = files['speech.mp4'];
    const want20 = offsetAt(fast.table, 20);
    step('(b) direct on: opened from the 20 s sample, moov at the head', !!opened?.ok && Math.abs(r.startS - 20) < 0.03 && r.moovAt === 'head', opened?.ok ? `key ${r.key} startS ${r.startS?.toFixed(3)} dur ${r.durationS?.toFixed(1)} codec ${r.codec}` : JSON.stringify(opened?.error));
    const gen1 = genOf(r?.key);
    let sawBilingual = null;
    const b = await feed(tab, page, 60000, async (ev, t) => {
      sawBilingual ??= bilingual(await trackInfo(page));
      return ev?.direct?.segments > 0 && sawBilingual && t > 37;
    });
    const evB = b?.ev;
    const dB = evB?.direct;
    const reqB = extRequests('speech.mp4', since);
    const dataB = dataRequests('speech.mp4', since);
    const fd = dataB[0];
    const spanB = dB?.fetchedToS ? spanOf(fast, 20, dB.fetchedToS) : 0;
    numbers.b = {
      firstSentenceS: dB?.firstSegmentAt ? (dB.firstSegmentAt - dB.startedAt) / 1000 : null,
      firstAudioRange: fd ? [fd.start, fd.end] : null,
      expectedOffset: want20,
      requests: dB?.requests,
      bytes: dB?.bytes,
      dataBytes: sizeOf(dataB),
      spanBytes: spanB,
      fileBytes: fast.size,
      aheadS: dB?.aheadS,
      maxAheadS: dB?.maxAheadS,
      fetchedToS: dB?.fetchedToS,
      playS: dB?.playS,
      segments: dB?.segments,
      translations: dB?.translations,
      ranges: reqB.map((e) => `${e.start}-${e.end}`),
    };
    step('(b) the first audio range starts at the 20 s sample', !!fd && fd.start === want20, `${fd?.start} vs ${want20}`);
    step('(b) the lead stays within 60 s of the fed playhead', dB?.maxAheadS > 50 && dB.maxAheadS <= 60.05, `max ${dB?.maxAheadS} now ${dB?.aheadS} (fetched to ${dB?.fetchedToS?.toFixed(1)} s, playhead ${dB?.playS?.toFixed(1)} s)`);
    await sleep(3000);
    const dB2 = (await evidence(tab)).direct;
    step('(b) refilled once the lead fell short (playhead past 35 s)', b?.t > 35 && dB2?.fetchedToS > 80.5, `playhead ${b?.t?.toFixed(1)} s, fetched to ${dB2?.fetchedToS?.toFixed(1)} s, ${dB2?.requests} requests (${dB2?.retried} retried); status ${dB2?.lastStatus} error ${JSON.stringify(dB2?.fetchError)}; server: ${srv.sockets} sockets, ${srv.open()} player responses open; worker requests not done: ${JSON.stringify(netNotDone())}`);
    const cuesB = await cuesOf(tab, `d${gen1}-`);
    const firstB = Math.min(...cuesB.map((c) => c.start));
    step('(b) segments came back to the page from about 20 s on', cuesB.length > 0 && firstB >= 19 && firstB < 35, `${cuesB.length} cues, first at ${firstB.toFixed(2)} s: ${cuesB.sort((x, y) => x.start - y.start)[0]?.text}`);
    step('(b) the track shows them bilingual', !!sawBilingual, JSON.stringify(sawBilingual?.active));
    const maxRequests = Math.ceil(spanB / (512 * 1024)) + reqB.length - dataB.length + 2;
    step('(b) bytes and requests: only the stretch from 20 s to the lead, in 512 KB ranges', dB?.requests === reqB.length && numbers.b.dataBytes <= spanB + 4096 && numbers.b.dataBytes >= spanB * 0.95 && dB.requests <= maxRequests, `${dB?.requests} requests (${reqB.length - dataB.length} for the head and moov), ${(numbers.b.dataBytes / 1e6).toFixed(2)} MB of audio ranges for a ${(spanB / 1e6).toFixed(2)} MB stretch (20 → ${dB?.fetchedToS?.toFixed(1)} s) of a ${(fast.size / 1e6).toFixed(1)} MB file`);
    if (bilingual(await until(async () => bilingual(await trackInfo(page)), 15000, 100))) {
      await shoot(page, '1-direct-captions');
      await shoot(page, '2-direct-captions-zoom', { x: 16, y: 380, width: 960, height: 176 });
    }

    // ---- (c) ----
    const quietFrom = await evidence(tab);
    const nQuiet = quietFrom.direct.requests;
    await sleep(6000);
    const quiet = (await evidence(tab)).direct;
    step('(c) no playhead fed: no more fetching past the lead', quiet.requests === nQuiet && quiet.fetchedToS <= quiet.playS + 60.05, `${nQuiet} → ${quiet.requests} requests; fetched to ${quiet.fetchedToS?.toFixed(1)} s, last playhead ${quiet.playS?.toFixed(1)} s`);
    const offC = await command(tab, { cmd: 'direct', on: false, reason: 'seek' });
    step('(c) off: closed with the pipeline stats', offC?.ok && offC.result.on === false && offC.result.stats?.source === 'direct', JSON.stringify({ reason: offC?.result?.reason, blocks: offC?.result?.stats?.blocks, decodedS: offC?.result?.stats?.decodedS, fedS: offC?.result?.stats?.feeder?.fedS }));
    await player(page, 'v.currentTime = 45; v.play().catch(() => {}); return true;');
    await until(() => player(page, 'return v.currentTime >= 45;'), 10000);
    const sinceC = Date.now();
    const onC = await command(tab, { cmd: 'direct', on: true, url: primaryA.src, fromS: 45, lang: 'en', targetLang: 'zh' });
    const gen2 = genOf(onC?.result?.key);
    const c = await feed(tab, page, 45000, async () => (await cuesOf(tab, `d${gen2}-`)).length > 0);
    const cuesC = await cuesOf(tab, `d${gen2}-`);
    const firstC = Math.min(...cuesC.map((x) => x.start));
    const dataC = dataRequests('speech.mp4', sinceC)[0];
    numbers.c = { firstSentenceS: c?.ev?.direct?.firstSegmentAt ? (c.ev.direct.firstSegmentAt - c.ev.direct.startedAt) / 1000 : null, firstCueAtS: firstC, firstAudioRange: dataC ? [dataC.start, dataC.end] : null, expectedOffset: offsetAt(fast.table, 45) };
    step('(c) on again from 45 s: the audio from the 45 s sample, new cues from about 45 s', !!onC?.ok && dataC?.start === offsetAt(fast.table, 45) && firstC >= 44 && firstC < 60, `key ${onC?.result?.key}; first range ${dataC?.start}; ${cuesC.length} cues, first at ${firstC.toFixed(2)} s: ${cuesC.sort((x, y) => x.start - y.start)[0]?.text}`);
    await command(tab, { cmd: 'direct', on: false, reason: 'next' });

    // ---- (d) ----
    await cdp.send('Page.navigate', { url: `${BASE}/last.html` }, page);
    await until(() => player(page, 'return location.pathname === "/last.html" && v.readyState >= 1;'), 15000);
    await inject(tab);
    const evD0 = await until(async () => {
      const ev = await evidence(tab);
      return ev?.media?.some((m) => m.src === `${BASE}/speech-last.mp4`) ? ev : null;
    }, 15000);
    await player(page, 'v.currentTime = 20; v.play().catch(() => {}); return true;');
    await until(() => player(page, 'return !v.paused && v.currentTime >= 20;'), 10000);
    const sinceD = Date.now();
    const last = files['speech-last.mp4'];
    const onD = await command(tab, { cmd: 'direct', on: true, url: `${BASE}/speech-last.mp4`, fromS: 20, lang: 'en', targetLang: 'zh' });
    const gen3 = genOf(onD?.result?.key);
    const reqD = () => extRequests('speech-last.mp4', sinceD);
    const moovOffset = last.table.mdat.end;
    let bilD = null;
    const d = await feed(tab, page, 45000, async () => {
      bilD ??= bilingual(await trackInfo(page));
      return (await cuesOf(tab, `d${gen3}-`)).length > 0 && bilD;
    });
    const rd = reqD();
    numbers.d = { firstSentenceS: d?.ev?.direct?.firstSegmentAt ? (d.ev.direct.firstSegmentAt - d.ev.direct.startedAt) / 1000 : null, ranges: rd.slice(0, 4).map((e) => `${e.start}-${e.end}`), requests: d?.ev?.direct?.requests, bytes: d?.ev?.direct?.bytes };
    const firstD = dataRequests('speech-last.mp4', sinceD)[0];
    step('(d) moov at the end: the head, the tail where mdat ends, then audio from the 20 s sample', !!evD0 && onD?.ok && onD.result.moovAt === 'tail' && rd[0]?.start === 0 && rd[1]?.start === moovOffset && firstD?.start === offsetAt(last.table, 20), `${onD?.ok ? onD.result.moovAt : JSON.stringify(onD?.error)}; ranges ${numbers.d.ranges.join(', ')}; moov at ${moovOffset}`);
    const cuesD = await cuesOf(tab, `d${gen3}-`);
    step('(d) captions from the moov-last file, bilingual on the track', cuesD.length > 0 && !!bilD, `${cuesD.length} cues, first ${Math.min(...cuesD.map((x) => x.start)).toFixed(2)} s; ${JSON.stringify(bilD?.active)}`);
    if (bilingual(await until(async () => bilingual(await trackInfo(page)), 15000, 100))) await shoot(page, '3-moov-last-captions');

    // ---- (e) ----
    srv.stall = true;
    const n0 = reqD().length;
    await command(tab, { cmd: 'direct', position: 45 }); // the lead now short: a refill starts and hangs
    const stalled = await until(async () => reqD().slice(n0).find((e) => !e.done && !e.aborted) || null, 5000, 100);
    await sleep(500);
    const offE = await command(tab, { cmd: 'direct', on: false, reason: 'command' });
    const abortedE = await until(async () => (stalled?.aborted ? true : null), 5000, 100);
    srv.stall = false;
    const evE = await evidence(tab);
    step('(e) off with a request in flight: the request aborted, the stream closed', !!stalled && !!abortedE && offE?.ok && offE.result.stats?.source === 'direct' && evE.direct.on === false, `stalled ${stalled ? `${stalled.start}-${stalled.end}` : 'none'}, aborted ${!!abortedE}; ${JSON.stringify({ reason: offE?.result?.reason, blocks: offE?.result?.stats?.blocks, feederClosed: offE?.result?.stats?.feeder?.closed })}`);

    // ---- (f) ----
    const denied = await command(tab, { cmd: 'direct', on: true, url: `http://localhost:${srv.port}/speech-last.mp4` });
    step('(f) a host the extension may not read: no-permission with its pattern', denied?.ok === false && denied.error?.code === 'no-permission' && denied.error.message === 'http://localhost/*', JSON.stringify(denied?.error));

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
