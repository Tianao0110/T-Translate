// Built-in LLM whitelist. These are the only GGUF files T-Engine loads unless
// the developer door (settings.tengine.allowUnlistedModels) is open: GGUF
// parsers have had memory-safety CVEs, so the sha256 here is a security
// boundary, not a hint. Re-pinned once a year together with the llama.cpp
// build in electron/tengine/runtime/llama-manifest.json (docs/T-ENGINE.md).
//
// Weights are never bundled or re-hosted: the user downloads the file from
// the link below and drops it into <models>/llm-models.

// Translation plus every AI action (summarise, explain, digest, rewrite ...).
const LLM_ROLE_GENERAL = 'general';
// Translation only: short user-only prompt, no AI actions.
const LLM_ROLE_MT = 'mt';
const LLM_ROLES = [LLM_ROLE_GENERAL, LLM_ROLE_MT];

// Folder under the models root, scanned by the LLM pack manager.
const LLM_MODELS_DIR = 'llm-models';

// Date of the last annual pin (models + llama.cpp build together).
const LLM_PINNED = '2026-09-08';

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
    // The template has a thinking switch; T-Engine keeps it off (handbook §5).
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
];

// Role of a file outside the whitelist, from its name alone: only the
// Hunyuan MT family (hy-mt2-7b, hunyuan-mt-1.8b ...) is translation-only —
// the same family test the stack's template mapping uses for LM Studio
// models. Everything else is a general model; "MT" elsewhere in a name
// (Qwen…-M-TI) means nothing.
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

// Cheap pre-check by file name and exact size, so the scanner only hashes
// 2 GB when the file could be a whitelisted one. The hash still decides.
function packForFile(name, size) {
  return LLM_PACKS.find((p) => p.file === name && p.size === size) || null;
}

function defaultPack() {
  return LLM_PACKS.find((p) => p.default) || null;
}

function packsForRole(role) {
  return LLM_PACKS.filter((p) => p.role === role);
}

module.exports = {
  LLM_ROLE_GENERAL,
  LLM_ROLE_MT,
  LLM_ROLES,
  LLM_MODELS_DIR,
  LLM_PINNED,
  LLM_PACKS,
  roleForFileName,
  packById,
  packByHash,
  packForFile,
  defaultPack,
  packsForRole,
};
