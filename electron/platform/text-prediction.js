// Word completion from the Windows typing predictor
// (Windows.Data.Text.TextPredictionGenerator): one resident PowerShell 5.1
// host answers line-delimited JSON on stdin / stdout. Started on demand,
// stopped when idle. No electron imports: testable with plain node. The
// main-window compose handler (ipc/translation-stack.js) calls complete();
// rules and numbers in docs/design/renderer.md §1.

const { spawn } = require('child_process');

const MIN_LETTERS = 3;
const CONTEXT_WORDS = 8;
const IDLE_EXIT_MS = 5 * 60 * 1000;
const START_TIMEOUT_MS = 10000;
const REQUEST_TIMEOUT_MS = 2000;

const HOST_SCRIPT = `
$utf8 = New-Object System.Text.UTF8Encoding $false
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $null = [Windows.Data.Text.TextPredictionGenerator, Windows.Data.Text, ContentType = WindowsRuntime]
  $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
  $listType = [System.Collections.Generic.IReadOnlyList[string]]
  $asTask = $asTaskGeneric.MakeGenericMethod($listType)
  Function Await($op) { $t = $asTask.Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result }
  $gen = New-Object Windows.Data.Text.TextPredictionGenerator('en-US')
  if ($gen.LanguageAvailableButNotInstalled) { throw 'en-US typing data is not installed' }
  $opt = [Windows.Data.Text.TextPredictionOptions]::Predictions
  $null = Await ($gen.GetCandidatesAsync('the', 1, $opt, [string[]]@()))
  [Console]::Out.WriteLine('{"ready":true}')
} catch {
  [Console]::Out.WriteLine((@{ ready = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress))
  exit 0
}
[Console]::Out.Flush()
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $id = $null
  try {
    $req = $line | ConvertFrom-Json
    $id = $req.id
    $prev = [string[]]@($req.prev | Where-Object { $_ })
    $c = @(Await ($gen.GetCandidatesAsync([string]$req.fragment, 3, $opt, $prev)))
    $out = @{ id = $id; candidates = $c }
  } catch {
    $out = @{ id = $id; candidates = @(); error = $_.Exception.Message }
  }
  [Console]::Out.WriteLine(($out | ConvertTo-Json -Compress))
  [Console]::Out.Flush()
}
`;

// { prev, fragment } for the predictor, or null: the text has to end inside
// an English word with at least MIN_LETTERS letters typed.
function predictionRequest(text) {
  if (typeof text !== 'string') return null;
  const tail = text.slice(-200);
  if (!/^[\x20-\x7E\n]*$/.test(tail)) return null;
  const m = /[A-Za-z']+$/.exec(tail);
  if (!m || m[0].replace(/'/g, '').length < MIN_LETTERS) return null;
  const fragment = m[0];
  const prev = tail.slice(0, tail.length - fragment.length).split(/\s+/).filter(Boolean).slice(-CONTEXT_WORDS);
  return { prev, fragment };
}

// The rest of the word after `fragment`, from the best candidate; '' unless
// it extends what was typed with letters only.
function predictionSuffix(candidates, fragment) {
  const list = Array.isArray(candidates) ? candidates : typeof candidates === 'string' ? [candidates] : [];
  const best = list[0];
  if (typeof best !== 'string' || best.length <= fragment.length) return '';
  if (best.slice(0, fragment.length).toLowerCase() !== fragment.toLowerCase()) return '';
  const rest = best.slice(fragment.length);
  return /^[A-Za-z']+$/.test(rest) ? rest : '';
}

function createTextPredictor({ spawnImpl = spawn, timers = { set: setTimeout, clear: clearTimeout }, idleMs = IDLE_EXIT_MS, logger = null } = {}) {
  let child = null;
  let starting = null;
  let unavailable = false;
  let idleTimer = null;
  let seq = 0;
  const pending = new Map(); // id -> { resolve, timer }

  function settleAll() {
    for (const [, p] of pending) {
      timers.clear(p.timer);
      p.resolve([]);
    }
    pending.clear();
  }

  function stop() {
    if (idleTimer) timers.clear(idleTimer);
    idleTimer = null;
    if (child) child.kill();
    child = null;
    starting = null;
    settleAll();
  }

  function armIdle() {
    if (idleTimer) timers.clear(idleTimer);
    idleTimer = timers.set(stop, idleMs);
  }

  // Resolves true once the host is answering, false when this machine has no predictor.
  function start() {
    if (unavailable) return Promise.resolve(false);
    if (starting) return starting;
    starting = new Promise((resolve) => {
      let ready = false;
      let failed = false;
      let buf = '';
      const giveUp = (why) => {
        if (ready || failed) return;
        failed = true;
        unavailable = true;
        logger?.warn?.(`text prediction unavailable: ${why}`);
        stop();
        resolve(false);
      };
      try {
        const encoded = Buffer.from(HOST_SCRIPT, 'utf16le').toString('base64');
        child = spawnImpl('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'ignore'],
        });
      } catch (e) {
        giveUp(e.message);
        return;
      }
      const me = child;
      const startTimer = timers.set(() => giveUp('start timeout'), START_TIMEOUT_MS);
      me.stdin.on('error', () => {});
      me.stdout.setEncoding('utf8');
      me.stdout.on('data', (chunk) => {
        buf += chunk;
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          let msg;
          try {
            msg = JSON.parse(line);
          } catch {
            continue;
          }
          if (!ready) {
            timers.clear(startTimer);
            if (msg.ready) {
              ready = true;
              resolve(true);
            } else {
              giveUp(msg.error || 'not ready');
            }
            continue;
          }
          const p = pending.get(msg.id);
          if (!p) continue;
          pending.delete(msg.id);
          timers.clear(p.timer);
          p.resolve(msg.candidates);
        }
      });
      const gone = () => {
        timers.clear(startTimer);
        if (child === me) {
          child = null;
          starting = null;
          settleAll();
        }
        if (!ready) giveUp('host exited');
      };
      me.on('exit', gone);
      me.on('error', gone);
    });
    return starting;
  }

  function ask(req) {
    return new Promise((resolve) => {
      const id = ++seq;
      const timer = timers.set(() => {
        pending.delete(id);
        resolve([]);
      }, REQUEST_TIMEOUT_MS);
      pending.set(id, { resolve, timer });
      child.stdin.write(`${JSON.stringify({ id, ...req })}\n`);
    });
  }

  return {
    // The rest of the word being typed, '' when there is nothing sure to show.
    async complete(text) {
      const req = predictionRequest(text);
      if (!req || !(await start()) || !child) return '';
      armIdle();
      return predictionSuffix(await ask(req), req.fragment);
    },
    // Starts the host ahead of typing (the source box got focus).
    async warm() {
      const ok = await start();
      if (ok) armIdle();
      return ok;
    },
    stop,
    available: () => !unavailable,
  };
}

module.exports = { createTextPredictor, predictionRequest, predictionSuffix, MIN_LETTERS };
