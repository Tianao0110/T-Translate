// The ABI transcription is checked two ways: struct sizes through koffi
// alone (always), and the default-parameter fingerprint through the pinned
// DLLs (only when scripts/fetch-llama-runtime.js has put them in
// resources/llama). A drifted field lands values in the wrong slots and
// both checks say so before any model is loaded.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';

const require = createRequire(import.meta.url);
const ABI = require('../../electron/tengine/runtime/llama-abi.js');
const manifest = require('../../electron/tengine/runtime/llama-manifest.json');
const { verifyRuntime, loadRuntime, defineStructs } = require('../../electron/tengine/runtime/llama-binding.js');
const koffi = require('koffi');

const RUNTIME_DIR = path.resolve(__dirname, '../../resources/llama');
const haveDlls = fs.existsSync(path.join(RUNTIME_DIR, 'llama.dll'));

const plain = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v]));

describe('llama ABI transcription', () => {
  it('pins the same build as the manifest', () => {
    expect(ABI.BUILD).toBe(manifest.build);
  });

  it('struct layouts have the recorded x64 sizes', () => {
    const structs = defineStructs(koffi);
    for (const name of Object.keys(ABI.STRUCTS)) {
      expect(koffi.sizeof(structs[name]), name).toBe(ABI.SIZES[name]);
    }
  });

  it('every struct field order matches the header transcription', () => {
    // The trailing pointer the spike had missed must stay last.
    const ctxFields = Object.keys(ABI.STRUCTS.llama_context_params);
    expect(ctxFields[ctxFields.length - 1]).toBe('ctx_other');
    expect(ctxFields[0]).toBe('n_ctx');
    const modelFields = Object.keys(ABI.STRUCTS.llama_model_params);
    expect(modelFields[0]).toBe('devices');
    expect(modelFields[modelFields.length - 1]).toBe('load_mtp');
    expect(Object.keys(ABI.STRUCTS.llama_batch)).toEqual(['n_tokens', 'token', 'embd', 'pos', 'n_seq_id', 'seq_id', 'logits']);
  });

  it('golden fingerprint covers every field of both param structs', () => {
    expect(Object.keys(ABI.GOLDEN.modelParams)).toEqual(Object.keys(ABI.STRUCTS.llama_model_params));
    expect(Object.keys(ABI.GOLDEN.contextParams)).toEqual(Object.keys(ABI.STRUCTS.llama_context_params));
  });

  it('verifyRuntime reports what is missing or altered', () => {
    const r = verifyRuntime('Z:/definitely/not/here');
    expect(r.ok).toBe(false);
    expect(r.build).toBe(manifest.build);
    expect(r.missing).toHaveLength(manifest.files.length);
    expect(r.mismatched).toEqual([]);
  });

  it.skipIf(!haveDlls)('pinned DLLs reproduce the default-parameter fingerprint', () => {
    const rt = loadRuntime(RUNTIME_DIR, { koffi });
    expect(rt.version()).toBe(ABI.GOLDEN.version);
    expect(plain(rt.f.modelDefault())).toEqual(ABI.GOLDEN.modelParams);
    expect(plain(rt.f.ctxDefault())).toEqual(ABI.GOLDEN.contextParams);
    expect(plain(rt.f.chainDefault())).toEqual(ABI.GOLDEN.chainParams);
    // Symbols live where the ABI says they do.
    for (const [lib, protos] of Object.entries(ABI.FUNCS)) {
      for (const key of Object.keys(protos)) expect(rt.homes[key], key).toBe(lib);
    }
  });

  it.skipIf(!haveDlls)('enumerates at least the CPU device after loading backends', () => {
    const rt = loadRuntime(RUNTIME_DIR, { koffi });
    const devs = rt.devices();
    expect(devs.length).toBeGreaterThan(0);
    const cpu = devs.find((d) => d.type === ABI.ENUMS.DEV_TYPE.CPU);
    expect(cpu).toBeTruthy();
    expect(cpu.memory.total).toBeGreaterThan(0);
    expect(typeof rt.systemInfo()).toBe('string');
  });
});
