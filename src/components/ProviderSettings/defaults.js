// What a brand-new install starts with.
//
// The old rule was `enabled: index === 0` over the display order, and that
// order starts with OpenAI — the one provider in the list that cannot do
// anything without a paid key. So a fresh install had exactly one enabled
// source, permanently unusable, the moment the settings page persisted its
// list (which any save from any tab does). Until then the stack fell through
// to DEFAULT_PRIORITY and quietly worked, so the breakage looked like
// "translation stopped working after I changed a setting".
//
// Local models stay ahead of the cloud fallback: with LM Studio or Ollama
// running the text never leaves the machine, and without them the localhost
// attempt fails instantly (connection refused, not a timeout) and Google
// Translate — free, no key — answers. "Local first" stays true and the app
// still works the moment it is installed.
export const DEFAULT_ENABLED_PROVIDERS = ['local-llm', 'ollama', 'google-translate'];

export function buildDefaultProviderList(allProvidersMeta) {
  const known = (allProvidersMeta || []).map(m => m.id).filter(Boolean);
  const defaults = DEFAULT_ENABLED_PROVIDERS.filter(id => known.includes(id));
  const rest = known.filter(id => !DEFAULT_ENABLED_PROVIDERS.includes(id));

  // Order is priority order here — the enabled defaults lead so the chain
  // tries them before anything the user later switches on.
  return [...defaults, ...rest].map((id, index) => ({
    id,
    enabled: defaults.includes(id),
    priority: index,
  }));
}
