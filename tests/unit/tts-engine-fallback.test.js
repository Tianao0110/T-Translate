// TTS engine seam (v0.3.9 前置三): neural is registered but must stay
// invisible and harmless until its bridge + voice pack exist (v0.4.x), and a
// configured-but-unavailable engine degrades to web-speech instead of erroring.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import ttsManager, { NeuralTTSEngine } from '../../src/services/tts/index.js';

function stubSpeechSynthesis() {
  const synth = {
    getVoices: () => [{ name: 'Stub Voice', lang: 'zh-CN', voiceURI: 'stub' }],
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    speak: vi.fn(),
    cancel: vi.fn(),
  };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
  return synth;
}

beforeEach(() => {
  stubSpeechSynthesis();
});

afterEach(() => {
  ttsManager.dispose();
  delete window.speechSynthesis;
  delete window.electron;
});

describe('neural TTS engine shell', () => {
  it('is unavailable while the audio-engine bridge does not exist', async () => {
    const engine = new NeuralTTSEngine({});
    expect(await engine.isAvailable()).toBe(false);
    expect(await engine.getVoices()).toEqual([]);
  });

  it('is unavailable when the bridge exists but reports no voice pack', async () => {
    window.electron = {
      audioEngine: {
        ttsGenerate: vi.fn(),
        ttsStatus: vi.fn(async () => ({ available: false })),
      },
    };
    const engine = new NeuralTTSEngine({});
    expect(await engine.isAvailable()).toBe(false);
  });

  it('speak refuses without the bridge instead of pretending', async () => {
    const engine = new NeuralTTSEngine({});
    await expect(engine.speak('你好')).rejects.toThrow('NEURAL_UNAVAILABLE');
  });

  function stubBridge(voices) {
    window.electron = {
      audioEngine: {
        ttsStatus: vi.fn(async () => ({ available: voices.length > 0, packs: [], loaded: '' })),
        ttsVoices: vi.fn(async () => voices),
        ttsGenerate: vi.fn(async () => ({ success: true })),
        ttsCancel: vi.fn(),
        onTtsChunk: vi.fn(() => () => {}),
      },
    };
    return window.electron.audioEngine;
  }
  const zhVoice = { id: 'tts-kokoro-zh-en:3', packId: 'tts-kokoro-zh-en', sid: 3, lang: 'zh', gender: 'f', n: 1, featured: true, preferMixed: false, languages: ['zh', 'en'], engine: 'kokoro' };

  it('is available once the bridge reports an installed pack, and names voices for the picker', async () => {
    stubBridge([zhVoice]);
    const engine = new NeuralTTSEngine({});
    expect(await engine.isAvailable()).toBe(true);
    const voices = await engine.getVoices();
    expect(voices).toHaveLength(1);
    expect(voices[0].id).toBe('tts-kokoro-zh-en:3');
    expect(typeof voices[0].name).toBe('string');
    expect(voices[0].name.length).toBeGreaterThan(0);
  });

  it('a language no installed pack covers is refused per utterance, not swallowed', async () => {
    const bridge = stubBridge([zhVoice]);
    const engine = new NeuralTTSEngine({});
    await expect(engine.speak('こんにちは', { lang: 'ja' })).rejects.toThrow('NO_VOICE_FOR_LANG:ja');
    expect(bridge.ttsGenerate).not.toHaveBeenCalled();
  });
});

describe('TTSManager with a live neural engine', () => {
  // Picking a voice on the settings page calls updateConfig with the engine
  // live; the engine must accept it (it used to throw "not a function").
  it('updateConfig reaches the engine without throwing', async () => {
    window.electron = {
      audioEngine: {
        ttsStatus: vi.fn(async () => ({ available: true })),
        ttsVoices: vi.fn(async () => [zhVoice]),
        ttsGenerate: vi.fn(async () => ({ success: true })),
        ttsCancel: vi.fn(),
        onTtsChunk: vi.fn(() => () => {}),
      },
      store: { get: vi.fn(async () => null), set: vi.fn(async () => {}) },
    };
    await ttsManager.init({ enabled: true, engine: 'neural' });
    expect(ttsManager.currentEngineId).toBe('neural');
    await expect(ttsManager.updateConfig({ voiceId: 'tts-kokoro-zh-en:3', rate: 1.2 })).resolves.toBeUndefined();
    expect(ttsManager.currentEngine.config.defaultRate).toBe(1.2);
  });
});

describe('TTSManager per-utterance fallback', () => {
  it('hands an uncovered language to web-speech and keeps the neural engine configured', async () => {
    window.electron = {
      audioEngine: {
        ttsStatus: vi.fn(async () => ({ available: true })),
        ttsVoices: vi.fn(async () => [
          { id: 'tts-kokoro-zh-en:3', packId: 'tts-kokoro-zh-en', sid: 3, lang: 'zh', gender: 'f', n: 1, featured: true, preferMixed: false, languages: ['zh', 'en'], engine: 'kokoro' },
        ]),
        ttsGenerate: vi.fn(async () => ({ success: true })),
        ttsCancel: vi.fn(),
        onTtsChunk: vi.fn(() => () => {}),
      },
      store: { get: vi.fn(async () => null), set: vi.fn(async () => {}) },
    };
    await ttsManager.init({ enabled: true, engine: 'neural' });
    expect(ttsManager.currentEngineId).toBe('neural');

    const spy = vi.spyOn(ttsManager, '_speakWithFallback').mockResolvedValue(undefined);
    await ttsManager.speak('こんにちは', { lang: 'ja' });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][1].voiceId).toBe('');
    expect(window.electron.audioEngine.ttsGenerate).not.toHaveBeenCalled();
    expect(ttsManager.currentEngineId).toBe('neural');
    spy.mockRestore();
  });
});

describe('TTSManager engine fallback', () => {
  it('listEngines reports web-speech available and neural not (today)', async () => {
    const list = await ttsManager.listEngines();
    const byId = Object.fromEntries(list.map((e) => [e.id, e.available]));
    expect(byId['web-speech']).toBe(true);
    expect(byId['neural']).toBe(false);
  });

  it('a config pointing at neural falls back to web-speech without touching the config', async () => {
    await ttsManager.init({ enabled: true, engine: 'neural' });
    expect(ttsManager.currentEngineId).toBe('web-speech');
    // the user's choice survives so the engine comes back with its pack
    expect(ttsManager.config.engine).toBe('neural');
  });
});
