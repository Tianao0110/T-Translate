// Which model LM Studio has loaded, from its own REST list (/api/v0/models,
// which carries `state` and `type`; /v1/models lists every downloaded model
// once JIT loading is on). Requests that leave the model name blank name the
// loaded one (providers/openai-compatible.js, ocr/llm-vision.js).

import { rtFetch } from './runtime.js';

const HIT_TTL_MS = 3000;
const MISS_TTL_MS = 60000;
const PROBE_TIMEOUT_MS = 3000;

// API base -> { at, models } where models is null when the endpoint is not LM Studio.
const cache = new Map();

function apiBase(endpoint) {
  return String(endpoint || '').replace(/\/+$/, '').replace(/\/v1$/, '');
}

async function listModels(endpoint) {
  const base = apiBase(endpoint);
  const hit = cache.get(base);
  const now = Date.now();
  if (hit && now - hit.at < (hit.models ? HIT_TTL_MS : MISS_TTL_MS)) return hit.models;

  let models = null;
  try {
    const res = await rtFetch(`${base}/api/v0/models`, { method: 'GET', signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data?.data)) models = data.data;
    }
  } catch { /* not LM Studio, or not running */ }
  cache.set(base, { at: now, models });
  return models;
}

// { known: false } when the endpoint gives no LM Studio list; otherwise
// { known: true, id } with id null when nothing suitable is loaded. `vision`
// wants an image-capable model; text prefers a plain LLM, then a VLM.
export async function pickLoadedModel(endpoint, { vision = false } = {}) {
  const models = await listModels(endpoint);
  if (!models) return { known: false, id: null };
  const loaded = models.filter((m) => m.state === 'loaded' && m.type !== 'embeddings');
  const pick = vision
    ? loaded.find((m) => m.type === 'vlm')
    : loaded.find((m) => m.type === 'llm') || loaded.find((m) => m.type === 'vlm');
  return { known: true, id: pick?.id || null };
}

export function clearLoadedModelCache() {
  cache.clear();
}
