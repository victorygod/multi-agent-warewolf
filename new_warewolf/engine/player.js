/**
 * PlayerController - 统一的玩家控制器接口
 * 将 AI 和人类的调用封装到统一接口中
 * phase.js 只调用这个接口，不关心是 AI 还是人类
 */

const { createLogger } = require('../utils/logger');

// 创建日志实例（延迟初始化）
let backendLogger = null;
function getLogger() {
  if (!backendLogger) {
    backendLogger = createLogger('backend.log');
  }
  return backendLogger;
}

/**
 * 玩家控制器基类 - 定义统一接口
 */
class PlayerController {
  constructor(playerId, game) {
    this.playerId = playerId;
    this.game = game;
  }

  // ========== 公共方法 ==========

  // 获取玩家
  getPlayer() {
    return this.game.players.find(p => p.id === this.playerId);
  }

  // 获取游戏状态
  getState() {
    return this.game.getState(this.playerId);
  }

  // 获取可见消息
  getVisibleMessages() {
    const player = this.getPlayer();
    return this.game.message.getVisibleTo(player, this.game);
  }

  // 获取技能定义
  getSkill(actionType) {
    const player = this.getPlayer();
    if (!player) return null;

    // 优先从角色获取
    let skill = player.role?.skills?.[actionType];

    // 全局机制技能（不绑定特定角色）
    const globalMechanicSkills = ['campaign', 'withdraw', 'assignOrder', 'passBadge'];
    if (!skill && globalMechanicSkills.includes(actionType)) {
      const { ATTACHMENTS } = require('./roles');
      skill = ATTACHMENTS.sheriff?.skills?.[actionType];
    }

    // 添加 id 属性（用于判断技能类型）
    if (skill && !skill.id) {
      skill.id = actionType;
    }

    return skill;
  }

  // 格式化可选目标为日志字符串
  formatAllowedTargets(actionType, extraData, requestData) {
    // choice 类型（如女巫的救/毒/跳过）
    if (extraData?.healAvailable !== undefined || extraData?.poisonAvailable !== undefined) {
      const options = [];
      if (extraData?.healAvailable) options.push('救');
      if (extraData?.poisonAvailable) options.push('毒');
      options.push('跳过');
      return options.join('/');
    }

    // target 类型（如守卫、预言家、猎人等）
    if (extraData?.allowedTargets?.length > 0) {
      return extraData.allowedTargets.map(id => {
        const player = this.game.players.find(p => p.id === id);
        return player ? `${id}号${player.name}` : `${id}号`;
      }).join(', ');
    }

    // 从 requestData.aliveList 解析
    if (requestData?.aliveList) {
      return requestData.aliveList.replace(/\n/g, ', ');
    }

    // cupid 类型（连接两个玩家）
    if (actionType === 'cupid' && extraData?.allowedTargets?.length >= 2) {
      return extraData.allowedTargets.map(id => `${id}号`).join(', ');
    }

    return '无';
  }

  // 验证技能可用性
  canUseSkill(skill, extraData = {}) {
    const player = this.getPlayer();
    if (!player) return { ok: false, message: '玩家不存在' };

    const currentPhase = this.game.phaseManager?.getCurrentPhase()?.id;

    // 检查阶段限制
    if (skill.availablePhases && !skill.availablePhases.includes(currentPhase)) {
      return { ok: false, message: '该技能在当前阶段不可用' };
    }

    // 检查 canUse 条件
    if (skill.canUse && !skill.canUse(player, this.game, extraData)) {
      return { ok: false, message: '当前无法使用此技能' };
    }

    return { ok: true };
  }

  // 执行技能（公共逻辑）
  executeSkill(skill, action, extraData = {}) {
    const player = this.getPlayer();
    if (!player) return { success: false, message: '玩家不存在' };

    switch (skill.type) {
      case 'target':
        return this.executeTargetSkill(skill, player, action, extraData);

      case 'double_target':
        return this.executeDoubleTargetSkill(skill, player, action);

      case 'choice':
        return this.executeChoiceSkill(skill, player, action);

      case 'instant':
        return this.executeInstantSkill(skill, player, action);

      default:
        return { success: false, message: '未知的技能类型' };
    }
  }

  // target 类型技能执行
  executeTargetSkill(skill, player, action, extraData) {
    // 兼容 target 和 targetId 两种格式
    const targetId = action?.target ? parseInt(action.target) :
                     action?.targetId ? parseInt(action.targetId) : null;

    // 猎人开枪：允许 targetId 为 null（放弃开枪）
    if (skill.id === 'shoot' && !targetId) {
      skill.execute(null, player, this.game);
      return { success: true, targetId: null };
    }

    if (!targetId) {
      return { success: false, message: '未选择目标' };
    }

    const target = this.game.players.find(p => p.id === targetId);
    if (!target) {
      return { success: false, message: '目标不存在' };
    }

    if (skill.validate && !skill.validate(target, player, this.game)) {
      return { success: false, message: '目标无效' };
    }

    skill.execute(target, player, this.game);
    return { success: true, targetId };
  }

  // double_target 类型技能执行（丘比特）
  executeDoubleTargetSkill(skill, player, action) {
    const targetIds = action?.targetIds;
    if (!targetIds || targetIds.length !== 2) {
      return { success: false, message: '需要选择两个目标' };
    }

    const targets = targetIds.map(id => this.game.players.find(p => p.id === id)).filter(t => t);
    if (targets.length !== 2) {
      return { success: false, message: '目标无效' };
    }

    if (skill.validate && !skill.validate(targets, player, this.game)) {
      return { success: false, message: '目标无效' };
    }

    skill.execute(targets, player, this.game);
    return { success: true, targetIds };
  }

  // choice 类型技能执行（女巫）
  executeChoiceSkill(skill, player, action) {
    const choice = action || { action: 'skip' };
    const result = skill.execute(choice, player, this.game);
    return { success: true, ...result };
  }

  // instant 类型技能执行（竞选、退水、自爆）
  executeInstantSkill(skill, player, action) {
    const confirmed = action?.confirmed || action?.run || action?.withdraw;
    if (confirmed) {
      skill.execute(null, player, this.game);
      // 根据技能类型返回对应格式，保持与 phase.js 兼容
      if (skill.id === 'campaign') return { success: true, run: true };
      if (skill.id === 'withdraw') return { success: true, withdraw: true };
      return { success: true, confirmed: true };
    }
    // 失败时也返回对应格式
    if (skill.id === 'campaign') return { success: false, run: false };
    if (skill.id === 'withdraw') return { success: false, withdraw: false };
    return { success: false, confirmed: false };
  }

  // ========== 抽象方法（子类实现）==========

  // 获取发言决策结果
  async getSpeechResult(visibility = 'public', actionType = 'speak') {
    throw new Error('Not implemented');
  }

  // 获取投票决策结果（actionType 用于区分狼人投票和白天的投票）
  async getVoteResult(actionType = 'vote', extraData = {}) {
    throw new Error('Not implemented');
  }

  // 使用技能
  async useSkill(actionType, extraData = {}) {
    throw new Error('Not implemented');
  }
}

/**
 * 人类玩家控制器 - 通过 requestAction 调用
 */
class HumanController extends PlayerController {
  // 获取发言决策结果
  async getSpeechResult(visibility = 'public', actionType = 'speak') {
    const response = await this.game.requestAction(this.playerId, actionType, { visibility });
    return { content: response?.content || '' };
  }

  // 获取投票决策结果（actionType 用于区分狼人投票和白天的投票）
  async getVoteResult(actionType = 'vote', extraData = {}) {
    const response = await this.game.requestAction(this.playerId, actionType, extraData);
    return { targetId: response?.targetId };
  }

  // 使用技能
  async useSkill(actionType, extraData = {}) {
    const skill = this.getSkill(actionType);
    if (!skill) return { success: false, message: '技能不存在' };

    const validation = this.canUseSkill(skill, extraData);
    if (!validation.ok) return { success: false, message: validation.message };

    // 根据技能类型请求不同的响应格式
    const requestData = this.buildSkillRequest(skill, extraData);

    // 记录技能请求的可选目标
    const player = this.getPlayer();
    const 可选目标 = this.formatAllowedTargets(actionType, extraData, requestData);
    getLogger().info(`${player?.name} 使用技能 ${actionType}，可选: ${可选目标}`);

    const response = await this.game.requestAction(this.playerId, actionType, requestData);

    // 执行技能
    return this.executeSkill(skill, response, extraData);
  }

  // 构建技能请求数据
  buildSkillRequest(skill, extraData) {
    switch (skill.type) {
      case 'target':
      case 'double_target':
        return {
          aliveList: this.game.players.filter(p => p.alive).map(p => `${p.id}号: ${p.name}`).join('\n'),
          ...extraData
        };

      case 'choice':
        return extraData;

      case 'instant':
        return {};

      default:
        return extraData;
    }
  }
}

module.exports = {
  PlayerController,
  HumanController
};