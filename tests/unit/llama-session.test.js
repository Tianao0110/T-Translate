// The parts of the decode loop that need no DLL: thought stripping across
// token boundaries, the loop guard, prefix reuse arithmetic, the prompt
// templates, device choice and the KV estimate.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const s = require('../../electron/tengine/runtime/llama-session.js');

describe('think stripper', () => {
  const run = (pieces, opts) => {
    const st = s.createThinkStripper(opts);
    let out = '';
    for (const p of pieces) out += st.push(p);
    out += st.flush();
    return { out, leaks: st.leaks() };
  };

  it('passes plain text through untouched', () => {
    expect(run(['你好', '，世界', '。'])).toEqual({ out: '你好，世界。', leaks: 0 });
  });

  it('drops a thought block that arrives in one piece', () => {
    expect(run(['<think>let me see</think>\n\n答案'])).toEqual({ out: '\n\n答案', leaks: 1 });
  });

  it('drops a thought block whose tags are split across pieces', () => {
    expect(run(['<', 'thi', 'nk>秘密', '想法</th', 'ink>', '译文'])).toEqual({ out: '译文', leaks: 1 });
  });

  it('drops a stray closer and counts it', () => {
    expect(run(['</think>', '\n\n- 要点'])).toEqual({ out: '\n\n- 要点', leaks: 1 });
  });

  it('discards an unterminated thought at flush', () => {
    expect(run(['<think>never', ' ends'])).toEqual({ out: '', leaks: 1 });
  });

  it('holds back only what could start a tag, then releases it', () => {
    const st = s.createThinkStripper();
    expect(st.push('a <')).toBe('a ');
    expect(st.push('b')).toBe('<b');
    expect(st.push(' <thi')).toBe(' ');
    expect(st.push('rd')).toBe('<third');
    expect(st.flush()).toBe('');
    expect(st.leaks()).toBe(0);
  });

  it('works with other families tags', () => {
    const r = run(['<|begin_of_thought|>x<|end_of_thought|>ok'], { openers: ['<|begin_of_thought|>'], closers: ['<|end_of_thought|>'] });
    expect(r).toEqual({ out: 'ok', leaks: 1 });
  });
});

describe('think token scan', () => {
  it('finds openers and closers by text, not by control attribute', () => {
    const vocab = ['a', '<think>', '</think>', '<|im_start|>', '[THINK]', '<reasoning>', '</reasoning>', '<thinker>'];
    const r = s.findThinkTokens((i) => vocab[i], vocab.length);
    expect(r.openers.map((t) => t.id)).toEqual([1, 4, 5]);
    expect(r.closers.map((t) => t.id)).toEqual([2, 6]);
  });
});

describe('loop detector', () => {
  it('needs 24 tokens of a single repeated token', () => {
    const d = s.createLoopDetector();
    let hit = false;
    for (let i = 0; i < 23; i++) hit = d.push(7) || hit;
    expect(hit).toBe(false);
    expect(d.push(7)).toBe(true);
  });

  it('catches a longer pattern after three repeats', () => {
    const d = s.createLoopDetector();
    const pattern = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    let hit = false;
    for (let r = 0; r < 3; r++) for (const t of pattern) hit = d.push(t) || hit;
    for (let i = 0; i < 4; i++) hit = d.push(pattern[i]) || hit;
    expect(hit).toBe(true);
  });

  it('lets ordinary text through', () => {
    const d = s.createLoopDetector();
    let hit = false;
    for (let i = 0; i < 200; i++) hit = d.push((i * 7919) % 1000) || hit;
    expect(hit).toBe(false);
  });
});

describe('prefix reuse arithmetic', () => {
  it('counts the shared prefix', () => {
    expect(s.commonPrefixLength([1, 2, 3, 4], [1, 2, 9, 4])).toBe(2);
    expect(s.commonPrefixLength([1, 2], [1, 2, 3])).toBe(2);
    expect(s.commonPrefixLength([], [1])).toBe(0);
  });
});

describe('prompt templates', () => {
  it('renders ChatML with the empty thought block only when the vocab has one', () => {
    const withThink = s.renderChatml({ system: 'S', user: 'U', opener: '<think>', closer: '</think>' });
    expect(withThink).toBe('<|im_start|>system\nS<|im_end|>\n<|im_start|>user\nU<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n');
    const without = s.renderChatml({ user: 'U' });
    expect(without).toBe('<|im_start|>user\nU<|im_end|>\n<|im_start|>assistant\n');
  });

  it('folds the system text into the user turn for the MT template', () => {
    expect(s.renderHunyuan({ system: 'Translate to English.', user: '你好' })).toBe('<｜hy_begin▁of▁sentence｜><｜hy_User｜>Translate to English.\n\n你好<｜hy_Assistant｜>');
    expect(s.renderHunyuan({ user: '你好' })).toBe('<｜hy_begin▁of▁sentence｜><｜hy_User｜>你好<｜hy_Assistant｜>');
  });

  it('detects the family from the model template text', () => {
    expect(s.detectFamily('{% ... <|im_start|>system ... %}')).toBe('qwen3');
    expect(s.detectFamily('<｜hy_User｜>{{ content }}')).toBe('hunyuan');
    expect(s.detectFamily('{{ bos_token }}<start_of_turn>')).toBe('model');
    expect(s.detectFamily(null)).toBe('unknown');
  });
});

describe('device choice', () => {
  const devs = [
    { index: 0, type: 1, name: 'Vulkan0', memory: { free: 1, total: 16e9 } },
    { index: 1, type: 2, name: 'Vulkan1', memory: { free: 1, total: 16e9 } },
    { index: 2, type: 0, name: 'CPU', memory: { free: 1, total: 32e9 } },
  ];

  it('cpu means the CPU device, no fallback note', () => {
    expect(s.pickDevice(devs, 'cpu')).toEqual({ device: devs[2], provider: 'cpu', fallback: null });
  });

  it('gpu picks the discrete card over the integrated one', () => {
    expect(s.pickDevice(devs, 'gpu').device).toBe(devs[0]);
  });

  it('gpu without any GPU falls back to the CPU and says so', () => {
    const r = s.pickDevice([devs[2]], 'gpu');
    expect(r.provider).toBe('cpu');
    expect(r.fallback).toBe('no GPU device');
  });

  it('an explicit index wins when it is a GPU', () => {
    expect(s.pickDevice(devs, 'gpu', 1).device).toBe(devs[1]);
    expect(s.pickDevice(devs, 'gpu', 2).device).toBe(devs[0]);
  });
});

describe('kv estimate', () => {
  it('sizes Qwen3-1.7B at 4k context to about 470 MB', () => {
    const bytes = s.estimateKvBytes({ blockCount: 28, embeddingLength: 2048, headCount: 16, headCountKv: 8 }, 4096);
    expect(Math.round(bytes / 1048576)).toBe(448);
  });

  it('falls back to a quarter GB without a shape', () => {
    expect(s.estimateKvBytes({}, 4096)).toBe(256 * 1024 * 1024);
  });
});
