const WebSocket = require('ws');
const http = require('http');
const { ServerCore } = require('../../server-core');
const { createPlayerRole } = require('../../engine/roles');

const DEFAULT_MOCK_OPTIONS = {
  presetResponses: {
    'action_sheriff_campaign': { run: false },
    'action_withdraw': { withdraw: false },
    'action_night_werewolf_discuss': { content: '过。' },
    'action_day_discuss': { content: '我是好人。' },
    'action_sheriff_speech': { content: '我是好人。' },
    'action_witch': { action: 'skip' },
    'action_explode': { confirmed: false },
    'action_assignOrder': { startPlayerId: 1 },
    'action_last_words': { content: '我是好人，再见了。' }
  },
  customStrategies: {
    'action_night_werewolf_vote': (context) => {
      const targets = context.extraData?.allowedTargets || context.alivePlayers?.map(p => p.id) || [1];
      return { target: targets[0] };
    },
    'action_day_vote': (context) => {
      const targets = context.extraData?.allowedTargets || context.alivePlayers?.map(p => p.id) || [1];
      return { target: targets[0] };
    },
    'action_post_vote': (context) => {
      const targets = context.extraData?.allowedTargets || context.alivePlayers?.map(p => p.id) || [1];
      return { target: targets[0] };
    },
    'action_sheriff_vote': (context) => {
      const targets = context.extraData?.allowedTargets || context.alivePlayers?.map(p => p.id) || [1];
      return { target: targets[0] };
    },
    'action_seer': (context) => {
      const targets = context.extraData?.allowedTargets || context.alivePlayers?.filter(p => p.id !== context.self?.id).map(p => p.id) || [1];
      return { target: targets[0] };
    },
    'action_guard': (context) => {
      const targets = context.extraData?.allowedTargets || context.alivePlayers?.map(p => p.id) || [1];
      return { target: targets[0] };
    },
    'action_shoot': (context) => {
      const targets = context.extraData?.allowedTargets || context.alivePlayers?.filter(p => p.id !== context.self?.id).map(p => p.id) || [];
      return targets.length > 0 ? { target: targets[0], use: true } : { use: false };
    },
    'action_cupid': (context) => {
      const targets = context.alivePlayers?.filter(p => p.id !== context.self?.id).map(p => p.id) || [1, 2];
      return { targets: targets.slice(0, 2) };
    },
    'action_passBadge': (context) => {
      const targets = context.alivePlayers?.filter(p => p.id !== context.self?.id).map(p => p.id) || [];
      return targets.length > 0 ? { targetId: targets[0] } : { targetId: null };
    }
  }
};

class ServerHarness {
  constructor(port, options = {}) {
    this.port = port;
    this.mockOptions = options.mockOptions || DEFAULT_MOCK_OPTIONS;
    this.forcedRoles = new Map();
    this.humanClients = new Map();

    this.core = new ServerCore({
      port,
      backendLogger: {
        info: () => {},
        debug: () => {},
        error: () => {},
        warn: () => {}
      }
    });

    this._setupHooks();
  }

  _setupHooks() {
    const originalCreateAI = this.core.createAI.bind(this.core);
    this.core.createAI = (aiManager, playerId, options) => {
      return aiManager.createAI(playerId, {
        agentType: 'mock',
        mockOptions: options.mockOptions || this.mockOptions
      });
    };

    const originalOnAfterAssignRoles = this.core.onAfterAssignRoles.bind(this.core);
    this.core.onAfterAssignRoles = () => {
      originalOnAfterAssignRoles();
      this._applyForcedRoles();
      // 角色交换后需要重新更新 AI 的 system message
      for (const player of this.core.game.players) {
        if (player.isAI) {
          const controller = this.core.aiManager?.get(player.id);
          if (controller) {
            controller.updateSystemMessage();
          }
        }
      }
    };

    this.core.shouldAutoStart = () => false;
  }

  async start() {
    this.core.app = require('express')();
    this.core.server = http.createServer(this.core.app);
    this.core.wss = new WebSocket.Server({ server: this.core.server });
    this.core._setupRoutes();
    this.core._setupWebSocketHandlers();

    return new Promise((resolve) => {
      this.core.server.listen(this.port, () => resolve());
    });
  }

  stop() {
    this.core.stop();
  }

  async addHuman(name, options = {}) {
    const client = await this._createHumanClient(name, options);
    this.humanClients.set(name, client);
    return client;
  }

  async addAI(count, options = {}) {
    for (let i = 0; i < count; i++) {
      if (!this.core.game) {
        const { GameEngine } = require('../../engine/main');
        const { resetUsedNames } = require('../../ai/agent/prompt');
        this.core.currentPresetId = options.presetId || '9-standard';
        this.core.game = new GameEngine({ presetId: this.core.currentPresetId });
        this.core.aiManager = this.core.createAIManager(this.core.game);
        this.core.game.aiManager = this.core.aiManager;
        resetUsedNames();
        this.core.game.getAIController = (playerId) => this.core.aiManager.get(playerId);
        this.core.setupGameListeners();
      }

      const { getRandomProfiles } = require('../../ai/agent/prompt');
      const profiles = getRandomProfiles(1);
      const aiPlayerId = this.core.game.players.length + 1;
      this.core.game.players.push({
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

      this.core.createAI(this.core.aiManager, aiPlayerId, {
        mockOptions: options.mockOptions || this.mockOptions
      });
    }
  }

  startGame() {
    this.core.startGame();
  }

  setForcedRole(playerName, roleId) {
    this.forcedRoles.set(playerName, roleId);
  }

  setMockOptions(options) {
    this.mockOptions = options;
  }

  _applyForcedRoles() {
    if (!this.core.game) return;
    for (const [playerName, roleId] of this.forcedRoles) {
      const player = this.core.game.players.find(p => p.name === playerName && !p.isAI);
      if (player) {
        const oldRole = player.role;
        player.role = createPlayerRole(roleId);
        const client = this.humanClients.get(playerName);
        if (client) {
          client.playerId = player.id;
        }
        if (oldRole) {
          const aiWithSameRole = this.core.game.players.find(
            p => p.isAI && p.role?.id === roleId && p.id !== player.id
          );
          if (aiWithSameRole) {
            aiWithSameRole.role = oldRole;
          }
        }
      }
    }
  }

  getGame() { return this.core.game; }

  getPlayer(playerId) {
    return this.core.game?.players.find(p => p.id === playerId);
  }

  getPlayerByName(name) {
    return this.core.game?.players.find(p => p.name === name);
  }

  getAIMockModel(playerId) {
    const controller = this.core.aiManager?.get(playerId);
    return controller?.agent?.mockModel || null;
  }

  getAICallHistory(playerId) {
    return this.getAIMockModel(playerId)?.getCallHistory() || [];
  }

  getAICallsByPhase(playerId, phase) {
    return this.getAIMockModel(playerId)?.getCallsByPhase(phase) || [];
  }

  getAILastMessages(playerId) {
    const calls = this.getAICallHistory(playerId);
    return calls.length > 0 ? calls[calls.length - 1].messagesForLLM : null;
  }

  async waitForPhase(phaseId, timeout = 5000) {
    return this._waitForCondition(
      () => this.core.game?.phaseManager?.getCurrentPhase()?.id === phaseId,
      timeout,
      `等待阶段 ${phaseId} 超时`
    );
  }

  async waitForPlayerAction(playerId, actionType, timeout = 5000) {
    const client = this._findClientByPlayerId(playerId);
    if (!client) throw new Error(`未找到玩家 ${playerId}`);
    return client.waitForAction(actionType, timeout);
  }

  async waitForAICalls(playerId, minCount = 1, timeout = 10000) {
    return this._waitForCondition(
      () => this.getAICallHistory(playerId).length >= minCount,
      timeout,
      `等待 AI 玩家 ${playerId} 至少 ${minCount} 次调用`
    );
  }

  _createHumanClient(name, options = {}) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${this.port}`);
      const client = {
        ws,
        messages: [],
        playerId: null,
        role: null,
        autoRespond: options.autoRespond || {},

        send(msg) {
          ws.send(JSON.stringify({ ...msg, playerId: this.playerId }));
        },

        waitFor(type, timeout = 5000) {
          return this._waitForCondition(m => m.type === type, timeout);
        },

        waitForCondition(predicate, timeout = 5000) {
          return this._waitForCondition(predicate, timeout);
        },

        waitForAction(actionType, timeout = 5000) {
          return this._waitForCondition(
            m => m.type === 'state' && m.data?.pendingAction?.action === actionType,
            timeout
          );
        },

        _waitForCondition(predicate, timeout) {
          return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('等待超时')), timeout);
            const check = () => {
              const msg = this.messages.find(predicate);
              if (msg) { clearTimeout(timer); resolve(msg); }
              else { setTimeout(check, 50); }
            };
            check();
          });
        },

        autoRespondToAction() {
          const stateMsg = [...this.messages].reverse()
            .find(m => m.type === 'state' && m.data?.pendingAction && !m._handled);
          if (!stateMsg) return false;

          stateMsg._handled = true;
          const actionData = stateMsg.data?.pendingAction;
          const requestId = actionData?.requestId;
          const actionType = actionData?.action;

          let response = this._getResponseForAction(actionType, actionData, stateMsg.data);
          if (response) {
            this.send({ type: 'response', requestId, ...response });
            return true;
          }
          return false;
        },

        _getResponseForAction(actionType, actionData, stateData) {
          const auto = this.autoRespond;

          if (actionType === 'action_sheriff_campaign') {
            return auto.campaign || { confirmed: true, run: true };
          }
          if (actionType === 'action_withdraw') {
            return auto.withdraw || { withdraw: false };
          }
          if (actionType === 'action_night_werewolf_discuss' || actionType === 'action_day_discuss' || actionType === 'action_sheriff_speech') {
            return auto.speak || { content: `我是${name}，我是好人。` };
          }
          if (actionType === 'action_last_words') {
            return auto.lastWords || { content: `我是${name}，再见了。` };
          }
          if (actionType === 'action_day_vote' || actionType === 'action_post_vote' ||
              actionType === 'action_night_werewolf_vote' || actionType === 'action_sheriff_vote') {
            const allowedTargets = actionData?.allowedTargets;
            const targetId = allowedTargets?.[0] || this._getFirstAliveOther(stateData);
            return auto.vote || { targetId };
          }
          if (actionType === 'action_seer' || actionType === 'action_guard') {
            const allowedTargets = actionData?.allowedTargets;
            const targetId = allowedTargets?.[0] || this._getFirstAliveOther(stateData);
            return auto[actionType.replace('action_', '')] || { targetId };
          }
          if (actionType === 'action_witch') {
            return auto.witch || { action: 'skip' };
          }
          if (actionType === 'action_assignOrder') {
            return auto.assignOrder || { startPlayerId: 1 };
          }
          if (actionType === 'action_passBadge') {
            return auto.passBadge || { targetId: this._getFirstAliveOther(stateData) };
          }
          if (actionType === 'action_shoot') {
            return auto.shoot || { targetId: this._getFirstAliveOther(stateData), use: true };
          }
          if (actionType === 'action_cupid') {
            const players = stateData?.players || [];
            const targets = players.filter(p => p.alive && p.id !== this.playerId).slice(0, 2).map(p => p.id);
            return auto.cupid || { targets };
          }
          if (actionType === 'action_explode') {
            return auto.explode || { confirmed: false };
          }
          return { confirmed: true };
        },

        _getFirstAliveOther(stateData) {
          const players = stateData?.players || [];
          const aliveOthers = players.filter(p => p.alive && p.id !== this.playerId);
          return aliveOthers[0]?.id || 1;
        }
      };

      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'join', name }));
      });

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data);
          client.messages.push(msg);
          if (msg.type === 'player_assigned') client.playerId = msg.data.playerId;
          if (msg.type === 'role_assigned') client.role = msg.data.role;
          if (msg.type === 'state' && msg.data?.pendingAction) {
            setTimeout(() => client.autoRespondToAction(), 10);
          }
        } catch (e) {}
      });

      ws.on('error', reject);
      setTimeout(() => resolve(client), 300);
    });
  }

  _findClientByPlayerId(playerId) {
    for (const client of this.humanClients.values()) {
      if (client.playerId === playerId) return client;
    }
    return null;
  }

  async _waitForCondition(predicate, timeout, errorMsg = '等待超时') {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(errorMsg)), timeout);
      const check = () => {
        if (predicate()) { clearTimeout(timer); resolve(); }
        else { setTimeout(check, 50); }
      };
      check();
    });
  }
}

module.exports = { ServerHarness, DEFAULT_MOCK_OPTIONS };