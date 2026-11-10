// Writes the MP4 unit-test samples into extension/test/fixtures/, each 2 s of
// a 440 Hz sine as AAC-LC 48 kHz mono:
//   tone-2s.m4s               fragmented (empty moov, one moof + mdat per
//                             second, default-base-is-moof), the layout MSE
//                             players append
//   tone-2s-faststart.mp4     progressive, moov before mdat (+faststart)
//   tone-2s-moov-last.mp4     progressive, moov after mdat (ffmpeg's default)
// ffmpeg is not a dependency: pass the executable. Run once; the files are committed.
//
//   node extension/scripts/make-fixture-mp4.js --ffmpeg <ffmpeg.exe> [--dir <dir>]
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const argOf = (name) => {
  const at = process.argv.indexOf(name);
  return at > -1 ? process.argv[at + 1] : null;
};

const SAMPLES = {
  'tone-2s.m4s': ['-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-frag_duration', '1000000'],
  'tone-2s-faststart.mp4': ['-movflags', '+faststart'],
  'tone-2s-moov-last.mp4': [],
};

function main() {
  const ffmpeg = argOf('--ffmpeg');
  if (!ffmpeg || !fs.existsSync(ffmpeg)) {
    console.error('usage: node extension/scripts/make-fixture-mp4.js --ffmpeg <ffmpeg.exe> [--dir <dir>]');
    return 2;
  }
  const dir = path.resolve(argOf('--dir') || path.join(__dirname, '..', 'test', 'fixtures'));
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, flags] of Object.entries(SAMPLES)) {
    const out = path.join(dir, name);
    // prettier-ignore
    execFileSync(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
      '-ar', '48000', '-ac', '1', '-c:a', 'aac', '-b:a', '64k',
      ...flags,
      '-fflags', '+bitexact', '-map_metadata', '-1',
      '-f', 'mp4', out,
    ], { stdio: 'inherit' });
    console.log(`wrote ${out} (${fs.statSync(out).size} bytes)`);
  }
  console.log(`with ${path.basename(ffmpeg)}`);
  return 0;
}

process.exitCode = main();
