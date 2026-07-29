// Path B (the vision model reads the capture) and its degrade chain:
// who may run it under each privacy mode, and what happens when the model
// turns out not to see images.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OCREngineManager, isLoopbackEndpoint } from '../../src/stack/ocr/manager.js';
import { configureRuntime } from '../../src/stack/runtime.js';

const stackClient = {
  visionChat: vi.fn(),
  chatCompletion: vi.fn(),
};
vi.mock('../../src/services/stack-client.js', () => ({ default: stackClient }));

const { runAiAction } = await import('../../src/services/ai-action-runner.js');
const { getAiAction } = await import('../../src/config/ai-actions.js');

const IMG = 'data:image/png;base64,AAAA';
const MESSAGES = [
  { role: 'system', content: 'You are a reading assistant.' },
  { role: 'user', content: 'Summarize this screenshot.' },
];

const OFFLINE_ENGINES = ['llm-vision', 'windows-ocr', 'rapid-ocr'];

function reply({ content = 'three points', promptTokens = 900 } = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content } }],
      usage: { prompt_tokens: promptTokens },
    }),
    text: async () => '',
  };
}

async function makeManager(settings = {}) {
  const manager = new OCREngineManager({ loadConfigs: async () => settings });
  await manager.init();
  return manager;
}

beforeEach(() => {
  configureRuntime({
    fetch: vi.fn(async () => reply()),
    getLanguage: () => 'zh',
    localOcr: { paddle: vi.fn(), windows: vi.fn(), isWindows: true },
  });
});

describe('isLoopbackEndpoint', () => {
  it('accepts the loopback forms a local model server uses', () => {
    expect(isLoopbackEndpoint('http://localhost:1234/v1')).toBe(true);
    expect(isLoopbackEndpoint('http://127.0.0.1:11434/v1')).toBe(true);
    expect(isLoopbackEndpoint('http://[::1]:1234/v1')).toBe(true);
  });

  it('refuses a remote host that merely looks local', () => {
    expect(isLoopbackEndpoint('http://localhost.evil.com/v1')).toBe(false);
    expect(isLoopbackEndpoint('https://api.example.com/v1')).toBe(false);
    expect(isLoopbackEndpoint('not a url')).toBe(false);
  });
});

describe('vision capability gating', () => {
  it('is available with the default local endpoint', async () => {
    const manager = await makeManager();

    expect(manager.getVisionCapability({ allowedEngines: OFFLINE_ENGINES }))
      .toMatchObject({ available: true, local: true });
  });

  it('is refused when the privacy mode disallows the engine', async () => {
    const manager = await makeManager();

    expect(manager.getVisionCapability({ allowedEngines: ['rapid-ocr'] }).available).toBe(false);
  });

  it('offline refuses a remote vision endpoint — the capture must stay local', async () => {
    const manager = await makeManager({ llmEndpoint: 'https://vision.example.com/v1' });

    expect(manager.getVisionCapability({ requireLocalVision: true }).available).toBe(false);
    expect(manager.getVisionCapability({ requireLocalVision: false }))
      .toMatchObject({ available: true, local: false });
  });

  it('is refused once vision is locked out by repeated failures', async () => {
    const manager = await makeManager();
    manager._visionLocked = true;

    expect(manager.getVisionCapability({}).available).toBe(false);
  });
});

describe('visionChat', () => {
  it('sends the prompt and the image to the vision endpoint', async () => {
    const fetchMock = vi.fn(async () => reply({ content: 'summary text' }));
    configureRuntime({ fetch: fetchMock });
    const manager = await makeManager();

    const result = await manager.visionChat(MESSAGES, IMG, {});

    expect(result).toMatchObject({ success: true, content: 'summary text' });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[1].content[0]).toMatchObject({ type: 'text' });
    expect(body.messages[1].content[1].image_url.url).toBe(IMG);
  });

  it('never reaches the network when the privacy mode blocks it', async () => {
    const fetchMock = vi.fn();
    configureRuntime({ fetch: fetchMock });
    const manager = await makeManager();

    const result = await manager.visionChat(MESSAGES, IMG, { allowedEngines: ['rapid-ocr'] });

    expect(result.success).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('treats a 200 with too few prompt tokens as the image being dropped', async () => {
    configureRuntime({ fetch: vi.fn(async () => reply({ promptTokens: 40 })) });
    const manager = await makeManager();

    const result = await manager.visionChat(MESSAGES, IMG, {});

    expect(result).toMatchObject({ success: false, visionUnsupported: true });
  });

  it('locks vision after repeated image-blind replies', async () => {
    configureRuntime({ fetch: vi.fn(async () => reply({ promptTokens: 40 })) });
    const manager = await makeManager();

    await manager.visionChat(MESSAGES, IMG, {});
    await manager.visionChat(MESSAGES, IMG, {});

    expect(manager.isVisionLocked()).toBe(true);
  });

  it('a success clears an earlier failure so transient errors do not accumulate', async () => {
    let calls = 0;
    configureRuntime({
      fetch: vi.fn(async () => (++calls === 1 ? reply({ promptTokens: 40 }) : reply())),
    });
    const manager = await makeManager();

    await manager.visionChat(MESSAGES, IMG, {});
    await manager.visionChat(MESSAGES, IMG, {});

    expect(manager.isVisionLocked()).toBe(false);
    expect(manager._visionFailCount).toBe(0);
  });
});

describe('runAiAction path choice and degrade', () => {
  const summarize = getAiAction('summarize');
  const BOTH = { text: true, vision: true };
  const withImage = (extra = {}) => ({
    sourceText: 'recognized text',
    targetLanguage: 'zh',
    imageData: IMG,
    capabilities: BOTH,
    ...extra,
  });

  beforeEach(() => {
    stackClient.visionChat.mockReset();
    stackClient.chatCompletion.mockReset();
  });

  it('reads the capture when a vision model is available', async () => {
    stackClient.visionChat.mockResolvedValue({ success: true, content: 'from the image' });

    const result = await runAiAction(summarize, withImage());

    expect(result).toMatchObject({ success: true, content: 'from the image', path: 'vision' });
    expect(stackClient.chatCompletion).not.toHaveBeenCalled();
  });

  it('falls back to the recognized text when the model turns out to be image-blind', async () => {
    stackClient.visionChat.mockResolvedValue({ success: false, error: 'no vision', visionUnsupported: true });
    stackClient.chatCompletion.mockResolvedValue({ success: true, content: 'from the text' });

    const result = await runAiAction(summarize, withImage());

    expect(result).toMatchObject({ success: true, content: 'from the text', degradedFrom: 'vision' });
  });

  it('reports the vision failure when there is no text to fall back to', async () => {
    stackClient.visionChat.mockResolvedValue({ success: false, error: 'vision endpoint down' });

    const result = await runAiAction(summarize, withImage({ sourceText: '' }));

    expect(result).toMatchObject({ success: false, error: 'vision endpoint down' });
    expect(stackClient.chatCompletion).not.toHaveBeenCalled();
  });

  it('keeps the vision error when the text fallback also fails', async () => {
    stackClient.visionChat.mockResolvedValue({ success: false, error: 'vision endpoint down' });
    stackClient.chatCompletion.mockResolvedValue({ success: false, error: 'no chat provider' });

    const result = await runAiAction(summarize, withImage());

    expect(result).toMatchObject({ success: false, error: 'vision endpoint down' });
  });

  it('never touches the vision path without a capture', async () => {
    stackClient.chatCompletion.mockResolvedValue({ success: true, content: 'from the text' });

    const result = await runAiAction(summarize, withImage({ imageData: null }));

    expect(result).toMatchObject({ success: true, path: 'text' });
    expect(stackClient.visionChat).not.toHaveBeenCalled();
  });

  it('never touches the vision path when no vision model is configured', async () => {
    stackClient.chatCompletion.mockResolvedValue({ success: true, content: 'from the text' });

    await runAiAction(summarize, withImage({ capabilities: { text: true, vision: false } }));

    expect(stackClient.visionChat).not.toHaveBeenCalled();
  });

  it('requires a real chat provider on the text path', async () => {
    stackClient.chatCompletion.mockResolvedValue({ success: true, content: 'x' });

    await runAiAction(summarize, withImage({ imageData: null }));

    expect(stackClient.chatCompletion.mock.calls[0][1]).toMatchObject({ requireChat: true });
  });
});
