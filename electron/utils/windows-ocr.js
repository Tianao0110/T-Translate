// Windows.Media.Ocr driver. PowerShell 5.1 hosts the WinRT calls; the script
// travels as -EncodedCommand (base64 UTF-16LE) because inline -Command goes
// through cmd.exe AND PowerShell argument parsing — quotes/newlines/pipes in
// the script body get mangled in ways that differ per machine.
// No electron imports here: keep this testable with plain `node`.

const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

// settings language -> Windows OCR language tag. Unmapped/auto -> '' which
// means "use the user's Windows profile languages".
const WIN_LANG_MAP = {
  'zh-Hans': 'zh-Hans-CN',
  'zh-Hant': 'zh-Hant-TW',
  'en': 'en-US',
  'ja': 'ja-JP',
  'ko': 'ko-KR',
  'fr': 'fr-FR',
  'de': 'de-DE',
  'es': 'es-ES',
  'ru': 'ru-RU',
};

function runPowerShell(script, options = {}) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encoded}`, {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024,
    timeout: 30000,
    ...options,
  });
}

// Strip the per-glyph spaces Windows OCR inserts in CJK output; latin-latin
// gaps stay intact.
const CJK = '[\\u3040-\\u30ff\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff\\uff00-\\uffef]';
function stripCjkSpaces(text) {
  return text
    .replace(new RegExp(`(${CJK}) +(?=${CJK})`, 'g'), '$1')
    .replace(new RegExp(`(${CJK}) +`, 'g'), '$1')
    .replace(new RegExp(` +(?=${CJK})`, 'g'), '');
}

function buildRecognizeScript(imagePath, winLang) {
  // Single-quoted PS literals; ' escaped by doubling.
  const psPath = imagePath.replace(/'/g, "''");
  const psLang = (winLang || '').replace(/'/g, "''");
  return `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
Function Await($WinRtTask, $ResultType) { $asTask = $asTaskGeneric.MakeGenericMethod($ResultType); $netTask = $asTask.Invoke($null, @($WinRtTask)); $netTask.Wait(-1) | Out-Null; $netTask.Result }
try {
  $storageFile = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync('${psPath}')) ([Windows.Storage.StorageFile])
  $stream = Await ($storageFile.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $ocrEngine = $null
  if ('${psLang}' -ne '') {
    try { $langObj = New-Object Windows.Globalization.Language('${psLang}'); $ocrEngine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($langObj) } catch {}
  }
  if ($null -eq $ocrEngine) { $ocrEngine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }
  if ($null -eq $ocrEngine) { Write-Error 'no usable OCR language pack'; exit 1 }
  $result = Await ($ocrEngine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
  $lines = @($result.Lines | ForEach-Object {
    $words = @($_.Words | ForEach-Object { @{ x = $_.BoundingRect.X; y = $_.BoundingRect.Y; w = $_.BoundingRect.Width; h = $_.BoundingRect.Height } })
    @{ text = $_.Text; words = $words }
  })
  @{ lines = $lines } | ConvertTo-Json -Depth 5 -Compress
  $stream.Dispose()
} catch { Write-Error $_.Exception.Message; exit 1 }
`.trim();
}

// OcrLine carries no rect of its own — only its Words do, so a line's box is
// their union. Line granularity matches the local engine's rawBlocks; word
// boxes would read as a "word pile" to the floating window's layout heuristic.
function unionWordRects(words) {
  const valid = (words || []).filter(
    w => [w?.x, w?.y, w?.w, w?.h].every(Number.isFinite) && w.w > 0 && w.h > 0
  );
  if (!valid.length) return null;

  const x = Math.min(...valid.map(w => w.x));
  const y = Math.min(...valid.map(w => w.y));
  const right = Math.max(...valid.map(w => w.x + w.w));
  const bottom = Math.max(...valid.map(w => w.y + w.h));
  return { x, y, width: right - x, height: bottom - y };
}

/**
 * Parse the PowerShell payload into text + positioned blocks.
 *
 * Falls back to treating the output as plain text when it isn't JSON: a host
 * where ConvertTo-Json misbehaves then degrades to this driver's pre-0.3.4
 * behavior (text, no coordinates) instead of failing recognition outright.
 *
 * @returns {{text: string, blocks: Array<{text, bbox, confidence, index}>}}
 */
function parseRecognizeOutput(stdout) {
  const raw = (stdout || '').trim();
  if (!raw) return { text: '', blocks: [] };

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return { text: raw, blocks: [] };
  }

  // PS 5.1 collapses a one-element array to a bare object and may render an
  // empty one as null.
  const lines = Array.isArray(data?.lines) ? data.lines : data?.lines ? [data.lines] : [];

  const texts = [];
  const blocks = [];
  for (const line of lines) {
    const text = typeof line?.text === 'string' ? line.text : '';
    if (!text.trim()) continue;
    texts.push(text);

    const bbox = unionWordRects(Array.isArray(line.words) ? line.words : line.words ? [line.words] : []);
    if (bbox) {
      blocks.push({ text: text.trim(), bbox, confidence: 0.9, index: blocks.length });
    }
  }

  return { text: texts.join('\n'), blocks };
}

/**
 * @param {string} imageData - dataURL or bare base64 PNG
 * @param {{language?: string}} options - settings language code ('auto' ok)
 * @returns {Promise<{success, text?, blocks?, rawBlocks?, confidence?, engine, error?}>}
 */
async function recognize(imageData, options = {}) {
  if (process.platform !== 'win32') {
    return { success: false, error: 'Windows OCR is only available on Windows', engine: 'windows-ocr' };
  }

  let tempFile = null;
  try {
    let base64Data = imageData;
    if (typeof imageData === 'string' && imageData.startsWith('data:image')) {
      base64Data = imageData.split(',')[1];
    }

    // random suffix: concurrent recognitions in the same millisecond must not
    // share a temp file
    tempFile = path.join(
      os.tmpdir(),
      `t-translate-winocr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`
    );
    fs.writeFileSync(tempFile, Buffer.from(base64Data, 'base64'));

    const winLang = WIN_LANG_MAP[options.language] || '';
    const { stdout } = await runPowerShell(buildRecognizeScript(tempFile, winLang));

    const parsed = parseRecognizeOutput(stdout);
    const text = stripCjkSpaces(parsed.text);
    // Boxes come straight from Windows in source-image pixels — this driver
    // writes the capture to disk untouched, so no scale conversion applies.
    const blocks = parsed.blocks.map(b => ({ ...b, text: stripCjkSpaces(b.text) }));
    return {
      success: true,
      text,
      blocks,
      rawBlocks: blocks,
      confidence: text ? 0.9 : 0,
      engine: 'windows-ocr',
    };
  } catch (error) {
    // stderr carries a full PS error record; keep the first meaningful line
    const firstLine = String(error.stderr || error.message || '')
      .split('\n').map((s) => s.trim()).filter(Boolean)[0] || 'Windows OCR failed';
    return { success: false, error: firstLine, engine: 'windows-ocr' };
  } finally {
    if (tempFile) {
      try { fs.unlinkSync(tempFile); } catch (e) { /* best-effort */ }
    }
  }
}

// Lists OCR-capable language tags installed on this system.
async function checkAvailability() {
  if (process.platform !== 'win32') {
    return { available: false, languages: [], reason: 'not-windows' };
  }

  const major = parseInt(os.release().split('.')[0], 10);
  if (major < 10) {
    return { available: false, languages: [], reason: 'needs-win10' };
  }

  try {
    const script = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
[Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages | ForEach-Object { $_.LanguageTag }
`.trim();
    const { stdout } = await runPowerShell(script, { timeout: 10000 });
    const languages = stdout.trim().split('\n').map((l) => l.trim()).filter(Boolean);
    return { available: languages.length > 0, languages, reason: languages.length ? null : 'no-lang-pack' };
  } catch (error) {
    return { available: false, languages: [], reason: error.message };
  }
}

module.exports = { recognize, checkAvailability, stripCjkSpaces, parseRecognizeOutput };
