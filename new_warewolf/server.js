/**
 * 狼人杀游戏服务器 - 简单的 API 入口
 * 只处理：玩家加入、玩家行动、SSE 推送
 * 业务流程都在 phase.js 里
 */

const fs = require('fs');
const path = require('path');

// 从 api_key.conf 加载配置
const configPath = path.join(__dirname, 'api_key.conf');
try {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  process.env.ANTHROPIC_BASE_URL = config.base_url;
  process.env.ANTHROPIC_AUTH_TOKEN = config.auth_token;
  process.env.ANTHROPIC_MODEL = config.model;
} catch (e) {
  console.log('未找到 api_key.conf，AI 将使用随机决策');
}

const express = require('express');
const { GameEngine } = require('./engine/main');
const { AIManager } = require('./ai/controller');
const { getRandomProfiles, resetUsedNames } = require('./ai/profiles');

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 游戏实例
let game = null;
let aiManager = null;

// SSE 客户端
const sseClients = new Map();

// 广播给所有客户端
function broadcast(event, data = null) {
  sseClients.forEach((client) => {
    const state = data || game.getState(client.playerId);
    client.res.write(`event: ${event}\ndata: ${JSON.stringify(state)}\n\n`);
  });
}

// 推送给指定玩家
function notifyPlayer(playerId, data) {
  sseClients.forEach((client) => {
    if (client.playerId === playerId) {
      client.res.write(`event: player_action\ndata: ${JSON.stringify(data)}\n\n`);
    }
  });
}

// ========== SSE 连接 ==========
app.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const clientId = Date.now();
  const playerName = req.query.name;
  const player = game?.players.find(p => p.name === playerName && !p.isAI);

  sseClients.set(clientId, { res, playerId: player?.id });

  if (game) {
    res.write(`event: state_update\ndata: ${JSON.stringify(game.getState(player?.id))}\n\n`);
  }

  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 30000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(clientId);
  });
});

// ========== API 接口 ==========

// 获取状态
app.get('/api/state', (req, res) => {
  if (!game) {
    return res.json({ phase: 'waiting', players: [], playerCount: 9 });
  }
  const playerName = req.query.name;
  const player = game.players.find(p => p.name === playerName && !p.isAI);
  res.json(game.getState(player?.id));
});

// 准备（加入游戏）
app.post('/api/ready', (req, res) => {
  const { playerName, playerCount } = req.body;
  const name = playerName || `玩家${Date.now() % 1000}`;
  const count = playerCount || 9;

  // 初始化游戏（只执行一次）
  if (!game) {
    game = new GameEngine();
    game.playerCount = count;
    aiManager = new AIManager(game);
    resetUsedNames();

    // 绑定 AI controller 获取方法
    game.getAIController = (playerId) => aiManager.get(playerId);

    // 监听玩家行动，推送消息
    game.on('player:action', ({ playerId, playerName, data }) => {
      console.log(`[Game] 推送 ${playerName}: ${data.type}`);
      notifyPlayer(playerId, data);
    });

    // 监听投票完成，广播状态
    game.on('vote:complete', () => {
      broadcast('state_update');
    });
  }

  // 检查是否已存在
  const existing = game.players.find(p => p.name === name && !p.isAI);
  if (existing) {
    return res.json({
      success: true,
      playerId: existing.id,
      state: game.getState(existing.id),
      rejoin: true
    });
  }

  // 检查房间是否已满
  if (game.players.length >= game.playerCount) {
    return res.status(400).json({ error: '房间已满' });
  }

  // 添加玩家
  const playerId = game.players.length + 1;
  game.players.push({
    id: playerId,
    name,
    alive: true,
    isAI: false,
    role: null,
    state: {}
  });

  broadcast('state_update');

  res.json({
    success: true,
    playerId,
    state: game.getState(playerId),
    gameStarted: false
  });
});

// 添加 AI
app.post('/api/add-ai', (req, res) => {
  if (!game) {
    game = new GameEngine();
    game.playerCount = 9;
    aiManager = new AIManager(game);
    resetUsedNames();
    game.getAIController = (playerId) => aiManager.get(playerId);
  }

  if (game.players.length >= game.playerCount) {
    return res.status(400).json({ error: '房间已满' });
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
  aiManager.createAI(aiPlayerId);

  // 人满开始游戏
  let gameStarted = false;
  if (game.players.length === game.playerCount) {
    game.assignRoles();
    game.start();  // phase.js 会自动执行
    gameStarted = true;
    console.log(`游戏开始！玩家数：${game.players.length}`);
  }

  broadcast('state_update');
  res.json({ success: true, state: game.getState(), gameStarted });
});

// 发言
app.post('/api/speak', (req, res) => {
  const { playerId, content } = req.body;
  game.speak(playerId, content);
  broadcast('state_update');
  res.json({ success: true, state: game.getState(playerId) });
});

// 投票
app.post('/api/vote', (req, res) => {
  const { voterId, targetId } = req.body;
  game.vote(voterId, targetId);
  broadcast('state_update');
  res.json({ success: true, state: game.getState() });
});

// 使用技能
app.post('/api/skill', (req, res) => {
  const { playerId, targetId, action } = req.body;
  const phase = game.phaseManager?.getCurrentPhase()?.id;
  game.useSkill(playerId, phase, targetId, action);
  broadcast('state_update');
  res.json({ success: true, state: game.getState(playerId) });
});

// 重置
app.post('/api/reset', (req, res) => {
  game = null;
  aiManager = null;
  resetUsedNames();
  broadcast('state_update');
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`狼人杀游戏服务器运行在 http://localhost:${PORT}`);
});