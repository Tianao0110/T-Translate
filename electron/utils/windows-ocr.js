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
  ($result.Lines | ForEach-Object { $_.Text }) -join [Environment]::NewLine
  $stream.Dispose()
} catch { Write-Error $_.Exception.Message; exit 1 }
`.trim();
}

/**
 * @param {string} imageData - dataURL or bare base64 PNG
 * @param {{language?: string}} options - settings language code ('auto' ok)
 * @returns {Promise<{success, text?, confidence?, engine, error?}>}
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

    tempFile = path.join(os.tmpdir(), `t-translate-winocr-${Date.now()}.png`);
    fs.writeFileSync(tempFile, Buffer.from(base64Data, 'base64'));

    const winLang = WIN_LANG_MAP[options.language] || '';
    const { stdout } = await runPowerShell(buildRecognizeScript(tempFile, winLang));

    const text = stripCjkSpaces(stdout.trim());
    return {
      success: true,
      text,
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

module.exports = { recognize, checkAvailability, stripCjkSpaces };
