// Renderer-side provider catalog. The pure-data table lives in the stack
// (single cross-process source — see stack/providers/metadata.js); the svg
// icons are Vite imports the main-process stack bundle must never see, so
// they are merged here, renderer-only.

import { PROVIDER_METADATA } from '../stack/providers/metadata.js';

import openai from '../assets/provider-icons/openai.svg';
import deepseek from '../assets/provider-icons/deepseek.svg';
import ollama from '../assets/provider-icons/ollama.svg';
import localLlm from '../assets/provider-icons/local-llm.svg';
import deepl from '../assets/provider-icons/deepl.svg';
import gemini from '../assets/provider-icons/gemini.svg';
import googleTranslate from '../assets/provider-icons/google-translate.svg';
import anthropic from '../assets/provider-icons/anthropic.svg';
import microsoftTranslator from '../assets/provider-icons/microsoft-translator.svg';
import baiduTranslate from '../assets/provider-icons/baidu-translate.svg';

export const PROVIDER_ICONS = {
  'openai': openai,
  'deepseek': deepseek,
  'ollama': ollama,
  'local-llm': localLlm,
  'deepl': deepl,
  'gemini': gemini,
  'google-translate': googleTranslate,
  'anthropic': anthropic,
  'microsoft-translator': microsoftTranslator,
  'baidu-translate': baiduTranslate,
};

// Display order preserved from the retired renderer registry (presets first,
// then standalone providers) so the settings list doesn't reshuffle.
const ORDER = [
  'openai', 'deepseek', 'ollama', 'local-llm',
  'deepl', 'gemini', 'google-translate', 'anthropic',
  'microsoft-translator', 'baidu-translate',
];

export function getAllProviderMetadata() {
  return ORDER.map((id) => ({ ...PROVIDER_METADATA[id], icon: PROVIDER_ICONS[id] }));
}
