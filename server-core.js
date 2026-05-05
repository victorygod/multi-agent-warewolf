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
const { getRandomProfiles, resetUsedNames, releaseAIName } = require('./ai/agent/prompt');
const { createLogger, clearLogs } = require('./utils/logger');
const { getPlayerDisplay } = require('./engine/utils');
const { BOARD_PRESETS, getEffectiveRules } = require('./engine/config');

class ServerCore {
  constructor(options = {}) {
    this.port = options.port || 3000;
    this.debugMode = options.debugMode || false;

    // 游戏实例
    this.game = null;
    this.aiManager = null;
    this.currentPresetId = null;

    // 客户端连接管理
    this.clients = new Map(); // ws -> { playerId, name, isSpectator, spectatorId }
    this.playerClients = new Map(); // playerId -> ws

    // 观战者
    this.spectators = []; // { id, name, view, ws }
    this._nextSpectatorId = 1;

    // 广播防抖
    this.broadcastPending = false;
    this.broadcastTimer = null;

    // 聊天室
    this.chatMessages = [];
    this.chatMessageId = 0;
    this._aiChatQueue = [];
    this._aiChatProcessing = false;

    // 统一消息流
    this.displayMessages = [];
    this.displayMessageId = 0;
    this._gameOverDisplayId = 0;

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
    if (this.game?.phaseManager) {
      this.game.phaseManager.stop();
    }
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
    this.app.use('/profiles', express.static('ai/profiles'));

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

  async _handleMessage(ws, data) {
    let msg;
    try {
      msg = JSON.parse(data);

      // 处理前端日志
      if (msg.type === 'frontend_log') {
        if (global.frontendLogger && msg.data) {
          global.frontendLogger.write(msg.data.level || 'INFO', msg.data.message || '');
        }
        return;
      }

      await this.handleMessage(ws, msg);
    } catch (e) {
      this.backendLogger.error(`[WS] 消息处理错误 (type=${msg?.type}): ${e.message}`);
      console.error(`[WS-DEBUG] type=${msg?.type} stack:`, e.stack);
      console.error(`[WS-DEBUG] msg data:`, JSON.stringify(msg).substring(0, 200));
    }
  }

  async handleMessage(ws, msg) {
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
      case 'remove_ai':
        this.handleRemoveAI(ws, msg);
        break;
      case 'reset':
        await this.handleReset(ws, msg);
        break;
      case 'ready':
        this.handleReady(ws, msg);
        break;
      case 'unready':
        this.handleUnready(ws, msg);
        break;
      case 'change_preset':
        this.handleChangePreset(ws, msg);
        break;
      case 'change_name':
        this.handleChangeName(ws, msg);
        break;
      case 'change_emoji':
        this.handleChangeEmoji(ws, msg);
        break;
      case 'change_debug_role':
        this.handleChangeDebugRole(ws, msg);
        break;
            case 'spectate':
        this.handleSpectate(ws, msg);
        break;
      case 'switch_view':
        this.handleSwitchView(ws, msg);
        break;
      case 'switch_role':
        this.handleSwitchRole(ws, msg);
        break;
      case 'chat':
        this.handleChat(ws, msg);
        break;
      case 'start_game':
        this.handleStartGame(ws, msg);
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

    // 重连：先查 players，再查 spectators
    const existingPlayer = this.game.players.find(p => p.name === name && !p.isAI);
    if (existingPlayer) {
      this.backendLogger.info(`[handleJoin] ${name} 重连为玩家 (id=${existingPlayer.id})`);
      this.clients.set(ws, { playerId: existingPlayer.id, name, isSpectator: false });
      this.playerClients.set(existingPlayer.id, ws);
      const state = this.game.getState(existingPlayer.id);
      state.messages = this._getDisplayMessagesForPlayer(existingPlayer.id);
      state.rejoin = true;
      state.presetLocked = this.currentPresetId !== null;
      state.presetId = this.currentPresetId;
      state.debugMode = this.debugMode;
      state.spectators = this.spectators.map(s => ({ id: s.id, name: s.name, view: s.view }));
      this.send(ws, 'state', state);
      this.broadcastState();
      return;
    }

    const existingSpectator = this.spectators.find(s => s.name === name);
    if (existingSpectator) {
      this.backendLogger.info(`[handleJoin] ${name} 重连为观战者 (id=${existingSpectator.id})`);
      existingSpectator.ws = ws;
      this.clients.set(ws, { playerId: null, name, isSpectator: true, spectatorId: existingSpectator.id });
      const state = this._getStateForSpectator(existingSpectator);
      state.presetLocked = this.currentPresetId !== null;
      state.presetId = this.currentPresetId;
      this.send(ws, 'state', state);
      this.broadcastState();
      return;
    }

    // 游戏已开始 → 新连接自动进入观战席
    if (this.game.phaseManager && this.game.phaseManager.running) {
      const spectatorId = this._nextSpectatorId++;
      const spectator = { id: spectatorId, name, view: 'god', ws };
      this.spectators.push(spectator);
      this.clients.set(ws, { playerId: null, name, isSpectator: true, spectatorId });
      this.send(ws, 'spectator_assigned', { spectatorId, name });
      const state = this._getStateForSpectator(spectator);
      state.presetLocked = this.currentPresetId !== null;
      state.presetId = this.currentPresetId;
      this.send(ws, 'state', state);
      this.broadcastState();
      return;
    }

    // 房间已满 → 进入观战席
    if (this.game.players.length >= this.game.playerCount) {
      const spectatorId = this._nextSpectatorId++;
      const spectator = { id: spectatorId, name, view: 'god', ws };
      this.spectators.push(spectator);
      this.clients.set(ws, { playerId: null, name, isSpectator: true, spectatorId });
      this.send(ws, 'spectator_assigned', { spectatorId, name });
      const state = this._getStateForSpectator(spectator);
      state.presetLocked = this.currentPresetId !== null;
      state.presetId = this.currentPresetId;
      this.send(ws, 'state', state);
      this.broadcastState();
      return;
    }

    // 添加玩家
    const playerId = this._nextPlayerId();
    this.game.players.push({
      id: playerId,
      name,
      emoji: msg.emoji || '🎭',
      alive: true,
      isAI: false,
      ready: false,
      role: null,
      state: {},
      debugRole
    });

    this.clients.set(ws, { playerId, name, isSpectator: false });
    this.playerClients.set(playerId, ws);

    this.send(ws, 'player_assigned', { playerId });

    const state = this.game.getState(playerId);
    state.messages = this._getDisplayMessagesForPlayer(playerId);
    state.presetLocked = this.currentPresetId !== null;
    state.presetId = this.currentPresetId;
    state.debugMode = this.debugMode;
    state.gameStarted = false;
    state.spectators = this.spectators.map(s => ({ id: s.id, name: s.name, view: s.view }));
    this.send(ws, 'state', state);
    this.broadcastState();
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
    const aiPlayerId = this._nextPlayerId();
    this.game.players.push({
      id: aiPlayerId,
      name: profiles[0].name,
      emoji: '🎭',
      profileName: profiles[0].profileName,
      profile: profiles[0].profile,
      background: profiles[0].background,
      thinking: profiles[0].thinking,
      speaking: profiles[0].speaking,
      alive: true,
      isAI: true,
      ready: true,
      role: null,
      state: {}
    });

    this.createAI(this.aiManager, aiPlayerId, {
      agentType: msg.agentType,
      mockOptions: msg.mockOptions
    });

    // 检查是否所有人已准备
    this._checkAndStartGame();
    this.broadcastState();
  }

  handleRemoveAI(ws, msg) {
    if (!this.game) return;
    if (this.game.phaseManager && this.game.phaseManager.running) return;

    const playerId = msg.playerId;
    const aiPlayer = this.game.players.find(p => p.id === playerId && p.isAI);
    if (!aiPlayer) {
      this.send(ws, 'error', { message: '找不到该AI玩家' });
      return;
    }

    this.game.players = this.game.players.filter(p => p.id !== playerId);
    if (this.aiManager) {
      const controller = this.aiManager.controllers.get(playerId);
      if (controller) controller.destroy();
      this.aiManager.controllers.delete(playerId);
    }
    releaseAIName(aiPlayer.name);
    this._updateIdMappings();
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

  handleChat(ws, msg) {
    const info = this.clients.get(ws);
    if (!info) return;

    // playing 阶段不处理聊天消息
    if (this.game && this.game.phaseManager && this.game.phaseManager.running) return;

    const content = (msg.content || '').trim();
    if (!content) return;

    // 确定发送者信息
    let playerId = null;
    let playerName = info.name;
    let isAI = false;

    if (info.isSpectator) {
      // 观战者也能发聊天
      playerId = `spectator_${info.spectatorId}`;
      playerName = info.name;
    } else if (info.playerId != null) {
      const player = this.game ? this.game.players.find(p => p.id === info.playerId) : null;
      playerId = info.playerId;
      playerName = player ? player.name : info.name;
      isAI = player ? player.isAI : false;
    }

    const chatMsg = {
      id: ++this.chatMessageId,
      type: 'chat',
      playerId,
      playerName,
      content,
      isAI,
      timestamp: Date.now(),
      event: (!this.game || !this.game.winner) ? 'waiting' : 'game_over'
    };

    this.chatMessages.push(chatMsg);
    this.displayMessages.push({ ...chatMsg, source: 'chat', displayId: ++this.displayMessageId });
    this.broadcastState();

    // 触发 AI @提及
    this._handleChatMentions(chatMsg);
  }

  handleStartGame(ws, msg) {
    if (!this.game) return;
    if (this.game.phaseManager && this.game.phaseManager.running) return;

    this.startGame();
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

  async handleReset(ws, msg) {
    if (!this.game) return;

    // 判断是否为游戏结束后的返回房间：phaseManager 曾存在（游戏进行过）
    const wasPlaying = this.game.phaseManager !== null;

    // 游戏结束后返回房间：AI 保留且自动准备，人类重置为未准备，观战者保留
    if (wasPlaying) {
      // 停止游戏
      if (this.game.phaseManager) {
        this.game.phaseManager.running = false;
      }

      // 保留 AI 玩家，重置人类玩家
      const aiPlayers = this.game.players.filter(p => p.isAI);
      const humanPlayers = this.game.players.filter(p => !p.isAI);

      // 先压缩（此时 role 仍在，压缩信息完整）
      if (this.aiManager) {
        await this.aiManager.reassignToGame(this.game);
      }

      // 重置 AI 玩家状态
      aiPlayers.forEach(p => {
        p.alive = true;
        p.role = null;
        p.state = {};
        p.ready = true;
        p.deathReason = undefined;
        p.revealed = undefined;
      });

      // 重置人类玩家状态
      humanPlayers.forEach(p => {
        p.alive = true;
        p.role = null;
        p.state = {};
        p.ready = false;
        p.deathReason = undefined;
        p.revealed = undefined;
      });

      // 重置游戏状态
      this.game.winner = null;
      this.game.gameOverInfo = null;
      this.game.round = 1;
      this.game.sheriff = null;
      this.game.couples = null;
      this.game.werewolfTarget = null;
      this.game.guardTarget = null;
      this.game.healTarget = null;
      this.game.poisonTarget = null;
      this.game.votes = {};
      this.game.deathQueue = [];
      this.game.lastWordsPlayer = null;
      this.game.lastDeathPlayer = null;
      this.game._lastNightDeaths = [];
      this.game.interrupt = null;
      this.game._speechQueue = [];
      this.game._currentSpeakerId = null;
      this.game.sheriffAssignOrder = null;
      this.game.phaseManager = null;
      this.game._pendingRequests = new Map();

      // 保留玩家数组（AI + 人类），观战者保留
      this.game.players = [...aiPlayers, ...humanPlayers];
      // 重新分配 ID
      this.game.players.forEach((p, i) => { p.id = i + 1; });
      this._updateIdMappings();

      // 清空消息
      if (this.game.message) {
        this.game.message.messages = [];
      }

      // 从展示流中移除游戏消息，保留聊天消息
      this.displayMessages = this.displayMessages.filter(m => m.source !== 'game');
      this._gameOverDisplayId = 0;

      // 更新 AI 的 chatWatermark
      if (this.aiManager) {
        for (const controller of this.aiManager.controllers.values()) {
          controller.agent.lastChatMessageId = this.chatMessageId;
        }
      }

      this._checkAndStartGame();
    } else {
      // 等待阶段重置：完全重置
      this.game = null;
      this.aiManager = null;
      this.currentPresetId = null;
      this.displayMessages = [];
      this._gameOverDisplayId = 0;
      resetUsedNames();
    }

    this.broadcastState();
  }

  handleReady(ws, msg) {
    const info = this.clients.get(ws);
    if (!info || info.isSpectator || !this.game) return;

    const player = this.game.players.find(p => p.id === info.playerId);
    if (player && !player.ready) {
      player.ready = true;
      this._checkAndStartGame();
      this.broadcastState();
    }
  }

  handleUnready(ws, msg) {
    const info = this.clients.get(ws);
    if (!info || info.isSpectator || !this.game) return;

    const player = this.game.players.find(p => p.id === info.playerId);
    if (player && player.ready) {
      player.ready = false;
      this.broadcastState();
    }
  }

  handleChangePreset(ws, msg) {
    const info = this.clients.get(ws);
    if (!info || !this.game) return;
    if (this.game.phaseManager && this.game.phaseManager.running) return;

    const presetId = msg.presetId;
    if (!presetId || !BOARD_PRESETS[presetId]) return;

    this.currentPresetId = presetId;
    this.game.presetId = presetId;
    this.game.preset = BOARD_PRESETS[presetId];
    this.game.effectiveRules = getEffectiveRules(this.game.preset);
    this.game.playerCount = this.game.preset.playerCount;

    // 配置变更后全员取消准备
    this.game.players.forEach(p => {
      if (!p.isAI) p.ready = false;
    });

    // 人数溢出处理：先踢 AI，再把溢出玩家送观战席
    while (this.game.players.length > this.game.playerCount) {
      // 优先踢 AI（从最大 id 开始）
      const aiPlayers = this.game.players.filter(p => p.isAI);
      if (aiPlayers.length > 0) {
        const lastAI = aiPlayers.reduce((a, b) => a.id > b.id ? a : b);
        this.game.players = this.game.players.filter(p => p.id !== lastAI.id);
        if (this.aiManager) {
          const controller = this.aiManager.controllers.get(lastAI.id);
          if (controller) controller.destroy();
          this.aiManager.controllers.delete(lastAI.id);
        }
        releaseAIName(lastAI.name);
        continue;
      }
      // 没有AI了，从最大 id 的玩家送观战席
      const humanPlayers = this.game.players.filter(p => !p.isAI);
      if (humanPlayers.length > 0) {
        const lastHuman = humanPlayers.reduce((a, b) => a.id > b.id ? a : b);
        this.game.players = this.game.players.filter(p => p.id !== lastHuman.id);
        const spectatorId = this._nextSpectatorId++;
        this.spectators.push({ id: spectatorId, name: lastHuman.name, view: 'villager', ws: null });
        // 更新该客户端的映射
        this.clients.forEach((cInfo, cws) => {
          if (cInfo.playerId === lastHuman.id) {
            this.clients.set(cws, { playerId: null, name: lastHuman.name, isSpectator: true, spectatorId });
            this.playerClients.delete(lastHuman.id);
            this.send(cws, 'spectator_assigned', { spectatorId, name: lastHuman.name });
          }
        });
        continue;
      }
      break;
    }

    this._updateIdMappings();
    this.broadcastState();
  }

  handleChangeName(ws, msg) {
    const info = this.clients.get(ws);
    if (!info || info.isSpectator || !this.game) return;
    if (this.game.phaseManager && this.game.phaseManager.running) return;

    const newName = (msg.name || '').trim();
    if (!newName) return;

    const player = this.game.players.find(p => p.id === info.playerId);
    if (player) {
      player.name = newName;
      info.name = newName;
      if (msg.emoji) player.emoji = msg.emoji;
      this.broadcastState();
    }
  }

  handleChangeEmoji(ws, msg) {
    const info = this.clients.get(ws);
    if (!info || info.isSpectator || !this.game) return;
    if (this.game.phaseManager && this.game.phaseManager.running) return;

    const player = this.game.players.find(p => p.id === info.playerId);
    if (player && !player.ready) {
      player.emoji = msg.emoji || '🎭';
      this.broadcastState();
    }
  }

  handleChangeDebugRole(ws, msg) {
    const info = this.clients.get(ws);
    if (!info || info.isSpectator || !this.game) return;
    if (!this.debugMode) return;
    if (this.game.phaseManager && this.game.phaseManager.running) return;

    const player = this.game.players.find(p => p.id === info.playerId);
    if (player && !player.ready) {
      this.backendLogger.info(`[handleChangeDebugRole] ${info.name} 选择角色: ${msg.role || '随机'}`);
      player.debugRole = msg.role || null;
      this.broadcastState();
    }
  }

  handleSpectate(ws, msg) {
    const info = this.clients.get(ws);
    if (!info || !this.game) return;
    if (this.game.phaseManager && this.game.phaseManager.running) return;

    if (!info.isSpectator) {
      const player = this.game.players.find(p => p.id === info.playerId);
      if (player && player.ready) return;

      this.backendLogger.info(`[handleSpectate] ${info.name} (playerId=${info.playerId}) 切换为观战者`);
      this.game.players = this.game.players.filter(p => p.id !== info.playerId);
      this.playerClients.delete(info.playerId);

      const spectatorId = this._nextSpectatorId++;
      const spectator = { id: spectatorId, name: info.name, view: 'villager', ws };
      this.spectators.push(spectator);
      this.clients.set(ws, { playerId: null, name: info.name, isSpectator: true, spectatorId });

      this.send(ws, 'spectator_assigned', { spectatorId, name: info.name });
      this.broadcastState();
    }
  }

  handleSwitchView(ws, msg) {
    const info = this.clients.get(ws);
    if (!info || !info.isSpectator) return;

    const spectator = this.spectators.find(s => s.id === info.spectatorId);
    if (spectator && ['villager', 'werewolf', 'god'].includes(msg.view)) {
      spectator.view = msg.view;
      const state = this._getStateForSpectator(spectator);
      this.send(ws, 'state', state);
    }
  }

  handleSwitchRole(ws, msg) {
    const info = this.clients.get(ws);
    if (!info || !this.game) return;
    if (this.game.phaseManager && this.game.phaseManager.running) return;

    const role = msg.role; // 'player' or 'spectator'
    this.backendLogger.info(`[handleSwitchRole] ${info.name} isSpectator=${info.isSpectator} → role=${role}`);

    if (info.isSpectator && role === 'player') {
      // 观战者 → 玩家（需要有空位）
      if (this.game.players.length >= this.game.playerCount) {
        this.send(ws, 'error', { message: '游戏区已满' });
        return;
      }

      const spectator = this.spectators.find(s => s.id === info.spectatorId);
      if (!spectator) return;

      // 从 spectators 移除
      this.spectators = this.spectators.filter(s => s.id !== info.spectatorId);

      // 加入 players
      const playerId = this._nextPlayerId();
      this.game.players.push({
        id: playerId,
        name: spectator.name,
        emoji: '🎭',
        alive: true,
        isAI: false,
        ready: false,
        role: null,
        state: {}
      });

      this.clients.set(ws, { playerId, name: spectator.name, isSpectator: false });
      this.playerClients.set(playerId, ws);
      this.send(ws, 'player_assigned', { playerId });
      this.broadcastState();
    } else if (!info.isSpectator && role === 'spectator') {
      // 玩家 → 观战者（委托给 handleSpectate）
      this.handleSpectate(ws, msg);
    }
  }

  _checkAndStartGame() {
    if (!this.game) return;
    if (this.game.phaseManager && this.game.phaseManager.running) return;

    const playerCount = this.game.playerCount;
    const players = this.game.players;
    if (players.length === playerCount && players.every(p => p.ready)) {
      const allAI = players.every(p => p.isAI);
      if (allAI) {
        this.broadcast('game_ready', {});
      } else {
        this.startGame();
      }
    }
  }

  _getStateForSpectator(spectator) {
    if (!this.game) {
      return {
        phase: 'waiting',
        players: [],
        presetId: this.currentPresetId,
        presetLocked: this.currentPresetId !== null,
        spectators: this.spectators.map(s => ({ id: s.id, name: s.name, view: s.view })),
        debugMode: this.debugMode
      };
    }

    const state = this.game.getState(null);
    state.self = null;
    state.messages = this._getDisplayMessagesForPlayer(null);
    state.spectators = this.spectators.map(s => ({ id: s.id, name: s.name, view: s.view }));
    state.debugMode = this.debugMode;
    state.presetLocked = this.currentPresetId !== null;
    state.presetId = this.currentPresetId;
    // 观战者始终收到上帝视角（全量消息 + 全量角色），前端根据 view 过滤
    return state;
  }

  _handleDisconnect(ws) {
    const info = this.clients.get(ws);
    if (info) {
      this.backendLogger.info(`${info.name} 断开连接`);
      if (info.isSpectator) {
        this.spectators = this.spectators.filter(s => s.id !== info.spectatorId);
      } else {
        this.playerClients.delete(info.playerId);
      }
      this.clients.delete(ws);
    }
  }

  // ========== 游戏控制 ==========

  async startGame() {
    if (!this.game || this.game.players.length < 1) return;

    this._gameOverDisplayId = 0;

    // AI Agent 进入游戏模式（增量聊天 + 压缩 + 重置水位线）
    if (this.aiManager) {
      for (const controller of this.aiManager.controllers.values()) {
        const player = controller.getPlayer();
        if (player) {
          await controller.agent.enterGame(player, this.game, this.chatMessages, this.chatMessageId);
        }
      }
    }

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
      const messages = this._getDisplayMessagesForPlayer(null);
      this.clients.forEach((info, ws) => {
        this.send(ws, 'state', {
          phase: 'waiting',
          players: [],
          messages,
          presetId: this.currentPresetId,
          presetLocked: this.currentPresetId !== null,
          boardRoles,
          spectators: this.spectators.map(s => ({ id: s.id, name: s.name, view: s.view })),
          debugMode: this.debugMode
        });
      });
      return;
    }

    this.clients.forEach((info, ws) => {
      try {
        if (info.isSpectator) {
          const spectator = this.spectators.find(s => s.id === info.spectatorId);
          if (spectator) {
            const state = this._getStateForSpectator(spectator);
            state.messages = this._getDisplayMessagesForPlayer(null);
            this.send(ws, 'state', state);
          }
        } else if (info.playerId != null) {
          const playerExists = this.game.players.find(p => p.id === info.playerId);
          if (!playerExists) return;
          const state = this.game.getState(info.playerId);
          state.messages = this._getDisplayMessagesForPlayer(info.playerId);
          state.presetLocked = this.currentPresetId !== null;
          state.presetId = this.currentPresetId;
          state.debugMode = this.debugMode;
          state.spectators = this.spectators.map(s => ({ id: s.id, name: s.name, view: s.view }));
          this.send(ws, 'state', state);
        }
      } catch (e) {
        this.backendLogger.error(`[broadcastState] error for client ${info.name} (spectator=${info.isSpectator}, playerId=${info.playerId}): ${e.message}`);
      }
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

  _getDisplayMessagesForPlayer(playerId) {
    const isRunning = this.game?.phaseManager?.running;
    const hasWinner = !!this.game?.winner;
    const isSpectator = playerId === null;

    return this.displayMessages.filter(msg => {
      if (msg.source === 'chat') {
        if (isRunning) return false;
        if (hasWinner) return msg.displayId >= this._gameOverDisplayId;
        return true;
      }

      if (msg.source === 'game') {
        if (!this.game) return false;
        if (isSpectator) return true;
        const player = this.game.players.find(p => p.id === playerId);
        return player && this.game.message.canSee(player, msg, this.game);
      }

      return false;
    });
  }

  _sendInitialState(ws) {
    if (this.game) {
      const isGameRunning = this.game.phaseManager && this.game.phaseManager.running;
      const state = this.game.getState();
      state.messages = isGameRunning ? [] : this._getDisplayMessagesForPlayer(null);
      state.presetLocked = this.currentPresetId !== null;
      state.presetId = this.currentPresetId;
      state.debugMode = this.debugMode;
      state.spectators = this.spectators.map(s => ({ id: s.id, name: s.name, view: s.view }));
      this.send(ws, 'state', state);
    } else {
      const boardRoles = this.getBoardRoles();
      this.send(ws, 'state', {
        phase: 'waiting',
        players: [],
        messages: this._getDisplayMessagesForPlayer(null),
        presetId: this.currentPresetId,
        presetLocked: this.currentPresetId !== null,
        boardRoles,
        spectators: [],
        debugMode: this.debugMode
      });
    }
  }

  // ========== 工具方法 ==========

  getBoardRoles() {
    if (!this.currentPresetId) return null;
    const preset = BOARD_PRESETS[this.currentPresetId];
    return preset ? preset.roles : null;
  }

  // ========== AI 聊天队列 ==========

  _addGameBrief() {
    if (!this.game) return;

    const presetName = this.game.preset?.name || this.currentPresetId || '标准局';
    const winner = this.game.winner;
    const winnerText = winner === 'good' ? '好人阵营获胜' : winner === 'wolf' ? '狼人阵营获胜' : '第三方阵营获胜';
    const playersList = this.game.players.map((p, i) => `${i + 1}号${p.name}`).join('、');

    const briefMsg = {
      id: ++this.chatMessageId,
      type: 'game_brief',
      playerName: '',
      content: `${presetName}\n${winnerText}\n参与者：${playersList}`,
      timestamp: Date.now()
    };
    this.chatMessages.push(briefMsg);
    this._gameOverDisplayId = ++this.displayMessageId;
    this.displayMessages.push({ ...briefMsg, source: 'chat', displayId: this._gameOverDisplayId });
    this.broadcastState();
  }

  _exitGameForAllAI() {
    if (!this.aiManager) return;
    for (const controller of this.aiManager.controllers.values()) {
      const player = controller.getPlayer();
      if (player) {
        controller.agent.exitGame(player);
      }
    }
  }

  _triggerAIPostGameChat() {
    if (!this.game || !this.aiManager) return;

    const items = [];
    for (const [playerId, controller] of this.aiManager.controllers) {
      const player = this.game.players.find(p => p.id === playerId);
      if (!player) continue;

      if (!player.alive) {
        controller.supplementDeadMessages(this.game);
      }

      const chatContext = controller.buildGameOverChatContext(this.game);
      items.push({ controller, chatContext });
    }

    this._aiChatQueue.push(...items);
    this._processAIChatQueue();
  }

  _handleChatMentions(chatMsg) {
    if (!this.game || !this.aiManager) return;
    if (this.game.phaseManager && this.game.phaseManager.running) return;

    const content = chatMsg.content;
    const mentionedControllers = new Set();

    let pos = 0;
    while ((pos = content.indexOf('@', pos)) !== -1) {
      const textAfterAt = content.slice(pos + 1);
      if (textAfterAt.length === 0) { pos++; continue; }

      const controller = this._findAIControllerByPrefix(textAfterAt);
      if (controller && !mentionedControllers.has(controller)) {
        mentionedControllers.add(controller);
        const chatContext = controller.handleMention(chatMsg, this.chatMessages);
        this._enqueueAIChat(controller, chatContext);
      }
      pos++;
    }
  }

  _findAIControllerByPrefix(textAfterAt) {
    if (!this.game || !this.aiManager) return null;
    let bestMatch = null;
    let bestLength = 0;
    for (const [playerId, controller] of this.aiManager.controllers) {
      const player = this.game.players.find(p => p.id === playerId);
      if (player && textAfterAt.startsWith(player.name) && player.name.length > bestLength) {
        bestMatch = controller;
        bestLength = player.name.length;
      }
    }
    return bestMatch;
  }

  _enqueueAIChat(controller, chatContext) {
    this._aiChatQueue.push({ controller, chatContext });
    this._processAIChatQueue();
  }

  async _processAIChatQueue() {
    if (this._aiChatProcessing) return;
    if (this._aiChatQueue.length === 0) return;

    this._aiChatProcessing = true;

    // game_over 事件并行处理，其他事件顺序处理
    const gameOverItems = [];
    const sequentialItems = [];
    while (this._aiChatQueue.length > 0) {
      const item = this._aiChatQueue.shift();
      if (item.chatContext.event === 'game_over') {
        gameOverItems.push(item);
      } else {
        sequentialItems.push(item);
      }
    }

    // 并行处理所有 game_over 发言
    if (gameOverItems.length > 0) {
      this.backendLogger.info(`[AI-Chat] 并行复盘: ${gameOverItems.length} 个 AI 同时发言`);
      const promises = gameOverItems.map(({ controller, chatContext }) => {
        const delay = Math.random() * 2000;
        return new Promise(resolve => setTimeout(resolve, delay))
          .then(() => this._executeAIChat(controller, chatContext));
      });
      await Promise.all(promises);
    }

    // 顺序处理 @提及 和 waiting 事件
    for (const { controller, chatContext } of sequentialItems) {
      await new Promise(resolve => setTimeout(resolve, Math.random() * 2000));
      await this._executeAIChat(controller, chatContext);
    }

    this._aiChatProcessing = false;

    // 处理期间可能新入队了消息，再检查一次
    if (this._aiChatQueue.length > 0) {
      this._processAIChatQueue();
    }
  }

  async _executeAIChat(controller, chatContext) {
    try {
      const result = await controller.sendChatMessage(chatContext);
      if (result) {
        const chatMsg = {
          id: ++this.chatMessageId,
          type: 'chat',
          playerId: result.playerId,
          playerName: result.playerName,
          content: result.content,
          isAI: true,
          timestamp: Date.now(),
          event: chatContext.event || 'waiting'
        };
        this.chatMessages.push(chatMsg);
        this.displayMessages.push({ ...chatMsg, source: 'chat', displayId: ++this.displayMessageId });
        this.broadcastState();

        controller.agent.lastChatMessageId = this.chatMessageId;
        this._handleChatMentions(chatMsg);
      }

      if (chatContext.event === 'game_over') {
        const player = controller.getPlayer();
        controller.agent.appendGameOverInfo(player, this.game);
        await controller.agent.postGameCompress(player, this.game);
      }
    } catch (e) {
      this.backendLogger.error(`[AI-Chat] 队列处理错误: ${e.message}`);
    }
  }

  // ========== 游戏事件监听 ==========

  setupGameListeners() {
    if (!this.game) return;

    this.game.on('player:action', ({ playerId, data }) => {
      const ws = this.playerClients.get(playerId);
      if (ws && this.game.players.find(p => p.id === playerId)) {
        const state = this.game.getState(playerId);
        state.messages = this._getDisplayMessagesForPlayer(playerId);
        this.send(ws, 'state', state);
      }
    });

    this.game.message.on('message:added', (msg) => {
      // 游戏消息入流
      this.displayMessages.push({ ...msg, source: 'game', displayId: ++this.displayMessageId });

      if (this.game.aiManager) {
        this.game.aiManager.onMessageAdded(msg);
      }

      // 游戏结束消息触发 AI 退出游戏模式 + 赛后聊天
      if (msg.type === 'game_over') {
        this._addGameBrief();
        this._exitGameForAllAI();
        this._triggerAIPostGameChat();
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

  _nextPlayerId() {
    if (!this.game || this.game.players.length === 0) return 1;
    return Math.max(...this.game.players.map(p => p.id)) + 1;
  }

  _updateIdMappings() {
    if (!this.game) return;

    // 更新人类玩家映射
    const newPlayerClients = new Map();
    this.clients.forEach((info, cws) => {
      const player = this.game.players.find(p => p.name === info.name && !p.isAI);
      if (player) {
        info.playerId = player.id;
        newPlayerClients.set(player.id, cws);
      }
    });
    this.playerClients = newPlayerClients;

    // 更新 AI controller 映射（playerId 只需更新 AIController 一处）
    const newControllers = new Map();
    for (const player of this.game.players) {
      if (player.isAI) {
        for (const [oldId, controller] of this.aiManager.controllers) {
          if (controller.playerName === player.name) {
            controller.playerId = player.id;
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
