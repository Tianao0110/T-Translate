// Access audit for safeStorage decryption — extracted from ipc/secure-storage.js
// so the main-process translation stack's secureVault shares the SAME trail and
// burst alarm. After the stack migration most decryption happens in-process
// without touching IPC; an IPC-local audit would be blind to the biggest
// consumer.

const { BrowserWindow } = require('electron');
const logger = require('./logger')('SecureAudit');

// App-internal bulk sweeps legitimately touch every stored key at once:
// settings-page load, translation-stack boot/reload, OCR engine config loads.
// They stay in the audit trail but are excluded from the burst alarm — it
// exists to flag access patterns the app's own architecture can't produce.
const BULK_CONTEXTS = new Set(['settings-load', 'stack-reload', 'ocr-config']);

const accessLog = {
  records: [],
  maxRecords: 200,

  alertThreshold: 15,      // >15 non-bulk decrypts in window => suspicious
  alertWindowMs: 60000,
  lastAlertTime: 0,
  alertCooldownMs: 300000, // throttle alerts to 1 per 5 min
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

// Record an access AND fire the alert if it crosses the line — the one-call
// form both the IPC handler and the stack vault use.
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
  sendSecurityAlert,
  auditAccess,
  reset,
};
