/**
 * AIController - AI 玩家控制器
 * 继承 PlayerController，注入 Agent 策略
 */

const { PlayerController } = require('../engine/player');
const { RandomAgent, LLMAgent, MockAgent } = require('./agents');
const { createLogger } = require('../utils/logger');

// 创建日志实例（延迟初始化）
let agentLogger = null;
let backendLogger = null;
function getLogger() {
  if (!agentLogger) {
    agentLogger = createLogger('agent.log');
  }
  return agentLogger;
}
function getBackendLogger() {
  if (!backendLogger) {
    // 优先使用 global.backendLogger（server.js中创建），否则创建新的
    backendLogger = global.backendLogger || createLogger('backend.log');
  }
  return backendLogger;
}

class AIController extends PlayerController {
  /**
   * @param {number} playerId - 玩家 ID
   * @param {GameEngine} game - 游戏引擎
   * @param {Object} options - 配置选项
   * @param {string} options.agentType - Agent 类型: 'llm' | 'random' | 'mock'
   * @param {Object} options.mockBehaviors - MockAgent 的预设行为
   */
  constructor(playerId, game, options = {}) {
    super(playerId, game);

    // 创建 Agent
    this.randomAgent = new RandomAgent(playerId, game);
    this.llmAgent = options.agentType === 'llm'
      ? new LLMAgent(playerId, game)
      : null;
    this.mockAgent = options.agentType === 'mock'
      ? new MockAgent(playerId, game, options.mockOptions)
      : null;
  }

  /**
   * 获取 MockAgent 实例（用于测试时预设行为）
   */
  getMockAgent() {
    return this.mockAgent;
  }

  // ========== 决策上下文构建 ==========

  buildContext(extraData = {}) {
    const state = this.getState();
    const player = this.getPlayer();

    return {
      phase: state.phase,
      players: state.players,
      alivePlayers: this.game.players.filter(p => p.alive),
      messages: this.getVisibleMessages(),
      self: state.self,
      dayCount: this.game.dayCount,
      werewolfTarget: this.game.werewolfTarget,
      extraData
    };
  }

  // ========== 统一决策入口 ==========

  async decide(context) {
    // 优先使用 MockAgent（测试用）
    if (this.mockAgent) {
      try {
        const action = await this.mockAgent.decide(context);
    // console.log(`[DEBUG MockAgent] playerId=${this.playerId}, action=${JSON.stringify(action)}, context.action=${context.action}`);
        if (this.validateAction(action, context)) {
          return action;
        }
      } catch (e) {
        getLogger().error(`MockAgent 决策失败: ${e.message}`);
      }
    }

    // 尝试 LLM 决策
    if (this.llmAgent) {
      try {
        const action = await this.llmAgent.decide(context);
        if (this.validateAction(action, context)) {
          return action;
        }
        getLogger().info(`LLM action 无效，降级到 RandomAgent`);
      } catch (e) {
        getLogger().error(`LLM 决策失败: ${e.message}`);
      }
    }

    // 降级到 RandomAgent
    return this.randomAgent.decide(context);
  }

  // 验证 action 有效性
  validateAction(action, context) {
    if (!action) return false;

    // 非目标类 action（如 campaign, withdraw）直接通过
    if (!action.target && !action.type) return true;

    // 有 type 的 action 需要验证 type
    if (action.type && !action.type.match(/^(vote|speech|target)$/)) {
      return true;
    }

    // 验证目标是否存在且有效
    if (action.target) {
      const targetId = parseInt(action.target);
      const target = context.alivePlayers.find(p => p.id === targetId);
      if (!target) return false;

      // 检查是否在允许范围内（如投票限制）
      if (context.extraData?.allowedTargets) {
        if (!context.extraData.allowedTargets.includes(targetId)) {
          return false;
        }
      }
    }

    return true;
  }

  // ========== 实现抽象方法 ==========

  async getSpeechResult(visibility = 'public', actionType = 'speak') {
    const player = this.getPlayer();
    const context = this.buildContext({ actionType });

    // 根据阶段类型调整 context
    context.phase = actionType === 'last_words' ? 'last_words' : context.phase;
    context.action = actionType;

    const action = await this.decide(context);
    const content = action?.type === 'speech' ? action.content : '过。';

    const logMsg = `[AI] ${player?.name} 发言: ${content}`;
    getLogger().info(logMsg);
    getBackendLogger().info(logMsg);
    return { content, visibility };
  }

  async getVoteResult(actionType = 'vote', extraData = {}) {
    const player = this.getPlayer();
    // 将 actionType 添加到 context 中
    const context = this.buildContext({ ...extraData, actionType });
    // 同时设置 action 字段以便 Agent 识别
    context.action = actionType;

    const action = await this.decide(context);
    let targetId = null;
    const isSkipping = action?.type === 'skip'; // 记录是否是故意弃权

    if (action?.type === 'vote' && action.target) {
      targetId = parseInt(action.target);
    } else if (action?.type === 'skip') {
      targetId = null;
    } else if (action?.target) {
      targetId = parseInt(action.target);
    }

    // 只有在不是故意弃权且有目标限制时，才随机选择
    if (!isSkipping && !targetId && extraData?.allowedTargets?.length > 0) {
      targetId = extraData.allowedTargets[Math.floor(Math.random() * extraData.allowedTargets.length)];
    }

    if (targetId) {
      const target = this.game.players.find(p => p.id === targetId);
      const pos = this.game.getPosition(targetId);
      const logMsg = `[AI] ${player?.name} 投票给 ${pos}号 ${target?.name}`;
      getLogger().info(logMsg);
      getBackendLogger().info(logMsg);
    } else {
      const logMsg = `[AI] ${player?.name} 选择弃权`;
      getLogger().info(logMsg);
      getBackendLogger().info(logMsg);
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

    // 构建上下文，包含技能特定信息
    const context = this.buildContext({ ...extraData, actionType });
    context.phase = actionType; // 使用技能类型作为阶段标识
    context.action = actionType;

    // 让 Agent 决策
    const action = await this.decide(context);

    // 转换 action 格式以适配 executeSkill
    const normalizedAction = this.normalizeAction(action, actionType, extraData);

    // 合并日志：可选目标 → 决策结果
    const 可选目标 = this.formatAllowedTargets(actionType, extraData);
    const logMsg = `[AI] ${player.name} 使用技能 ${actionType}，可选: ${可选目标} → ${JSON.stringify(normalizedAction)}`;
    getLogger().info(logMsg);
    getBackendLogger().info(logMsg);

    // 执行技能
    return this.executeSkill(skill, normalizedAction, extraData);
  }

  // 格式化可选目标为日志字符串
  formatAllowedTargets(actionType, extraData) {
    // choice 类型（如女巫的救/毒/跳过）
    if (extraData?.healAvailable !== undefined || extraData?.poisonAvailable !== undefined) {
      const options = [];
      if (extraData?.healAvailable) options.push('救');
      if (extraData?.poisonAvailable) options.push('毒');
      options.push('跳过');
      return options.join('/');
    }

    // target 类型（如守卫、预言家、猎人、传警徽、指定发言顺序等）
    if (extraData?.allowedTargets?.length > 0) {
      return extraData.allowedTargets.map(id => {
        const target = this.game.players.find(p => p.id === id);
        return target ? `${id}号${target.name}` : `${id}号`;
      }).join(', ');
    }

    // passBadge 和 assignOrder：从存活玩家中排除自己
    if (actionType === 'passBadge' || actionType === 'assignOrder') {
      const player = this.getPlayer();
      const targets = this.game.players.filter(p => p.alive && p.id !== player?.id);
      if (targets.length > 0) {
        return targets.map(p => `${p.id}号${p.name}`).join(', ');
      }
      return '无存活玩家';
    }

    // cupid 类型（连接两个玩家）
    if (actionType === 'cupid' && extraData?.allowedTargets?.length >= 2) {
      return extraData.allowedTargets.map(id => `${id}号`).join(', ');
    }

    return '无';
  }

  // 标准化 action 格式
  normalizeAction(action, actionType, extraData) {
    // 处理特定技能类型的 action 转换
    switch (actionType) {
      case 'witch':
        // 女巫技能：heal/poison/skip
        if (action?.type === 'heal') {
          return { action: 'heal' };
        }
        if (action?.type === 'poison') {
          return { action: 'poison', targetId: action.target ? parseInt(action.target) : null };
        }
        return { action: 'skip' };

      case 'cupid':
        // 丘比特连线
        if (action?.targetIds) {
          return { targetIds: action.targetIds };
        }
        return { targetIds: action?.target ? [parseInt(action.target)] : [] };

      case 'campaign':
        // 竞选：支持 confirmed 格式（RandomAgent）和 run 格式（测试/MockAI）
        return { run: action?.confirmed === true || action?.run === true };

      case 'withdraw':
        // 退水：支持 confirmed 格式和 withdraw 格式（测试/MockAI）
        return { withdraw: action?.confirmed === true || action?.withdraw === true };

      case 'shoot':
      case 'passBadge':
        // 猎人开枪 / 传警徽
        return { target: action?.target ? parseInt(action.target) : null };

      default:
        // 默认：target 类型
        return { target: action?.target ? parseInt(action.target) : null };
    }
  }

  }

/**
 * AI 管理器
 */
class AIManager {
  constructor(gameEngine) {
    this.game = gameEngine;
    this.controllers = new Map();
  }

  // 创建 AI 控制器
  createAI(playerId, options = {}) {
    const controller = new AIController(playerId, this.game, options);
    this.controllers.set(playerId, controller);
    return controller;
  }

  // 获取 AI 控制器
  get(playerId) {
    return this.controllers.get(playerId);
  }

  // 清空
  clear() {
    this.controllers.clear();
  }

  // 获取所有 AI 玩家 ID
  getAllPlayerIds() {
    return Array.from(this.controllers.keys());
  }
}

module.exports = { AIController, AIManager };