/**
 * GameEngine - 底层 API 提供者
 * 只提供投票、发言、技能等基础方法
 * 业务流程逻辑都在 phase.js 的 execute 函数里
 */

const { EventEmitter } = require('./event');
const { MessageManager } = require('./message');
const { PhaseManager } = require('./phase');
const { VoteManager } = require('./vote');
const { HOOKS, BOARD_PRESETS, getEffectiveRules } = require('./config');
const { createPlayerRole } = require('./roles');
const { HumanController } = require('./player');
const {
  shuffle,
  getSpeakerOrder,
  getPlayerDisplay
} = require('./utils');
const { createLogger } = require('../utils/logger');
const { PHASE, ACTION, MSG, VISIBILITY, CAMP, DEATH_REASON } = require('./constants');
const { buildMessage } = require('./message_template');

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

    // 板子预设
    this.presetId = config.presetId || null;
    this.preset = this.presetId ? BOARD_PRESETS[this.presetId] : null;
    this.effectiveRules = this.preset ? getEffectiveRules(this.preset) : JSON.parse(JSON.stringify(HOOKS.RULES));
    this._playerCount = null; // 手动设置的值，优先于 preset

    // 游戏状态
    this.players = [];
    this.round = 1;
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

    // WebSocket 等待机制
    this._pendingRequests = new Map(); // requestId -> { resolve, timeout }

    // 即时中断标记（用于自爆等即时技能）
    this.interrupt = null; // { type: 'explode', playerId }

    // 发言队列跟踪（用于重连时恢复发言状态）
    this._speechQueue = []; // 待发言的玩家 ID 列表
    this._currentSpeakerId = null; // 当前发言的玩家 ID
  }

  // playerCount: 手动设置优先，否则从 preset 派生
  get playerCount() {
    return this._playerCount ?? this.preset?.playerCount ?? 9;
  }

  set playerCount(val) {
    this._playerCount = val;
  }

  // ========== 即时行动 API ==========

  // 狼人自爆
  explode(playerId) {
    const player = this.players.find(p => p.id === playerId);

    // 基础验证
    if (!player?.alive) return { success: false, message: '玩家已死亡' };
    if (this.config.hooks.getCamp(player, this) !== CAMP.WOLF) {
      return { success: false, message: '只有狼人可以自爆' };
    }

    // 获取自爆技能定义
    const skill = player.role?.skills?.[ACTION.EXPLODE];
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
      case ACTION.GUARD: {
        const lastTarget = player.state?.lastGuardTarget;
        const filter = filters?.[ACTION.GUARD];
        const allowedTargets = filter ? filter(this, player) : null;
        return { ...baseData, lastGuardTarget: lastTarget, allowedTargets };
      }

      case ACTION.WITCH: {
        const werewolfTarget = extraData?.werewolfTarget || this.werewolfTarget;
        const filter = filters?.[ACTION.WITCH_POISON];
        const poisonTargets = filter ? filter(this, player, { werewolfTarget }) : null;
        return {
          ...baseData,
          werewolfTarget,
          healAvailable: extraData?.healAvailable ?? (player.state?.heal > 0),
          poisonAvailable: extraData?.poisonAvailable ?? (player.state?.poison > 0),
          canSelfHeal: extraData?.canSelfHeal ?? (this.round === 1),
          poisonTargets
        };
      }

      case ACTION.SEER: {
        const checkedIds = (player.state?.seerChecks || []).map(c => c.targetId);
        const filter = filters?.[ACTION.SEER];
        const allowedTargets = filter ? filter(this, player) : null;
        return { ...baseData, checkedIds, allowedTargets: allowedTargets?.length > 0 ? allowedTargets : null };
      }

      case ACTION.CUPID: {
        const allowedTargets = this.players.filter(p => p.alive).map(p => p.id);
        return { ...baseData, count: 2, allowedTargets };
      }

      case ACTION.POST_VOTE:
      case ACTION.DAY_VOTE:
      case ACTION.SHERIFF_VOTE: {
        // 优先使用 extraData 中传入的 allowedTargets（如警长投票时的候选人）
        if (extraData?.allowedTargets) {
          return { ...baseData, allowedTargets: extraData.allowedTargets };
        }
        const filter = filters?.[ACTION.POST_VOTE];
        const allowedTargets = filter ? filter(this, player) : null;
        return { ...baseData, allowedTargets };
      }

      case ACTION.NIGHT_WEREWOLF_VOTE: {
        const filter = filters?.[ACTION.NIGHT_WEREWOLF_VOTE];
        const allowedTargets = filter ? filter(this, player) : null;
        return { ...baseData, allowedTargets };
      }

      case ACTION.SHOOT: {
        const filter = filters?.[ACTION.SHOOT];
        const allowedTargets = filter ? filter(this, player) : null;
        return { ...baseData, allowedTargets };
      }

      case ACTION.PASS_BADGE: {
        const filter = filters?.[ACTION.PASS_BADGE];
        const allowedTargets = filter ? filter(this, player) : null;
        return { ...baseData, allowedTargets };
      }

      case ACTION.ASSIGN_ORDER: {
        // 警长指定发言顺序：可选所有存活玩家（除自己）
        const aliveOthers = this.players
          .filter(p => p.alive && p.id !== player.id)
          .map(p => p.id);
        return { ...baseData, allowedTargets: aliveOthers };
      }

      case ACTION.SHERIFF_CAMPAIGN:
      case ACTION.WITHDRAW:
      case ACTION.LAST_WORDS:
      case ACTION.EXPLODE:
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
  async callSpeech(playerId, actionType, visibility = VISIBILITY.PUBLIC) {
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
      try {
        const result = await controller.getSpeechResult(visibility, actionType);
        this.speak(playerId, result.content, visibility, actionType);
      } catch (err) {
        getLogger().warn(`${player.name} 发言超时或出错，跳过发言: ${err.message}`);
        this.speak(playerId, '', visibility, actionType);
      }
    }

    // 从队列中移除已发言的玩家
    const index = this._speechQueue.indexOf(playerId);
    if (index > -1) {
      this._speechQueue.splice(index, 1);
    }
  }

  // 让玩家投票 - 支持单个 playerId 或数组
  async callVote(playerId, actionType, extraData = {}) {
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
      // 循环直到玩家做出有效选择或超时
      while (true) {
        let result;
        try {
          result = await controller.getVoteResult(actionType, extraData);
        } catch (err) {
          getLogger().warn(`${player.name} 投票超时或出错，视为弃权: ${err.message}`);
          return;
        }

        const targetId = result?.targetId;

        // 跳过无效投票（如没有可选目标时返回null）
        if (targetId === null || targetId === undefined) {
          return;
        }

        // 尝试投票
        const voteResult = this.vote(playerId, targetId, extraData);
        if (voteResult.success) {
          return;
        }

        // 投票失败，记录日志并重新请求
        getLogger().warn(`${player.name} 投票失败: ${voteResult.error}，重新请求`);
      }
    }
  }

  // 让玩家使用技能 - 支持单个 playerId 或数组（通过 role.skills 驱动）
  async callSkill(playerId, actionType, extraData = {}) {
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
    const deadPlayerAllowedSkills = [ACTION.PASS_BADGE, ACTION.SHOOT];
    if (!player.alive && !deadPlayerAllowedSkills.includes(actionType)) return;

    // 使用 buildActionData 计算 allowedTargets，传递给 controller
    const actionData = this.buildActionData(playerId, actionType, extraData);
    // 优先使用 extraData 中传入的 allowedTargets（如PK投票时指定），否则使用 buildActionData 计算的
    const allowedTargets = extraData?.allowedTargets ?? actionData.allowedTargets;
    const enrichedExtraData = {
      ...extraData,
      allowedTargets,
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
      try {
        return await controller.useSkill(actionType, enrichedExtraData);
      } catch (err) {
        getLogger().warn(`${player.name} 使用技能 ${actionType} 超时或出错，视为不使用技能: ${err.message}`);
        return { success: false, message: '操作超时，技能未使用' };
      }
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

  // ========== 玩家行动 API ==========

  // 发言
  speak(playerId, content, visibility = VISIBILITY.PUBLIC, actionType) {
    const player = this.players.find(p => p.id === playerId);
    if (!player) return;

    // 确定消息类型和模板
    let messageType, templateKey;
    if (actionType === ACTION.LAST_WORDS) {
      messageType = 'last_words';
      templateKey = 'LAST_WORDS';
    } else if (visibility === VISIBILITY.CAMP) {
      messageType = 'wolf_speech';
      templateKey = 'WOLF_SPEECH';
    } else if (actionType === ACTION.SHERIFF_SPEECH) {
      messageType = PHASE.SHERIFF_SPEECH;
      templateKey = 'SHERIFF_SPEECH';
    } else {
      messageType = MSG.SPEECH;
      templateKey = 'SPEECH';
    }

    // 使用模板构建带标签的内容
    const playerDisplay = getPlayerDisplay(this.players, player);
    const formattedContent = buildMessage(templateKey, {
      player: playerDisplay,
      content: content
    });

    this.message.add({
      type: messageType,
      content: formattedContent,
      playerId,
      playerName: player.name,
      visibility
    });
    // 消息添加会自动触发实时同步，无需额外事件
  }

  // 投票
  vote(voterId, targetId, extraData = {}) {
    const voter = this.players.find(p => p.id === voterId);
    if (!voter) return { success: false, error: '投票者不存在' };

    // 检查是否限制了投票目标（如PK投票只能投给平票候选人）
    // 空数组表示无限制
    if (extraData?.allowedTargets?.length > 0 && !extraData.allowedTargets.includes(Number(targetId))) {
      return { success: false, error: '只能投票给候选人' };
    }

    // 确保键为字符串类型，保持一致性
    const key = String(voterId);

    // 检查是否已投票
    if (this.votes[key] !== undefined) {
      return { success: false, error: '你已投票' };
    }

    this.votes[key] = targetId;
    return { success: true };
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

    // 2. 触发角色死亡事件（猎人、白痴、丘比特）
    if (player.role?.events?.['player:death']) {
      const result = player.role.events['player:death']({ player, reason }, this, player);
      if (result?.cancel) {
        return { hasLastWords: false, lastWordsPlayer: null, cancelled: true };
      }
    }

    // 3. 触发附加身份死亡事件（情侣殉情）
    if (this.couples?.includes(player.id)) {
      const { ATTACHMENTS } = require('./roles');
      const coupleAttachment = ATTACHMENTS.couple;
      if (coupleAttachment?.events?.['player:death']) {
        coupleAttachment.events['player:death']({ player, reason }, this, player);
      }
    }

    // 4. 检查遗言（死亡消息在 phase.js 的 day_announce 阶段统一发送）
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
      const extraData = { deathReason: deadPlayer.deathReason };
      if (ability.canUse && !ability.canUse(deadPlayer, this, extraData)) continue;

      // 使用统一的 callSkill
      await this.callSkill(deadPlayer.id, skillId, extraData);
      break; // 每个死亡玩家只触发一个技能
    }

    // 处理警长传警徽（附加身份技能，不在 role.skills 中）
    if (deadPlayer.id === this.sheriff && !deadPlayer.alive) {
      const { ATTACHMENTS } = require('./roles');
      const sheriffAttachment = ATTACHMENTS.sheriff;
      const passBadgeSkill = sheriffAttachment?.skills?.[ACTION.PASS_BADGE];
      if (passBadgeSkill?.availablePhases?.includes(currentPhase)) {
        const extraData = { deathReason: deadPlayer.deathReason };
        if (!passBadgeSkill.canUse || passBadgeSkill.canUse(deadPlayer, this, extraData)) {
          // 通过 controller.useSkill 执行（内部会调 skill.execute）
          const controller = this.getPlayerController(deadPlayer.id);
          if (controller && typeof controller.useSkill === 'function') {
            await controller.useSkill(ACTION.PASS_BADGE, extraData);
          }
        }
      }
    }
  }

  /**
   * 统一死亡处理管道：遗言 → 死亡技能+警徽移交，处理连锁死亡
   * @param {Array} initialDeaths - 初始死亡列表（已被 handleDeath 处理过）
   * @param {string} phase - 当前阶段
   */
  async processDeathChain(initialDeaths, phase) {
    const initialSet = new Set(initialDeaths.map(d => d.id));
    // 初始死亡入队
    this.deathQueue.push(...initialDeaths);

    while (this.deathQueue.length > 0) {
      const player = this.deathQueue.shift();
      const isInitial = initialSet.has(player.id);

      // 初始死亡已被 handleDeath 处理过（alive=false），跳过存活检查
      // 连锁死亡需要检查存活并处理
      if (!isInitial) {
        if (!player || !player.alive) continue;
        player.deathReason = player.deathReason || DEATH_REASON.HUNTER;
        const deathResult = this.handleDeath(player, player.deathReason);
        if (deathResult.cancelled) continue;
        this.message.add({
          type: MSG.DEATH_ANNOUNCE,
          content: `${getPlayerDisplay(this.players, player)} 死亡`,
          deaths: [player],
          visibility: VISIBILITY.PUBLIC
        });
      }

      // 遗言（仅初始死亡，按 hasLastWords 判断）
      if (isInitial && this.config.hooks?.hasLastWords(player, player.deathReason, this)) {
        await this.callSpeech(player.id, ACTION.LAST_WORDS);
      }

      // 死亡技能 + 警徽移交
      await this.handleDeathAbility(player, phase);
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
        isSheriff: this.sheriff === p.id,
        isCouple: this.couples?.includes(p.id)
      }))
    };
  }

  // 获取玩家可见状态
  getState(playerId) {
    const player = this.players.find(p => p.id === playerId);
    const phase = this.phaseManager?.getCurrentPhase();

    // 如果游戏已结束，确保 phase 返回 game_over
    const currentPhaseId = this.winner ? PHASE.GAME_OVER : (phase?.id || 'waiting');

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
        revealed: p.state?.revealed,
        canVote: p.state?.canVote !== false,
        canSpeak: this.canSpeak(p),
        isSheriff: this.sheriff === p.id,
        isCouple: this.couples?.includes(p.id) && this.couples?.includes(playerId),
        couplePartner: this.couples?.includes(p.id) && this.couples?.includes(playerId)
          ? this.couples.find(id => id !== p.id)
          : null
      })),
      messages: [],
      sheriff: this.sheriff,
      couples: this.couples?.includes(playerId) ? this.couples : null,
      playerCount: this.playerCount,
      preset: this.preset ? {
        id: this.presetId,
        name: this.preset.name,
        description: this.preset.description,
        playerCount: this.preset.playerCount,
        roles: this.preset.roles,
        ruleDescriptions: this.preset.ruleDescriptions
      } : null,
      dayCount: this.round,
      winner: this.winner,
      // 游戏结束时的完整信息（复用 _checkGameEnd 中已计算的 gameOverInfo）
      gameOverInfo: this.gameOverInfo || null,
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
        background: player.background,
        thinking: player.thinking,
        speaking: player.speaking,
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

    // 构建 pendingAction（游戏结束后不再返回待处理行动）
    let pendingAction = null;
    if (!this.winner) {
      for (const [requestId, pending] of this._pendingRequests) {
        if (pending.playerId === playerId) {
          const actionData = this.buildActionData(playerId, pending.actionType, pending.data || {});
          const { requestId: _, ...restActionData } = actionData;
          pendingAction = { requestId, ...restActionData };
          break;
        }
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

    // 从板子预设获取角色配置
    if (!this.preset) {
      getLogger().error('assignRoles: 无板子预设，无法分配角色');
      return;
    }
    let roles = this.preset.roles.slice();
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

    // 随机打乱玩家位置，然后重新分配 ID（保证位置编号 = ID）
    shuffle(this.players);
    this.players.forEach((player, index) => {
      player.id = index + 1;
    });
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

  // 获取玩家位置（ID = 位置编号）
  getPosition(playerId) {
    return playerId;
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