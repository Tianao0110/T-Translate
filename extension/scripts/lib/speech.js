// Shared by the extension's end-to-end scripts: English speech synthesized
// with SAPI into a wav, and the installed ASR packs linked into a sandbox.

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const LINES = [
  'Good evening everyone, thank you for joining the weekly briefing.',
  'Tonight we look at the new train schedule and the road works downtown.',
  'That is all for now, see you next week.',
];

// Each line followed by 1.2 s of silence.
function synthesizeWav(dest, lines = LINES) {
  const quote = (s) => `'${s.replace(/'/g, "''")}'`;
  const ps = `
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$names = $s.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name }
if ($names -contains 'Microsoft David Desktop') { $s.SelectVoice('Microsoft David Desktop') }
$p = New-Object System.Speech.Synthesis.PromptBuilder([System.Globalization.CultureInfo]::GetCultureInfo('en-US'))
foreach ($line in @(${lines.map(quote).join(', ')})) { $p.AppendText($line); $p.AppendBreak([TimeSpan]::FromMilliseconds(1200)) }
$s.SetOutputToWaveFile(${quote(dest)})
$s.Speak($p)
$s.SetOutputToNull()
$s.Dispose()
`;
  execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')], { stdio: ['ignore', 'pipe', 'pipe'] });
  return dest;
}

// Hard links (copies across drives) of every pack folder under packsDir.
function linkPacks(packsDir, dest) {
  for (const pack of fs.readdirSync(packsDir)) {
    const src = path.join(packsDir, pack);
    if (!fs.statSync(src).isDirectory()) continue;
    const out = path.join(dest, pack);
    fs.mkdirSync(out, { recursive: true });
    for (const f of fs.readdirSync(src)) {
      try {
        fs.linkSync(path.join(src, f), path.join(out, f));
      } catch {
        fs.copyFileSync(path.join(src, f), path.join(out, f));
      }
    }
  }
}

module.exports = { LINES, synthesizeWav, linkPacks };
