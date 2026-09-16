// What a brand-new install starts with: the built-in model, then local
// models, then the key-free cloud fallback (docs/design/renderer.md §7).
export const DEFAULT_ENABLED_PROVIDERS = ['tengine', 'local-llm', 'ollama', 'google-translate'];

export function buildDefaultProviderList(allProvidersMeta) {
  const known = (allProvidersMeta || []).map(m => m.id).filter(Boolean);
  const defaults = DEFAULT_ENABLED_PROVIDERS.filter(id => known.includes(id));
  const rest = known.filter(id => !DEFAULT_ENABLED_PROVIDERS.includes(id));

  // Order is priority order.
  return [...defaults, ...rest].map((id, index) => ({
    id,
    enabled: defaults.includes(id),
    priority: index,
  }));
}
