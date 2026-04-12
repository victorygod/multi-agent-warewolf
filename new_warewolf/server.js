/**
 * 狼人杀游戏服务器 - WebSocket 版本
 * 统一双向通信，支持请求-响应模式
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');

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

const { GameEngine } = require('./engine/main');
const { AIManager } = require('./ai/controller');
const { getRandomProfiles, resetUsedNames } = require('./ai/prompts');
const { createLogger, clearLogs } = require('./utils/logger');

// 初始化日志（每次启动清空日志）
clearLogs();
const backendLogger = createLogger('backend.log');
const agentLogger = createLogger('agent.log');
const frontendLogger = createLogger('frontend.log');

// 导出日志实例供其他模块使用
global.backendLogger = backendLogger;
global.agentLogger = agentLogger;
global.frontendLogger = frontendLogger;

const PORT = 3000;

// 全局 debug 模式（供其他模块使用）
global.DEBUG_MODE = DEBUG_MODE;

// 创建 HTTP 服务器（用于静态文件）
const server = http.createServer((req, res) => {
  // 去掉查询参数
  const urlPath = req.url.split('?')[0];
  // 简单的静态文件服务
  let filePath = path.join(__dirname, 'public', urlPath === '/' ? 'index.html' : urlPath);
  const extname = path.extname(filePath);
  const contentTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json'
  };
  const contentType = contentTypes[extname] || 'text/plain';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    }
  });
});

// 创建 WebSocket 服务器
const wss = new WebSocket.Server({ server });

// 游戏实例
let game = null;
let aiManager = null;

// 客户端连接管理
const clients = new Map(); // ws -> { playerId, name }
const playerClients = new Map(); // playerId -> ws

// ========== 工具函数 ==========

// 发送消息给客户端
function send(ws, type, data = null) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    const msg = data !== null ? { type, data } : { type };
    ws.send(JSON.stringify(msg));
  }
}

// 广播状态给所有客户端
function broadcastState() {
  if (!game) {
    // 游戏未开始，发送等待状态
    clients.forEach((info, ws) => {
      send(ws, 'state', { phase: 'waiting', players: [], playerCount: 9, debugMode: DEBUG_MODE });
    });
    return;
  }
  clients.forEach((info, ws) => {
    const state = game.getState(info.playerId);
    state.debugMode = DEBUG_MODE;
    send(ws, 'state', state);
  });
}

// 获取带有 debug 模式的状态
function getStateWithDebug(playerId) {
  if (game) {
    const state = game.getState(playerId);
    state.debugMode = DEBUG_MODE;
    return state;
  }
  return { phase: 'waiting', players: [], playerCount: 9, debugMode: DEBUG_MODE };
}

// 发送给特定玩家
function sendToPlayer(playerId, type, data = {}) {
  const ws = playerClients.get(playerId);
  if (ws) {
    send(ws, type, data);
  }
}

// ========== 游戏事件监听 ==========

let broadcastPending = false;
let broadcastTimer = null;

function setupGameListeners() {
  // 监听玩家行动请求
  game.on('player:action', ({ playerId, data }) => {
    const player = game.players.find(p => p.id === playerId);
    backendLogger.info(`请求 ${player?.name} 行动: ${data.action}`);

    // 发送最新状态（已包含 pendingAction）
    const state = game.getState(playerId);
    state.debugMode = DEBUG_MODE;
    sendToPlayer(playerId, 'state', state);
  });

  // 监听消息添加（统一通过 message 管理）
  game.message.on('message:added', (msg) => {
    const contentStr = msg.content ? ` | ${msg.content}` : '';
    backendLogger.debug(`新消息: ${msg.type}${contentStr}`);
    // 防抖：100ms 内只广播一次
    if (!broadcastPending) {
      broadcastPending = true;
      clearTimeout(broadcastTimer);
      broadcastTimer = setTimeout(() => {
        broadcastPending = false;
        broadcastState();
      }, 100);
    }
  });

  // 监听投票完成
  game.on('vote:complete', () => {
    broadcastState();
  });
}

// ========== 消息处理 ==========

function handleMessage(ws, msg) {
  const info = clients.get(ws);

  switch (msg.type) {
    case 'join':
      handleJoin(ws, msg);
      break;
    case 'response':
      handleResponse(ws, msg);
      break;
    case 'speak':
      handleSpeak(ws, msg);
      break;
    case 'vote':
      handleVote(ws, msg);
      break;
    case 'sheriff_order':
      handleSheriffOrder(ws, msg);
      break;
    case 'add_ai':
      handleAddAI(ws, msg);
      break;
    case 'reset':
      handleReset(ws, msg);
      break;
    default:
      send(ws, 'error', { message: `未知消息类型: ${msg.type}` });
  }
}

// 加入游戏
function handleJoin(ws, msg) {
  const name = msg.name || `玩家${Date.now() % 1000}`;
  const count = msg.playerCount || 9;
  const debugRole = msg.debugRole; // Debug 模式选择的角色

  // 初始化游戏（只执行一次）
  if (!game) {
    game = new GameEngine();
    game.playerCount = count;
    aiManager = new AIManager(game);
    resetUsedNames();
    game.getAIController = (playerId) => aiManager.get(playerId);
    setupGameListeners();
  }

  // 检查是否已存在
  const existing = game.players.find(p => p.name === name && !p.isAI);
  if (existing) {
    clients.set(ws, { playerId: existing.id, name });
    playerClients.set(existing.id, ws);

    const playerId = existing.id;
    const state = game.getState(playerId);
    state.rejoin = true;
    state.debugMode = DEBUG_MODE;
    send(ws, 'state', state);
    // state 已包含 pendingAction，无需额外处理
    return;
  }

  // 检查房间是否已满
  if (game.players.length >= game.playerCount) {
    send(ws, 'error', { message: '房间已满' });
    return;
  }

  // 添加玩家
  const playerId = game.players.length + 1;
  game.players.push({
    id: playerId,
    name,
    alive: true,
    isAI: false,
    role: null,
    state: {},
    debugRole: debugRole // Debug 模式选择的角色
  });

  clients.set(ws, { playerId, name });
  playerClients.set(playerId, ws);

  broadcastState();
  send(ws, 'state', { ...game.getState(playerId), gameStarted: false, debugMode: DEBUG_MODE });
}

// 响应行动请求
function handleResponse(ws, msg) {
  const info = clients.get(ws);
  if (!info) return;

  const { requestId, ...responseData } = msg;
  backendLogger.debug(`收到响应: playerId=${info.playerId}`);
  const handled = game.handleResponse(info.playerId, requestId, responseData);
  backendLogger.debug(`handleResponse 结果: ${handled}`);

  broadcastState();
}

// 发言
function handleSpeak(ws, msg) {
  const info = clients.get(ws);
  if (!info) return;

  const { content } = msg;
  game.speak(info.playerId, content);
  broadcastState();
}

// 投票
function handleVote(ws, msg) {
  const info = clients.get(ws);
  if (!info) return;

  const { targetId } = msg;
  game.vote(info.playerId, targetId);
  broadcastState();
}

// 警长指定发言起始位置
function handleSheriffOrder(ws, msg) {
  const info = clients.get(ws);
  if (!info) return;

  const { startPlayerId } = msg;

  if (game.sheriff !== info.playerId) {
    send(ws, 'error', { message: '只有警长可以指定发言顺序' });
    return;
  }

  game.setSheriffOrder(startPlayerId);
  broadcastState();
}

// 添加 AI
function handleAddAI(ws, msg) {
  if (!game) {
    game = new GameEngine();
    game.playerCount = 9;
    aiManager = new AIManager(game);
    resetUsedNames();
    game.getAIController = (playerId) => aiManager.get(playerId);
    setupGameListeners();
  }

  if (game.players.length >= game.playerCount) {
    send(ws, 'error', { message: '房间已满' });
    return;
  }

  const profiles = getRandomProfiles(1);
  const aiPlayerId = game.players.length + 1;
  game.players.push({
    id: aiPlayerId,
    name: profiles[0].name,
    alive: true,
    isAI: true,
    role: null,
    state: {}
  });
  // 根据配置选择 agent 类型
  const agentType = (process.env.BASE_URL && process.env.AUTH_TOKEN) ? 'llm' : 'random';
  aiManager.createAI(aiPlayerId, { agentType });

  // 人满开始游戏
  let gameStarted = false;
  if (game.players.length === game.playerCount) {
    game.assignRoles();
    game.start();
    gameStarted = true;
    backendLogger.info(`游戏开始！玩家数：${game.players.length}`);
  }

  broadcastState();
}

// 重置游戏
function handleReset(ws, msg) {
  game = null;
  aiManager = null;
  resetUsedNames();
  broadcastState();
  send(ws, 'state', { data: { phase: 'waiting', players: [], playerCount: 9 } });
}

/**
 * 构建完整的行动数据（委托给 engine）
 */
function buildActionData(playerId, actionType, existingData, state) {
  // 提取 extraData 中的配置项
  const extraData = {
    requestId: existingData?.requestId,
    werewolfTarget: existingData?.werewolfTarget || state.nightActions?.werewolfTarget,
    healAvailable: existingData?.healAvailable ?? state.self?.witchHeal > 0,
    poisonAvailable: existingData?.poisonAvailable ?? state.self?.witchPoison > 0,
    canSelfHeal: existingData?.canSelfHeal ?? state.dayCount > 1
  };

  // 委托给 engine 的配置化方法
  return game.buildActionData(playerId, actionType, extraData);
}

// ========== WebSocket 连接管理 ==========

wss.on('connection', (ws) => {
  backendLogger.info('新连接');

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);

      // 处理前端日志
      if (msg.type === 'frontend_log') {
        frontendLogger.write(msg.data.level, msg.data.message);
        return;
      }

      handleMessage(ws, msg);
    } catch (e) {
      console.error('[WS] 消息解析错误:', e);
    }
  });

  ws.on('close', () => {
    const info = clients.get(ws);
    if (info) {
      backendLogger.info(`${info.name} 断开连接`);
      // 不取消请求，等待玩家重连
      playerClients.delete(info.playerId);
      clients.delete(ws);
    }
  });

  // 发送初始状态
  if (game) {
    const state = game.getState();
    state.debugMode = DEBUG_MODE;
    send(ws, 'state', state);
  } else {
    send(ws, 'state', { phase: 'waiting', players: [], playerCount: 9, debugMode: DEBUG_MODE });
  }
});

// 启动服务器
server.listen(PORT, () => {
  backendLogger.info(`服务器启动: http://localhost:${PORT}`);
});