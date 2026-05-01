/**
 * ServerCore - 狼人杀游戏服务器核心
 * 纯业务逻辑，零测试代码污染
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const express = require('express');

const { GameEngine } = require('./engine/main');
const { AIManager } = require('./ai/controller');
const { getRandomProfiles, resetUsedNames } = require('./ai/agent/prompt');
const { createLogger, clearLogs } = require('./utils/logger');
const { getPlayerDisplay } = require('./engine/utils');
const { BOARD_PRESETS } = require('./engine/config');

class ServerCore {
  constructor(options = {}) {
    this.port = options.port || 3000;
    this.debugMode = options.debugMode || false;

    // 游戏实例
    this.game = null;
    this.aiManager = null;
    this.currentPresetId = null;

    // 客户端连接管理
    this.clients = new Map(); // ws -> { playerId, name }
    this.playerClients = new Map(); // playerId -> ws

    // 广播防抖
    this.broadcastPending = false;
    this.broadcastTimer = null;

    // HTTP 和 WebSocket 服务器（由外部注入或创建）
    this.server = null;
    this.wss = null;
    this.app = null;

    // 日志
    this.backendLogger = options.backendLogger || console;
  }

  // ========== 生命周期 ==========

  async start() {
    this._createHTTPServer();
    this._createWebSocketServer();
    this._setupRoutes();
    this._setupWebSocketHandlers();

    return new Promise((resolve) => {
      this.server.listen(this.port, () => {
        this.backendLogger.info(`服务器启动: http://localhost:${this.port}`);
        resolve();
      });
    });
  }

  stop() {
    if (this.wss) {
      this.wss.clients.forEach(client => {
        try { client.terminate(); } catch (_) {}
      });
      this.wss.close();
    }
    if (this.server) {
      this.server.closeAllConnections?.();
      this.server.close();
    }
  }

  reset() {
    this.game = null;
    this.aiManager = null;
    this.currentPresetId = null;
    resetUsedNames();
    this.broadcastState();
  }

  // ========== 创建服务器 ==========

  _createHTTPServer() {
    this.app = express();
    this.server = http.createServer(this.app);
  }

  _createWebSocketServer() {
    this.wss = new WebSocket.Server({ server: this.server });
  }

  // ========== HTTP 路由 ==========

  _setupRoutes() {
    this.app.use(express.static('public'));

    this.app.get('/api/presets', (req, res) => {
      res.json({
        debugMode: this.debugMode,
        presets: BOARD_PRESETS,
        currentPresetId: this.currentPresetId
      });
    });
  }

  // ========== WebSocket 处理 ==========

  _setupWebSocketHandlers() {
    this.wss.on('connection', (ws) => {
      this.backendLogger.info('新连接');

      ws.on('message', (data) => this._handleMessage(ws, data));

      ws.on('close', () => this._handleDisconnect(ws));

      // 发送初始状态
      this._sendInitialState(ws);
    });
  }

  _handleMessage(ws, data) {
    try {
      const msg = JSON.parse(data);

      // 处理前端日志
      if (msg.type === 'frontend_log') {
        if (global.frontendLogger && msg.data) {
          global.frontendLogger.write(msg.data.level || 'INFO', msg.data.message || '');
        }
        return;
      }

      this.handleMessage(ws, msg);
    } catch (e) {
      this.backendLogger.error('[WS] 消息解析错误:', e);
    }
  }

  handleMessage(ws, msg) {
    switch (msg.type) {
      case 'join':
        this.handleJoin(ws, msg);
        break;
      case 'response':
        this.handleResponse(ws, msg);
        break;
      case 'speak':
        this.handleSpeak(ws, msg);
        break;
      case 'vote':
        this.handleVote(ws, msg);
        break;
      case 'sheriff_order':
        this.handleSheriffOrder(ws, msg);
        break;
      case 'add_ai':
        this.handleAddAI(ws, msg);
        break;
      case 'reset':
        this.handleReset(ws, msg);
        break;
      default:
        this.send(ws, 'error', { message: `未知消息类型: ${msg.type}` });
    }
  }

  // ========== 玩家管理 ==========

  handleJoin(ws, msg) {
    const name = msg.name || `玩家${Date.now() % 1000}`;
    const debugRole = msg.debugRole;

    // 初始化游戏
    if (!this.game) {
      this.currentPresetId = msg.presetId || '9-standard';
      this.game = new GameEngine({ presetId: this.currentPresetId });
      this.aiManager = this.createAIManager(this.game);
      this.game.aiManager = this.aiManager;
      resetUsedNames();
      this.game.getAIController = (playerId) => this.aiManager.get(playerId);
      this.setupGameListeners();
    }

    // 检查是否已存在（重连）
    const existing = this.game.players.find(p => p.name === name && !p.isAI);
    if (existing) {
      this.clients.set(ws, { playerId: existing.id, name });
      this.playerClients.set(existing.id, ws);

      const state = this.game.getState(existing.id);
      state.rejoin = true;
      this.send(ws, 'state', state);
      return;
    }

    // 检查房间是否已满
    if (this.game.players.length >= this.game.playerCount) {
      this.send(ws, 'error', { message: '房间已满' });
      return;
    }

    // 添加玩家
    const playerId = this.game.players.length + 1;
    this.game.players.push({
      id: playerId,
      name,
      alive: true,
      isAI: false,
      role: null,
      state: {},
      debugRole
    });

    this.clients.set(ws, { playerId, name });
    this.playerClients.set(playerId, ws);

    this.send(ws, 'player_assigned', { playerId });

    const state = this.game.getState(playerId);
    state.presetLocked = this.currentPresetId !== null;
    state.presetId = this.currentPresetId;
    state.gameStarted = false;
    this.send(ws, 'state', state);
  }

  handleAddAI(ws, msg) {
    // 初始化游戏
    if (!this.game) {
      this.currentPresetId = msg.presetId || '9-standard';
      this.game = new GameEngine({ presetId: this.currentPresetId });
      this.aiManager = this.createAIManager(this.game);
      this.game.aiManager = this.aiManager;
      resetUsedNames();
      this.game.getAIController = (playerId) => this.aiManager.get(playerId);
      this.setupGameListeners();
    }

    if (this.game.players.length >= this.game.playerCount) {
      this.send(ws, 'error', { message: '房间已满' });
      return;
    }

    const profiles = getRandomProfiles(1);
    const aiPlayerId = this.game.players.length + 1;
    this.game.players.push({
      id: aiPlayerId,
      name: profiles[0].name,
      background: profiles[0].background,
      thinking: profiles[0].thinking,
      speaking: profiles[0].speaking,
      alive: true,
      isAI: true,
      role: null,
      state: {}
    });

    // 使用钩子方法创建 AI
    this.createAI(this.aiManager, aiPlayerId, {
      agentType: msg.agentType,
      mockOptions: msg.mockOptions
    });

    // 人满开始游戏
    if (this.shouldAutoStart() && this.game.players.length === this.game.playerCount) {
      this.startGame();
    }

    this.broadcastState();
  }

  handleResponse(ws, msg) {
    const info = this.clients.get(ws);
    if (!info || !this.game) return;

    const { requestId, ...responseData } = msg;
    this.game.handleResponse(info.playerId, requestId, responseData);
    this.broadcastState();
  }

  handleSpeak(ws, msg) {
    const info = this.clients.get(ws);
    if (!info || !this.game) return;

    this.game.speak(info.playerId, msg.content);
    this.broadcastState();
  }

  handleVote(ws, msg) {
    const info = this.clients.get(ws);
    if (!info || !this.game) return;

    this.game.vote(info.playerId, msg.targetId);
    this.broadcastState();
  }

  handleSheriffOrder(ws, msg) {
    const info = this.clients.get(ws);
    if (!info || !this.game) return;

    if (this.game.sheriff !== info.playerId) {
      this.send(ws, 'error', { message: '只有警长可以指定发言顺序' });
      return;
    }

    this.game.setSheriffOrder(msg.startPlayerId);
    this.broadcastState();
  }

  handleReset(ws, msg) {
    this.reset();
  }

  _handleDisconnect(ws) {
    const info = this.clients.get(ws);
    if (info) {
      this.backendLogger.info(`${info.name} 断开连接`);
      this.playerClients.delete(info.playerId);
      this.clients.delete(ws);
    }
  }

  // ========== 游戏控制 ==========

  startGame() {
    if (!this.game || this.game.players.length < 1) return;

    this.onBeforeAssignRoles();
    this.game.assignRoles();
    this.onAfterAssignRoles();

    // 广播角色分配
    this.game.players.forEach(p => {
      const client = this.playerClients.get(p.id);
      if (client) {
        this.send(client, 'role_assigned', { role: p.role });
      }
    });

    this.broadcast('game_started', { playerCount: this.game.players.length });
    this.game.start().catch(err => this.backendLogger.error(err));
  }

  // ========== 消息广播 ==========

  broadcast(type, data) {
    const msg = JSON.stringify({ type, data, timestamp: Date.now() });
    this.wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    });
  }

  broadcastState() {
    if (!this.game) {
      const boardRoles = this.getBoardRoles();
      this.clients.forEach((info, ws) => {
        this.send(ws, 'state', {
          phase: 'waiting',
          players: [],
          presetId: this.currentPresetId,
          presetLocked: this.currentPresetId !== null,
          boardRoles
        });
      });
      return;
    }

    this.clients.forEach((info, ws) => {
      const state = this.game.getState(info.playerId);
      state.presetLocked = this.currentPresetId !== null;
      state.presetId = this.currentPresetId;
      this.send(ws, 'state', state);
    });
  }

  send(ws, type, data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type, data, timestamp: Date.now() }));
    }
  }

  sendToPlayer(playerId, type, data) {
    const ws = this.playerClients.get(playerId);
    if (ws) {
      this.send(ws, type, data);
    }
  }

  _sendInitialState(ws) {
    if (this.game) {
      const state = this.game.getState();
      state.presetLocked = this.currentPresetId !== null;
      state.presetId = this.currentPresetId;
      this.send(ws, 'state', state);
    } else {
      const boardRoles = this.getBoardRoles();
      this.send(ws, 'state', {
        phase: 'waiting',
        players: [],
        presetId: this.currentPresetId,
        presetLocked: this.currentPresetId !== null,
        boardRoles
      });
    }
  }

  // ========== 工具方法 ==========

  getBoardRoles() {
    if (!this.currentPresetId) return null;
    const preset = BOARD_PRESETS[this.currentPresetId];
    return preset ? preset.roles : null;
  }

  // ========== 游戏事件监听 ==========

  setupGameListeners() {
    if (!this.game) return;

    this.game.on('player:action', ({ playerId, data }) => {
      const ws = this.playerClients.get(playerId);
      if (ws) {
        const state = this.game.getState(playerId);
        this.send(ws, 'state', state);
      }
    });

    this.game.message.on('message:added', (msg) => {
      if (this.game.aiManager) {
        this.game.aiManager.onMessageAdded(msg);
      }

      // 防抖广播
      if (!this.broadcastPending) {
        this.broadcastPending = true;
        clearTimeout(this.broadcastTimer);
        this.broadcastTimer = setTimeout(() => {
          this.broadcastPending = false;
          this.broadcastState();
        }, 100);
      }
    });
  }

  // ========== 可覆盖钩子 ==========

  createAIManager(game) {
    return new AIManager(game);
  }

  createAI(aiManager, playerId, options = {}) {
    const agentType = options.agentType || this.getAgentType();
    return aiManager.createAI(playerId, { agentType, mockOptions: options.mockOptions });
  }

  getAgentType() {
    return (process.env.BASE_URL && process.env.AUTH_TOKEN) ? 'llm' : 'random';
  }

  shouldAutoStart() {
    return true;
  }

  onBeforeAssignRoles() {
    // 空钩子，供 wrapper 覆盖
  }

  onAfterAssignRoles() {
    this._updateIdMappings();
  }

  _updateIdMappings() {
    if (!this.game) return;

    // 更新人类玩家映射
    // 重新构建 playerClients 映射，避免循环更新问题
    const newPlayerClients = new Map();
    this.clients.forEach((info, cws) => {
      const player = this.game.players.find(p => p.name === info.name && !p.isAI);
      if (player) {
        // 更新 info.playerId 为新的 ID
        info.playerId = player.id;
        newPlayerClients.set(player.id, cws);
      }
    });
    this.playerClients = newPlayerClients;

    // 更新 AI controller 映射
    const newControllers = new Map();
    for (const player of this.game.players) {
      if (player.isAI) {
        for (const [oldId, controller] of this.aiManager.controllers) {
          if (controller.playerName === player.name) {
            controller.playerId = player.id;
            if (controller.agent) {
              controller.agent.playerId = player.id;
            }
            newControllers.set(player.id, controller);
            break;
          }
        }
      }
    }
    this.aiManager.controllers = newControllers;

    // 更新 AI system 消息
    for (const player of this.game.players) {
      if (player.isAI) {
        const controller = this.aiManager.get(player.id);
        if (controller) {
          controller.updateSystemMessage();
        }
      }
    }
  }
}

module.exports = { ServerCore };
