// External TTS endpoint client (main-process stack): request shape against
// an OpenAI-compatible /v1/audio/speech server, and the failure modes the
// renderer degrades on.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { configureRuntime } from '../../src/stack/runtime.js';
import { TtsEndpointClient, isLoopbackUrl } from '../../src/stack/tts/endpoint.js';

function audioResponse(bytes = 4000, contentType = 'audio/wav') {
  return {
    ok: true,
    status: 200,
    headers: { get: (h) => (h.toLowerCase() === 'content-type' ? contentType : null) },
    arrayBuffer: async () => new ArrayBuffer(bytes),
    text: async () => '',
  };
}

let fetchMock;

beforeEach(() => {
  fetchMock = vi.fn(async () => audioResponse());
  configureRuntime({ fetch: fetchMock });
});

function client(config) {
  return new TtsEndpointClient({ loadConfig: async () => config });
}

describe('TtsEndpointClient', () => {
  it('is not configured without a base URL', async () => {
    expect((await client({}).getCapability()).available).toBe(false);
    const r = await client({}).speak({ text: '你好' });
    expect(r.success).toBe(false);
    expect(r.notConfigured).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts the OpenAI speech body with the vaulted key, normalizing the base URL', async () => {
    const r = await client({ baseUrl: 'http://localhost:8880/', model: 'kokoro', voice: 'af_sky', apiKey: 'sk-test' })
      .speak({ text: '你好，世界', speed: 1.2 });
    expect(r.success).toBe(true);
    expect(r.audio.byteLength).toBe(4000);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:8880/v1/audio/speech');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer sk-test');
    expect(JSON.parse(init.body)).toEqual({ model: 'kokoro', input: '你好，世界', voice: 'af_sky', response_format: 'wav', speed: 1.2 });
  });

  it('accepts a base URL that already ends in /v1 and omits speed at 1.0', async () => {
    await client({ baseUrl: 'https://api.openai.com/v1' }).speak({ text: 'hi', speed: 1 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/audio/speech');
    expect(init.headers.Authorization).toBeUndefined();
    const body = JSON.parse(init.body);
    expect(body.speed).toBeUndefined();
    expect(body.model).toBe('tts-1');
    expect(body.voice).toBe('alloy');
  });

  it('a request-level voice overrides the configured one', async () => {
    await client({ baseUrl: 'http://x', voice: 'a' }).speak({ text: 'hi', voice: 'b' });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).voice).toBe('b');
  });

  it('maps 401/403 to a key error and other statuses to an HTTP error', async () => {
    fetchMock.mockResolvedValueOnce({ ...audioResponse(), ok: false, status: 401, text: async () => 'bad key' });
    const r1 = await client({ baseUrl: 'http://x' }).speak({ text: 'hi' });
    expect(r1.success).toBe(false);
    expect(r1.error).toContain('401');
    fetchMock.mockResolvedValueOnce({ ...audioResponse(), ok: false, status: 500, text: async () => 'boom' });
    const r2 = await client({ baseUrl: 'http://x' }).speak({ text: 'hi' });
    expect(r2.error).toContain('500');
    expect(r2.error).toContain('boom');
  });

  it('a JSON reply on the speech route is reported as "no audio"', async () => {
    fetchMock.mockResolvedValueOnce({ ...audioResponse(0, 'application/json'), text: async () => '{"error":"unknown model"}' });
    const r = await client({ baseUrl: 'http://x' }).speak({ text: 'hi' });
    expect(r.success).toBe(false);
    expect(r.error).toContain('unknown model');
  });

  it('a network failure never throws', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const r = await client({ baseUrl: 'http://x' }).speak({ text: 'hi' });
    expect(r.success).toBe(false);
    expect(r.error).toContain('ECONNREFUSED');
  });

  it('an external abort comes back as cancelled', async () => {
    const controller = new AbortController();
    fetchMock.mockImplementationOnce((url, init) => new Promise((resolve, reject) => {
      // A real fetch rejects at once on an already-aborted signal.
      if (init.signal.aborted) return reject(new Error('aborted'));
      init.signal.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    const p = client({ baseUrl: 'http://x' }).speak({ text: 'hi', signal: controller.signal });
    controller.abort();
    const r = await p;
    expect(r.success).toBe(false);
    expect(r.cancelled).toBe(true);
  });

  it('test() merges a draft config over the stored one and reports timing', async () => {
    const r = await client({ baseUrl: 'http://stored', apiKey: 'k' }).test({ baseUrl: 'http://draft:1', sampleText: 'ping' });
    expect(r.success).toBe(true);
    expect(typeof r.ms).toBe('number');
    expect(r.bytes).toBe(4000);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://draft:1/v1/audio/speech');
    expect(init.headers.Authorization).toBe('Bearer k');
    expect(JSON.parse(init.body).input).toBe('ping');
  });

  it('isLoopbackUrl', () => {
    expect(isLoopbackUrl('http://localhost:8880/v1')).toBe(true);
    expect(isLoopbackUrl('http://127.0.0.1:1')).toBe(true);
    expect(isLoopbackUrl('https://api.openai.com/v1')).toBe(false);
    expect(isLoopbackUrl('garbage')).toBe(false);
  });
});
