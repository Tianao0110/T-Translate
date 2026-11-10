// Records extension/test/fixtures/tone-2s.webm: 2 s of a 440 Hz sine through
// MediaRecorder (audio/webm;codecs=opus, 48 kbps) in a headless Chrome or
// Edge with a throwaway profile. Run once; the file is committed.
//
//   node extension/scripts/make-fixture.js [--browser <exe>] [--out <file>]
/* eslint-disable no-console */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { findBrowser, launchBrowser } = require('./lib/browser');

const argOf = (name) => {
  const at = process.argv.indexOf(name);
  return at > -1 ? process.argv[at + 1] : null;
};

// Runs in the page; resolves the recording as base64.
async function record() {
  const ctx = new AudioContext({ sampleRate: 48000 });
  await ctx.resume();
  const osc = new OscillatorNode(ctx, { frequency: 440 });
  const dest = ctx.createMediaStreamDestination();
  osc.connect(new GainNode(ctx, { gain: 0.5 })).connect(dest);
  const rec = new MediaRecorder(dest.stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 48000 });
  const parts = [];
  rec.ondataavailable = (e) => parts.push(e.data);
  const stopped = new Promise((r) => {
    rec.onstop = r;
  });
  osc.start();
  rec.start();
  await new Promise((r) => setTimeout(r, 2000));
  rec.stop();
  await stopped;
  osc.stop();
  await ctx.close();
  const bytes = new Uint8Array(await new Blob(parts).arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function main() {
  const exe = findBrowser(argOf('--browser'));
  if (!exe) throw new Error('no Chrome / Edge found; pass --browser <exe>');
  const out = path.resolve(argOf('--out') || path.join(__dirname, '..', 'test', 'fixtures', 'tone-2s.webm'));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tcaption-fixture-'));
  const browser = await launchBrowser({ exe, profile });
  try {
    const { sessionId } = await browser.open('about:blank');
    const b64 = await browser.evaluate(sessionId, `(${record.toString()})()`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, Buffer.from(b64, 'base64'));
    console.log(`wrote ${out} (${fs.statSync(out).size} bytes) with ${path.basename(exe)}`);
  } finally {
    console.log(`browser pid ${browser.child.pid} closed via ${await browser.close()}`);
    console.log(`profile left for the recycle bin: ${profile}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
