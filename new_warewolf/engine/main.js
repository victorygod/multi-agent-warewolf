/**
 * GameEngine - 底层 API 提供者
 * 只提供投票、发言、技能等基础方法
 * 业务流程逻辑都在 phase.js 的 execute 函数里
 */

const { EventEmitter } = require('./event');
const { MessageManager } = require('./message');
const { PhaseManager } = require('./phase');
const { VoteManager } = require('./vote');
const { NightManager } = require('./night');
const { HOOKS } = require('./config');
const { createPlayerRole } = require('./roles');
const { HumanController } = require('./player');
const {
  shuffle,
  getSpeakerOrder,
  getPosition,
  getPlayerDisplay
} = require('./utils');
const { createLogger } = require('../utils/logger');

// 创建日志实例（延迟初始化）
let backendLogger = null;
function getLogger() {
  if (!backendLogger) {
    backendLogger = createLogger('backend.log');
  }
  return backendLogger;
}

class GameEngine extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = { hooks: HOOKS, ...config };
    this.message = new MessageManager();

    // 游戏状态
    this.players = [];
    this.nightCount = 0;
    this.dayCount = 0;
    this.winner = null;

    // 夜晚状态
    this.werewolfTarget = null;
    this.guardTarget = null;
    this.healTarget = null;
    this.poisonTarget = null;

    // 投票
    this.votes = {};

    // 特殊状态
    this.couples = null;
    this.sheriff = null;
    this.sheriffAssignOrder = null;  // 警长指定的发言顺序
    this.deathQueue = [];
    this.lastWordsPlayer = null;
    this.lastDeathPlayer = null;  // 上一轮死亡的第一位玩家
    this._lastNightDeaths = [];  // 上一晚的死亡信息（用于公布死讯）

    // 阶段管理器
    this.phaseManager = null;
    this.getAIController = null;  // 由 server.js 设置

    // 子管理器
    this.voteManager = new VoteManager(this);
    this.nightManager = new NightManager(this);

    // WebSocket 等待机制
    this._pendingRequests = new Map(); // requestId -> { resolve, timeout }

    // 即时中断标记（用于自爆等即时技能）
    this.interrupt = null; // { type: 'explode', playerId }

    // 发言队列跟踪（用于重连时恢复发言状态）
    this._speechQueue = []; // 待发言的玩家 ID 列表
    this._currentSpeakerId = null; // 当前发言的玩家 ID
  }

  // ========== 即时行动 API ==========

  // 狼人自爆
  explode(playerId) {
    const player = this.players.find(p => p.id === playerId);

    // 基础验证
    if (!player?.alive) return { success: false, message: '玩家已死亡' };
    if (this.config.hooks.getCamp(player, this) !== 'wolf') {
      return { success: false, message: '只有狼人可以自爆' };
    }

    // 获取自爆技能定义
    const skill = player.role?.skills?.explode;
    if (!skill) return { success: false, message: '技能不存在' };

    const currentPhase = this.phaseManager?.getCurrentPhase()?.id;

    // 验证阶段限制
    if (skill.availablePhases && !skill.availablePhases.includes(currentPhase)) {
      return { success: false, message: '当前阶段不能自爆' };
    }

    // 验证 canUse
    if (skill.canUse && !skill.canUse(player, this)) {
      return { success: false, message: '当前无法使用此技能' };
    }

    // 调用 role 中的技能执行
    skill.execute(null, player, this);

    // 设置中断标记（由 phase 检测并跳转）
    this.interrupt = { type: 'explode', playerId };

    // 取消当前所有待处理请求
    this.cancelAllPendingRequests();

    return { success: true };
  }

  // 取消所有待处理请求
  cancelAllPendingRequests() {
    for (const [requestId, pending] of this._pendingRequests) {
      clearTimeout(pending.timeout);
      this._pendingRequests.delete(requestId);
      // 拒绝等待中的请求
      pending.resolve({ cancelled: true, reason: 'explode' });
    }
  }

  // ========== 行动数据构建（配置化） ==========

  /**
   * 构建行动请求的完整数据
   * @param {number} playerId - 玩家ID
   * @param {string} actionType - 行动类型 (guard, witch, vote, etc.)
   * @param {Object} extraData - 额外数据 (werewolfTarget, healAvailable, etc.)
   * @returns {Object} 行动数据
   */
  buildActionData(playerId, actionType, extraData = {}) {
    const player = this.players.find(p => p.id === playerId);
    if (!player) {
      return { requestId: `${playerId}-${actionType}-${Date.now()}`, action: actionType };
    }

    const baseData = {
      requestId: extraData?.requestId || `${playerId}-${actionType}-${Date.now()}`,
      action: actionType
    };

    const filters = this.config.hooks?.ACTION_FILTERS;

    // 根据行动类型构建数据
    switch (actionType) {
      case 'guard': {
        const lastTarget = player.state?.lastGuardTarget;
        const filter = filters?.guard;
        const allowedTargets = filter ? filter(this, player) : null;
        return { ...baseData, lastGuardTarget: lastTarget, allowedTargets };
      }

      case 'witch': {
        const werewolfTarget = extraData?.werewolfTarget || this.werewolfTarget;
        const filter = filters?.witch_poison;
        const poisonTargets = filter ? filter(this, player, { werewolfTarget }) : null;
        return {
          ...baseData,
          werewolfTarget,
          healAvailable: extraData?.healAvailable ?? (player.state?.heal > 0),
          poisonAvailable: extraData?.poisonAvailable ?? (player.state?.poison > 0),
          canSelfHeal: extraData?.canSelfHeal ?? (this.dayCount > 1),
          poisonTargets
        };
      }

      case 'seer': {
        const checkedIds = (player.state?.seerChecks || []).map(c => c.targetId);
        const filter = filters?.seer;
        const allowedTargets = filter ? filter(this, player) : null;
        return { ...baseData, checkedIds, allowedTargets: allowedTargets?.length > 0 ? allowedTargets : null };
      }

      case 'cupid':
        return { ...baseData, count: 2 };

      case 'vote':
      case 'sheriff_vote': {
        const filter = filters?.vote;
        const allowedTargets = filter ? filter(this, player) : null;
        return { ...baseData, allowedTargets };
      }

      case 'wolf_vote': {
        const filter = filters?.wolf_vote;
        const allowedTargets = filter ? filter(this, player) : null;
        return { ...baseData, allowedTargets };
      }

      case 'shoot': {
        const filter = filters?.shoot;
        const allowedTargets = filter ? filter(this, player) : null;
        return { ...baseData, allowedTargets };
      }

      case 'passBadge': {
        const filter = filters?.pass_badge;
        const allowedTargets = filter ? filter(this, player) : null;
        return { ...baseData, allowedTargets };
      }

      case 'assignOrder': {
        // 警长指定发言顺序：可选所有存活玩家（除自己）
        const aliveOthers = this.players
          .filter(p => p.alive && p.id !== player.id)
          .map(p => p.id);
        return { ...baseData, allowedTargets: aliveOthers };
      }

      case 'campaign':
      case 'withdraw':
      case 'speak':
      case 'last_words':
      case 'explode':
        return baseData;

      default:
        return baseData;
    }
  }

  // ========== 玩家行动 API（统一封装，phase 只调这些） ==========

  // 获取玩家控制器（AI 或人类）
  getPlayerController(playerId) {
    const player = this.players.find(p => p.id === playerId);
    if (!player) return null;

    // 如果是 AI 玩家，使用 AIController（由 server.js 通过 getAIController 设置）
    if (player.isAI) {
      const aiController = this.getAIController?.(playerId);
      if (aiController) {
        return aiController;
      }
      getLogger().warn(`AI 玩家 ${player.name} 没有 controller`);
      return null;
    }

    // 人类玩家返回 HumanController
    return new HumanController(playerId, this);
  }

  // 让玩家发言 - 支持单个 playerId 或数组
  async callSpeech(playerId, actionType = 'speak', visibility = 'public') {
    // 支持数组输入
    if (Array.isArray(playerId)) {
      // 初始化发言队列
      this._speechQueue = [...playerId];
      for (const id of playerId) {
        await this.callSpeech(id, actionType, visibility);
      }
      // 清空发言队列
      this._speechQueue = [];
      this._currentSpeakerId = null;
      return;
    }

    const player = this.players.find(p => p.id === playerId);
    if (!player) return;

    // 设置当前发言者
    this._currentSpeakerId = playerId;

    // 使用统一的 PlayerController
    const controller = this.getPlayerController(playerId);

    // 使用 controller 获取发言内容
    if (controller && typeof controller.getSpeechResult === 'function') {
      const result = await controller.getSpeechResult(visibility, actionType);
      this.speak(playerId, result.content, visibility, actionType);
    }

    // 从队列中移除已发言的玩家
    const index = this._speechQueue.indexOf(playerId);
    if (index > -1) {
      this._speechQueue.splice(index, 1);
    }
  }

  // 让玩家投票 - 支持单个 playerId 或数组
  async callVote(playerId, actionType = 'vote', extraData = {}) {
    // 支持数组输入
    if (Array.isArray(playerId)) {
      await Promise.all(playerId.map(id => this.callVote(id, actionType, extraData)));
      return;
    }

    const player = this.players.find(p => p.id === playerId);
    if (!player) return;

    // 使用统一的 PlayerController
    const controller = this.getPlayerController(playerId);

    // 使用 controller 获取投票结果（传递 actionType 以区分狼人投票和白天的投票）
    if (controller && typeof controller.getVoteResult === 'function') {
      const result = await controller.getVoteResult(actionType, extraData);
      const targetId = result?.targetId;
      // 跳过无效投票（如没有可选目标时返回null）
      if (targetId !== null && targetId !== undefined) {
        this.vote(playerId, targetId, extraData);
      }
    }
  }

  // 让玩家使用技能 - 支持单个 playerId 或数组（通过 role.skills 驱动）
  async callSkill(playerId, actionType = 'choose_target', extraData = {}) {
    // 支持数组输入
    if (Array.isArray(playerId)) {
      for (const id of playerId) {
        await this.callSkill(id, actionType, extraData);
      }
      return;
    }

    const player = this.players.find(p => p.id === playerId);
    if (!player) return;

    // 允许死亡玩家使用特定技能（passBadge: 警长传警徽, shoot: 猎人开枪）
    const deadPlayerAllowedSkills = ['passBadge', 'shoot'];
    if (!player.alive && !deadPlayerAllowedSkills.includes(actionType)) return;

    // 使用 buildActionData 计算 allowedTargets，传递给 controller
    const actionData = this.buildActionData(playerId, actionType, extraData);
    const enrichedExtraData = {
      ...extraData,
      allowedTargets: actionData.allowedTargets,
      checkedIds: actionData.checkedIds,
      lastGuardTarget: actionData.lastGuardTarget,
      werewolfTarget: actionData.werewolfTarget,
      healAvailable: actionData.healAvailable,
      poisonAvailable: actionData.poisonAvailable,
      canSelfHeal: actionData.canSelfHeal,
      poisonTargets: actionData.poisonTargets
    };

    // 使用统一的 PlayerController
    const controller = this.getPlayerController(playerId);
    if (controller && typeof controller.useSkill === 'function') {
      return await controller.useSkill(actionType, enrichedExtraData);
    }
  }

  // ========== WebSocket 请求-响应机制 ==========

  // 请求玩家行动，等待响应
  requestAction(playerId, actionType, data = {}) {
    return new Promise((resolve, reject) => {
      const requestId = `${playerId}-${actionType}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      // 设置超时（5分钟）
      const timeout = setTimeout(() => {
        this._pendingRequests.delete(requestId);
        reject(new Error('操作超时'));
      }, 5 * 60 * 1000);

      this._pendingRequests.set(requestId, { resolve, timeout, playerId, actionType, data });

      // 发送请求给玩家
      this.emit('player:action', {
        playerId,
        data: {
          requestId,
          action: actionType,
          ...data
        }
      });
    });
  }

  // 收到玩家响应
  handleResponse(playerId, requestId, responseData) {
    const pending = this._pendingRequests.get(requestId);
    if (pending && pending.playerId === playerId) {
      clearTimeout(pending.timeout);
      this._pendingRequests.delete(requestId);
      pending.resolve(responseData);
      return true;
    }
    return false;
  }

  // 取消玩家的所有待处理请求
  cancelPendingRequests(playerId) {
    for (const [requestId, pending] of this._pendingRequests) {
      if (pending.playerId === playerId) {
        clearTimeout(pending.timeout);
        this._pendingRequests.delete(requestId);
      }
    }
  }

  // ========== 玩家行动 API ==========

  // 发言
  speak(playerId, content, visibility = 'public', actionType = 'speak') {
    const player = this.players.find(p => p.id === playerId);
    if (!player) return;

    // 遗言使用不同的消息类型
    const messageType = actionType === 'last_words' ? 'last_words' : 'speech';

    this.message.add({
      type: messageType,
      content,
      playerId,
      playerName: player.name,
      visibility
    });
    // 消息添加会自动触发实时同步，无需额外事件
  }

  // 投票
  vote(voterId, targetId, extraData = {}) {
    const voter = this.players.find(p => p.id === voterId);
    if (!voter) throw new Error('投票者不存在');

    // 检查是否限制了投票目标（如PK投票只能投给平票候选人）
    if (extraData?.allowedTargets && !extraData.allowedTargets.includes(Number(targetId))) {
      throw new Error('只能投票给平票候选人');
    }

    // 确保键为字符串类型，保持一致性
    const key = String(voterId);

    // 检查是否已投票
    if (this.votes[key] !== undefined) {
      throw new Error('你已投票');
    }

    this.votes[key] = targetId;
    // 投票结果在投票阶段结束后通过 message 统一广播
  }

  // ========== 统一死亡处理 ==========

  /**
   * 处理玩家死亡
   * @param {Object} player - 死亡玩家对象
   * @param {string} reason - 死亡原因：wolf/poison/vote/hunter/couple/conflict
   * @returns {Object} 处理结果 { hasLastWords, lastWordsPlayer }
   */
  handleDeath(player, reason) {
    if (!player || !player.alive) {
      return { hasLastWords: false, lastWordsPlayer: null };
    }

    // 1. 标记玩家死亡
    player.alive = false;
    player.deathReason = reason;

    // 2. 警长死亡处理
    let sheriffResult = null;
    if (this.sheriff === player.id) {
      // 需要传警徽，设置为特殊标记，稍后在前端处理
      player.state = player.state || {};
      player.state.sheriffDied = true;
    }

    // 3. 触发角色死亡事件（猎人、白痴、丘比特）
    if (player.role?.events?.['player:death']) {
      player.role.events['player:death']({ player, reason }, this, player);
    }

    // 4. 触发附加身份死亡事件（情侣殉情）
    if (this.couples?.includes(player.id)) {
      const { ATTACHMENTS } = require('./roles');
      const coupleAttachment = ATTACHMENTS.couple;
      if (coupleAttachment?.events?.['player:death']) {
        coupleAttachment.events['player:death']({ player, reason }, this, player);
      }
    }

    // 5. 检查遗言（死亡消息在 phase.js 的 day_announce 阶段统一发送）
    const canHaveLastWords = this.config.hooks?.hasLastWords(player, reason, this);
    const needsLastWords = canHaveLastWords && player.state?.canSpeak !== false;

    return {
      hasLastWords: needsLastWords,
      lastWordsPlayer: needsLastWords ? player : null
    };
  }

  /**
   * 处理死亡玩家的技能（如猎人射击）
   * @param {Object} deadPlayer - 死亡的玩家
   * @param {string} currentPhase - 当前阶段
   */
  async handleDeathAbility(deadPlayer, currentPhase) {
    if (!deadPlayer?.role?.skills) return;

    for (const [skillId, ability] of Object.entries(deadPlayer.role.skills)) {
      // 检查技能是否有 availablePhases 且当前阶段匹配
      if (!ability.availablePhases?.includes(currentPhase)) continue;

      // 检查 canUse 条件（传入死亡原因和 extraData）
      const extraData = { deathReason: deadPlayer.deathReason, isNight: currentPhase === 'hunter_night' };
      if (ability.canUse && !ability.canUse(deadPlayer, this, extraData)) continue;

      // 使用统一的 callSkill
      await this.callSkill(deadPlayer.id, skillId, extraData);
      break; // 每个死亡玩家只触发一个技能
    }

    // 处理警长传警徽（附加身份技能，不在 role.skills 中）
    if (deadPlayer.id === this.sheriff && !deadPlayer.alive) {
      const { ATTACHMENTS } = require('./roles');
      const sheriffAttachment = ATTACHMENTS.sheriff;
      const passBadgeSkill = sheriffAttachment?.skills?.passBadge;
      if (passBadgeSkill?.availablePhases?.includes(currentPhase)) {
        const extraData = { deathReason: deadPlayer.deathReason, isNight: currentPhase === 'hunter_night' };
        if (!passBadgeSkill.canUse || passBadgeSkill.canUse(deadPlayer, this, extraData)) {
          // 直接执行技能，不通过 callSkill（因为 callSkill 检查 role.skills）
          const controller = this.getPlayerController(deadPlayer.id);
          let target = null;
          if (controller && typeof controller.useSkill === 'function') {
            const result = await controller.useSkill('passBadge', extraData);
            if (result?.targetId) {
              target = this.players.find(p => p.id === result.targetId);
            }
          }
          // 执行 passBadge 技能逻辑
          passBadgeSkill.execute(target, deadPlayer, this);
        }
      }
    }
  }

  // ========== 游戏流程 ==========

  // 开始游戏
  async start() {
    this.phaseManager = new PhaseManager(this);
    try {
      await this.phaseManager.start();
    } catch (e) {
      getLogger().error(`游戏执行错误: ${e.message}`);
    }
  }

  // 获取游戏结束信息
  getGameOverInfo() {
    return {
      winner: this.winner,
      players: this.players.map(p => ({
        id: p.id,
        name: p.name,
        display: getPlayerDisplay(this.players, p),
        alive: p.alive,
        role: p.role,
        deathReason: p.deathReason,
        isSheriff: this.sheriff === p.id
      }))
    };
  }

  // 获取玩家可见状态
  getState(playerId) {
    const player = this.players.find(p => p.id === playerId);
    const phase = this.phaseManager?.getCurrentPhase();

    // 如果游戏已结束，确保 phase 返回 game_over
    const currentPhaseId = this.winner ? 'game_over' : (phase?.id || 'waiting');

    const state = {
      phase: currentPhaseId,
      players: this.players.map(p => ({
        id: p.id,
        name: p.name,
        alive: p.alive,
        isAI: p.isAI,
        role: p.role,
        // 额外状态信息
        deathReason: p.deathReason,
        hasLastWords: p.hasLastWords,
        revealed: p.state?.revealed,
        canVote: p.state?.canVote !== false,
        canSpeak: this.canSpeak(p),
        isSheriff: this.sheriff === p.id,
        isCouple: this.couples?.includes(p.id),
        couplePartner: this.couples?.includes(p.id)
          ? this.couples.find(id => id !== p.id)
          : null
      })),
      messages: [],
      sheriff: this.sheriff,
      couples: this.couples?.includes(playerId) ? this.couples : null,
      playerCount: this.playerCount || 9,
      dayCount: this.dayCount,
      winner: this.winner,
      // 游戏结束时的完整信息
      gameOverInfo: this.winner ? {
        winner: this.winner,
        players: this.players.map(p => ({
          id: p.id,
          name: p.name,
          alive: p.alive,
          role: p.role,
          deathReason: p.deathReason,
          isSheriff: this.sheriff === p.id
        }))
      } : null,
      // 夜间行动状态（用于前端显示）
      nightActions: {
        werewolfTarget: this.werewolfTarget,
        guardTarget: this.guardTarget,
        healTarget: this.healTarget,
        poisonTarget: this.poisonTarget
      },
      // 发言队列（用于重连时恢复发言状态）
      speechQueue: this._speechQueue || [],
      currentSpeakerId: this._currentSpeakerId,
      // 警长指定的发言起始位置
      sheriffAssignOrder: this.sheriffAssignOrder
    };

    if (player) {
      // 获取守卫的上一晚守护目标
      let lastGuardTarget = null;
      if (player.role?.id === 'guard') {
        lastGuardTarget = player.state?.lastGuardTarget;
      }

      state.self = {
        id: player.id,
        name: player.name,
        role: player.role,
        state: player.state,
        alive: player.alive,
        // 私有信息
        isCouple: this.couples?.includes(player.id),
        couplePartner: this.couples?.includes(player.id)
          ? this.couples.find(id => id !== player.id)
          : null,
        // 守卫上一晚守护的目标（用于前端禁用）
        lastGuardTarget: lastGuardTarget,
        // 预言家查验历史
        seerChecks: player.state?.seerChecks || [],
        // 女巫药水量
        witchHeal: player.state?.heal,
        witchPoison: player.state?.poison,
        // 猎人是否可以开枪
        hunterCanShoot: player.state?.canShoot,
        // 白痴是否已翻牌
        idiotRevealed: player.state?.revealed
      };
      state.messages = this.message.getVisibleTo(player, this);
    }

    // 构建 pendingAction
    let pendingAction = null;
    for (const [requestId, pending] of this._pendingRequests) {
      if (pending.playerId === playerId) {
        const actionData = this.buildActionData(playerId, pending.actionType, pending.data || {});
        // 保留原始的 requestId，不使用 buildActionData 生成的（避免覆盖导致响应不匹配）
        const { requestId: _, ...restActionData } = actionData;
        pendingAction = { requestId, ...restActionData };
        break;
      }
    }
    state.pendingAction = pendingAction;

    return state;
  }

  // 分配角色
  assignRoles() {
    // 如果已经有角色了，跳过
    if (this.players.some(p => p.role)) {
      getLogger().debug('角色已分配，跳过');
      return;
    }

    const count = this.players.length;

    // 角色配置：村民、狼人、预言家、女巫、猎人、守卫、丘比特、白痴
    // 9人局：3狼、预言家、女巫、猎人、村民x3（共9人）
    const roles9 = ['werewolf', 'werewolf', 'werewolf', 'seer', 'witch', 'hunter', 'villager', 'villager', 'villager'];
    // 12人局：4狼、预言家、女巫、猎人、守卫、丘比特、白痴、村民x4
    const roles12 = ['werewolf', 'werewolf', 'werewolf', 'werewolf', 'seer', 'witch', 'hunter', 'guard', 'cupid', 'idiot', 'villager', 'villager'];

    let roles = count <= 9 ? roles9.slice(0, count) : roles12.slice(0, count);
    shuffle(roles);

    for (const player of this.players) {
      // Debug 模式：使用玩家选择的角色
      let roleId;
      if (player.debugRole) {
        // 先从池中找该角色
        const idx = roles.indexOf(player.debugRole);
        if (idx !== -1) {
          roleId = roles.splice(idx, 1)[0];
        } else {
          // 如果已被其他 debug 玩家使用，从剩余角色中随机
          roleId = roles.splice(Math.floor(Math.random() * roles.length), 1)[0];
        }
      } else {
        roleId = roles.splice(Math.floor(Math.random() * roles.length), 1)[0];
      }
      const role = createPlayerRole(roleId);
      if (!role) {
        getLogger().error(`无法创建角色: ${roleId}, 玩家: ${player.name}`);
        continue;
      }
      player.role = role;
      player.state = role.state ? { ...role.state } : {};
    }

    // 随机打乱玩家在数组中的位置（用于发言顺序等），但不改变 ID
    shuffle(this.players);
  }

  // ========== 发言顺序相关方法 ==========

  // 检查玩家是否能发言
  canSpeak(player) {
    if (!player.alive) return false;
    // 白痴翻牌后不能发言
    if (player.role?.id === 'idiot' && player.state?.revealed) return false;
    return true;
  }

  // 计算发言顺序
  getSpeakerOrder() {
    return getSpeakerOrder(this.players, {
      sheriff: this.sheriff,
      sheriffAssignOrder: this.sheriffAssignOrder,
      lastDeathPlayer: this.lastDeathPlayer,
      canSpeak: this.canSpeak.bind(this)
    });
  }

  // 获取玩家位置（编号）
  getPosition(playerId) {
    return getPosition(this.players, playerId);
  }

  // 记录本轮死亡的第一位玩家（用于下一轮发言顺序）
  recordLastDeath() {
    if (this.deathQueue.length > 0) {
      this.lastDeathPlayer = this.deathQueue[0].id;
    }
  }

  // 警长指定发言起始位置
  setSheriffOrder(startPlayerId) {
    this.sheriffAssignOrder = startPlayerId;
  }
}

module.exports = { GameEngine };