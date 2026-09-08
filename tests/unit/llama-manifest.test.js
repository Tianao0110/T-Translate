// The runtime manifest is what the load probe and the fetch script trust.
// A re-pin that drops a DLL from the load order, or leaves a tool DLL in,
// must fail here before it reaches a build.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const manifest = require('../../electron/tengine/runtime/llama-manifest.json');

const HEX64 = /^[0-9a-f]{64}$/;
// Load order needs these; the baseline CPU variant keeps pre-AVX machines alive.
const REQUIRED = ['libomp.dll', 'ggml-base.dll', 'ggml.dll', 'llama.dll', 'mtmd.dll', 'ggml-vulkan.dll', 'ggml-cpu-x64.dll'];

describe('llama runtime manifest', () => {
  it('pins one official build and its zip', () => {
    expect(manifest.build).toMatch(/^b\d+$/);
    expect(manifest.pinnedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(manifest.zip.url).toBe(`https://github.com/ggml-org/llama.cpp/releases/download/${manifest.build}/${manifest.zip.name}`);
    expect(manifest.zip.name).toBe(`llama-${manifest.build}-bin-win-vulkan-x64.zip`);
    expect(manifest.zip.size).toBeGreaterThan(0);
    expect(manifest.zip.sha256).toMatch(HEX64);
  });

  it('lists every file with a size and a hash, no duplicates', () => {
    expect(manifest.files.length).toBeGreaterThan(REQUIRED.length);
    const names = manifest.files.map((f) => f.name);
    expect(new Set(names).size).toBe(names.length);
    for (const f of manifest.files) {
      expect(f.size).toBeGreaterThan(0);
      expect(f.sha256).toMatch(HEX64);
    }
  });

  it('keeps the load-order DLLs in and the tools out', () => {
    const names = manifest.files.map((f) => f.name);
    for (const r of REQUIRED) expect(names).toContain(r);
    expect(names).toContain('LICENSE-LLVM-OpenMP');
    for (const n of names) {
      expect(n).not.toMatch(/\.exe$|-impl\.dll$|^ggml-rpc|^llama-common/);
    }
  });
});
