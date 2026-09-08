// The one table behind the GPU switch. Every engine that runs a model on
// this machine has a row: whether it can take the GPU, on which runtime, and
// — when it cannot — why, in a form the settings page can show. The switch,
// its confirmation dialog, the per-engine status rows and the self-tests all
// read this; adding an engine means adding a row, not touching the UI.
//
// Backend policy: one execution provider for everything, WebGPU (Dawn on
// D3D12), because it covers NVIDIA / AMD / Intel with nothing to install and
// is the one Microsoft still develops. DirectML was measured and dropped
// (maintenance mode, rejected Kokoro's ConvTranspose). Quantized (int8)
// graphs run 3–6x slower on WebGPU than on the CPU, which is why the listen
// engines are listed as CPU-only rather than "not yet".
//
// Shared main/renderer: plain data, no requires.

const GPU_PROVIDER = 'webgpu';

const GPU_ENGINES = [
  {
    id: 'ocr',
    // Runtime: onnxruntime-node inside the OCR host utilityProcess.
    runtime: 'onnxruntime-node',
    gpu: true,
    // Measured 2026-09-07 (RTX 4090 Laptop): screen-sized capture 1.95 s → 0.61 s.
    note: 'ppocr',
  },
  {
    id: 'tts',
    // Runtime: sherpa-onnx inside the audio utilityProcess, with the WebGPU
    // provider patch (native/sherpa-onnx-webgpu).
    runtime: 'sherpa-onnx',
    gpu: true,
    // Kokoro fp32: first chunk 573 ms → 111 ms, RTF 0.235 → 0.044.
    note: 'kokoro',
  },
  {
    id: 'asr',
    runtime: 'sherpa-onnx',
    gpu: false,
    // SenseVoice / zipformer / Qwen3-ASR are int8: 3–6x slower on WebGPU.
    reason: 'int8',
  },
];

const gpuCapableIds = () => GPU_ENGINES.filter((e) => e.gpu).map((e) => e.id);

module.exports = { GPU_PROVIDER, GPU_ENGINES, gpuCapableIds };
