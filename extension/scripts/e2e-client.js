// End to end for the extension's companion client: the real companion server
// and listen engine in a throwaway sandbox, the real client talking to it
// over 127.0.0.1 — pair, hello, translate, an ASR session with synthesized
// speech, the system-listen fallback, and a window preemption.
//
//   npx electron extension/scripts/e2e-client.js --packs <installed asr-models dir> [--keep]
//
// Nothing of the user's is touched: sandbox userData, packs hard-linked (or
// copied across drives) into the sandbox's models root.
/* eslint-disable no-console */

const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { REPO, arg, has, sleep, waitFor, checklist, sandbox, fakeStore, run } = require('../../scripts/lib/electron-smoke');
const { fakeWindow, readWavPcm } = require('../../scripts/lib/listen-sandbox');
const { synthesizeWav, linkPacks } = require('./lib/speech');

const { step, summary } = checklist();
const KEEP = has('--keep');

async function main() {
  const packsDir = arg('--packs');
  if (!packsDir || !fs.existsSync(packsDir)) {
    console.error('usage: --packs <dir with asr-base-sense-voice/ etc.>');
    return 2;
  }
  const box = sandbox('tt-caption-e2e');
  linkPacks(packsDir, path.join(process.env.TT_MODELS_ROOT, 'asr-models'));
  const wav = synthesizeWav(path.join(box.dir, 'speech.wav'));
  const pcm = readWavPcm(wav);
  console.log(`sandbox: ${box.dir}\naudio: ${(pcm.length / 16000).toFixed(1)}s en speech\n`);

  const engineManager = require('../../electron/listen/audio-engine-manager');
  const { initCompanion } = require('../../electron/companion');
  const store = fakeStore({ 'settings.companion.enabled': true });
  const win = { status: [] };
  engineManager.init({ store, getWindow: () => fakeWindow({ status: (p) => win.status.push(p.state) }) });
  const translateStream = async (text, _o, onChunk) => { onChunk(`[译] ${text}`); return { success: true, text: `[译] ${text}` }; };
  engineManager.configureTranslation({ translateStream });
  const logger = { info: () => {}, warn: (m) => console.log('  [warn]', m), error: (m) => console.log('  [error]', m), debug: () => {} };
  const companion = initCompanion({ store, engineManager, translateStream, logger, version: 'e2e', getPrivacyMode: () => 'standard' });
  await companion.ready();
  step('companion channel up', companion.status().running === true, `port ${companion.status().port}`);

  // The client under test, loaded as the ESM module the offscreen page will use.
  const { createCompanionClient } = await import(pathToFileURL(path.join(REPO, 'extension/src/offscreen/companion-client.js')).href);
  const mem = new Map();
  const storage = { get: async (k) => (mem.has(k) ? mem.get(k) : null), set: async (k, v) => { mem.set(k, v); } };
  const states = [];
  const client = createCompanionClient({ version: '0.0.0-e2e', storage, onState: (s) => states.push(s.status), reconnectDelay: () => 200 });
  await client.load();
  step('unpaired at first', client.getState().status === 'unpaired');

  let failed = null;
  try { await client.pair(); } catch (e) { failed = e.code; }
  step('pairing refused while the window is closed', failed === 'pairing-failed');
  companion.openPairing();
  const hello = await client.pair();
  step('pair + hello', hello.app === 'T-Translate' && client.getState().status === 'ready' && mem.get('pairing')?.port === companion.status().port, JSON.stringify(hello.capabilities));
  step('pairing window is one-shot', companion.status().pairingOpen === false);

  const tr = await client.translate([{ id: 'a', text: 'hello' }, { id: 'b', text: '' }], { target: 'zh' });
  step('translate', tr[0]?.text === '[译] hello' && tr[1]?.text === '', JSON.stringify(tr));

  // ASR session: open, subscribe, feed unpaced with backpressure handling.
  const { id } = await client.openAsr({ lang: 'en', targetLang: 'zh', mediaStartS: 100 });
  const events = [];
  let closedAt = 0;
  const sub = client.subscribe(id, (evt) => { events.push(evt); if (evt.type === 'closed') closedAt = Date.now(); });
  await waitFor(() => events.some((e) => e.type === 'status' && e.state === 'listening'), { tries: 300 });
  step('events stream reports listening', events.some((e) => e.state === 'listening'));

  let waits = 0;
  let seq = 0;
  const chunk = 16000;
  const fedStart = Date.now();
  for (let i = 0; i < pcm.length; i += chunk) {
    for (;;) {
      const r = await client.feed(id, pcm.subarray(i, i + chunk), ++seq);
      if (r.ok) break;
      waits += 1;
      await sleep(Math.min(r.wait, 1000));
    }
  }
  for (let i = 0; i < 3; i++) await client.feed(id, new Float32Array(chunk), ++seq);
  const fedMs = Date.now() - fedStart;
  await waitFor(() => events.filter((e) => e.type === 'segment').length >= 2, { tries: 200 });
  const segs = events.filter((e) => e.type === 'segment');
  step('finals on the media timeline', segs.length >= 2 && segs.every((s, i) => s.start >= 100 && (i === 0 || s.start > segs[i - 1].start)), segs.map((s) => `[${s.start}–${s.end}] ${s.text}`).join(' | '));
  await waitFor(() => segs.every((s) => events.some((e) => e.type === 'translation' && e.id === s.id && e.done)), { tries: 100 });
  step('every final translated', segs.every((s) => events.some((e) => e.type === 'translation' && e.id === s.id && e.done)));
  console.log(`  fed ${(pcm.length / 16000).toFixed(1)}s in ${fedMs} ms with ${waits} waits`);

  const closeReq = Date.now();
  await client.closeAsr(id);
  await waitFor(() => closedAt > 0, { tries: 100 });
  step('close → closed/closed on the stream', events.at(-1)?.type === 'closed' && events.at(-1)?.reason === 'closed', `${closedAt - closeReq} ms after the request`);
  sub.stop();

  // System-listen fallback: open, see listening, close.
  const sys = await client.listenOpen({ lang: 'en', targetLang: 'zh', mediaStartS: 0 });
  const sysEvents = [];
  const sysSub = client.subscribe(sys.id, (evt) => sysEvents.push(evt));
  await waitFor(() => sysEvents.some((e) => e.state === 'listening' || e.state === 'capture-error' || e.type === 'closed'), { tries: 300 });
  await client.closeAsr(sys.id);
  await waitFor(() => sysEvents.some((e) => e.type === 'closed'), { tries: 100 });
  step('listen/open (system) opens and closes', sysEvents.some((e) => e.state === 'listening') && sysEvents.at(-1)?.reason === 'closed', sysEvents.filter((e) => e.type !== 'translation').map((e) => e.state || `closed:${e.reason}`).join(' > '));
  sysSub.stop();

  // Preemption: the floating window starts listening while a companion session runs.
  const pre = await client.openAsr({ lang: 'en', targetLang: 'zh' });
  const preEvents = [];
  const preSub = client.subscribe(pre.id, (evt) => preEvents.push(evt));
  await waitFor(() => preEvents.some((e) => e.state === 'listening'), { tries: 300 });
  const windowStart = engineManager.startSession({ language: 'en', source: { mode: 'off' } });
  await waitFor(() => preEvents.some((e) => e.type === 'closed'), { tries: 200 });
  step('window preempts: closed/preempted', windowStart.queued === true && preEvents.at(-1)?.reason === 'preempted');
  preSub.stop();
  await engineManager.stopSessionAndWait('e2e');

  // Token regenerated: the client learns it is unpaired on the next call.
  companion.regenerateToken();
  let code = null;
  try { await client.hello(); } catch (e) { code = e.code; }
  step('regenerated token → unauthorized → unpaired', code === 'unauthorized' && client.getState().status === 'unpaired');

  await companion.stop();
  step('channel stopped', companion.status().running === false);
  console.log(`\n  client states: ${[...new Set(states)].join(' > ')}`);
  const result = summary();
  if (!KEEP) box.cleanup();
  else console.log(`sandbox kept: ${box.dir}`);
  return result;
}

run(main);
