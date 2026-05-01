/**
 * controller.js - AI 控制器
 * 对外接口与 ai/controller.js 对齐
 */

const { PlayerController } = require('../engine/player');
const { Agent } = require('./agent/agent');
const { createLogger } = require('../utils/logger');
const { getPlayerDisplay } = require('../engine/utils');
const { ACTION, VISIBILITY } = require('../engine/constants');

let backendLogger = null;
const getLogger = () => backendLogger || (backendLogger = global.backendLogger || createLogger('backend.log'));

class AIController extends PlayerController {
  constructor(playerId, game, options = {}) {
    super(playerId, game);

    // 保存玩家名称，用于 assignRoles 后重建映射
    const player = this.getPlayer();
    this.playerName = player?.name;

    const agentOptions = {};
    if (options.agentType === 'llm') {
      agentOptions.useLLM = true;
      agentOptions.compressionEnabled = true;
    } else if (options.agentType === 'mock') {
      agentOptions.mockOptions = options.mockOptions;
    }
    this.agent = new Agent(playerId, agentOptions);
  }

  buildContext(extraData = {}) {
    const state = this.getState();
    const player = this.getPlayer();

    return {
      phase: state.phase,
      players: state.players,
      alivePlayers: this.game?.players?.filter(p => p.alive) || [],
      messages: this.getVisibleMessages(),
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

    // action 格式：{ skip: true } 或 { content: "..." }
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

    // action 格式：{ skip: true } 或 { target: N }
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
      this.agent.enqueue({ type: 'compress' });
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

    // action 格式：{ skip: true } 或 { target: N } 或 { targets: [N, N] } 或 { action: 'heal' } 等
    const targetsStr = this.formatAllowedTargets(actionType, extraData);
    getLogger().info(`[AI] ${player.name} 使用技能 ${actionType}, 可选：${targetsStr} → ${JSON.stringify(action)}`);

    // 弃权时跳过技能执行
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

  onMessageAdded(msg) {
    for (const controller of this.controllers.values()) {
      if (controller.shouldAnalyzeMessage(msg, controller.playerId)) {
        controller.enqueueMessage(msg);
      }
    }
  }
}

module.exports = { AIController, AIManager };