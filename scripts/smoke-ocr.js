// Local OCR smoke: renders a known line of text to PNG, recognizes it through
// the OCR host utilityProcess (CPU, then WebGPU when --gpu is given), and
// checks the host survives a kill. Runs against the bundled base pack, so
// `npm run ocr:models` must have been done. Nothing of the user's is
// touched: userData is a sandbox.
//
//   npm run smoke:ocr            CPU path only
//   npm run smoke:ocr -- --gpu   also the WebGPU path (needs a DX12 GPU)
/* eslint-disable no-console */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { app } = require('electron');

const SANDBOX = path.join(os.tmpdir(), 't-translate-smoke-ocr');
const TEXT_ZH = '今天的会议改到下午三点';
const TEXT_EN = 'Hello World 2026';
const BIG_LINES = [
  '请大家提前准备好各自负责部分的材料',
  'The quarterly report is due next Friday',
  '如果有问题随时在群里联系我',
  'Settings are saved automatically on change',
  '模型在设置页下载后悬浮窗即可使用',
  'Version 0.4.9 adds GPU acceleration for OCR',
  '离线模式下不会发出任何网络请求',
  'Thank you for reading this far',
];

let failures = 0;
function step(label, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures++;
}

function renderPng(text, width = 640, height = 120) {
  const canvasKit = require('@napi-rs/canvas');
  const canvas = canvasKit.createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#000';
  ctx.font = '40px "Microsoft YaHei", sans-serif';
  ctx.fillText(text, 20, 78);
  return canvas.toBuffer('image/png');
}

const norm = (s) => String(s).replace(/\s+/g, '').toLowerCase();

async function main() {
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  fs.mkdirSync(SANDBOX, { recursive: true });
  app.setPath('userData', SANDBOX);

  const ocrEngine = require('../electron/utils/ocr-engine');
  const hostManager = require('../electron/managers/ocr-host-manager').get();
  const gpu = process.argv.includes('--gpu');

  const light = await ocrEngine.healthCheck();
  step('bundled base pack resolves', light.healthy === true, light.activeBase || light.error);
  if (!light.healthy) return;

  const zhPng = renderPng(TEXT_ZH);
  const enPng = renderPng(TEXT_EN);
  const bigPng = (() => {
    const canvasKit = require('@napi-rs/canvas');
    const canvas = canvasKit.createCanvas(1280, 720);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 1280, 720);
    ctx.fillStyle = '#000';
    ctx.font = '36px "Microsoft YaHei", sans-serif';
    BIG_LINES.forEach((line, i) => ctx.fillText(line, 40, 80 + i * 80));
    return canvas.toBuffer('image/png');
  })();

  async function pass(label) {
    const t0 = Date.now();
    const first = await ocrEngine.recognize(zhPng, { language: 'zh-Hans', preprocess: { enabled: false } });
    const firstMs = Date.now() - t0;
    step(`${label}: Chinese line recognized`, first.success && norm(first.text).includes(norm(TEXT_ZH)), first.success ? `${JSON.stringify(first.text)} in ${firstMs}ms (host spawn + model load)` : `${first.errorCode}: ${first.error}`);
    const t1 = Date.now();
    const second = await ocrEngine.recognize(enPng, { language: 'en', preprocess: { enabled: false } });
    const secondMs = Date.now() - t1;
    step(`${label}: English line recognized, session cached`, second.success && norm(second.text).includes(norm(TEXT_EN)), second.success ? `${JSON.stringify(second.text)} in ${secondMs}ms` : `${second.errorCode}: ${second.error}`);
    const t2 = Date.now();
    const third = await ocrEngine.recognize(zhPng, { language: 'zh-Hans', preprocess: { enabled: false } });
    step(`${label}: warm recognition`, third.success, `${Date.now() - t2}ms`);
    // A screen-sized capture is where the model dominates the wall clock
    // (small strips are mostly decode + IPC), so that is what the CPU/GPU
    // comparison is measured on.
    const t3 = Date.now();
    const big = await ocrEngine.recognize(bigPng, { language: 'zh-Hans', preprocess: { enabled: false } });
    const bigMs = Date.now() - t3;
    // rawBlocks = per line; blocks = the lib's paragraph merge, fewer by design.
    step(`${label}: screen-sized capture (${BIG_LINES.length} lines)`, big.success && big.rawBlocks.length >= BIG_LINES.length - 1, `${big.rawBlocks?.length ?? 0} lines in ${bigMs}ms`);
    return { firstMs, secondMs, warmMs: Date.now() - t2, bigMs };
  }

  const cpu = await pass('cpu');
  step('host process is running', hostManager.running() === true);

  // A dead host must not strand the app: the next call respawns it.
  hostManager.shutdown();
  step('host stopped on shutdown', hostManager.running() === false);
  const afterKill = await ocrEngine.recognize(enPng, { language: 'en', preprocess: { enabled: false } });
  step('recognition after a host restart', afterKill.success && norm(afterKill.text).includes(norm(TEXT_EN)), afterKill.success ? afterKill.text : afterKill.error);

  const deep = await ocrEngine.healthCheck({ deep: true });
  step('deep health check builds a session in the host', deep.healthy === true, deep.error || deep.activeBase);

  if (gpu) {
    hostManager.setProvider('webgpu');
    const gpuRun = await pass('webgpu');
    const gpuHealth = await ocrEngine.hostStatus().catch((e) => ({ ok: false, error: e.message }));
    step('host reports the WebGPU provider without fallback', gpuHealth.ok && gpuHealth.provider === 'webgpu' && !gpuHealth.fallback, JSON.stringify(gpuHealth));
    step('WebGPU beats CPU on a screen-sized capture', gpuRun.bigMs < cpu.bigMs, `cpu ${cpu.bigMs}ms vs webgpu ${gpuRun.bigMs}ms`);
    hostManager.setProvider('cpu');
  } else {
    console.log('  (WebGPU path skipped — pass --gpu to test it)');
  }

  hostManager.shutdown();
  console.log(`\n==== ${failures ? `${failures} FAILED` : 'all passed'} ====`);
}

app.whenReady().then(() =>
  main()
    .catch((e) => {
      console.error('smoke crashed:', e);
      failures++;
    })
    .finally(() => app.exit(failures ? 1 : 0)),
);
