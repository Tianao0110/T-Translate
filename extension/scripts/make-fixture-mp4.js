// Writes extension/test/fixtures/tone-2s.m4s: 2 s of a 440 Hz sine as AAC-LC
// 48 kHz mono in fragmented MP4 (empty moov, one moof + mdat per second,
// default-base-is-moof), the layout MSE players append. ffmpeg is not a
// dependency: pass the executable. Run once; the file is committed.
//
//   node extension/scripts/make-fixture-mp4.js --ffmpeg <ffmpeg.exe> [--out <file>]
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const argOf = (name) => {
  const at = process.argv.indexOf(name);
  return at > -1 ? process.argv[at + 1] : null;
};

function main() {
  const ffmpeg = argOf('--ffmpeg');
  if (!ffmpeg || !fs.existsSync(ffmpeg)) {
    console.error('usage: node extension/scripts/make-fixture-mp4.js --ffmpeg <ffmpeg.exe> [--out <file>]');
    return 2;
  }
  const out = path.resolve(argOf('--out') || path.join(__dirname, '..', 'test', 'fixtures', 'tone-2s.m4s'));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  // prettier-ignore
  execFileSync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
    '-ar', '48000', '-ac', '1', '-c:a', 'aac', '-b:a', '64k',
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-frag_duration', '1000000',
    '-fflags', '+bitexact', '-map_metadata', '-1',
    '-f', 'mp4', out,
  ], { stdio: 'inherit' });
  console.log(`wrote ${out} (${fs.statSync(out).size} bytes) with ${path.basename(ffmpeg)}`);
  return 0;
}

process.exitCode = main();
