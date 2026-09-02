// Windows audio capture through WASAPI, driven by koffi (same approach as
// native-helper.js: no compiled addon, so an Electron upgrade never means a
// rebuild — the maintenance-mode endgame is why this is not a native module).
//
// Two activations, one output format:
//
//   system   IMMDevice::Activate(IAudioClient) on the default render endpoint
//            + AUDCLNT_STREAMFLAGS_LOOPBACK. Every Windows version. Taps AFTER
//            the endpoint volume: a muted system yields silence, and a quiet
//            one used to yield a whisper (8% on the slider is -38 dB and the
//            VAD went deaf). The pump reads IAudioEndpointVolume and undoes
//            that attenuation (win-audio-gain), so what the ASR hears no
//            longer depends on how loud the user listens. Mute stays silence.
//   process  ActivateAudioInterfaceAsync(VAD\Process_Loopback) with
//            AUDIOCLIENT_ACTIVATION_PARAMS. Windows 10 build 20348+, which in
//            practice means Windows 11 (consumer Win10 stops at 19045).
//            Taps BEFORE the endpoint volume: a muted system still records.
//            Two modes: capture that process tree, or capture everything else.
//
// Both deliver 16 kHz mono float32 straight into the ASR pipeline. The process
// path accepts it natively; the system path needs AUTOCONVERTPCM because a
// shared-mode capture otherwise only takes the endpoint's mix format.
//
// Spike numbers behind the choices (2026-08-30, gstack v041-process-loopback-spike):
// activation 4ms, tone captured at rms 0.039 vs an expected 0.040, EXCLUDE mode
// measured exactly 0.00000 while that tone played, and process loopback keeps
// working with the system muted (0.03874 vs 0.03877 unmuted).

const os = require('os');
const logger = require('./logger')('WinAudio');
const { compensationGain, makeClipGuard, applyGain } = require('./win-audio-gain');

// ===== koffi + COM plumbing =====

let api = null; // null = not probed yet, false = unavailable

function init() {
  if (process.platform !== 'win32') return null;
  if (api !== null) return api || null;

  try {
    const koffi = require('koffi');
    const ole32 = koffi.load('ole32.dll');
    const kernel32 = koffi.load('kernel32.dll');
    const mmdevapi = koffi.load('mmdevapi.dll');

    api = {
      koffi,
      CoInitializeEx: ole32.func('long CoInitializeEx(void*, uint32)'),
      CoCreateInstance: ole32.func(
        'long CoCreateInstance(const uint8_t* rclsid, void* pUnkOuter, uint32 dwClsContext, const uint8_t* riid, _Out_ void** ppv)'
      ),
      ActivateAudioInterfaceAsync: mmdevapi.func(
        'long ActivateAudioInterfaceAsync(const char16_t* path, const uint8_t* riid, const uint8_t* params, void* handler, _Out_ void** op)'
      ),
      CreateEventW: kernel32.func('void* CreateEventW(void*, int, int, void*)'),
      CloseHandle: kernel32.func('int CloseHandle(void*)'),
      OpenProcess: kernel32.func('void* OpenProcess(uint32 access, int inherit, uint32 pid)'),
      QueryFullProcessImageNameW: kernel32.func(
        'int QueryFullProcessImageNameW(void* hProcess, uint32 flags, _Inout_ uint16_t* name, _Inout_ uint32* size)'
      ),
      // Callback prototypes for the COM completion handler. koffi keeps proto
      // names in a global registry, so these are declared exactly once.
      QIProto: koffi.proto('long TTAudioQI(void* self, void* riid, void** ppv)'),
      RefProto: koffi.proto('unsigned long TTAudioRef(void* self)'),
      DoneProto: koffi.proto('long TTAudioDone(void* self, void* op)'),
    };
    // MTA: the process-loopback activation completes on a worker thread. In the
    // main process this returns RPC_E_CHANGED_MODE (already STA) and that is
    // fine — the callback still arrives through the message pump.
    api.CoInitializeEx(null, 0);
    return api;
  } catch (e) {
    logger.warn(`koffi/WASAPI unavailable: ${e.message}`);
    api = false;
    return null;
  }
}

function guid(str) {
  const h = str.replace(/[{}-]/g, '');
  const b = Buffer.alloc(16);
  b.writeUInt32LE(parseInt(h.slice(0, 8), 16), 0);
  b.writeUInt16LE(parseInt(h.slice(8, 12), 16), 4);
  b.writeUInt16LE(parseInt(h.slice(12, 16), 16), 6);
  for (let i = 0; i < 8; i++) b[8 + i] = parseInt(h.slice(16 + i * 2, 18 + i * 2), 16);
  return b;
}

const IID = {
  MMDeviceEnumerator: guid('BCDE0395-E52F-467C-8E3D-C4579291692E'),
  IMMDeviceEnumerator: guid('A95664D2-9614-4F35-A746-DE8DB63617E6'),
  IAudioSessionManager2: guid('77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F'),
  IAudioSessionControl2: guid('BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D'),
  IAudioMeterInformation: guid('C02216F6-8C67-4B5B-9D00-D008E73E0064'),
  IAudioClient: guid('1CB9AD4C-DBFA-4C32-B178-C2F568A703B2'),
  IAudioCaptureClient: guid('C8ADBD64-E71E-48A0-A4DE-185C395CD317'),
  IAudioEndpointVolume: guid('5CDF2C82-841E-4546-9722-0CF74078229A'),
  IActivateAudioInterfaceCompletionHandler: guid('41D949AB-9862-444A-80F6-C261334DA5EB'),
  IAgileObject: guid('94EA2B94-E9CC-49E0-C0FF-EE64CA8F5B90'),
  IUnknown: guid('00000000-0000-0000-C000-000000000046'),
};

const protos = new Map();
function comProto(sig) {
  if (!protos.has(sig)) protos.set(sig, init().koffi.proto(sig));
  return protos.get(sig);
}

// A COM object is a pointer to a pointer to a function table: read *this, index
// the table, call the slot.
function vcall(obj, index, sig, ...args) {
  const { koffi } = init();
  const vtbl = koffi.decode(obj, 'void*');
  const fn = koffi.decode(vtbl, index * 8, 'void*');
  return koffi.call(fn, comProto(sig), obj, ...args);
}

function release(obj) {
  if (obj) {
    try {
      vcall(obj, 2, 'unsigned long Release(void*)');
    } catch {
      // teardown path — a failed Release is not worth a crash
    }
  }
}

function queryInterface(obj, iid) {
  const out = [null];
  return vcall(obj, 0, 'long QI(void*, const uint8_t*, _Out_ void**)', iid, out) === 0 ? out[0] : null;
}

function hrError(what, hr) {
  const err = new Error(`${what} failed: 0x${(hr >>> 0).toString(16)}`);
  err.hr = hr >>> 0;
  return err;
}

function check(hr, what) {
  if (hr !== 0) throw hrError(what, hr);
  return hr;
}

// koffi.address() rejects Buffers, so anything whose address must be embedded
// in another struct is allocated here rather than with Buffer.alloc.
function mem(bytes) {
  return init().koffi.alloc('uint8_t', bytes);
}
const poke = {
  u16: (m, off, v) => init().koffi.encode(m, off, 'uint16_t', v),
  u32: (m, off, v) => init().koffi.encode(m, off, 'uint32_t', v),
  i32: (m, off, v) => init().koffi.encode(m, off, 'int32_t', v),
  ptr: (m, off, v) => init().koffi.encode(m, off, 'uint64_t', typeof v === 'bigint' ? v : init().koffi.address(v)),
};

// ===== capability =====

const PROCESS_LOOPBACK_MIN_BUILD = 20348;

function windowsBuild() {
  const m = /^\d+\.\d+\.(\d+)/.exec(os.release());
  return m ? Number(m[1]) : 0;
}

/**
 * What this machine can do. `processLoopback:false` is the honest Win10 answer
 * — the UI must fall back to system-wide capture and say so, never pretend.
 */
function getCapabilities() {
  if (process.platform !== 'win32') {
    return { supported: false, processLoopback: false, build: 0, reason: 'not-windows' };
  }
  if (!init()) {
    return { supported: false, processLoopback: false, build: windowsBuild(), reason: 'no-native' };
  }
  const build = windowsBuild();
  return {
    supported: true,
    processLoopback: build >= PROCESS_LOOPBACK_MIN_BUILD,
    build,
    reason: build >= PROCESS_LOOPBACK_MIN_BUILD ? null : 'needs-win11',
  };
}

// ===== process list for the picker =====

const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

function processName(pid) {
  const { OpenProcess, QueryFullProcessImageNameW, CloseHandle } = init();
  if (!pid) return null;
  const h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
  if (!h) return null;
  try {
    const buf = Buffer.alloc(2048);
    const size = [1024];
    if (!QueryFullProcessImageNameW(h, 0, buf, size)) return null;
    return buf.toString('utf16le', 0, size[0] * 2).split('\\').pop();
  } finally {
    CloseHandle(h);
  }
}

function defaultRenderDevice() {
  const outEnum = [null];
  check(
    init().CoCreateInstance(IID.MMDeviceEnumerator, null, 23, IID.IMMDeviceEnumerator, outEnum),
    'CoCreateInstance(MMDeviceEnumerator)'
  );
  const devEnum = outEnum[0];
  const outDev = [null];
  const hr = vcall(devEnum, 4, 'long GetDefaultAudioEndpoint(void*, int, int, _Out_ void**)', 0, 0, outDev);
  release(devEnum);
  check(hr, 'GetDefaultAudioEndpoint');
  return outDev[0];
}

/**
 * Audio sessions on the default render endpoint, sampled for peak level over
 * `sampleMs` so the caller can show only what is actually making sound.
 *
 * Only processes that have OPENED an audio stream appear at all — a program
 * that has never played anything is not listed, which is why the picker is
 * "play something, then choose", not "choose, then play".
 */
async function listAudioSessions({ sampleMs = 800, sampleEveryMs = 50 } = {}) {
  if (!init()) return [];
  let device = null;
  let mgr = null;
  let sessions = null;
  const rows = [];
  try {
    device = defaultRenderDevice();
    const outMgr = [null];
    check(
      vcall(device, 3, 'long Activate(void*, const uint8_t*, uint32, void*, _Out_ void**)',
        IID.IAudioSessionManager2, 23, null, outMgr),
      'Activate(IAudioSessionManager2)'
    );
    mgr = outMgr[0];
    const outSessions = [null];
    check(vcall(mgr, 5, 'long GetSessionEnumerator(void*, _Out_ void**)', outSessions), 'GetSessionEnumerator');
    sessions = outSessions[0];

    const outCount = [0];
    vcall(sessions, 3, 'long GetCount(void*, _Out_ int*)', outCount);
    for (let i = 0; i < outCount[0]; i++) {
      const outCtl = [null];
      if (vcall(sessions, 4, 'long GetSession(void*, int, _Out_ void**)', i, outCtl) !== 0) continue;
      const ctl = outCtl[0];
      const ctl2 = queryInterface(ctl, IID.IAudioSessionControl2);
      const outState = [0];
      vcall(ctl, 3, 'long GetState(void*, _Out_ int*)', outState);
      const outPid = [0];
      if (ctl2) vcall(ctl2, 14, 'long GetProcessId(void*, _Out_ uint32*)', outPid);
      rows.push({
        pid: outPid[0],
        name: processName(outPid[0]),
        state: ['inactive', 'active', 'expired'][outState[0]] || 'unknown',
        systemSounds: ctl2 ? vcall(ctl2, 15, 'long IsSystemSoundsSession(void*)') === 0 : false,
        peak: 0,
        _ctl: ctl,
        _ctl2: ctl2,
        _meter: queryInterface(ctl, IID.IAudioMeterInformation),
      });
    }

    const until = Date.now() + sampleMs;
    do {
      for (const row of rows) {
        if (!row._meter) continue;
        const out = [0];
        if (vcall(row._meter, 3, 'long GetPeakValue(void*, _Out_ float*)', out) === 0) {
          row.peak = Math.max(row.peak, out[0]);
        }
      }
      if (Date.now() >= until) break;
      await new Promise((r) => setTimeout(r, sampleEveryMs));
    } while (Date.now() < until);

    return rows
      .filter((r) => r.pid && r.name && !r.systemSounds)
      .map(({ pid, name, state, peak }) => ({ pid, name, state, peak, audible: state === 'active' && peak > 0.0001 }))
      .sort((a, b) => b.peak - a.peak || a.name.localeCompare(b.name));
  } catch (e) {
    logger.warn(`listAudioSessions failed: ${e.message}`);
    return [];
  } finally {
    for (const row of rows) {
      release(row._meter);
      release(row._ctl2);
      release(row._ctl);
    }
    release(sessions);
    release(mgr);
    release(device);
  }
}

// ===== activation =====

const VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK = 'VAD\\Process_Loopback';
const AUDCLNT_STREAMFLAGS_LOOPBACK = 0x00020000;
const AUDCLNT_STREAMFLAGS_EVENTCALLBACK = 0x00040000;
const AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM = 0x80000000;
const AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY = 0x08000000;
const AUDCLNT_E_DEVICE_INVALIDATED = 0x88890004;
const AUDCLNT_BUFFERFLAGS_SILENT = 0x2;
// Set when the device dropped samples between two packets — i.e. our pump did
// not drain the 2s client buffer in time. Counted rather than ignored: it is
// the difference between "the audio stopped" and "we stopped listening".
const AUDCLNT_BUFFERFLAGS_DATA_DISCONTINUITY = 0x1;

const SAMPLE_RATE = 16000;
const BUFFER_DURATION_HNS = 20000000n; // 2s of slack; the pump polls every 20ms
const ACTIVATION_TIMEOUT_MS = 10000;

// 16 kHz mono float32 — exactly what the ASR worker consumes, so nothing in
// this file ever resamples.
function waveFormat16kMono() {
  const wf = mem(18);
  poke.u16(wf, 0, 3); // WAVE_FORMAT_IEEE_FLOAT
  poke.u16(wf, 2, 1);
  poke.u32(wf, 4, SAMPLE_RATE);
  poke.u32(wf, 8, SAMPLE_RATE * 4);
  poke.u16(wf, 12, 4);
  poke.u16(wf, 14, 32);
  poke.u16(wf, 16, 0);
  return wf;
}

// The completion handler ActivateAudioInterfaceAsync requires: a COM object
// implemented as a table of koffi callbacks. Every piece stays referenced for
// the life of the call or the GC frees the vtable under Windows' feet.
function makeCompletionHandler(onCompleted) {
  const { koffi, QIProto, RefProto, DoneProto } = init();
  const objBuf = mem(8);
  const vtblBuf = mem(8 * 4);
  const accepted = [IID.IUnknown, IID.IActivateAudioInterfaceCompletionHandler, IID.IAgileObject];

  const qi = koffi.register((self, riid, ppv) => {
    try {
      const asked = Buffer.from(koffi.decode(riid, 'uint8_t', 16));
      if (accepted.some((w) => w.equals(asked))) {
        koffi.encode(ppv, 'void*', self);
        return 0;
      }
      koffi.encode(ppv, 'void*', null);
      return 0x80004002 | 0; // E_NOINTERFACE
    } catch {
      return 0x80004005 | 0; // E_FAIL
    }
  }, koffi.pointer(QIProto));
  // Lifetime is ours, not COM's: the handler lives exactly as long as the
  // activation promise, so the counts are constants.
  const addref = koffi.register(() => 2, koffi.pointer(RefProto));
  const rel = koffi.register(() => 1, koffi.pointer(RefProto));
  const done = koffi.register((self, op) => {
    try {
      onCompleted(op);
    } catch {
      // surfaced through the promise
    }
    return 0;
  }, koffi.pointer(DoneProto));

  [qi, addref, rel, done].forEach((cb, i) => poke.ptr(vtblBuf, i * 8, koffi.address(cb)));
  poke.ptr(objBuf, 0, vtblBuf);
  return { obj: objBuf, keep: [vtblBuf, qi, addref, rel, done] };
}

function activateProcessLoopback(pid, exclude) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn) => (arg) => {
      if (settled) return;
      settled = true;
      fn(arg);
    };
    const fail = finish(reject);

    const handler = makeCompletionHandler((op) => {
      try {
        const outHr = [0];
        const outIface = [null];
        const hr = vcall(op, 3, 'long GetActivateResult(void*, _Out_ long*, _Out_ void**)', outHr, outIface);
        if (hr !== 0) return fail(hrError('GetActivateResult', hr));
        if (outHr[0] !== 0) return fail(hrError('process loopback activation', outHr[0]));
        finish(resolve)(outIface[0]);
      } catch (e) {
        fail(e);
      }
    });

    // AUDIOCLIENT_ACTIVATION_PARAMS { type; { pid; mode } } wrapped in a
    // VT_BLOB PROPVARIANT, which is how this API takes its parameters.
    const params = mem(12);
    poke.i32(params, 0, 1); // AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK
    poke.u32(params, 4, pid);
    poke.i32(params, 8, exclude ? 1 : 0); // EXCLUDE / INCLUDE target process tree
    const propvariant = mem(24);
    poke.u16(propvariant, 0, 65); // VT_BLOB
    poke.u32(propvariant, 8, 12);
    poke.ptr(propvariant, 16, params);
    handler.keep.push(params, propvariant);

    const outOp = [null];
    const hr = init().ActivateAudioInterfaceAsync(
      VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, IID.IAudioClient, propvariant, handler.obj, outOp
    );
    if (hr !== 0) return fail(hrError('ActivateAudioInterfaceAsync', hr));
    setTimeout(() => fail(new Error('activation completion handler never fired')), ACTIVATION_TIMEOUT_MS);
  });
}

// Returns the loopback client plus the endpoint's volume control. The volume
// interface is best effort: without it capture still works, only at whatever
// level the user happens to listen at (the pre-v0.4.1 behavior).
function activateSystemLoopback() {
  const device = defaultRenderDevice();
  try {
    const out = [null];
    check(
      vcall(device, 3, 'long Activate(void*, const uint8_t*, uint32, void*, _Out_ void**)',
        IID.IAudioClient, 23, null, out),
      'Activate(IAudioClient)'
    );
    let volume = null;
    try {
      const outVol = [null];
      const hr = vcall(device, 3, 'long Activate(void*, const uint8_t*, uint32, void*, _Out_ void**)',
        IID.IAudioEndpointVolume, 23, null, outVol);
      if (hr === 0) volume = outVol[0];
      else logger.warn(`endpoint volume unavailable: 0x${(hr >>> 0).toString(16)}`);
    } catch (e) {
      logger.warn(`endpoint volume unavailable: ${e.message}`);
    }
    return { client: out[0], volume };
  } finally {
    release(device);
  }
}

// ===== capture =====

/**
 * Start capturing 16 kHz mono float32.
 *
 * @param {object} opts
 * @param {'system'|'include'|'exclude'} opts.mode
 * @param {number} [opts.pid]      target for include/exclude
 * @param {(pcm: Float32Array) => void} opts.onPcm
 * @param {(kind: string, detail?: string) => void} [opts.onEvent]
 * @returns {Promise<{stop: () => void, mode: string}>}
 */
async function startCapture({ mode = 'system', pid = 0, onPcm, onEvent = () => {}, pollMs = 20 }) {
  if (!init()) throw new Error('native audio capture unavailable');
  if (mode !== 'system' && !getCapabilities().processLoopback) {
    throw new Error('process loopback needs Windows 10 build 20348 or newer');
  }
  if (mode !== 'system' && !pid) throw new Error('process capture needs a pid');

  let client = null;
  let capture = null;
  let hEvent = null;
  let timer = null;
  let stopped = false;
  let reacquires = 0;
  let silentPackets = 0;
  let discontinuities = 0;
  let framesDelivered = 0;
  // System path only: the endpoint volume control, the inverse gain derived
  // from it, and the guard that switches compensation off for devices that
  // apply their volume in hardware (their loopback was never attenuated).
  let volume = null;
  let gain = 1;
  let endpointDb = null;
  let compensation = mode === 'system' ? 'on' : 'n/a'; // 'on' | 'off' | 'n/a'
  let clipGuard = null;
  let pollsSinceVolume = 0;
  const VOLUME_POLLS = 25; // re-read the slider every ~500ms at the 20ms pump

  const teardown = () => {
    if (timer) clearInterval(timer);
    timer = null;
    if (client) {
      try {
        vcall(client, 11, 'long Stop(void*)');
      } catch {
        // the device may already be gone; nothing to salvage
      }
    }
    release(capture);
    release(client);
    release(volume);
    if (hEvent) init().CloseHandle(hEvent);
    capture = client = hEvent = volume = null;
  };

  // GetMasterVolumeLevel is the attenuation the engine applies (dB over the
  // device's own range); the 0..1 scalar is only the slider position and is
  // not linear in amplitude (8% read -38 dB, not -22).
  const refreshGain = () => {
    if (!volume) return;
    try {
      const outDb = [0];
      if (vcall(volume, 8, 'long GetMasterVolumeLevel(void*, _Out_ float*)', outDb) !== 0) return;
      endpointDb = outDb[0];
      gain = compensation === 'on' ? compensationGain(endpointDb) : 1;
    } catch (e) {
      logger.warn(`endpoint volume read failed: ${e.message}`);
      release(volume);
      volume = null;
      gain = 1;
    }
  };

  const open = async () => {
    if (mode === 'system') {
      ({ client, volume } = activateSystemLoopback());
    } else {
      client = await activateProcessLoopback(pid, mode === 'exclude');
    }

    // Process loopback takes 16k mono directly (it has no mix format at all —
    // GetMixFormat returns E_NOTIMPL). The endpoint client only accepts its
    // mix format unless the audio engine is asked to convert, which is what
    // AUTOCONVERTPCM does — measured identical to converting it ourselves.
    let flags = AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK;
    if (mode === 'system') flags |= AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY;
    check(
      vcall(client, 3, 'long Initialize(void*, int, uint32, int64_t, int64_t, void*, void*)',
        0, flags, BUFFER_DURATION_HNS, 0n, waveFormat16kMono(), null),
      'IAudioClient::Initialize'
    );

    hEvent = init().CreateEventW(null, 0, 0, null);
    check(vcall(client, 13, 'long SetEventHandle(void*, void*)', hEvent), 'SetEventHandle');
    const outCapture = [null];
    check(
      vcall(client, 14, 'long GetService(void*, const uint8_t*, _Out_ void**)', IID.IAudioCaptureClient, outCapture),
      'GetService(IAudioCaptureClient)'
    );
    capture = outCapture[0];
    check(vcall(client, 10, 'long Start(void*)'), 'IAudioClient::Start');
    refreshGain();
    pollsSinceVolume = 0;
  };

  // Polled rather than blocked on the event handle: this runs on the ASR
  // worker's only JS thread, and a blocking wait there would stall decoding.
  // 20ms against a 2s client buffer has no overflow risk and adds no
  // meaningful latency (first token is ~560ms).
  const drain = () => {
    if (stopped || !capture) return;
    const { koffi } = init();
    if (volume && ++pollsSinceVolume >= VOLUME_POLLS) {
      pollsSinceVolume = 0;
      refreshGain();
    }
    for (;;) {
      const outNext = [0];
      const hrNext = vcall(capture, 5, 'long GetNextPacketSize(void*, _Out_ uint32*)', outNext);
      if (hrNext !== 0) return onDeviceError(hrNext);
      if (!outNext[0]) return;

      const outData = [null];
      const outFrames = [0];
      const outFlags = [0];
      const outPos = [0n];
      const outQpc = [0n];
      const hr = vcall(
        capture, 3,
        'long GetBuffer(void*, _Out_ void**, _Out_ uint32*, _Out_ uint32*, _Out_ uint64_t*, _Out_ uint64_t*)',
        outData, outFrames, outFlags, outPos, outQpc
      );
      if (hr !== 0) return onDeviceError(hr);

      const frames = outFrames[0];
      if (outFlags[0] & AUDCLNT_BUFFERFLAGS_DATA_DISCONTINUITY) discontinuities += 1;
      if (frames > 0) {
        framesDelivered += frames;
        if (outFlags[0] & AUDCLNT_BUFFERFLAGS_SILENT) {
          silentPackets += 1;
          // Silent packets carry no valid data pointer; the timeline still has
          // to advance or the VAD would see a jump-cut instead of a pause.
          onPcm(new Float32Array(frames));
        } else if (outData[0]) {
          const bytes = new Uint8Array(koffi.decode(outData[0], 'uint8_t', frames * 4));
          const pcm = new Float32Array(bytes.buffer, 0, frames);
          if (gain !== 1) {
            applyGain(pcm, gain);
            if (!clipGuard) clipGuard = makeClipGuard();
            if (clipGuard.check(pcm)) {
              // Sustained clipping under gain: this device applies its volume
              // in hardware, the loopback signal was never attenuated, and the
              // inverse is pure distortion. Off for the rest of this capture.
              compensation = 'off';
              gain = 1;
              onEvent('volume-compensation-off', `clipping at ${endpointDb === null ? '?' : endpointDb.toFixed(1)} dB`);
            }
          }
          onPcm(pcm);
        }
      }
      vcall(capture, 4, 'long ReleaseBuffer(void*, uint32)', frames);
    }
  };

  // A default-device switch (headphones plugged in) invalidates the client.
  // The renderer used to notice this through a dead MediaStream track; here it
  // is an explicit HRESULT, so the rebuild is immediate instead of guessed.
  const onDeviceError = (hr) => {
    const code = hr >>> 0;
    if (code !== AUDCLNT_E_DEVICE_INVALIDATED) {
      logger.warn(`capture error 0x${code.toString(16)} — restarting stream`);
    }
    if (stopped) return;
    if (reacquires >= 3) {
      onEvent('reacquire-failed', `0x${code.toString(16)}`);
      stopped = true;
      teardown();
      return;
    }
    reacquires += 1;
    onEvent('device-lost', `0x${code.toString(16)}`);
    teardown();
    setTimeout(async () => {
      if (stopped) return;
      try {
        await open();
        timer = setInterval(drain, pollMs);
        onEvent('device-reacquired');
      } catch (e) {
        onEvent('reacquire-failed', e.message);
      }
    }, 800);
  };

  await open();
  timer = setInterval(drain, pollMs);
  logger.info(
    `capture started (mode=${mode}${pid ? `, pid=${pid}` : ''}` +
      `${endpointDb === null ? '' : `, endpoint ${endpointDb.toFixed(1)} dB, gain x${gain.toFixed(1)}`})`
  );

  return {
    mode,
    // Read by the worker's metrics line: silent packets mean the source went
    // quiet at the OS level (not our doing), discontinuities mean the pump
    // fell behind. Both are invisible in the PCM itself. endpointDb says how
    // far down the user's volume slider was — the number that explained a
    // "deaf" session once.
    stats() {
      return { silentPackets, discontinuities, framesDelivered, endpointDb, gain, compensation };
    },
    stop() {
      stopped = true;
      teardown();
      logger.info('capture stopped');
    },
  };
}

module.exports = {
  getCapabilities,
  listAudioSessions,
  startCapture,
  SAMPLE_RATE,
  PROCESS_LOOPBACK_MIN_BUILD,
};
