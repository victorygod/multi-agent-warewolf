/**
 * 阶段执行器 - 简化版
 * 外层循环 = 天数，内层循环 = 每天的阶段流程
 * phase 只调用 game 提供的统一 API，不区分 AI/人类
 */

const { getPlayerDisplay } = require('./utils');
const { createLogger } = require('../utils/logger');
const { PHASE, ACTION, MSG, VISIBILITY, CAMP, DEATH_REASON } = require('./constants');
const { buildMessage, formatVoteDetails } = require('./message_template');

// 创建日志实例（延迟初始化，避免循环依赖）
let backendLogger = null;
function getLogger() {
  if (!backendLogger) {
    backendLogger = createLogger('backend.log');
  }
  return backendLogger;
}

/**
 * 每天的阶段流程
 */
const PHASE_FLOW = [
  // ========== 进入夜晚 ==========
  {
    id: PHASE.NIGHT_ENTER,
    name: '进入夜晚',
    execute: async (game) => {
      game.message.add({
        type: MSG.SYSTEM,
        content: buildMessage('PHASE_NIGHT', { round: game.round }),
        phase: PHASE.NIGHT_ENTER,
        round: game.round,
        visibility: VISIBILITY.PUBLIC
      });
    }
  },

  // ========== 夜晚 ==========

  // 丘比特连线（仅第一夜）
  {
    id: PHASE.CUPID,
    name: '丘比特连线',
    condition: (game) => game.round === 1 && game.players.some(p => p.role.id === 'cupid'),
    execute: async (game) => {
      const cupid = game.players.find(p => p.role.id === 'cupid' && p.alive);
      if (!cupid) return;

      await game.callSkill(cupid.id, ACTION.CUPID);
    }
  },

  // 守卫守护（每晚）
  {
    id: PHASE.GUARD,
    name: '守卫守护',
    condition: (game) => game.players.some(p => p.role.id === 'guard' && p.alive),
    execute: async (game) => {
      const guard = game.players.find(p => p.role.id === 'guard' && p.alive);
      if (!guard) return;

      // 传递给前端上一晚守护的目标，用于禁用
      const lastGuardTarget = guard.state.lastGuardTarget;
      await game.callSkill(guard.id, ACTION.GUARD, { lastGuardTarget });
    }
  },

  // 狼人讨论（每晚）
  {
    id: PHASE.NIGHT_WEREWOLF_DISCUSS,
    name: '狼人讨论',
    condition: (game) => game.players.some(p => game.config.hooks.getCamp(p, game) === CAMP.WOLF && p.alive),
    execute: async (game) => {
      const wolves = game.players.filter(p => game.config.hooks.getCamp(p, game) === CAMP.WOLF && p.alive);
      await game.callSpeech(wolves.map(w => w.id), ACTION.NIGHT_WEREWOLF_DISCUSS, VISIBILITY.CAMP);
    }
  },

  // 狼人投票
  {
    id: PHASE.NIGHT_WEREWOLF_VOTE,
    name: '狼人投票',
    execute: async (game) => {
      const wolves = game.players.filter(p => game.config.hooks.getCamp(p, game) === CAMP.WOLF && p.alive);

      // 清理上一轮的投票数据
      game.votes = {};

      // 计算狼人投票的可选目标（所有存活玩家，包括自己和其他狼人）
      const allowedTargets = game.players
        .filter(p => p.alive)
        .map(p => p.id);

      // 并行让所有狼人投票（传递 actionType 和 allowedTargets）
      await Promise.all(wolves.map(wolf => game.callVote(wolf.id, ACTION.NIGHT_WEREWOLF_VOTE, { allowedTargets })));

      // 使用 VoteManager 通用方法计算投票结果
      const { voteCounts, voteDetails } = game.voteManager.calculateVoteResults(wolves, { useWeight: false });
      const { maxVotes } = game.voteManager.findMaxVotes(voteCounts);

      const unanimousVote = game.effectiveRules?.wolf?.unanimousVote ?? false;

      // 狼人投票必须统一，否则空刀
      if (unanimousVote && wolves.length > 1) {
        const votedTargets = Object.values(game.votes).filter(v => v).map(Number);
        const allSame = votedTargets.length > 0 && votedTargets.every(t => t === votedTargets[0]);

        if (!allSame) {
          game.werewolfTarget = null;
          game.message.add({
            type: MSG.WOLF_VOTE_RESULT,
            content: buildMessage('WOLF_VOTE_EMPTY', {}),
            visibility: VISIBILITY.CAMP,
            playerId: wolves[0]?.id,
            voteDetails,
            voteCounts
          });
          game.votes = {};
          return;
        }
      }

      // 处理平票：随机选择其中一个
      const topVotes = game.voteManager.findTopVotes(voteCounts, maxVotes);
      let werewolfTarget = topVotes[0]?.id;
      if (topVotes.length > 1) {
        werewolfTarget = topVotes[Math.floor(Math.random() * topVotes.length)].id;
      }

      game.werewolfTarget = werewolfTarget;

      // 发送狼人可见的投票结果消息
      const targetPlayer = game.players.find(p => p.id === werewolfTarget);
      game.message.add({
        type: MSG.WOLF_VOTE_RESULT,
        content: buildMessage('WOLF_VOTE_RESULT', {
          票型: formatVoteDetails(voteDetails)
        }),
        visibility: VISIBILITY.CAMP,
        playerId: wolves[0]?.id,
        voteDetails,
        voteCounts
      });

      game.votes = {};
    }
  },

  // 女巫技能（每晚）
  {
    id: PHASE.WITCH,
    name: '女巫技能',
    condition: (game) => game.players.some(p => p.role.id === 'witch'),
    execute: async (game) => {
      const witch = game.players.find(p => p.role.id === 'witch' && p.alive);
      if (!witch) return;

      // 使用统一的 callSkill（通过 useSkill 调用）
      const extraData = {
        werewolfTarget: game.werewolfTarget,
        healAvailable: witch.state?.heal > 0,
        poisonAvailable: witch.state?.poison > 0,
        canSelfHeal: (game.effectiveRules?.witch?.canSelfHeal ?? true) && game.round === 1
      };
      await game.callSkill(witch.id, ACTION.WITCH, extraData);
    }
  },

  // 预言家查验
  {
    id: PHASE.SEER,
    name: '预言家查验',
    condition: (game) => game.players.some(p => p.role.id === 'seer'),
    execute: async (game) => {
      const seer = game.players.find(p => p.role.id === 'seer' && p.alive);
      if (!seer) return;

      await game.callSkill(seer.id, ACTION.SEER);
    }
  },

  // ========== 白天 ==========

  // 进入白天
  {
    id: PHASE.DAY_ENTER,
    name: '进入白天',
    execute: async (game) => {
      game.message.add({
        type: MSG.SYSTEM,
        content: buildMessage('PHASE_DAY', { round: game.round }),
        phase: PHASE.DAY_ENTER,
        round: game.round,
        visibility: VISIBILITY.PUBLIC
      });
    }
  },

  // 警长竞选（仅第一天白天，公布死讯之前）
  {
    id: PHASE.SHERIFF_CAMPAIGN,
    name: '警长竞选',
    condition: (game) => game.round === 1 && (game.effectiveRules?.sheriff?.enabled !== false),
    execute: async (game) => {
      // 询问所有存活玩家是否参加竞选（并发执行，保密决定）
      const candidates = game.players.filter(p => p.alive);
      const results = await Promise.all(candidates.map(p =>
        game.callSkill(p.id, ACTION.SHERIFF_CAMPAIGN).then(r => ({ player: p, result: r }))
      ));
      // 处理结果
      for (const { player, result } of results) {
        if (result?.run === true) {
          player.state = player.state || {};
          player.state.isCandidate = true;
        }
      }

      // 广播警上/警下
      const onStage = game.players.filter(p => p.state?.isCandidate && !p.state?.withdrew);
      const offStage = game.players.filter(p => !p.state?.isCandidate && p.alive);
      game.message.add({
        type: MSG.SHERIFF_CANDIDATES,
        content: buildMessage('SHERIFF_CANDIDATES', {
          警上列表: onStage.map(p => getPlayerDisplay(game.players, p)).join('，') || '无',
          警下列表: offStage.map(p => getPlayerDisplay(game.players, p)).join('，') || '无'
        }),
        visibility: VISIBILITY.PUBLIC,
        metadata: {
          onStage: onStage.map(p => ({ id: p.id, name: p.name })),
          offStage: offStage.map(p => ({ id: p.id, name: p.name }))
        }
      });
    }
  },

  // 警长竞选发言 + 退水
  {
    id: PHASE.SHERIFF_SPEECH,
    name: '警长竞选发言',
    condition: (game) => game.round === 1 && (game.effectiveRules?.sheriff?.enabled !== false),
    execute: async (game) => {
      // 候选人发言
      const candidates = game.players.filter(p => p.alive && p.state?.isCandidate && !p.state?.withdrew);
      await game.callSpeech(candidates.map(p => p.id), ACTION.SHERIFF_SPEECH);

      // 询问是否退水（并发执行）
      const results = await Promise.all(candidates.map(p =>
        game.callSkill(p.id, ACTION.WITHDRAW).then(r => ({ player: p, result: r }))
      ));
      // 处理结果
      for (const { player, result } of results) {
        if (result?.withdraw === true) {
          player.state.withdrew = true;
        }
      }
    }
  },

  // 警长投票
  {
    id: PHASE.SHERIFF_VOTE,
    name: '警长投票',
    condition: (game) => game.round === 1 && (game.effectiveRules?.sheriff?.enabled !== false),
    execute: async (game) => {
      // 使用 VoteManager 结算选举
      const candidates = game.players.filter(p => p.state?.isCandidate && !p.state?.withdrew);
      let voters = game.players.filter(p => !p.state?.isCandidate && p.alive && p.state?.canVote !== false);
      if (voters.length === 0) voters = candidates.filter(p => p.alive && p.state?.canVote !== false);

      await game.voteManager.resolveElection(candidates, voters, game.players);
    }
  },

  // 公布死讯（包含夜晚结算）
  {
    id: PHASE.DAY_ANNOUNCE,
    name: '公布死讯',
    execute: async (game) => {
      // 夜晚结算（原 nightManager.resolve 内联）
      const deaths = [];
      const deathReasons = new Map();

      if (game.werewolfTarget) {
        const target = game.players.find(p => p.id === game.werewolfTarget);
        const guarded = game.guardTarget === game.werewolfTarget;
        const healed = game.healTarget === game.werewolfTarget;
        if (guarded && healed) {
          deaths.push(target);
          deathReasons.set(target.id, DEATH_REASON.CONFLICT);
        } else if (!guarded && !healed) {
          deaths.push(target);
          deathReasons.set(target.id, DEATH_REASON.WEREWOLF);
        }
      }

      if (game.poisonTarget) {
        const target = game.players.find(p => p.id === game.poisonTarget);
        if (!deaths.includes(target)) {
          deaths.push(target);
          deathReasons.set(target.id, DEATH_REASON.POISON);
        }
      }

      // 保留现有 deathQueue（如猎人开枪），夜晚死亡优先
      const existingQueue = game.deathQueue || [];
      game.deathQueue = [...deaths, ...existingQueue];

      // 重置夜晚状态
      game.werewolfTarget = null;
      game.guardTarget = null;
      game.healTarget = null;
      game.poisonTarget = null;

      // 夜晚死亡标记（原 nightManager.process 内联）
      const allDeaths = [];
      while (game.deathQueue.length > 0) {
        const player = game.deathQueue.shift();
        if (!player.alive) continue;
        const reason = deathReasons.get(player.id) || player.deathReason || DEATH_REASON.VOTE;
        game.handleDeath(player, reason);
        allDeaths.push({ id: player.id, name: player.name, reason });
      }
      game._lastNightDeaths = allDeaths;

      // 批量公告
      if (game._lastNightDeaths?.length > 0) {
        game.message.add({
          type: MSG.DEATH_ANNOUNCE,
          content: buildMessage('NIGHT_DEATH', {
            玩家列表: game._lastNightDeaths.map(d => getPlayerDisplay(game.players, d)).join('，')
          }),
          deaths: game._lastNightDeaths,
          visibility: VISIBILITY.PUBLIC
        });
      } else {
        game.message.add({
          type: MSG.SYSTEM,
          content: buildMessage('PEACEFUL_NIGHT', {}),
          visibility: VISIBILITY.PUBLIC
        });
      }

      // 死亡管道：遗言 → 技能+警徽移交
      if (game._lastNightDeaths?.length > 0) {
        const deathPlayers = game._lastNightDeaths.map(d => game.players.find(p => p.id === d.id)).filter(Boolean);
        await game.processDeathChain(deathPlayers, PHASE.DAY_ANNOUNCE);
      }

      // 每天白天开始时清空警长指定的发言顺序
      game.sheriffAssignOrder = null;

      // 清空上一天的遗言玩家
      game.lastWordsPlayer = null;

      game.recordLastDeath();
    }
  },

  // 白天讨论
  {
    id: PHASE.DAY_DISCUSS,
    name: '白天讨论',
    execute: async (game) => {
      // 警长指定发言起始位置（每天都可以指定）
      const config = game.effectiveRules?.sheriff || { enabled: true, sheriffAssignOrder: true };
      if (config.enabled && config.sheriffAssignOrder && game.sheriff) {
        const sheriff = game.players.find(p => p.id === game.sheriff);
        // 警长还活着且今天还没指定
        if (sheriff?.alive && !game.sheriffAssignOrder) {
          await game.callSkill(sheriff.id, ACTION.ASSIGN_ORDER);
        }
      }

      const speakers = game.getSpeakerOrder().filter(p => game.canSpeak(p));
      await game.callSpeech(speakers.map(p => p.id), ACTION.DAY_DISCUSS);
    }
  },

  // 白天投票
  {
    id: PHASE.DAY_VOTE,
    name: '白天投票',
    execute: async (game) => {
      const voters = game.players.filter(p => p.alive && p.state?.canVote !== false);

      // 计算白天投票的可选目标（排除自己、排除已翻牌的白痴）
      const getAllowedTargets = (playerId) => game.players
        .filter(p => p.alive && p.id !== playerId && !(p.role.id === 'idiot' && p.state?.revealed))
        .map(p => p.id);

      // 并行让所有存活玩家投票
      await Promise.all(voters.map(voter => game.callVote(voter.id, ACTION.DAY_VOTE, { allowedTargets: getAllowedTargets(voter.id) })));

      // 不在这里结算，留到 post_vote 阶段统一处理
    }
  },

  // 放逐后处理
  {
    id: PHASE.POST_VOTE,
    name: '放逐后处理',
    execute: async (game) => {
      // 结算投票（显示票型）
      await game.voteManager.resolve();
      game.votes = {};

      // 死亡管道：遗言 → 技能+警徽移交
      if (game.lastWordsPlayer) {
        await game.processDeathChain([game.lastWordsPlayer], PHASE.POST_VOTE);
      }
    }
  }
];

/**
 * 阶段管理器
 */
class PhaseManager {
  constructor(game) {
    this.game = game;
    this.running = false;
    this.currentPhase = null;
  }

  async start() {
    this.running = true;

    // 外层循环：轮次
    while (this.running) {
      getLogger().info(`========== 第 ${this.game.round} 轮 ==========`);

      // 内层循环：一天内的阶段流程
      for (const phase of PHASE_FLOW) {
        if (!this.running) break;

        // 检查即时中断（如狼人自爆）
        if (this.game.interrupt?.type === 'explode') {
          const { playerId } = this.game.interrupt;
          this.game.interrupt = null;
          getLogger().info(`狼人自爆中断，playerId=${playerId}`);

          // 如果当前不是公布死讯阶段，执行公布死讯
          if (phase.id !== PHASE.DAY_ANNOUNCE) {
            const announcePhase = PHASE_FLOW.find(p => p.id === PHASE.DAY_ANNOUNCE);
            if (announcePhase) await this._runPhase(announcePhase);
          }

          // 检查胜负，结束游戏或进入下一天
          if (this._checkGameEnd()) break;
          break;
        }

        // 检查阶段条件
        if (phase.condition && !phase.condition(this.game)) continue;

        // 执行阶段
        await this._runPhase(phase);

        // 检查胜负
        if (this._checkGameEnd()) break;
      }

      // 一轮结束，轮次+1
      this.game.round++;
    }

    getLogger().info('PhaseManager 停止');
  }

  stop() {
    this.running = false;
  }

  getCurrentPhase() {
    return this.currentPhase;
  }

  // 统一执行单个阶段
  async _runPhase(phase) {
    this.currentPhase = phase;
    getLogger().info(`进入阶段: ${phase.id}`);

    // 通知前端阶段开始
    this.game.message.add({
      type: MSG.PHASE_START,
      phase: phase.id,
      phaseName: phase.name,
      round: this.game.round,
      visibility: VISIBILITY.PUBLIC
    });

    try {
      await phase.execute(this.game);
      getLogger().info(`阶段完成: ${phase.id}`);
    } catch (e) {
      getLogger().error(`执行阶段 ${phase.id} 失败: ${e.message}`);
    }
  }

  // 检查游戏是否结束
  _checkGameEnd() {
    const winner = this.game.config.hooks.checkWin(this.game);
    if (winner) {
      this.game.winner = winner;
      getLogger().info(`游戏结束，胜者: ${winner}`);
      this.game.gameOverInfo = this.game.getGameOverInfo();
      this.currentPhase = { id: PHASE.GAME_OVER, name: '游戏结束' };
      this.game.message.add({
        type: MSG.GAME_OVER,
        content: buildMessage('GAME_OVER', {
          结果: winner === CAMP.GOOD ? '好人阵营获胜' : winner === CAMP.WOLF ? '狼人阵营获胜' : '第三方阵营获胜'
        }),
        winner: winner,
        gameOverInfo: this.game.gameOverInfo,
        visibility: VISIBILITY.PUBLIC
      });
      // 清除所有待处理请求，避免前端继续显示操作选项
      this.game.cancelAllPendingRequests();
      this.running = false;
      return true;
    }
    return false;
  }

  // 执行指定阶段（用于测试）
  async executePhase(phaseId) {
    const phase = PHASE_FLOW.find(p => p.id === phaseId);
    if (!phase) {
      throw new Error(`未知阶段: ${phaseId}`);
    }

    // 检查条件
    if (phase.condition && !phase.condition(this.game)) {
      getLogger().debug(`阶段 ${phaseId} 条件不满足，跳过`);
      return false;
    }

    await this._runPhase(phase);
    return true;
  }
}

module.exports = { PhaseManager, PHASE_FLOW };