// Pins TZ when the bundled ICU cannot map the Windows time zone id (it then
// runs on a fixed offset with no daylight saving). main.js calls this before
// any window or host process starts; they all inherit the variable.

const { execFileSync } = require('child_process');

const ZONE_KEY = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\TimeZoneInformation';

// Windows ids newer than the ICU data in this Electron.
const WINDOWS_ZONE_FALLBACKS = {
  'Alberta Standard Time': 'America/Edmonton',
};

function readWindowsZoneId(exec = execFileSync) {
  try {
    const out = exec('reg', ['query', ZONE_KEY, '/v', 'TimeZoneKeyName'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 3000,
    });
    const match = /TimeZoneKeyName\s+REG_SZ\s+(.+)/.exec(out);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}

// null when ICU resolved the zone itself; otherwise { windowsId, zone },
// zone null for an id missing from the table.
function applyTimeZoneFallback({
  env = process.env,
  platform = process.platform,
  resolvedZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
  readZoneId = readWindowsZoneId,
} = {}) {
  if (platform !== 'win32' || env.TZ || resolvedZone) return null;
  const windowsId = readZoneId();
  const zone = (windowsId && WINDOWS_ZONE_FALLBACKS[windowsId]) || null;
  if (zone) env.TZ = zone;
  return { windowsId, zone };
}

module.exports = { applyTimeZoneFallback, readWindowsZoneId, WINDOWS_ZONE_FALLBACKS };
