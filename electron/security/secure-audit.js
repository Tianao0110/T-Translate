// Access audit for safeStorage decryption, shared by the IPC handler and
// secure-vault: one trail, one burst alarm (security-alert to every window).

const { BrowserWindow } = require('electron');
const logger = require('../platform/logger')('SecureAudit');

// Bulk sweeps (settings load, stack reload, OCR config) stay in the trail but
// are excluded from the burst alarm.
const BULK_CONTEXTS = new Set(['settings-load', 'stack-reload', 'ocr-config']);

const accessLog = {
  records: [],
  maxRecords: 200,

  alertThreshold: 15, // non-bulk decrypts per window
  alertWindowMs: 60000,
  lastAlertTime: 0,
  alertCooldownMs: 300000,
};

function logAccess(key, context = 'unknown') {
  accessLog.records.push({ key, timestamp: Date.now(), context });

  if (accessLog.records.length > accessLog.maxRecords) {
    accessLog.records = accessLog.records.slice(-accessLog.maxRecords);
  }

  return checkAnomaly();
}

function checkAnomaly() {
  const now = Date.now();
  const windowStart = now - accessLog.alertWindowMs;
  const recent = accessLog.records.filter(
    r => r.timestamp > windowStart && !BULK_CONTEXTS.has(r.context)
  );

  if (recent.length >= accessLog.alertThreshold) {
    const uniqueKeys = new Set(recent.map(r => r.key));
    return {
      isAnomaly: true,
      count: recent.length,
      uniqueKeys: uniqueKeys.size,
      window: accessLog.alertWindowMs / 1000,
    };
  }

  return { isAnomaly: false };
}

function sendSecurityAlert(anomaly) {
  const now = Date.now();
  if (now - accessLog.lastAlertTime < accessLog.alertCooldownMs) return;
  accessLog.lastAlertTime = now;

  logger.warn(`SECURITY ALERT: ${anomaly.count} decrypt ops in ${anomaly.window}s (${anomaly.uniqueKeys} unique keys)`);

  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('security-alert', {
        type: 'suspicious-key-access',
        count: anomaly.count,
        uniqueKeys: anomaly.uniqueKeys,
        timestamp: now,
      });
    }
  }
}

// Records an access and fires the alert when it crosses the line.
function auditAccess(key, context) {
  const anomaly = logAccess(key, context);
  if (anomaly.isAnomaly) {
    sendSecurityAlert(anomaly);
  }
  return anomaly;
}

function reset() {
  accessLog.records = [];
  accessLog.lastAlertTime = 0;
}

module.exports = {
  BULK_CONTEXTS,
  logAccess,
  checkAnomaly,
  auditAccess,
  reset,
};
