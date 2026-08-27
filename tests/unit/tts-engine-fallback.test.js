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
