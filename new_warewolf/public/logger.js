/**
 * 前端日志模块
 * 通过 WebSocket 发送日志到后端，写入 frontend.log
 */

// 全局 WebSocket 实例（由 controller.js 设置）
let ws = null;

// 设置 WebSocket 实例
function setWebSocket(websocket) {
  ws = websocket;
}

// 发送日志到后端
function sendLog(level, message) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'frontend_log',
      data: { level, message, time: Date.now() }
    }));
  }
  // 同时输出到 console（开发调试用）
  console.log(`[FRONTEND] ${message}`);
}

// 日志接口
const frontendLogger = {
  info: (msg) => sendLog('INFO', msg),
  warn: (msg) => sendLog('WARN', msg),
  error: (msg) => sendLog('ERROR', msg),
  debug: (msg) => sendLog('DEBUG', msg)
};

// 导出
window.frontendLogger = frontendLogger;
window.setFrontendLoggerWs = setWebSocket;