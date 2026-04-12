/**
 * 阶段执行器 - 简化版
 * 外层循环 = 天数，内层循环 = 每天的阶段流程
 * phase 只调用 game 提供的统一 API，不区分 AI/人类
 */

const { getPlayerDisplay } = require('./utils');
const { createLogger } = require('../utils/logger');

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
  // ========== 夜晚 ==========

  // 丘比特连线（仅第一夜）
  {
    id: 'cupid',
    name: '丘比特连线',
    condition: (game) => game.nightCount === 0 && game.players.some(p => p.role.id === 'cupid'),
    execute: async (game) => {
      const cupid = game.players.find(p => p.role.id === 'cupid' && p.alive);
      if (!cupid) return;

      await game.callSkill(cupid.id, 'cupid');
    }
  },

  // 守卫守护（每晚）
  {
    id: 'guard',
    name: '守卫守护',
    condition: (game) => game.players.some(p => p.role.id === 'guard' && p.alive),
    execute: async (game) => {
      const guard = game.players.find(p => p.role.id === 'guard' && p.alive);
      if (!guard) return;

      // 传递给前端上一晚守护的目标，用于禁用
      const lastGuardTarget = guard.state.lastGuardTarget;
      await game.callSkill(guard.id, 'guard', { lastGuardTarget });
    }
  },

  // 狼人讨论（每晚）
  {
    id: 'night_werewolf_discuss',
    name: '狼人讨论',
    condition: (game) => game.players.some(p => game.config.hooks.getCamp(p, game) === 'wolf' && p.alive),
    execute: async (game) => {
      const wolves = game.players.filter(p => game.config.hooks.getCamp(p, game) === 'wolf' && p.alive);
      await game.callSpeech(wolves.map(w => w.id), 'speak', 'camp');
    }
  },

  // 狼人投票
  {
    id: 'night_werewolf_vote',
    name: '狼人投票',
    execute: async (game) => {
      const wolves = game.players.filter(p => game.config.hooks.getCamp(p, game) === 'wolf' && p.alive);

      // 清理上一轮的投票数据
      game.votes = {};

      // 计算狼人投票的可选目标（所有存活玩家，包括自己和其他狼人）
      const allowedTargets = game.players
        .filter(p => p.alive)
        .map(p => p.id);

      // 并行让所有狼人投票（传递 actionType 和 allowedTargets）
      await Promise.all(wolves.map(wolf => game.callVote(wolf.id, 'wolf_vote', { allowedTargets })));

      // 使用 VoteManager 通用方法计算投票结果
      const { voteCounts, voteDetails } = game.voteManager.calculateVoteResults(wolves, { useWeight: false });
      const { maxVotes } = game.voteManager.findMaxVotes(voteCounts);

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
        type: 'wolf_vote_result',
        content: `狼人选择击杀 ${getPlayerDisplay(game.players, targetPlayer)}`,
        visibility: 'camp',
        playerId: wolves[0]?.id,
        voteDetails,
        voteCounts
      });

      game.votes = {};
    }
  },

  // 女巫技能（每晚）
  {
    id: 'witch',
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
        canSelfHeal: game.config.hooks?.RULES?.witch?.canSelfHeal !== false && game.nightCount > 0
      };
      await game.callSkill(witch.id, 'witch', extraData);
    }
  },

  // 预言家查验
  {
    id: 'seer',
    name: '预言家查验',
    condition: (game) => game.players.some(p => p.role.id === 'seer'),
    execute: async (game) => {
      const seer = game.players.find(p => p.role.id === 'seer' && p.alive);
      if (!seer) return;

      await game.callSkill(seer.id, 'seer');
    }
  },

  // ========== 白天 ==========

  // 警长竞选（仅第一天白天，公布死讯之前）
  {
    id: 'sheriff_campaign',
    name: '警长竞选',
    condition: (game) => game.dayCount === 0,
    execute: async (game) => {
      // 询问所有存活玩家是否参加竞选
      const candidates = game.players.filter(p => p.alive);
      for (const player of candidates) {
        const result = await game.callSkill(player.id, 'campaign');
        // 只有明确run=true才算参加竞选
        if (result?.run === true) {
          player.state = player.state || {};
          player.state.isCandidate = true;
        }
      }

      // 广播警上/警下
      const onStage = game.players.filter(p => p.state?.isCandidate && !p.state?.withdrew);
      const offStage = game.players.filter(p => !p.state?.isCandidate && p.alive);
      game.message.add({
        type: 'sheriff_candidates',
        content: `警上：${onStage.map(p => getPlayerDisplay(game.players, p)).join('、') || '无'} | 警下：${offStage.map(p => getPlayerDisplay(game.players, p)).join('、') || '无'}`,
        visibility: 'public',
        metadata: {
          onStage: onStage.map(p => ({ id: p.id, name: p.name })),
          offStage: offStage.map(p => ({ id: p.id, name: p.name }))
        }
      });
    }
  },

  // 警长竞选发言 + 退水
  {
    id: 'sheriff_speech',
    name: '警长竞选发言',
    condition: (game) => game.dayCount === 0,
    execute: async (game) => {
      // 候选人发言
      const candidates = game.players.filter(p => p.alive && p.state?.isCandidate && !p.state?.withdrew);
      await game.callSpeech(candidates.map(p => p.id));

      // 询问是否退水
      for (const player of candidates) {
        const result = await game.callSkill(player.id, 'withdraw');
        // 只有明确withdraw=true才算退水
        if (result?.withdraw === true) {
          player.state.withdrew = true;
        }
      }
    }
  },

  // 警长投票
  {
    id: 'sheriff_vote',
    name: '警长投票',
    condition: (game) => game.dayCount === 0,
    execute: async (game) => {
      // 使用 VoteManager 结算选举
      const candidates = game.players.filter(p => p.state?.isCandidate && !p.state?.withdrew);
      let voters = game.players.filter(p => !p.state?.isCandidate && p.alive);
      if (voters.length === 0) voters = candidates.filter(p => p.alive);

      await game.voteManager.resolveElection(candidates, voters, game.players);
    }
  },

  // 公布死讯（包含夜晚结算）
  {
    id: 'day_announce',
    name: '公布死讯',
    execute: async (game) => {
      // 夜晚结算
      game.nightManager.resolve();
      game.nightManager.process();
      game.nightCount++;
      if (game.dayCount === 0) {
        game.dayCount = 1;
      }

      // 每天白天开始时清空警长指定的发言顺序，让警长可以重新指定
      game.sheriffAssignOrder = null;

      // 清空上一天的遗言玩家，避免PK投票无人出局时重复触发遗言
      game.lastWordsPlayer = null;

      game.recordLastDeath();

      if (game._lastNightDeaths?.length > 0) {
        game.message.add({
          type: 'death_announce',
          content: game._lastNightDeaths.map(d => getPlayerDisplay(game.players, d)).join('、') + ' 死亡',
          deaths: game._lastNightDeaths,
          visibility: 'public'
        });

        // 处理猎人开枪（在遗言之前）
        for (const deathInfo of game._lastNightDeaths) {
          const death = game.players.find(p => p.id === deathInfo.id);
          if (death?.role?.id === 'hunter' && death?.state?.canShoot) {
            await game.handleDeathAbility(death, 'day_announce');
          }
        }

        // 处理猎人射杀的人（加入死亡队列）
        while (game.deathQueue.length > 0) {
          const target = game.deathQueue.shift();
          if (!target || !target.alive) continue;
          target.deathReason = target.deathReason || 'hunter';
          game.handleDeath(target, target.deathReason);
          // 添加到死亡公告
          game.message.add({
            type: 'death_announce',
            content: `${getPlayerDisplay(game.players, target)} 被猎人射杀`,
            deaths: [target],
            visibility: 'public'
          });
        }

        // 夜间死亡有遗言（仅首夜死亡有遗言）
        const lastWordsPlayers = game._lastNightDeaths.filter(p =>
          game.config.hooks?.hasLastWords(p, p.deathReason, game)
        );
        if (lastWordsPlayers.length > 0) {
          await game.callSpeech(lastWordsPlayers.map(p => p.id), 'last_words');
        }

        // 处理警长死亡（警徽传递）- 通过 handleDeathAbility 触发前端请求
        for (const deathInfo of game._lastNightDeaths) {
          if (deathInfo.id === game.sheriff) {
            const sheriff = game.players.find(p => p.id === deathInfo.id);
            if (sheriff && !sheriff.alive) {
              // 使用 handleDeathAbility 来触发 passBadge 技能，让玩家选择传警徽对象
              await game.handleDeathAbility(sheriff, 'day_announce');
            }
          }
        }
      } else {
        game.message.add({
          type: 'system',
          content: '昨晚是平安夜',
          visibility: 'public'
        });
      }
    }
  },

  // 白天讨论
  {
    id: 'day_discuss',
    name: '白天讨论',
    execute: async (game) => {
      // 警长指定发言起始位置（每天都可以指定）
      const config = game.config.hooks?.RULES?.sheriff || { enabled: true, sheriffAssignOrder: true };
      if (config.enabled && config.sheriffAssignOrder && game.sheriff) {
        const sheriff = game.players.find(p => p.id === game.sheriff);
        // 警长还活着且今天还没指定
        if (sheriff?.alive && !game.sheriffAssignOrder) {
          await game.callSkill(sheriff.id, 'assignOrder');
        }
      }

      const speakers = game.getSpeakerOrder().filter(p => game.canSpeak(p));
      await game.callSpeech(speakers.map(p => p.id));
    }
  },

  // 白天投票
  {
    id: 'day_vote',
    name: '白天投票',
    execute: async (game) => {
      const voters = game.players.filter(p => p.alive);

      // 计算白天投票的可选目标（排除自己）
      const getAllowedTargets = (playerId) => game.players
        .filter(p => p.alive && p.id !== playerId)
        .map(p => p.id);

      // 并行让所有存活玩家投票
      await Promise.all(voters.map(voter => game.callVote(voter.id, 'vote', { allowedTargets: getAllowedTargets(voter.id) })));

      // 不在这里结算，留到 post_vote 阶段统一处理
    }
  },

  // 放逐后处理
  {
    id: 'post_vote',
    name: '放逐后处理',
    execute: async (game) => {
      // 结算投票（显示票型）
      await game.voteManager.resolve();
      game.votes = {};

      // 处理死亡玩家的遗言和警徽传递
      if (game.lastWordsPlayer) {
        const deadPlayer = game.lastWordsPlayer;

        // 1. 遗言阶段
        if (game.config.hooks?.hasLastWords(deadPlayer, 'vote', game)) {
          await game.callSpeech(deadPlayer.id, 'last_words');
        }

        // 2. 检查并触发死亡技能（如猎人射击、警长传警徽）
        await game.handleDeathAbility(deadPlayer, 'post_vote');
      }

      // 处理死亡队列中的其他死亡（如猎人开枪射杀）
      while (game.deathQueue.length > 0) {
        const player = game.deathQueue.shift();
        if (!player || !player.alive) continue;

        // 设置死亡原因并处理死亡
        player.deathReason = player.deathReason || 'hunter';
        game.handleDeath(player, player.deathReason);

        // 处理警长死亡（通过 handleDeathAbility 触发 passBadge 技能）
        if (player.id === game.sheriff) {
          await game.handleDeathAbility(player, 'post_vote');
        }
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

    // 外层循环：天数
    while (this.running) {
      getLogger().info(`========== 第 ${this.game.dayCount + 1} 天 ==========`);

      // 内层循环：一天内的阶段流程
      for (const phase of PHASE_FLOW) {
        if (!this.running) break;

        // 检查即时中断（如狼人自爆）
        if (this.game.interrupt?.type === 'explode') {
          const { playerId } = this.game.interrupt;
          this.game.interrupt = null;
          getLogger().info(`狼人自爆中断，playerId=${playerId}`);

          // 如果当前不是公布死讯阶段，执行公布死讯
          if (phase.id !== 'day_announce') {
            const announcePhase = PHASE_FLOW.find(p => p.id === 'day_announce');
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

      // 一天结束，天数+1
      this.game.dayCount++;
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
      type: 'phase_start',
      content: phase.name,
      phase: phase.id,
      phaseName: phase.name,
      visibility: 'public'
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
      this.currentPhase = { id: 'game_over', name: '游戏结束' };
      this.game.message.add({
        type: 'game_over',
        content: `游戏结束，${winner === 'good' ? '好人阵营' : winner === 'wolf' ? '狼人阵营' : '第三方阵营'}获胜`,
        winner: winner,
        gameOverInfo: this.game.gameOverInfo,
        visibility: 'public'
      });
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