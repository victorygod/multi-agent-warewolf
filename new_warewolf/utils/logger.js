/**
 * 日志模块
 * 每次服务器启动时清空日志目录
 */

const fs = require('fs');
const path = require('path');

// 项目根目录
const PROJECT_ROOT = path.resolve(__dirname, '..');

// logs 目录路径
const LOGS_DIR = path.join(PROJECT_ROOT, 'logs');

// 确保 logs 目录存在
function ensureLogsDir() {
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }
}

// 清空日志目录
function clearLogs() {
  ensureLogsDir();
  fs.readdirSync(LOGS_DIR).forEach(file => {
    if (file.endsWith('.log')) {
      fs.unlinkSync(path.join(LOGS_DIR, file));
    }
  });
}

// 获取相对路径
function getRelativePath(fullPath) {
  // fullPath 格式: "/Users/wolf/Desktop/wolf/new_warewolf/server.js:439:17"
  // 目标: "server.js:439"

  if (!fullPath) return 'unknown';

  // 转换为相对路径
  let relative = fullPath;
  if (fullPath.startsWith(PROJECT_ROOT)) {
    relative = fullPath.substring(PROJECT_ROOT.length + 1); // +1 去掉开头的 /
  }

  // 格式是 "server.js:439:17"，去掉最后的列号，只保留文件名:行号
  const lastColon = relative.lastIndexOf(':');
  if (lastColon !== -1) {
    const secondLastColon = relative.lastIndexOf(':', lastColon - 1);
    if (secondLastColon !== -1) {
      // 有两个冒号，去掉最后一个（列号）
      return relative.substring(0, lastColon);
    }
  }

  return relative;
}

// 写入日志（带文件路径和行号）
function writeLog(filepath, level, msg) {
  // 获取调用者的文件路径和行号
  const stack = new Error().stack;
  const callerLine = stack.split('\n')[3]; // 第0行是Error, 1是writeLog, 2是caller, 3是实际调用者

  let caller = 'unknown';
  if (callerLine) {
    // 尝试提取括号内的路径，格式: "at FuncName (/path/to/file.js:line:col)"
    const pathMatch = callerLine.match(/\(([^)]+)\)/);
    if (pathMatch) {
      caller = getRelativePath(pathMatch[1]);
    } else {
      // 尝试无括号格式: "at /path/to/file.js:line:col"
      const directMatch = callerLine.match(/at\s+([^\s(]+:\d+:\d+)/);
      if (directMatch) {
        caller = getRelativePath(directMatch[1]);
      }
    }
  }

  const timestamp = Date.now();
  const line = `${timestamp} [${level}] ${caller} ${msg}\n`;

  fs.appendFileSync(filepath, line);

  // ERROR 同时输出到 console
  if (level === 'ERROR') {
    console.error(`[${level}] ${caller} ${msg}`);
  }
}

// 创建日志实例
function createLogger(filename) {
  ensureLogsDir();
  const filepath = path.join(LOGS_DIR, filename);
  return {
    info: (msg) => writeLog(filepath, 'INFO', msg),
    warn: (msg) => writeLog(filepath, 'WARN', msg),
    error: (msg) => writeLog(filepath, 'ERROR', msg),
    debug: (msg) => writeLog(filepath, 'DEBUG', msg),
    // 供外部调用（如前端日志）
    write: (level, msg) => writeLog(filepath, level, msg)
  };
}

module.exports = { createLogger, clearLogs };