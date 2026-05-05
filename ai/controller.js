const { PlayerController } = require('../engine/player');
const { Agent } = require('./agent/agent');
const { formatChatMessages, buildGameOverInfo } = require('./agent/formatter');
const { createLogger } = require('../utils/logger');
const { getPlayerDisplay } = require('../engine/utils');
const { ACTION, VISIBILITY } = require('../engine/constants');

let backendLogger = null;
const getLogger = () => backendLogger || (global.backendLogger || createLogger('backend.log'));

class AIController extends PlayerController {
  constructor(playerId, game, options = {}) {
    super(playerId, game);

    const player = this.getPlayer();
    this.playerName = player?.name;

    const agentOptions = {};
    if (options.agentType === 'llm') {
      agentOptions.useLLM = true;
      agentOptions.compressionEnabled = true;
    } else if (options.agentType === 'mock') {
      agentOptions.mockOptions = options.mockOptions;
    }
    this.agent = new Agent(agentOptions);
  }

  buildContext(extraData = {}) {
    const state = this.getState();
    const player = this.getPlayer();
    const isChat = extraData.actionType === ACTION.CHAT;

    return {
      phase: state.phase,
      players: state.players,
      alivePlayers: this.game?.players?.filter(p => p.alive) || [],
      messages: isChat ? [] : this.getVisibleMessages(),
      self: state.self,
      dayCount: this.game?.round || 0,
      werewolfTarget: this.game?.werewolfTarget,
      witchPotion: {
        heal: state.self?.witchHeal > 0,
        poison: state.self?.witchPoison > 0
      },
      action: extraData.actionType,
      extraData
    };
  }

  async getSpeechResult(visibility = VISIBILITY.PUBLIC, actionType) {
    const player = this.getPlayer();
    const context = this.buildContext({ actionType });

    const action = await new Promise(resolve => {
      this.agent.enqueue({ type: 'answer', context, callback: resolve });
    });

    const content = action?.skip ? '过。' : (action?.content || '过。');
    getLogger().info(`[AI] ${player?.name} 发言：${content}`);
    return { content, visibility };
  }

  async getVoteResult(actionType = ACTION.DAY_VOTE, extraData = {}) {
    const player = this.getPlayer();
    const context = this.buildContext({ ...extraData, actionType });

    const action = await new Promise(resolve => {
      this.agent.enqueue({ type: 'answer', context, callback: resolve });
    });

    const isSkipping = action?.skip === true;
    const targetId = action?.target != null ? parseInt(action.target) : (action?.targetId != null ? parseInt(action.targetId) : null);

    if (!isSkipping && !targetId && extraData?.allowedTargets?.length > 0) {
      targetId = extraData.allowedTargets[Math.floor(Math.random() * extraData.allowedTargets.length)];
    }

    if (extraData?.allowedTargets?.length > 0) {
      const targetsStr = extraData.allowedTargets.map(id => {
        const p = this.game.players.find(x => x.id === id);
        return p ? getPlayerDisplay(this.game.players, p) : `${id}号`;
      }).join(', ');
      getLogger().info(`[AI] ${player?.name} 可选投票范围：${targetsStr}`);
    }

    if (targetId) {
      const target = this.game.players.find(p => p.id === targetId);
      getLogger().info(`[AI] ${player?.name} 投票给 ${getPlayerDisplay(this.game.players, target)}`);
    } else {
      getLogger().info(`[AI] ${player?.name} 选择弃权`);
    }

    if (actionType === ACTION.DAY_VOTE) {
      this.agent.enqueue({ type: 'compress', mode: 'game', context });
    }

    return { targetId };
  }

  async useSkill(actionType, extraData = {}) {
    const player = this.getPlayer();
    if (!player) return { success: false, message: '玩家不存在' };

    const skill = this.getSkill(actionType);
    if (!skill) return { success: false, message: '技能不存在' };

    const validation = this.canUseSkill(skill, extraData);
    if (!validation.ok) return { success: false, message: validation.message };

    const context = this.buildContext({ ...extraData, actionType });

    const action = await new Promise(resolve => {
      this.agent.enqueue({ type: 'answer', context, callback: resolve });
    });

    const targetsStr = this.formatAllowedTargets(actionType, extraData);
    getLogger().info(`[AI] ${player.name} 使用技能 ${actionType}, 可选：${targetsStr} → ${JSON.stringify(action)}`);

    if (action?.skip === true) {
      return { success: true, skipped: true };
    }

    return this.executeSkill(skill, action, extraData);
  }

  updateSystemMessage() {
    this.agent.updateSystemMessage(this.getPlayer(), this.game);
  }

  shouldAnalyzeMessage(msg, selfPlayerId) {
    return this.agent.shouldAnalyzeMessage(msg, selfPlayerId, this.game);
  }

  enqueueMessage(msg) {
    const context = this.buildContext({ actionType: 'analyze' });
    this.agent.enqueue({ type: 'answer', context, callback: null });
  }

  async sendChatMessage(chatContext) {
    const player = this.getPlayer();
    this.agent.updateSystemMessage(player, null, 'chat');
    const context = this.buildContext({ actionType: ACTION.CHAT, chatContext });

    const action = await new Promise(resolve => {
      this.agent.enqueue({ type: 'answer', context, callback: resolve });
    });

    if (action?.skip) {
      getLogger().info(`[AI-Chat] ${player?.name} 跳过聊天`);
      return null;
    }

    const content = action?.content?.trim();
    if (!content) {
      getLogger().info(`[AI-Chat] ${player?.name} 聊天内容为空，跳过`);
      return null;
    }

    getLogger().info(`[AI-Chat] ${player?.name} 聊天：${content}`);

    return {
      playerId: player.id,
      playerName: player.name,
      content,
      isAI: true
    };
  }

  async reassignToGame(newGame) {
    this.game = newGame;
    const player = this.getPlayer();
    if (player) {
      await this.agent.resetForNewGame(player, newGame);
    }
  }

  supplementDeadMessages(game) {
    const player = this.getPlayer();
    if (!player) return;
    const lastId = this.agent.lastProcessedId;
    const visibleMessages = game.message.getVisibleTo(player, game)
      .filter(m => m.id > lastId);
    if (visibleMessages.length === 0) return;
    const context = this.buildContext({ actionType: 'analyze' });
    this.agent.enqueue({ type: 'answer', context, callback: null });
  }

  buildGameOverChatContext(game) {
    const winner = game.winner;
    const winnerText = winner === 'good' ? '好人阵营' : winner === 'wolf' ? '狼人阵营' : '第三方阵营';
    const playersInfo = game.players.map(p => {
      const pos = game.players.indexOf(p) + 1;
      const roleId = p.role?.id || p.role || '未知';
      const roleName = { werewolf: '狼人', seer: '预言家', witch: '女巫', hunter: '猎人', guard: '守卫', villager: '村民', idiot: '白痴', cupid: '丘比特' }[roleId] || roleId;
      const status = p.alive ? '存活' : '死亡';
      return `${pos}号${p.name}: ${roleName} - ${status}`;
    }).join('\n');
    return { event: 'game_over', winner: winnerText, playersInfo };
  }

  handleMention(chatMsg, chatMessages) {
    const lastId = this.agent.lastChatMessageId || 0;
    const recentChat = chatMessages.filter(m => m.id > lastId && m.id <= chatMsg.id);
    this.agent.lastChatMessageId = chatMsg.id;

    return {
      event: 'mentioned',
      mentioner: chatMsg.playerName,
      mentionContent: chatMsg.content,
      recentChat: recentChat.length > 0 ? formatChatMessages(recentChat) : ''
    };
  }

  destroy() {
    this.agent.destroy();
  }
}

class AIManager {
  constructor(gameEngine) {
    this.game = gameEngine;
    this.controllers = new Map();
  }

  createAI(playerId, options = {}) {
    const controller = new AIController(playerId, this.game, options);
    this.controllers.set(playerId, controller);
    return controller;
  }

  get(playerId) {
    return this.controllers.get(playerId);
  }

  async reassignToGame(newGame) {
    this.game = newGame;
    for (const controller of this.controllers.values()) {
      await controller.reassignToGame(newGame);
    }
  }

  onMessageAdded(msg) {
    for (const controller of this.controllers.values()) {
      if (controller.shouldAnalyzeMessage(msg, controller.playerId)) {
        controller.enqueueMessage(msg);
      }
    }
  }
}

module.exports = { AIController, AIManager };