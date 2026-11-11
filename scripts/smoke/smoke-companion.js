// Companion-channel smoke: T-Caption's local HTTP channel over the real
// listen chain, in a throwaway sandbox, no network.
//
//   npx electron scripts/smoke/smoke-companion.js --packs <asr-models dir> [--zh] [--wav <file>] [--keep]
//
// --packs is a folder of installed listen packs (asr-models/<packId>/...),
// linked or copied read-only into the sandbox; --zh speaks Chinese instead
// of English; --wav brings an English recording of your own. Covers pairing -> hello ->
// asr/open (feed) -> events stream -> unpaced feed against the rate limit
// -> finals on the media timeline with their translations -> close; a seek
// mid-sentence (the half sentence on the old timeline, the rest from the new
// start, no reload); the system-sound session; preemption by a window
// session; no subtitle file left behind; the port released. Protocol: docs/design/listen.md §11;
// harness notes: docs/design/tooling.md §4.
/* eslint-disable no-console */

const path = require('path');
const fs = require('fs');
const net = require('net');
const { execFileSync } = require('child_process');
const { arg, has, sleep, waitFor, checklist, sandbox, place, fakeStore, run } = require('../lib/electron-smoke');
const { fakeWindow, readWavPcm } = require('../lib/listen-sandbox');

const KEEP = has('--keep');
const { step, summary } = checklist();
const CLIENT = 't-caption/0.0.0-smoke';
const CHUNK = 1600; // 100 ms
const TAIL_SILENCE_S = 2.5;
const MEDIA_START_S = 100;
const SEEK_TO_S = 500;

const LINES = {
  en: ['Good morning everyone, and welcome to the weekly news.', 'Today we will talk about the weather and the traffic in the city.', 'Thank you for listening, and have a nice day.'],
  zh: ['今天的天气非常好，我们去公园散步吧。', '下午可能会下雨，记得带上雨伞。', '谢谢大家的收听，祝大家生活愉快。'],
};

// SAPI speech with a pause between sentences: David reads English when
// installed (and --zh is not given), else Huihui reads Chinese. Returns the
// language spoken.
function synthesizeWav(dest, preferZh) {
  const quote = (s) => `'${s.replace(/'/g, "''")}'`;
  const ps = `
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$names = $s.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name }
if (-not $${preferZh ? 'true' : 'false'} -and $names -contains 'Microsoft David Desktop') { $lang = 'en'; $s.SelectVoice('Microsoft David Desktop') } else { $lang = 'zh'; $s.SelectVoice('Microsoft Huihui Desktop') }
$lines = @{ en = @(${LINES.en.map(quote).join(', ')}); zh = @(${LINES.zh.map(quote).join(', ')}) }
$culture = [System.Globalization.CultureInfo]::GetCultureInfo($(if ($lang -eq 'zh') { 'zh-CN' } else { 'en-US' }))
$p = New-Object System.Speech.Synthesis.PromptBuilder($culture)
foreach ($line in $lines[$lang]) { $p.AppendText($line); $p.AppendBreak([TimeSpan]::FromMilliseconds(1200)) }
$s.SetOutputToWaveFile(${quote(dest)})
$s.Speak($p)
$s.SetOutputToNull()
$s.Dispose()
Write-Output $lang
`;
  const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return out.trim();
}

// Every installed pack folder under packsDir, file by file, into the sandbox.
function linkPacks(packsDir, dest) {
  const ids = [];
  for (const entry of fs.readdirSync(packsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const linkTree = (src, dst) => {
      fs.mkdirSync(dst, { recursive: true });
      for (const f of fs.readdirSync(src, { withFileTypes: true })) {
        if (f.isDirectory()) linkTree(path.join(src, f.name), path.join(dst, f.name));
        else if (f.isFile()) place(dst, path.join(src, f.name));
      }
    };
    linkTree(path.join(packsDir, entry.name), path.join(dest, entry.name));
    ids.push(entry.name);
  }
  return ids;
}

function api(base, token = null) {
  const headers = (extra = {}) => ({ 'x-tt-client': CLIENT, ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra });
  async function json(method, route, body) {
    const r = await fetch(base + route, { method, headers: headers(body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
    const text = await r.text();
    return { status: r.status, json: text ? JSON.parse(text) : null };
  }
  async function feed(id, seq, samples) {
    const r = await fetch(`${base}/v1/asr/feed`, {
      method: 'POST',
      headers: headers({ 'content-type': 'application/octet-stream', 'x-session-id': id, 'x-seq': String(seq) }),
      body: Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength),
    });
    const text = await r.text();
    return { status: r.status, json: text ? JSON.parse(text) : null, retryAfter: Number(r.headers.get('retry-after')) || 0 };
  }
  // The NDJSON stream read in the background; every event gets its arrival time.
  async function events(id) {
    const out = { events: [], heartbeats: 0, ended: false };
    const r = await fetch(`${base}/v1/asr/events?id=${encodeURIComponent(id)}`, { headers: headers() });
    out.status = r.status;
    out.done = (async () => {
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i);
          buf = buf.slice(i + 1);
          const evt = JSON.parse(line);
          if (Object.keys(evt).length) out.events.push({ ...evt, at: Date.now() });
          else out.heartbeats += 1;
        }
      }
    })()
      .catch((e) => {
        out.error = e.message;
      })
      .finally(() => {
        out.ended = true;
      });
    return out;
  }
  return { json, feed, events };
}

// Unpaced 100 ms posts from x-seq seq0; a 429 waits out Retry-After, a 503
// (not ready yet) retries. stats.seq is the next x-seq.
async function feedAll(client, id, pcm, seq0 = 0) {
  const stats = { posts: 0, rate: 0, backpressure: 0, notReady: 0, other: [], seq: seq0 };
  let seq = seq0;
  for (let i = 0; i < pcm.length; i += CHUNK) {
    const chunk = pcm.slice(i, i + CHUNK);
    for (;;) {
      const r = await client.feed(id, seq, chunk);
      stats.posts += 1;
      if (r.status === 204) {
        seq += 1;
        break;
      }
      if (r.status === 429) {
        if (r.json?.error === 'rate') stats.rate += 1;
        else stats.backpressure += 1;
        await sleep((r.retryAfter || 1) * 1000);
      } else if (r.status === 503) {
        stats.notReady += 1;
        await sleep(200);
      } else {
        stats.other.push(r.status);
        stats.seq = seq;
        return stats;
      }
    }
  }
  stats.seq = seq;
  return stats;
}

const ofType = (stream, type) => stream.events.filter((e) => e.type === type);
const hasState = (stream, state) => stream.events.some((e) => e.type === 'status' && e.state === state);

function listeningOn(port) {
  try {
    const out = execFileSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf8' });
    return out.split(/\r?\n/).some((l) => l.includes(`127.0.0.1:${port} `) && /LISTENING/.test(l));
  } catch {
    return null;
  }
}

function refused(port) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port });
    sock.once('connect', () => {
      sock.destroy();
      resolve(false);
    });
    sock.once('error', (e) => resolve(e.code === 'ECONNREFUSED'));
  });
}

async function main() {
  const packsDir = arg('--packs');
  if (!packsDir || !fs.existsSync(packsDir)) {
    console.error('usage: npx electron scripts/smoke/smoke-companion.js --packs <asr-models dir> [--zh] [--wav <file>] [--keep]');
    return 2;
  }
  const box = sandbox('tt-companion-smoke');
  const { modelDir } = require('../../electron/packs/model-root');
  const packIds = linkPacks(packsDir, modelDir('asr-models'));
  console.log(`sandbox: ${box.dir}\npacks: ${packIds.join(', ')}\n`);

  let lang = 'en';
  let wav = arg('--wav');
  if (!wav) {
    wav = path.join(box.dir, 'speech.wav');
    lang = synthesizeWav(wav, has('--zh')) === 'zh' ? 'zh' : 'en';
  }
  const target = lang === 'zh' ? 'en' : 'zh';
  const speech = readWavPcm(wav);
  const pcm = new Float32Array(speech.length + TAIL_SILENCE_S * 16000);
  pcm.set(speech);
  console.log(`audio: ${(speech.length / 16000).toFixed(2)}s ${lang} speech + ${TAIL_SILENCE_S}s silence, translating to ${target}\n`);

  const store = fakeStore({ 'settings.companion.enabled': true });
  const engineManager = require('../../electron/listen/audio-engine-manager');
  const windowStatus = [];
  engineManager.init({ store, getWindow: () => fakeWindow({ status: (p) => windowStatus.push(p.state) }) });
  const fakeTranslate = async (text) => ({ success: true, text: `[译] ${text}`, effectivePrivacyMode: 'standard' });
  engineManager.configureTranslation({ translateStream: fakeTranslate });
  step('listen models found in the sandbox', !!engineManager.getInfo().modelName, engineManager.getInfo().modelName || 'none');

  const { initCompanion } = require('../../electron/companion');
  const P = require('../../electron/companion/protocol');
  const logger = require('../../electron/platform/logger')('Companion');
  const companion = initCompanion({ store, engineManager, translateStream: fakeTranslate, logger, version: 'smoke', getPrivacyMode: () => 'standard' });
  await companion.ready();
  const port = companion.status().port;
  try {
    step('channel listens on the protocol port range', companion.status().running && port >= P.PORT_BASE && port < P.PORT_BASE + P.PORT_SPAN, `127.0.0.1:${port}`);
    const base = `http://${P.HOST}:${port}`;

    // ===== Pairing and hello =====
    const anon = api(base);
    const early = await anon.json('POST', '/v1/pair');
    companion.openPairing();
    const paired = await anon.json('POST', '/v1/pair');
    const again = await anon.json('POST', '/v1/pair');
    step(
      'pairing: closed until opened, then one token, then closed again',
      early.status === 403 && paired.status === 200 && /^[0-9a-f]{64}$/.test(paired.json?.token || '') && paired.json.port === port && again.status === 403,
      `${early.status} → ${paired.status} → ${again.status}`
    );
    const client = api(base, paired.json?.token);
    const hello = await client.json('GET', '/v1/hello');
    step('hello with the token', hello.status === 200 && hello.json.protocol === 1 && hello.json.capabilities.asr === true, JSON.stringify(hello.json));
    step('without the token: 401', (await anon.json('GET', '/v1/hello')).status === 401);

    // ===== Fed session on the media timeline =====
    const opened = await client.json('POST', '/v1/asr/open', { mode: 'feed', lang, targetLang: target, mediaStartS: MEDIA_START_S });
    step('asr/open (feed)', opened.status === 200 && !!opened.json?.id, JSON.stringify(opened.json));
    const id = opened.json.id;
    const stream = await client.events(id);
    const loadStart = Date.now();
    await waitFor(() => hasState(stream, 'listening'), { tries: 300 });
    const loadMs = Date.now() - loadStart;
    step('events stream reports listening', stream.status === 200 && hasState(stream, 'listening'), `${loadMs} ms after open`);

    const feedStart = Date.now();
    const fed = await feedAll(client, id, pcm);
    const feedMs = Date.now() - feedStart;
    step(
      'unpaced feed gets through, the rate limit paces it',
      fed.other.length === 0,
      `${Math.ceil(pcm.length / CHUNK)} chunks in ${(feedMs / 1000).toFixed(1)}s (${((pcm.length / 16000) / (feedMs / 1000)).toFixed(1)}× realtime), ${fed.posts} posts, 429 rate ${fed.rate} / backpressure ${fed.backpressure}, 503 ${fed.notReady}${fed.other.length ? `, other ${fed.other}` : ''}`
    );

    // Finals settle: no new one for 3 s and every one translated.
    let lastCount = -1;
    let stableSince = Date.now();
    await waitFor(
      () => {
        const n = ofType(stream, 'segment').length;
        if (n !== lastCount) {
          lastCount = n;
          stableSince = Date.now();
        }
        const translated = ofType(stream, 'segment').every((s) => ofType(stream, 'translation').some((t) => t.id === s.id && t.done));
        return n >= 2 && translated && Date.now() - stableSince > 3000;
      },
      { tries: 300 }
    );
    const segments = ofType(stream, 'segment');
    const starts = segments.map((s) => s.start);
    step('at least two finals', segments.length >= 2, segments.map((s) => `[${s.start.toFixed(2)}–${s.end.toFixed(2)}] ${JSON.stringify(s.text)}`).join(' | '));
    step(
      'finals sit on the media timeline, in order',
      starts.length > 0 && starts[0] >= MEDIA_START_S && starts.every((v, i) => i === 0 || v > starts[i - 1]) && segments.every((s) => s.end > s.start),
      starts.map((v) => v.toFixed(2)).join(' → ')
    );
    const translations = ofType(stream, 'translation');
    step(
      'each final is followed by its finished translation',
      segments.every((s) => translations.some((t) => t.id === s.id && t.done && t.text === `[译] ${s.text}` && t.at >= s.at)),
      `${translations.filter((t) => t.done).length} done of ${segments.length}`
    );
    step('only status / segment / translation / closed on the wire', stream.events.every((e) => ['status', 'segment', 'translation', 'closed'].includes(e.type)));

    const busyFed = await client.json('POST', '/v1/listen/open', {});
    step('a second session while one runs: 409 busy', busyFed.status === 409 && busyFed.json.owner === 'companion', JSON.stringify(busyFed.json));

    const closeAt = Date.now();
    const closed = await client.json('POST', '/v1/asr/close', { id });
    await Promise.race([stream.done, sleep(10000)]);
    const closedEvt = ofType(stream, 'closed')[0];
    step(
      'asr/close: 204, then closed/closed and the stream ends',
      closed.status === 204 && stream.ended && closedEvt?.reason === 'closed' && closedEvt.at >= closeAt,
      closedEvt ? `closed ${closedEvt.at - closeAt} ms after the request` : 'no closed event'
    );
    await waitFor(() => !engineManager.getInfo().running, { tries: 100 });

    // ===== Seek in place: the same session, a new media start =====
    const seekOpen = await client.json('POST', '/v1/asr/open', { mode: 'feed', lang, targetLang: target, mediaStartS: MEDIA_START_S });
    const seekId = seekOpen.json.id;
    const seekStream = await client.events(seekId);
    await waitFor(() => hasState(seekStream, 'listening'), { tries: 300 });
    // Up to the middle of the last sentence, so the seek has a half sentence to flush.
    let lastVoiced = speech.length - 1;
    while (lastVoiced > 0 && Math.abs(speech[lastVoiced]) < 0.01) lastVoiced--;
    const cut = Math.max(16000, lastVoiced - Math.round(0.8 * 16000));
    const fedBefore = await feedAll(client, seekId, speech.slice(0, cut));
    const tSeek = Date.now();
    const seekRes = await client.json('POST', '/v1/asr/seek', { id: seekId, mediaStartS: SEEK_TO_S });
    const seekMs = Date.now() - tSeek;
    step(
      'asr/seek: 200 with the cut on the session clock, the engine never reloads',
      seekRes.status === 200 && Math.abs(seekRes.json?.atS - cut / 16000) < 0.05 && engineManager.getInfo().running,
      `${JSON.stringify(seekRes.json)} after ${(cut / 16000).toFixed(2)} s fed, ${seekMs} ms; 503 before ${fedBefore.notReady}`
    );
    const seekAt = Date.now();
    const fedAfter = await feedAll(client, seekId, pcm, fedBefore.seq);
    lastCount = -1;
    stableSince = Date.now();
    await waitFor(
      () => {
        const n = ofType(seekStream, 'segment').length;
        if (n !== lastCount) {
          lastCount = n;
          stableSince = Date.now();
        }
        return ofType(seekStream, 'segment').some((s) => s.start >= SEEK_TO_S) && Date.now() - stableSince > 3000;
      },
      { tries: 300 }
    );
    const seekSegs = ofType(seekStream, 'segment');
    const oldSegs = seekSegs.filter((s) => s.start < SEEK_TO_S);
    const newSegs = seekSegs.filter((s) => s.start >= SEEK_TO_S);
    const halfLine = lang === 'zh' ? /谢谢|收听/ : /thank|listening/i;
    const lastOld = oldSegs.at(-1);
    step(
      'the half sentence open at the seek comes out on the old timeline',
      !!lastOld && halfLine.test(lastOld.text) && lastOld.at >= tSeek && lastOld.start >= MEDIA_START_S && lastOld.end <= MEDIA_START_S + cut / 16000 + 0.05,
      `${oldSegs.map((s) => `[${s.start.toFixed(2)}–${s.end.toFixed(2)}] ${JSON.stringify(s.text)}`).join(' | ')}; the last one ${lastOld ? lastOld.at - tSeek : '?'} ms after the seek`
    );
    const newStarts = newSegs.map((s) => s.start);
    step(
      'finals after the seek run from the new start, in order, translated',
      newSegs.length >= 2 && newStarts[0] < SEEK_TO_S + 3 && newStarts.every((v, i) => i === 0 || v > newStarts[i - 1]) && newSegs.every((s) => s.end <= SEEK_TO_S + pcm.length / 16000 + 0.5) && newSegs.every((s) => ofType(seekStream, 'translation').some((t) => t.id === s.id && t.done)),
      `${newSegs.map((s) => `[${s.start.toFixed(2)}–${s.end.toFixed(2)}] ${JSON.stringify(s.text)}`).join(' | ')}; first final ${newSegs[0] ? ((newSegs[0].at - seekAt) / 1000).toFixed(1) : '?'} s after the seek; ${fedAfter.posts} posts`
    );
    const reloads = seekStream.events.filter((e) => e.type === 'status' && e.at >= tSeek && ['loading', 'engine-restarting'].includes(e.state));
    const { dataDir } = require('../../electron/platform/data-root');
    const probeLog = fs.readdirSync(dataDir('logs')).filter((f) => f.startsWith('audio-probe-')).sort().at(-1);
    const probe = probeLog ? fs.readFileSync(path.join(dataDir('logs'), probeLog), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
    const seekEvents = probe.filter((r) => r.type === 'event' && r.kind === 'seek');
    step(
      'no reload: no loading status after the seek, one asr_start in the worker log, its seek event',
      reloads.length === 0 && probe.filter((r) => r.type === 'asr_start').length === 1 && seekEvents.length === 1,
      `${probeLog}: ${seekEvents.map((r) => `seek ${r.detail} at +${r.ts - tSeek} ms`).join(', ')}; statuses after ${reloads.map((e) => e.state).join(', ') || 'none'}`
    );
    await client.json('POST', '/v1/asr/close', { id: seekId });
    await Promise.race([seekStream.done, sleep(10000)]);
    await waitFor(() => !engineManager.getInfo().running, { tries: 100 });

    // ===== System sound (DRM fallback) =====
    const sys = await client.json('POST', '/v1/listen/open', { lang, targetLang: target, mediaStartS: 0 });
    const sysStream = sys.json?.id ? await client.events(sys.json.id) : null;
    if (sysStream) await waitFor(() => hasState(sysStream, 'listening') || hasState(sysStream, 'capture-error') || ofType(sysStream, 'closed').length > 0, { tries: 300 });
    const sysListening = !!sysStream && hasState(sysStream, 'listening');
    if (sysStream) {
      await client.json('POST', '/v1/asr/close', { id: sys.json.id });
      await Promise.race([sysStream.done, sleep(10000)]);
    }
    step(
      'listen/open (system) opens, captures and closes',
      sys.status === 200 && sysListening && ofType(sysStream, 'closed')[0]?.reason === 'closed',
      sysStream ? sysStream.events.filter((e) => e.type !== 'segment' && e.type !== 'translation').map((e) => e.state || `closed:${e.reason}`).join(' > ') : JSON.stringify(sys.json)
    );
    await waitFor(() => !engineManager.getInfo().running, { tries: 100 });

    // ===== The user's own listen session wins =====
    const pre = await client.json('POST', '/v1/asr/open', { mode: 'feed', lang, targetLang: target, mediaStartS: 0 });
    const preStream = await client.events(pre.json.id);
    await waitFor(() => hasState(preStream, 'listening'), { tries: 300 });
    windowStatus.length = 0;
    const windowStart = engineManager.startSession({ language: lang, source: { mode: 'off' } });
    await Promise.race([preStream.done, sleep(10000)]);
    await waitFor(() => windowStatus.includes('listening'), { tries: 300 });
    step(
      'a window session preempts: closed/preempted, then the window session runs',
      windowStart.queued === true && ofType(preStream, 'closed')[0]?.reason === 'preempted' && windowStatus.includes('listening') && engineManager.getInfo().owner === 'window',
      `window start ${JSON.stringify(windowStart)}; companion ${ofType(preStream, 'closed').map((e) => e.reason)}; window ${windowStatus.join(' > ')}`
    );
    const blocked = await client.json('POST', '/v1/asr/open', { mode: 'feed' });
    step('while the window listens: 409 busy owner window', blocked.status === 409 && blocked.json.owner === 'window', JSON.stringify(blocked.json));
    await engineManager.stopSessionAndWait('smoke');

    const listenDir = engineManager.listenDir();
    const srts = fs.existsSync(listenDir) ? fs.readdirSync(listenDir).filter((f) => f.endsWith('.srt')) : [];
    step('no subtitle file written', srts.length === 0, srts.join(', ') || listenDir);

    console.log('\n==== 摘要 ====');
    console.log(`  终稿 ${segments.length} 条，首条 ${starts[0]?.toFixed(2)} s（媒体起点 ${MEDIA_START_S} s），模型就绪 ${loadMs} ms`);
    console.log(`  送音 ${(feedMs / 1000).toFixed(1)} s，限速 429 ${fed.rate} 次，背压 429 ${fed.backpressure} 次`);
    console.log(`  跳转：往返 ${seekMs} ms，切点 ${seekRes.json?.atS} s，新起点后首条终稿 ${newSegs[0]?.start.toFixed(2)} s`);
    console.log(`  事件流心跳 ${stream.heartbeats} 次\n`);
  } finally {
    await companion.stop();
    if (engineManager.getInfo().running) await engineManager.stopSessionAndWait('smoke-end');
  }
  step('stop releases the port', (await refused(port)) && listeningOn(port) === false, `127.0.0.1:${port}`);

  const failed = summary();
  if (failed === 0 && !KEEP) box.cleanup();
  else console.log(`\nsandbox kept: ${box.dir}`);
  return failed;
}

run(main);
