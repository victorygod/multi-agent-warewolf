/**
 * 日志模块
 * 支持测试注入：通过 setTestLogPath 将所有日志重定向到指定文件
 *
 * 日志级别说明：
 * - INFO: 玩家行为（发言、投票、技能使用）、阶段变更
 * - DEBUG: 工程调试信息（AI context、内部状态等）
 * - WARN/ERROR: 警告和错误
 *
 * 通过 server.js --debug 参数开启 DEBUG 日志
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const LOGS_DIR = path.join(PROJECT_ROOT, 'logs');

let _testLogPath = null;

function setTestLogPath(filepath) {
  _testLogPath = filepath;
  if (filepath) {
    fs.mkdirSync(path.dirname(filepath), { recursive: true });
  }
}

function resetTestLogPath() {
  _testLogPath = null;
}

function ensureLogsDir() {
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }
}

function clearLogs() {
  ensureLogsDir();
  fs.readdirSync(LOGS_DIR).forEach(file => {
    if (file.endsWith('.log')) {
      fs.unlinkSync(path.join(LOGS_DIR, file));
    }
  });
}

function getRelativePath(fullPath) {
  if (!fullPath) return 'unknown';
  let relative = fullPath;
  if (fullPath.startsWith(PROJECT_ROOT)) {
    relative = fullPath.substring(PROJECT_ROOT.length + 1);
  }
  const lastColon = relative.lastIndexOf(':');
  if (lastColon !== -1) {
    const secondLastColon = relative.lastIndexOf(':', lastColon - 1);
    if (secondLastColon !== -1) {
      return relative.substring(0, lastColon);
    }
  }
  return relative;
}

function writeLog(filepath, level, msg) {
  if (level === 'DEBUG' && !global.DEBUG_MODE) {
    return;
  }

  const stack = new Error().stack;
  const callerLine = stack.split('\n')[3];
  let caller = 'unknown';
  if (callerLine) {
    const pathMatch = callerLine.match(/\(([^)]+)\)/);
    if (pathMatch) {
      caller = getRelativePath(pathMatch[1]);
    } else {
      const directMatch = callerLine.match(/at\s+([^\s(]+:\d+:\d+)/);
      if (directMatch) {
        caller = getRelativePath(directMatch[1]);
      }
    }
  }

  const timestamp = Date.now();
  const line = `${timestamp} [${level}] ${caller} ${msg}\n`;
  const target = _testLogPath || filepath;
  fs.appendFileSync(target, line);

  if (level === 'ERROR') {
    console.error(`[${level}] ${caller} ${msg}`);
  }
}

function createLogger(filename) {
  ensureLogsDir();
  const filepath = path.join(LOGS_DIR, filename);
  return {
    info: (msg) => writeLog(filepath, 'INFO', msg),
    warn: (msg) => writeLog(filepath, 'WARN', msg),
    error: (msg) => writeLog(filepath, 'ERROR', msg),
    debug: (msg) => writeLog(filepath, 'DEBUG', msg),
    write: (level, msg) => writeLog(filepath, level, msg)
  };
}

module.exports = { createLogger, clearLogs, setTestLogPath, resetTestLogPath };