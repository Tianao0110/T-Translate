// The engine table: every engine that runs a model on this machine has a
// row — which host it lives in, on which runtime, whether it can take the
// GPU, and when it cannot, why, in a form the settings page can show. The
// GPU switch, its confirmation dialog, the per-engine status rows, the
// self-tests and the T-Engine status snapshot all read this; adding an
// engine means adding a row, not touching the UI.
//
// Backend choice and the measured numbers: docs/T-ENGINE.md §10.
// Plain data, no requires.

const PROVIDER = 'webgpu';

const ENGINES = [
  {
    id: 'ocr',
    host: 'ocr',
    // Runtime: onnxruntime-node inside the OCR host utilityProcess.
    runtime: 'onnxruntime-node',
    gpu: true,
    note: 'ppocr',
  },
  {
    id: 'tts',
    host: 'audio',
    // Runtime: sherpa-onnx inside the audio utilityProcess, with the WebGPU
    // provider patch (native/sherpa-onnx-webgpu).
    runtime: 'sherpa-onnx',
    gpu: true,
    note: 'kokoro',
  },
  {
    id: 'asr',
    host: 'audio',
    runtime: 'sherpa-onnx',
    gpu: false,
    // int8 graphs stay on the CPU (docs/T-ENGINE.md §10).
    reason: 'int8',
  },
  {
    id: 'llm',
    host: 'llm',
    // Runtime: the pinned llama.cpp DLLs (electron/tengine/runtime) inside
    // the LLM host utilityProcess. Its GPU path is Vulkan, not WebGPU.
    runtime: 'llama.cpp',
    gpu: true,
    backend: 'vulkan',
    note: 'qwen3',
  },
  {
    id: 'llm-vision',
    host: 'llm-vision',
    // The same llama.cpp runtime in its own host process, with mtmd for the
    // image encoder; resident next to the text model, not instead of it.
    runtime: 'llama.cpp',
    gpu: true,
    backend: 'vulkan',
    note: 'paddleocr-vl',
  },
];

const gpuCapableIds = () => ENGINES.filter((e) => e.gpu).map((e) => e.id);
const engineById = (id) => ENGINES.find((e) => e.id === id) || null;

module.exports = { PROVIDER, ENGINES, gpuCapableIds, engineById };
