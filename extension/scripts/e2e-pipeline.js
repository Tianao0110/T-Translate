// End to end for the media pipeline in a real browser: the real companion
// server and listen engine in a sandbox Electron, the built extension in a
// headless Chrome / Edge with a throwaway profile. An extension page records
// synthesized speech from an <audio> element into WebM/Opus (MediaRecorder);
// the bytes get unknown-size Segment / Clusters and cluster times +100 s (an
// MSE stream mid-video), then go through MEDIA_OPEN / PUSH / CLOSE in random
// cuts of up to 16 KB. With --ffmpeg the speech becomes fragmented MP4 / AAC
// instead (a moof + mdat a second, like Bilibili's DASH audio), every tfdt
// moved +100 s, and the browser decodes AAC.
//
//   npx electron extension/scripts/e2e-pipeline.js --packs <installed asr-models dir> [--browser <exe>] [--ffmpeg <ffmpeg.exe>]
//
// Set TEMP to a folder on the packs' drive so they are hard-linked, not
// copied. The sandbox is left in place for the recycle bin.
/* eslint-disable no-console */

const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { execFileSync } = require('child_process');
const { REPO, arg, sleep, checklist, sandbox, fakeStore, run } = require('../../scripts/lib/electron-smoke');
const { fakeWindow } = require('../../scripts/lib/listen-sandbox');
const { synthesizeWav, linkPacks } = require('./lib/speech');
const { findBrowser, launchBrowser, loadExtension } = require('./lib/browser');

const { step, summary } = checklist();
const OFFSET_MS = 100000;
const KEY = 'e2e-tab';
const FFMPEG = arg('--ffmpeg');
const AAC_RATE = 48000; // the AAC track's timescale too

// Unknown sizes for the Segment and every Cluster, offsetMs added to each Cluster Timecode.
function asMidStream(webm, offsetMs) {
  const src = Buffer.from(webm);
  const unknown = Buffer.from([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
  const out = [];
  let from = 0;
  let clusters = 0;
  for (let i = 0; i + 14 <= src.length; i++) {
    const segment = src[i] === 0x18 && src[i + 1] === 0x53 && src[i + 2] === 0x80 && src[i + 3] === 0x67 && src[i + 4] === 0x01;
    const cluster = src[i] === 0x1f && src[i + 1] === 0x43 && src[i + 2] === 0xb6 && src[i + 3] === 0x75 && src[i + 4] === 0x01 && src[i + 12] === 0xe7;
    if (!segment && !cluster) continue;
    out.push(src.subarray(from, i + 4), unknown);
    from = i + 12;
    if (cluster) {
      const n = src[i + 13] & 0x7f;
      let t = 0;
      for (let k = 0; k < n; k++) t = t * 256 + src[i + 14 + k];
      const v = Buffer.alloc(4);
      v.writeUInt32BE(t + offsetMs);
      out.push(Buffer.from([0xe7, 0x84]), v);
      from = i + 14 + n;
      clusters++;
    }
    i = from - 1;
  }
  out.push(src.subarray(from));
  return { bytes: Buffer.concat(out), clusters };
}

// Fragmented MP4 / AAC of a wav through ffmpeg.
function toFmp4(ffmpeg, wav, out) {
  // prettier-ignore
  execFileSync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', wav,
    '-ar', String(AAC_RATE), '-ac', '1', '-c:a', 'aac', '-b:a', '64k',
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-frag_duration', '1000000',
    '-f', 'mp4', out,
  ], { stdio: 'inherit' });
  return fs.readFileSync(out);
}

// Every moof's tfdt plus ticks.
function shiftTfdt(src, ticks) {
  const b = Buffer.from(src);
  let fragments = 0;
  const walk = (from, to) => {
    for (let p = from; p + 8 <= to; ) {
      const size = b.readUInt32BE(p);
      const type = b.toString('latin1', p + 4, p + 8);
      if (size < 8 || p + size > to) return;
      if (type === 'moof' || type === 'traf') walk(p + 8, p + size);
      else if (type === 'tfdt') {
        if (b[p + 8] === 1) b.writeBigUInt64BE(b.readBigUInt64BE(p + 12) + BigInt(ticks), p + 12);
        else b.writeUInt32BE(b.readUInt32BE(p + 12) + ticks, p + 12);
        fragments++;
      }
      p += size;
    }
  };
  walk(0, b.length);
  return { bytes: b, fragments };
}

// In the extension page: plays the wav in an <audio>, records its captureStream.
const RECORD = `async (wavB64) => {
  const bin = atob(wavB64);
  const wav = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) wav[i] = bin.charCodeAt(i);
  const audio = document.createElement('audio');
  audio.src = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
  document.body.append(audio);
  await new Promise((r, j) => { audio.oncanplaythrough = r; audio.onerror = () => j(new Error('audio load failed')); });
  const stream = audio.captureStream();
  const ended = new Promise((r) => { audio.onended = r; });
  await audio.play();
  if (!stream.getAudioTracks().length) await new Promise((r) => stream.addEventListener('addtrack', r, { once: true }));
  const rec = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
  const parts = [];
  rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
  const stopped = new Promise((r) => { rec.onstop = r; });
  const t0 = performance.now();
  rec.start(1000);
  await ended;
  rec.stop();
  await stopped;
  const bytes = new Uint8Array(await new Blob(parts).arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { b64: btoa(s), duration: audio.duration, recordMs: Math.round(performance.now() - t0) };
}`;

// In the extension page: listens for MEDIA_EVENT, opens, pushes random cuts.
const PUSH = `async ({ b64, key, maxCut }) => {
  const send = (type, payload) => chrome.runtime.sendMessage({ type, payload });
  const enc = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  window.__events = [];
  chrome.runtime.onMessage.addListener((m) => {
    if (m && m.type === 'media/event') window.__events.push({ at: performance.now(), ...m.payload });
  });
  const open = await send('media/open', { key, lang: 'en', targetLang: 'zh' });
  if (!open || !open.ok) return { open };
  let seed = 7;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const t0 = performance.now();
  window.__t0 = t0;
  let pushes = 0;
  const sizes = [];
  for (let i = 0; i < bytes.length; ) {
    const n = 1 + Math.floor(rnd() * maxCut);
    const r = await send('media/push', { key, bytes: enc(bytes.subarray(i, i + n)) });
    if (!r || !r.ok) return { push: r, at: i };
    i += n;
    pushes++;
    sizes.push(n);
  }
  return { pushes, pushMs: Math.round(performance.now() - t0), minCut: Math.min(...sizes), maxCut: Math.max(...sizes) };
}`;

async function main() {
  const packsDir = arg('--packs');
  const exe = findBrowser(arg('--browser'));
  if (!packsDir || !fs.existsSync(packsDir) || !exe) {
    console.error('usage: --packs <dir with asr-base-sense-voice/ etc.> [--browser <chrome.exe | msedge.exe>]');
    return 2;
  }
  const box = sandbox('tt-caption-pipeline');
  linkPacks(packsDir, path.join(process.env.TT_MODELS_ROOT, 'asr-models'));
  const wav = synthesizeWav(path.join(box.dir, 'speech.wav'));
  console.log(`sandbox: ${box.dir}\nbrowser: ${exe}\n`);

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
  const companion = initCompanion({ store, engineManager, translateStream, logger, version: 'e2e-s2', getPrivacyMode: () => 'standard' });
  await companion.ready();
  step('companion channel up', companion.status().running === true, `port ${companion.status().port}`);

  const { build } = await import(pathToFileURL(path.join(REPO, 'extension/scripts/build.mjs')).href);
  const { outDir } = await build({ outDir: path.join(box.dir, 'dist'), logLevel: 'silent' });

  const browser = await launchBrowser({ exe, profile: path.join(box.dir, 'profile') });
  const { cdp, attach, evaluate, open } = browser;
  console.log(`browser pid ${browser.child.pid}`);
  const problems = [];
  const warnings = [];
  cdp.listen((m) => {
    if (m.method === 'Runtime.exceptionThrown') problems.push(`exception: ${m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text}`);
    if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) {
      const text = m.params.args.map((a) => a.value ?? a.description).join(' ');
      (m.params.type === 'error' ? problems : warnings).push(text);
    }
  });

  try {
    const { id, sw } = await loadExtension(browser, outDir);
    await attach(sw.targetId);
    step('extension loaded', true, id);
    const { sessionId: page } = await open(`chrome-extension://${id}/options.html`);
    await sleep(500);

    companion.openPairing();
    const paired = await evaluate(page, `chrome.runtime.sendMessage({ type: 'companion/pair' })`);
    step('paired through the extension', paired?.ok && paired.result.status === 'ready', paired?.result?.status || JSON.stringify(paired?.error));
    const { targetInfos } = await cdp.send('Target.getTargets');
    const off = targetInfos.find((t) => t.url === `chrome-extension://${id}/offscreen.html`);
    if (off) await attach(off.targetId);
    step('offscreen document up', !!off);

    const format = FFMPEG ? 'mp4' : 'webm';
    let media;
    let audioS;
    if (FFMPEG) {
      const m4s = toFmp4(FFMPEG, wav, path.join(box.dir, 'speech.m4s'));
      const wavBytes = fs.readFileSync(wav);
      audioS = (wavBytes.length - 44) / wavBytes.readUInt32LE(28);
      const mid = shiftTfdt(m4s, (OFFSET_MS / 1000) * AAC_RATE);
      step('ffmpeg fMP4/AAC from the wav', m4s.length > 1000 && audioS > 5, `${(m4s.length / 1024).toFixed(1)} KB, ${audioS.toFixed(2)} s audio`);
      step('every tfdt moved to +100 s', mid.fragments >= 2, `${mid.fragments} fragment(s)`);
      media = mid.bytes;
    } else {
      // Records in real time, so the clip's length bounds the wait.
      const rec = await evaluate(page, `(${RECORD})(${JSON.stringify(fs.readFileSync(wav).toString('base64'))})`, { timeoutMs: 600000 });
      const webm = Buffer.from(rec.b64, 'base64');
      const mid = asMidStream(webm, OFFSET_MS);
      audioS = rec.duration;
      step('MediaRecorder WebM/Opus from <audio>', webm.length > 1000 && rec.duration > 5, `${(webm.length / 1024).toFixed(1)} KB, ${rec.duration.toFixed(2)} s audio, recorded in ${rec.recordMs} ms`);
      step('rewritten as an unknown-size stream at +100 s', mid.clusters >= 1, `${mid.clusters} cluster(s)`);
      media = mid.bytes;
    }

    const pushed = await evaluate(page, `(${PUSH})(${JSON.stringify({ b64: media.toString('base64'), key: KEY, maxCut: 16384 })})`);
    step('MEDIA_OPEN + every MEDIA_PUSH answered ok', pushed.pushes > 0 && !pushed.open && !pushed.push, JSON.stringify(pushed));

    const events = () => evaluate(page, 'window.__events');
    const segmentsOf = (evs) => evs.filter((e) => e.event.type === 'segment').map((e) => e.event);
    let evs = [];
    for (let i = 0; i < 600; i++) {
      evs = await events();
      if (segmentsOf(evs).length >= 3) break;
      await sleep(100);
    }
    const t0 = await evaluate(page, 'window.__t0');
    const closeAsked = Date.now();
    const closed = await evaluate(page, `chrome.runtime.sendMessage({ type: 'media/close', payload: { key: ${JSON.stringify(KEY)} } })`);
    const closeMs = Date.now() - closeAsked;
    for (let i = 0; i < 100; i++) {
      evs = await events();
      if (evs.some((e) => e.event.type === 'closed')) break;
      await sleep(100);
    }
    const segs = segmentsOf(evs);
    const firstSegAt = evs.find((e) => e.event.type === 'segment')?.at;
    step(
      'finals on the media timeline (≥ 2, after mediaStartS 100 s, rising)',
      segs.length >= 2 && segs.every((s, i) => s.start >= OFFSET_MS / 1000 && (i === 0 || s.start > segs[i - 1].start)),
      segs.map((s) => `[${s.start}–${s.end}] ${s.text}`).join(' | ')
    );
    const done = (s) => evs.some((e) => e.event.type === 'translation' && e.event.id === s.id && e.event.done);
    step('every final translated', segs.length > 0 && segs.every(done));
    const closedEvents = evs.filter((e) => e.event.type === 'closed');
    step('close → one closed/closed on MEDIA_EVENT, all with the key', closedEvents.length === 1 && closedEvents[0].event.reason === 'closed' && evs.every((e) => e.key === KEY), JSON.stringify(closedEvents.map((e) => e.event)));
    const stats = closed?.result;
    step(`MEDIA_CLOSE replies with the stream stats (${format})`, closed?.ok && stats.container === format && stats.blocks > 0 && stats.feeder?.fedS > 0, JSON.stringify(stats));
    step('no exceptions or console errors in extension contexts', problems.length === 0, problems.join(' || '));

    const numbers = {
      browser: path.basename(exe),
      format,
      mediaKB: +(media.length / 1024).toFixed(1),
      audioS: +audioS.toFixed(2),
      pushes: pushed.pushes,
      pushMs: pushed.pushMs,
      blocks: stats?.blocks,
      decodedS: stats && +stats.decodedS.toFixed(2),
      decodeMs: stats?.decodeMs,
      fedS: stats?.feeder?.fedS,
      feedMs: stats?.feeder?.feedMs,
      waits: stats?.feeder?.waits,
      waitReasons: stats?.feeder?.waitReasons,
      droppedS: stats?.feeder?.droppedS,
      segments: segs.length,
      firstSegmentStart: segs[0]?.start,
      firstSegmentAfterMs: firstSegAt ? Math.round(firstSegAt - t0) : null,
      closeMs,
      warnings: warnings.length,
    };
    console.log(`\n  numbers: ${JSON.stringify(numbers)}`);
    if (warnings.length) console.log(`  warnings: ${warnings.join(' || ')}`);
  } finally {
    const how = await browser.close();
    step('browser closed', true, how);
    await companion.stop();
    await engineManager.stopSessionAndWait?.('e2e-s2');
    console.log(`  sandbox left for the recycle bin: ${box.dir}`);
  }
  return summary();
}

run(main);
