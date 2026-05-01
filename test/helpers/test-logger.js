const fs = require('fs');
const path = require('path');
const { setTestLogPath, resetTestLogPath, clearLogs: clearEngineLogs } = require('../../utils/logger');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const TEST_LOGS_DIR = path.join(PROJECT_ROOT, 'logs');

function ensureTestLogsDir() {
  if (!fs.existsSync(TEST_LOGS_DIR)) {
    fs.mkdirSync(TEST_LOGS_DIR, { recursive: true });
  }
}

function clearTestLogs() {
  ensureTestLogsDir();
  for (const entry of fs.readdirSync(TEST_LOGS_DIR, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      fs.rmSync(path.join(TEST_LOGS_DIR, entry.name), { recursive: true, force: true });
    } else if (entry.name.endsWith('.log')) {
      fs.unlinkSync(path.join(TEST_LOGS_DIR, entry.name));
    }
  }
}

function createTestLogger(testFilePath) {
  ensureTestLogsDir();
  const rel = path.relative(path.join(PROJECT_ROOT, 'test'), testFilePath);
  const logPath = path.join(TEST_LOGS_DIR, rel.replace(/\.js$/, '.log'));
  fs.mkdirSync(path.dirname(logPath), { recursive: true });

  function write(level, msg) {
    const line = `${Date.now()} [${level}] ${msg}\n`;
    fs.appendFileSync(logPath, line);
  }

  return {
    info: (msg) => write('INFO', msg),
    warn: (msg) => write('WARN', msg),
    error: (msg) => write('ERROR', msg),
    debug: (msg) => write('DEBUG', msg),
    getLogPath: () => logPath
  };
}

let _runLogStream = null;

function openRunLog() {
  ensureTestLogsDir();
  const logPath = path.join(TEST_LOGS_DIR, 'test-run.log');
  _runLogStream = fs.createWriteStream(logPath, { flags: 'w' });
  return _runLogStream;
}

function writeRunLog(msg) {
  if (_runLogStream) {
    _runLogStream.write(`${Date.now()} ${msg}\n`);
  }
}

function closeRunLog() {
  if (_runLogStream) {
    _runLogStream.end();
    _runLogStream = null;
  }
}

function logTestResult(filePath, suiteName, testName, passed, error) {
  const status = passed ? 'PASS' : 'FAIL';
  writeRunLog(`[${status}] ${suiteName} > ${testName}`);
  if (!passed && error) {
    writeRunLog(`  ERROR: ${error.message}`);
  }
}

function redirectEngineLogger() {
  // No-op: logger injection handled via setTestLogPath
}

function restoreEngineLogger() {
  // No-op: logger injection handled via resetTestLogPath
}

module.exports = {
  createTestLogger,
  clearTestLogs,
  redirectEngineLogger,
  restoreEngineLogger,
  openRunLog,
  closeRunLog,
  logTestResult,
  TEST_LOGS_DIR,
  setTestLogPath,
  resetTestLogPath
};