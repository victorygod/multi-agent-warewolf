/**
 * 狼人杀游戏服务器 - 仅 API 路由
 */

// 环境变量配置（必须在 require 其他模块之前设置）
const fs = require('fs');
const path = require('path');

// 从 api_key.conf 加载配置
const configPath = path.join(__dirname, 'api_key.conf');
let config;
try {
  const configContent = fs.readFileSync(configPath, 'utf8');
  config = JSON.parse(configContent);
  process.env.ANTHROPIC_BASE_URL = config.base_url;
  process.env.ANTHROPIC_AUTH_TOKEN = config.auth_token;
  process.env.ANTHROPIC_MODEL = config.model;
} catch (e) {
  console.error('无法读取或解析 api_key.conf 文件，请确保文件存在且格式正确');
  console.error(e.message);
  process.exit(1);
}

// 调试模式（开发时默认开启，生产环境设置 DEBUG_MODE=false 关闭）
process.env.DEBUG_MODE = 'true';

const express = require('express');
const { GameEngine, PHASES } = require('./game/engine');
const { AIController } = require('./ai/controller');
const { ROLES } = require('./game/roles');

const DEBUG_MODE = process.env.DEBUG_MODE === 'true';
console.log(`调试模式: ${DEBUG_MODE}`);

const app = express();
const PORT = 3000;

// 中间件
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 游戏实例和 AI 控制器
let game = new GameEngine();
const aiController = new AIController();

// SSE 客户端
const sseClients = new Map();

function broadcast(event, data) {
  console.log(`[SSE] 广播 ${event} 给 ${sseClients.size} 个客户端`);
  sseClients.forEach((client, clientId) => {
    try {
      // 为每个客户端生成包含其角色信息的状态
      const playerState = game.getState(client.playerId);
      // SSE 标准格式：event: xxx\n xxx\n\n
      const clientMessage = `event: ${event}\ndata: ${JSON.stringify(playerState)}\n\n`;
      client.res.write(clientMessage);
    } catch (e) {
      console.error('[SSE] 广播失败:', e);
    }
  });
}

// ============ API 路由 ============

app.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const clientId = Date.now();
  // 从 URL 参数获取玩家名字，找到对应的玩家 ID
  const playerName = req.query.name;
  const player = game.players.find(p => p.name === playerName && !p.isAI);
  const playerId = player ? player.id : null;

  const clientInfo = { res, playerId };
  sseClients.set(clientId, clientInfo);
  console.log(`[SSE] 新客户端连接: ${clientId}, 玩家: ${playerName || '未知'}, 当前连接数: ${sseClients.size}`);

  const state = game.getState(playerId);
  res.write(`event: state_update\ndata: ${JSON.stringify(state)}\n\n`);

  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 30000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(clientId);
    console.log(`[SSE] 客户端断开: ${clientId}, 当前连接数: ${sseClients.size}`);
  });
});

app.get('/api/state', (req, res) => {
  // 支持通过 URL 参数传递玩家名字
  const playerName = req.query.name;
  const player = game.players.find(p => p.name === playerName && !p.isAI);
  const playerId = player ? player.id : null;
  res.json(game.getState(playerId));
});

app.post('/api/join', (req, res) => {
  try {
    const { playerName, playerId } = req.body;
    const name = playerName || `玩家${game.players.length + 1}`;

    // 检查是否已经存在同名玩家（支持刷新后重新加入）
    const existingPlayer = game.players.find(p => p.name === name && !p.isAI);
    if (existingPlayer) {
      // 返回已存在玩家的状态
      const state = game.getState(existingPlayer.id);
      res.json({ success: true, playerId: existingPlayer.id, playerCount: game.players.length, state, rejoin: true });
      return;
    }

    // 新玩家加入
    const id = playerId || `player_${Date.now()}`;
    const count = game.join(id, name, false);
    const state = game.getState(id);

    // 检查是否人满，满则自动开始
    let gameStarted = false;
    if (game.players.length === game.playerCount && game.phase === 'waiting') {
      try {
        const startState = game.start();
        gameStarted = true;
        console.log(`游戏开始！阶段：${startState.phase}, 玩家数：${startState.players.length}`);
        broadcast('state_update', startState);

        // 开始处理 AI 行动
        setTimeout(() => aiController.processAITurn(game, broadcast), 1000);
      } catch (e) {
        // 游戏已开始或其他错误
      }
    } else {
      broadcast('state_update', game.getState());
    }

    res.json({ success: true, playerId: id, playerCount: count, state, gameStarted });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// 获取调试模式状态
app.get('/api/debug', (req, res) => {
  res.json({ debugMode: DEBUG_MODE });
});

// 一键准备（加入 + 添加指定数量AI + 人满自动开始）
app.post('/api/ready', async (req, res) => {
  try {
    const { playerName, playerCount, aiCount, playerRole } = req.body;
    const name = playerName || `玩家${Date.now() % 1000}`;
    const count = playerCount || 9;
    const ai = aiCount !== undefined ? aiCount : 0;

    // 设置玩家数量
    game.setPlayerCount(count);

    // 检查是否已经存在同名玩家
    const existingPlayer = game.players.find(p => p.name === name && !p.isAI);
    let playerId;
    if (existingPlayer) {
      playerId = existingPlayer.id;
    } else {
      // 新玩家加入
      playerId = `player_${Date.now()}`;
      game.join(playerId, name, false);
    }

    // 添加指定数量的 AI（不补满）
    const currentAiCount = game.players.filter(p => p.isAI).length;
    const needAi = ai - currentAiCount;
    if (needAi > 0) {
      game.addAIPlayers(needAi);
    }

    // 检查是否人满，满则自动开始
    let gameStarted = false;
    let state = game.getState(playerId);

    if (game.players.length === game.playerCount) {
      try {
        // 调试模式下支持指定角色
        state = game.start(DEBUG_MODE ? { playerId, role: playerRole } : null);
        gameStarted = true;
        console.log(`游戏开始！阶段：${state.phase}, 玩家数：${state.players.length}`);
        broadcast('state_update', state);

        // 开始处理 AI 行动
        setTimeout(() => aiController.processAITurn(game, broadcast), 1000);
      } catch (e) {
        // 游戏已开始或其他错误
      }
    } else {
      // 人未满，广播当前状态
      broadcast('state_update', game.getState());
    }

    res.json({ success: true, playerId, state, gameStarted, debugMode: DEBUG_MODE });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/config', (req, res) => {
  try {
    const { playerCount } = req.body;
    game.setPlayerCount(playerCount);
    broadcast('state_update', game.getState());
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/add-ai', (req, res) => {
  try {
    const { count } = req.body;
    const added = game.addAIPlayers(count);

    // 检查是否人满，满则自动开始
    let gameStarted = false;
    let state = game.getState();

    if (game.players.length === game.playerCount && game.phase === 'waiting') {
      try {
        state = game.start();
        gameStarted = true;
        console.log(`游戏开始！阶段：${state.phase}, 玩家数：${state.players.length}`);
        broadcast('state_update', state);

        // 开始处理 AI 行动
        setTimeout(() => aiController.processAITurn(game, broadcast), 1000);
      } catch (e) {
        // 游戏已开始或其他错误
      }
    } else {
      broadcast('state_update', state);
    }

    res.json({ success: true, added, state, gameStarted });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/start', (req, res) => {
  try {
    const state = game.start();
    console.log(`游戏开始！阶段：${state.phase}, 玩家数：${state.players.length}`);
    broadcast('state_update', state);

    // 开始处理 AI 行动
    setTimeout(() => aiController.processAITurn(game, broadcast), 1000);

    res.json({ success: true, state });
  } catch (error) {
    console.error('开始游戏失败:', error);
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/speak', (req, res) => {
  try {
    const { playerId, content } = req.body;
    const state = game.speak(playerId, content);
    broadcast('state_update', game.getState());

    setTimeout(() => aiController.processAITurn(game, broadcast), 500);

    res.json({ success: true, state });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/vote', (req, res) => {
  try {
    const { voterId, targetId } = req.body;
    const state = game.vote(voterId, targetId);
    broadcast('state_update', game.getState());

    setTimeout(() => aiController.processAITurn(game, broadcast), 500);

    res.json({ success: true, state });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/seer-check', (req, res) => {
  try {
    const { seerId, targetId } = req.body;
    const result = game.seerCheck(seerId, targetId);
    // 先广播，再获取状态（避免消息被清空）
    broadcast('state_update', game.getState());
    const state = game.getState(seerId);

    setTimeout(() => aiController.processAITurn(game, broadcast), 500);

    res.json({ success: true, result, state });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/witch-action', (req, res) => {
  try {
    const { witchId, action, targetId } = req.body;
    const state = game.witchAction(witchId, action, targetId);
    broadcast('state_update', game.getState());

    setTimeout(() => aiController.processAITurn(game, broadcast), 500);

    res.json({ success: true, state });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/guard-protect', (req, res) => {
  try {
    const { guardId, targetId } = req.body;
    const state = game.guardProtect(guardId, targetId);
    broadcast('state_update', game.getState());

    setTimeout(() => aiController.processAITurn(game, broadcast), 500);

    res.json({ success: true, state });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// 遗言
app.post('/api/last-words', (req, res) => {
  try {
    const { playerId, content } = req.body;
    const state = game.lastWords(playerId, content);
    broadcast('state_update', game.getState());

    setTimeout(() => aiController.processAITurn(game, broadcast), 500);

    res.json({ success: true, state });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// 猎人开枪
app.post('/api/hunter-shoot', (req, res) => {
  try {
    const { hunterId, targetId } = req.body;
    const state = game.hunterShoot(hunterId, targetId);
    broadcast('state_update', game.getState());

    setTimeout(() => aiController.processAITurn(game, broadcast), 500);

    res.json({ success: true, state });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// 猎人不开枪
app.post('/api/hunter-skip', (req, res) => {
  try {
    const { hunterId } = req.body;
    const state = game.hunterSkip(hunterId);
    broadcast('state_update', game.getState());

    setTimeout(() => aiController.processAITurn(game, broadcast), 500);

    res.json({ success: true, state });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/reset', (req, res) => {
  game = new GameEngine();
  aiController.clear();
  broadcast('state_update', game.getState());
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`狼人杀游戏服务器运行在 http://localhost:${PORT}`);
});