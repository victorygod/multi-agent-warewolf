/**
 * 狼人杀游戏服务器 - WebSocket 版本
 * 统一双向通信，支持请求-响应模式
 */

const fs = require('fs');
const path = require('path');
const { ServerCore } = require('./server-core');
const { createLogger, clearLogs } = require('./utils/logger');

// Debug 模式：通过命令行参数 --debug 开启
const DEBUG_MODE = process.argv.includes('--debug');
if (DEBUG_MODE) {
  console.log('🔧 Debug 模式已开启');
}

// 从 api_key.conf 加载配置
const configPath = path.join(__dirname, 'api_key.conf');
try {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  process.env.BASE_URL = config.base_url;
  process.env.AUTH_TOKEN = config.auth_token;
  process.env.MODEL = config.model;
} catch (e) {
  console.log('未找到 api_key.conf，AI 将使用随机决策');
}

// 初始化日志（每次启动清空日志）
clearLogs();
const backendLogger = createLogger('backend.log');
const frontendLogger = createLogger('frontend.log');

// 导出日志实例供其他模块使用
global.backendLogger = backendLogger;
global.frontendLogger = frontendLogger;

// 全局 debug 模式（供其他模块使用）
global.DEBUG_MODE = DEBUG_MODE;

// 创建并启动服务器
const server = new ServerCore({
  port: 3000,
  debugMode: DEBUG_MODE,
  backendLogger
});

server.start().catch(console.error);

// 导出供测试使用
module.exports = { ServerCore };
