// Built-in LLM whitelist: the only GGUF files T-Engine loads unless the
// developer door (settings.llm.allowUnlistedModels) is open; the sha256
// is a security boundary (docs/T-ENGINE.md §5). Re-pinned once a year with
// the llama.cpp build in electron/tengine/runtime/llama-manifest.json.
// Weights are never bundled: the user drops the file into <models>/llm-models.

// Translation plus every AI action (summarise, explain, digest, rewrite ...).
const LLM_ROLE_GENERAL = 'general';
// Translation only: short user-only prompt, no AI actions.
const LLM_ROLE_MT = 'mt';
// Reads images (the built-in vision OCR engine): a model file plus its
// mmproj, both pinned, loaded in their own host next to the text model.
const LLM_ROLE_VISION = 'vision';
const LLM_ROLES = [LLM_ROLE_GENERAL, LLM_ROLE_MT, LLM_ROLE_VISION];

// Folder under the models root, scanned by the LLM pack manager.
const LLM_MODELS_DIR = 'llm-models';

const LLM_PACKS = [
  {
    id: 'qwen3-1.7b',
    role: LLM_ROLE_GENERAL,
    default: true,
    name: 'Qwen3-1.7B',
    vendor: 'Alibaba Qwen',
    file: 'Qwen3-1.7B-Q8_0.gguf',
    size: 1834426016,
    sha256: '061b54daade076b5d3362dac252678d17da8c68f07560be70818cace6590cb1a',
    arch: 'qwen3',
    template: 'qwen3',
    // The template has a thinking switch; T-Engine keeps it off (docs/T-ENGINE.md §5).
    hasThinking: true,
    ctx: 4096,
    minRamGb: 8,
    license: { name: 'Apache-2.0', url: 'https://huggingface.co/Qwen/Qwen3-1.7B-GGUF/blob/main/LICENSE' },
    source: {
      repo: 'Qwen/Qwen3-1.7B-GGUF',
      url: 'https://huggingface.co/Qwen/Qwen3-1.7B-GGUF/resolve/main/Qwen3-1.7B-Q8_0.gguf',
      mirror: 'https://hf-mirror.com/Qwen/Qwen3-1.7B-GGUF/resolve/main/Qwen3-1.7B-Q8_0.gguf',
    },
  },
  {
    id: 'hy-mt2-1.8b',
    role: LLM_ROLE_MT,
    default: false,
    name: 'Hy-MT2-1.8B',
    vendor: 'Tencent Hunyuan',
    file: 'Hy-MT2-1.8B-Q8_0.gguf',
    size: 1908528192,
    sha256: '5c3fe0b1408a5ceb0143184ef247b11b579c525f4b02b060e6c851bb76fef1a4',
    arch: 'hunyuan-dense',
    template: 'hunyuan',
    hasThinking: false,
    ctx: 4096,
    minRamGb: 8,
    license: { name: 'Apache-2.0', url: 'https://huggingface.co/tencent/Hy-MT2-1.8B-GGUF/blob/main/LICENSE.txt' },
    source: {
      repo: 'tencent/Hy-MT2-1.8B-GGUF',
      url: 'https://huggingface.co/tencent/Hy-MT2-1.8B-GGUF/resolve/main/Hy-MT2-1.8B-Q8_0.gguf',
      mirror: 'https://hf-mirror.com/tencent/Hy-MT2-1.8B-GGUF/resolve/main/Hy-MT2-1.8B-Q8_0.gguf',
    },
  },
  {
    id: 'paddleocr-vl-1.6',
    role: LLM_ROLE_VISION,
    default: false,
    name: 'PaddleOCR-VL-1.6',
    vendor: 'Baidu PaddlePaddle',
    file: 'PaddleOCR-VL-1.6-GGUF.gguf',
    size: 935769056,
    sha256: 'f3ae46ec885050acf4b3d31944431e1fd90d50664fb09126af4a3c050ba14ee8',
    // The image encoder; both files must match before the pack is ready.
    mmproj: {
      file: 'PaddleOCR-VL-1.6-GGUF-mmproj.gguf',
      size: 881770560,
      sha256: '204d757d7610d9b3faab10d506d69e5b244e32bf765e2bab2d0167e65e0a058a',
    },
    arch: 'paddleocr',
    template: 'auto',
    // Prompt family for runtime/mtmd.js.
    visionFamily: 'paddleocr',
    hasThinking: false,
    ctx: 4096,
    minRamGb: 4,
    license: { name: 'Apache-2.0', url: 'https://huggingface.co/PaddlePaddle/PaddleOCR-VL-1.6-GGUF/blob/main/README.md' },
    source: {
      repo: 'PaddlePaddle/PaddleOCR-VL-1.6-GGUF',
      url: 'https://huggingface.co/PaddlePaddle/PaddleOCR-VL-1.6-GGUF/resolve/main/PaddleOCR-VL-1.6-GGUF.gguf',
      mirror: 'https://hf-mirror.com/PaddlePaddle/PaddleOCR-VL-1.6-GGUF/resolve/main/PaddleOCR-VL-1.6-GGUF.gguf',
      mmproj: {
        url: 'https://huggingface.co/PaddlePaddle/PaddleOCR-VL-1.6-GGUF/resolve/main/PaddleOCR-VL-1.6-GGUF-mmproj.gguf',
        mirror: 'https://hf-mirror.com/PaddlePaddle/PaddleOCR-VL-1.6-GGUF/resolve/main/PaddleOCR-VL-1.6-GGUF-mmproj.gguf',
      },
    },
  },
];

// The files a pack consists of: the model, plus the mmproj for a vision
// pack. Every part carries its own size and hash.
function packFiles(pack) {
  const parts = [{ part: 'model', file: pack.file, size: pack.size, sha256: pack.sha256 }];
  if (pack.mmproj) parts.push({ part: 'mmproj', file: pack.mmproj.file, size: pack.mmproj.size, sha256: pack.mmproj.sha256 });
  return parts;
}

// Role of a file outside the whitelist, from its name alone: the Hunyuan MT
// family is translation-only (same family test as the stack's template
// mapping), everything else is a general model.
const MT_NAME_PATTERN = /\b(hy|hunyuan)[\s\-_]?mt/i;
function roleForFileName(name) {
  return MT_NAME_PATTERN.test(String(name || '')) ? LLM_ROLE_MT : LLM_ROLE_GENERAL;
}

function packById(id) {
  return LLM_PACKS.find((p) => p.id === id) || null;
}

function packByHash(sha256) {
  const hex = String(sha256 || '').toLowerCase();
  return LLM_PACKS.find((p) => p.sha256 === hex) || null;
}

// Cheap pre-check by file name and exact size before hashing; the hash
// still decides.
function packForFile(name, size) {
  return LLM_PACKS.find((p) => packFiles(p).some((f) => f.file === name && f.size === size)) || null;
}

function defaultPack() {
  return LLM_PACKS.find((p) => p.default) || null;
}

function packsForRole(role) {
  return LLM_PACKS.filter((p) => p.role === role);
}

// The one vision pack of this year's pin.
function visionPack() {
  return LLM_PACKS.find((p) => p.role === LLM_ROLE_VISION) || null;
}

module.exports = {
  LLM_ROLE_GENERAL,
  LLM_ROLE_MT,
  LLM_ROLE_VISION,
  LLM_ROLES,
  LLM_MODELS_DIR,
  LLM_PACKS,
  roleForFileName,
  packById,
  packByHash,
  packForFile,
  packFiles,
  defaultPack,
  packsForRole,
  visionPack,
};
