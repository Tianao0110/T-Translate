export { default as translationService, TranslationService } from './translation.js';
export { default as mainTranslation, MainTranslationService } from './main-translation.js';
export { default as translationCache, TranslationCache } from './cache.js';
export { default as pipeline, TranslationPipeline } from './pipeline.js';

export async function translate(text, options = {}) {
  const { default: svc } = await import('./translation.js');
  return svc.translate(text, options);
}

export async function translateStream(text, options = {}, onChunk) {
  const { default: svc } = await import('./translation.js');
  return svc.translateStream(text, options, onChunk);
}
