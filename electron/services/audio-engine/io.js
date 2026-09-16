// Worker-side I/O shared by the ASR, capture and TTS halves: messages to the
// host over parentPort, the JSONL session log (metrics only unless the host
// asked for text), and the fatal path that hands control to the worker's
// teardown.

const fs = require('fs');
const { eventRecord } = require('./probe-metrics');

let logStream = null;
let logText = false;
let onFatal = (code) => process.exit(code);

function post(msg) {
  try {
    process.parentPort.postMessage(msg);
  } catch {
    // parent gone — nothing sane left to do
  }
}

function openLog(file) {
  logStream = fs.createWriteStream(file, { flags: 'a' });
}

function logLine(rec) {
  if (!logStream) return;
  try {
    logStream.write(JSON.stringify(rec) + '\n');
  } catch {
    // log failure must never break transcription
  }
}

// Ends the log; secure mode entered mid-session calls this while the session
// goes on, teardown calls it last with the exit continuation.
function closeLog(done) {
  if (!logStream) {
    if (done) done();
    return;
  }
  const s = logStream;
  logStream = null;
  logText = false;
  try {
    s.end(done);
  } catch {
    if (done) done();
  }
}

const setLogText = (v) => {
  logText = v === true;
};
const textLogged = () => logText;
const setOnFatal = (fn) => {
  onFatal = fn;
};

function fatal(message) {
  logLine(eventRecord('fatal', message));
  post({ type: 'fatal', message: String(message) });
  onFatal(1);
}

module.exports = { post, openLog, logLine, closeLog, setLogText, textLogged, setOnFatal, fatal };
