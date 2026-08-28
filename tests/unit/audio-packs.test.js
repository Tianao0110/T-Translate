// Audio pack list: what the settings page renders is a merge of the manifest
// with what is on disk. Same contract as the OCR list, minus the generation
// filtering (audio has no bundled base to keep compatible).

import { describe, it, expect } from 'vitest';
import { computePackList } from '../../electron/shared/audio-packs.js';

const manifest = {
  packs: [
    { id: 'asr-base-sense-voice', type: 'asr-base', version: '1.0.0', size: 160816776 },
    { id: 'asr-draft-zipformer-zh-en', type: 'asr-draft', version: '1.0.0', size: 176344343 },
  ],
};

describe('computePackList', () => {
  it('marks everything not-installed on a fresh machine', () => {
    const list = computePackList([], manifest);
    expect(list.map((p) => p.status)).toEqual(['not-installed', 'not-installed']);
  });

  it('marks an installed pack installed and keeps its manifest fields', () => {
    const list = computePackList([{ id: 'asr-base-sense-voice', version: '1.0.0' }], manifest);
    const base = list.find((p) => p.id === 'asr-base-sense-voice');
    expect(base.status).toBe('installed');
    expect(base.installedVersion).toBe('1.0.0');
    expect(base.size).toBe(160816776);
  });

  it('flags an update when the manifest version is newer', () => {
    const list = computePackList([{ id: 'asr-base-sense-voice', version: '0.9.0' }], manifest);
    expect(list.find((p) => p.id === 'asr-base-sense-voice').status).toBe('update-available');
  });

  it('never flags an update when the local version is ahead', () => {
    const list = computePackList([{ id: 'asr-base-sense-voice', version: '1.1.0' }], manifest);
    expect(list.find((p) => p.id === 'asr-base-sense-voice').status).toBe('installed');
  });

  it('keeps an installed pack visible when the manifest is unreachable', () => {
    const list = computePackList([{ id: 'asr-base-sense-voice', version: '1.0.0' }], null);
    expect(list).toHaveLength(1);
    expect(list[0].status).toBe('orphaned');
  });

  it('skips manifest entries this build does not understand', () => {
    const future = { packs: [...manifest.packs, { id: 'tts-voice-x', type: 'tts-voice', version: '1.0.0' }] };
    expect(computePackList([], future).map((p) => p.id)).not.toContain('tts-voice-x');
  });
});
