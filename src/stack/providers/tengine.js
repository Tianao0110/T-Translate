// The built-in model as a translation provider. No network, no server, no
// key: the main process hands the stack a `localLlm` hook (runtime.js) that
// reaches T-Engine's LLM host, and this class turns the stack's messages
// into one system + one user text for it. Which file runs, on which
// backend, is the main process's decision; here it is just "the local
// model". Cancellation goes through the hook's cancel handle, stalls are
// the host watchdog's, and both come back as ordinary provider errors.

import { BaseProvider, LANGUAGE_CODES, combineSignal } from './base.js';
import { _t } from '../i18n.js';
import { getLocalLlm } from '../runtime.js';
import { PROVIDER_METADATA } from './metadata.js';

const TRANSLATE_TIMEOUT_MS = 180000;
const CHAT_MAX_TOKENS = 1024;

// One user turn is what the runtime templates render; earlier turns of a
// conversation are folded into it as labelled lines.
export function splitMessages(messages = []) {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const turns = messages.filter((m) => m.role !== 'system');
  if (turns.length <= 1) return { system, user: turns[0]?.content || '' };
  const user = turns.map((m) => `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${m.content}`).join('\n\n');
  return { system, user };
}

// Enough room for a translation of `text`: CJK output runs about one token
// per character. The runtime clamps to the context anyway.
export function translateBudget(text) {
  return Math.min(2048, Math.max(256, Math.ceil(String(text || '').length * 2) + 64));
}

class TengineProvider extends BaseProvider {
  static metadata = PROVIDER_METADATA['tengine'];

  constructor(config = {}) {
    super({ timeout: TRANSLATE_TIMEOUT_MS, ...config });
  }

  get supportsStreaming() {
    return true;
  }

  get latencyLevel() {
    return 'medium';
  }

  get requiresNetwork() {
    return false;
  }

  async translate(text, sourceLang = 'auto', targetLang = 'zh', options = {}) {
    if (!text?.trim()) return { success: false, error: _t('providerError.emptyText', '文本为空') };
    const messages = this._buildMessages(text, targetLang, options);
    return this._run({ kind: 'translate', messages, options, maxTokens: translateBudget(text) });
  }

  async translateStream(text, sourceLang, targetLang, onChunk, options = {}) {
    if (!text?.trim()) return { success: false, error: _t('providerError.emptyText', '文本为空') };
    const messages = this._buildMessages(text, targetLang, options);
    return this._run({ kind: 'translate', messages, options, maxTokens: translateBudget(text), onToken: onChunk });
  }

  // A translation-only pack (Hy-MT2) answers a prompt with a translation of
  // the prompt, so it must not be picked for AI actions; the service skips
  // providers whose canChat() says no.
  canChat() {
    const sel = getLocalLlm()?.selected?.();
    return !sel || sel.role !== 'mt';
  }

  // AI actions (summaries, explanations, rewrites).
  async chat(messages, options = {}) {
    if (!this.canChat()) return { success: false, error: _t('providerError.tengineNoChat', '当前内置模型只做翻译，AI 动作请改用通用模型') };
    const r = await this._run({ kind: options.kind || 'chat', messages, options, maxTokens: options.max_tokens || CHAT_MAX_TOKENS });
    if (!r.success) return r;
    return { success: true, content: r.text, model: r.model || null };
  }

  async testConnection() {
    const llm = getLocalLlm();
    if (!llm) return { success: false, message: _t('providerError.tengineNotReady', '内置模型引擎未就绪') };
    const sel = llm.selected();
    if (!sel || sel.status !== 'ready') return { success: false, message: _t('providerError.tengineNoModel', '未安装内置模型文件，请到设置里放入模型') };
    return { success: true, message: sel.name };
  }

  async getModels() {
    const llm = getLocalLlm();
    const s = llm ? llm.status() : null;
    return (s?.packs?.packs || []).filter((p) => p.status === 'ready').map((p) => p.id);
  }

  _buildMessages(text, targetLang, options = {}) {
    let prompt = options.systemPrompt;
    let mode = 'system';
    if (prompt && typeof prompt === 'object') {
      mode = prompt.mode || 'system';
      prompt = prompt.content;
    }
    if (!prompt) {
      const langName = LANGUAGE_CODES[targetLang]?.name || targetLang;
      prompt = `You are a professional translator. Translate the following text to ${langName}. Output only the translation, nothing else.`;
    }
    return mode === 'user'
      ? [{ role: 'user', content: `${prompt}\n\n${text}` }]
      : [{ role: 'system', content: prompt }, { role: 'user', content: text }];
  }

  _describe(e) {
    switch (e?.code) {
      case 'LLM_MODEL_MISSING':
      case 'LLM_MODEL_NOT_ALLOWED':
        return _t('providerError.tengineNoModel', '未安装内置模型文件，请到设置里放入模型');
      case 'LLM_HOST_UNAVAILABLE':
      case 'LLM_HOST_CRASHED':
      case 'LLM_HOST_TIMEOUT':
        return _t('providerError.tengineHostDown', '内置模型引擎暂不可用');
      case 'LLM_UNHEALTHY':
        return _t('providerError.tengineUnhealthy', '内置模型连续停滞，本次会话已改用其他翻译源');
      default:
        return e?.message || _t('providerError.unknownError', '未知错误');
    }
  }

  async _run({ kind, messages, options = {}, maxTokens, onToken = null }) {
    const llm = getLocalLlm();
    if (!llm) return { success: false, error: _t('providerError.tengineNotReady', '内置模型引擎未就绪') };
    const { system, user } = splitMessages(messages);
    if (!user.trim()) return { success: false, error: _t('providerError.emptyText', '文本为空') };

    let handle;
    try {
      handle = await llm.generate({ kind, system, user, maxTokens }, onToken);
    } catch (e) {
      this._lastError = e;
      return { success: false, error: this._describe(e) };
    }

    const signal = combineSignal(options.signal, this.config.timeout || TRANSLATE_TIMEOUT_MS);
    const onAbort = () => handle.cancel();
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
    try {
      const r = await handle.promise;
      if (r.stop === 'cancel') return { success: false, error: _t('providerError.tengineCancelled', '已取消') };
      if (r.stop === 'stall') return { success: false, error: _t('providerError.streamStalled', '生成中断：超过超时时间无新内容') };
      if (r.stop === 'error') return { success: false, error: _t('providerError.tengineFailed', '内置模型生成失败') };
      const text = (r.text || '').trim();
      if (!text) return { success: false, error: _t('providerError.noResult', '无翻译结果') };
      return { success: true, text, model: r.model || null, stop: r.stop, tokPerSec: r.tokPerSec ?? null };
    } catch (e) {
      this._lastError = e;
      return { success: false, error: this._describe(e) };
    } finally {
      if (signal) signal.removeEventListener('abort', onAbort);
    }
  }
}

export default TengineProvider;
