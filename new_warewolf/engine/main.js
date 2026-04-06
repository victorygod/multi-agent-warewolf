/**
 * GameEngine - 底层 API 提供者
 * 只提供投票、发言、技能等基础方法
 * 业务流程逻辑都在 phase.js 的 execute 函数里
 */

const { EventEmitter } = require('./event');
const { MessageManager } = require('./message');
const { PhaseManager } = require('./phase');
const { HOOKS } = require('./config');
const { createPlayerRole } = require('./roles');

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
    this.sheriffOrder = null;
    this.deathQueue = [];
    this.lastWordsPlayer = null;

    // 阶段管理器
    this.phaseManager = null;
    this.getAIController = null;  // 由 server.js 设置
  }

  // ========== 阶段执行推送方法 ==========

  // 推送消息给玩家（让玩家行动）
  notifyPlayer(playerId, data) {
    const player = this.players.find(p => p.id === playerId);
    if (!player) return;

    this.emit('player:action', {
      playerId,
      playerName: player.name,
      data
    });
  }

  // 调用 AI 发言
  async callSpeech(playerId) {
    const player = this.players.find(p => p.id === playerId);
    if (!player || !player.isAI) return;

    const controller = this.getAIController?.(playerId);
    if (controller) {
      await controller.speak();
    }
  }

  // 调用 AI 投票
  async callVote(playerId) {
    const player = this.players.find(p => p.id === playerId);
    if (!player || !player.isAI) return;

    const controller = this.getAIController?.(playerId);
    if (controller) {
      await controller.vote();
    }
  }

  // 调用 AI 技能
  async callSkill(playerId) {
    const player = this.players.find(p => p.id === playerId);
    if (!player || !player.isAI) return;

    const controller = this.getAIController?.(playerId);
    if (controller) {
      await controller.useSkill();
    }
  }

  // 等待投票完成
  waitForVotes(expectedCount) {
    return new Promise((resolve) => {
      const check = () => {
        const votedCount = Object.keys(this.votes || {}).length;
        if (votedCount >= expectedCount) {
          resolve();
        } else {
          setTimeout(check, 100);
        }
      };
      check();
    });
  }

  // 等待玩家行动（人类玩家通过 API 触发）
  waitForAction(playerId) {
    return new Promise((resolve) => {
      // 存储到等待队列
      this._actionWaiters = this._actionWaiters || new Map();
      this._actionWaiters.set(playerId, resolve);
    });
  }

  // 玩家行动完成（由 API 调用）
  completeAction(playerId, action) {
    const resolve = this._actionWaiters?.get(playerId);
    if (resolve) {
      this._actionWaiters.delete(playerId);
      resolve(action);
    }
  }

  // ========== 玩家行动 API ==========

  // 发言
  speak(playerId, content) {
    const player = this.players.find(p => p.id === playerId);
    if (!player) return;

    this.message.add({
      type: 'speech',
      content,
      playerId,
      playerName: player.name,
      visibility: 'public'
    });
  }

  // 投票
  vote(voterId, targetId) {
    const voter = this.players.find(p => p.id === voterId);
    if (!voter) throw new Error('投票者不存在');

    this.votes[voterId] = targetId;
  }

  // 使用技能
  useSkill(playerId, phaseId, targetId, action) {
    const player = this.players.find(p => p.id === playerId);
    if (!player) throw new Error('玩家不存在');

    if (phaseId === 'night_werewolf_vote') {
      this.werewolfTarget = targetId;
    } else if (phaseId === 'guard') {
      this.guardTarget = targetId;
    } else if (phaseId === 'seer') {
      // 预言家查验结果通过消息发送
      const target = this.players.find(p => p.id === targetId);
      const isWolf = target?.role?.camp === 'wolf';
      this.message.add({
        type: 'skill_result',
        content: `你查验了 ${target?.name}，TA是${isWolf ? '狼人' : '好人'}`,
        playerId,
        visibility: 'self'
      });
    } else if (phaseId === 'witch') {
      if (action === 'heal') {
        this.healTarget = this.werewolfTarget;
        player.state.heal = 0;
      } else if (action === 'poison') {
        this.poisonTarget = targetId;
        player.state.poison = 0;
      }
    }
  }

  // ========== 游戏逻辑 API ==========

  // 夜晚结算
  resolveNight() {
    const deaths = [];

    // 狼刀
    if (this.werewolfTarget) {
      const target = this.players.find(p => p.id === this.werewolfTarget);
      const guarded = this.guardTarget === this.werewolfTarget;
      const healed = this.healTarget === this.werewolfTarget;

      // 同守同救 = 死亡
      if (guarded && healed) {
        deaths.push(target);
      } else if (!guarded && !healed) {
        deaths.push(target);
      }
    }

    // 毒杀
    if (this.poisonTarget) {
      const target = this.players.find(p => p.id === this.poisonTarget);
      if (!deaths.includes(target)) {
        deaths.push(target);
      }
    }

    // 重置夜晚状态
    this.werewolfTarget = null;
    this.guardTarget = null;
    this.healTarget = null;
    this.poisonTarget = null;

    this.deathQueue = deaths;
    return deaths;
  }

  // 处理死亡
  processDeaths() {
    while (this.deathQueue.length > 0) {
      const player = this.deathQueue.shift();
      if (!player.alive) continue;

      const reason = this.getDeathReason(player);
      player.alive = false;

      this.emit('player:death', { player, reason });

      // 殉情
      if (this.couples?.includes(player.id)) {
        const partner = this.players.find(p =>
          this.couples.includes(p.id) && p.id !== player.id && p.alive
        );
        if (partner) {
          this.deathQueue.push(partner);
        }
      }
    }
  }

  // 获取死亡原因
  getDeathReason(player) {
    if (this.poisonTarget === player.id) return 'poison';
    if (this.werewolfTarget === player.id) return 'wolf';
    if (this.healTarget === player.id && this.guardTarget === player.id) return 'conflict';
    return 'vote';
  }

  // 结算投票
  resolveVote() {
    const voteDetails = [];
    const voteCounts = {};

    for (const [voterId, targetId] of Object.entries(this.votes)) {
      const voter = this.players.find(p => p.id === parseInt(voterId));
      const target = targetId ? this.players.find(p => p.id === targetId) : null;

      voteDetails.push({
        voter: voter?.name,
        target: target?.name || '弃权'
      });

      if (targetId) {
        voteCounts[targetId] = (voteCounts[targetId] || 0) + 1;
      }
    }

    // 广播票型
    this.message.add({
      type: 'vote_result',
      content: '投票结果',
      voteDetails,
      voteCounts,
      visibility: 'public'
    });

    // 计算最高票
    let maxVotes = 0;
    let maxPlayer = null;
    Object.entries(voteCounts).forEach(([id, count]) => {
      if (count > maxVotes) {
        maxVotes = count;
        maxPlayer = this.players.find(p => p.id === parseInt(id));
      }
    });

    // 处理平票
    const topVotes = Object.entries(voteCounts)
      .filter(([, count]) => count === maxVotes)
      .map(([id]) => this.players.find(p => p.id === parseInt(id)));

    if (topVotes.length > 1) {
      this.message.add({
        type: 'vote_tie',
        content: `平票：${topVotes.map(p => p.name).join('、')}，进行PK投票`,
        visibility: 'public'
      });
      this.votes = {};
      return;  // 继续 PK，不死亡
    }

    if (maxPlayer) {
      maxPlayer.alive = false;
      this.lastWordsPlayer = maxPlayer;
    }

    this.votes = {};
  }

  // ========== 游戏流程 ==========

  // 开始游戏
  start() {
    this.phaseManager = new PhaseManager(this);
    this.phaseManager.start();
  }

  // 获取玩家可见状态
  getState(playerId) {
    const player = this.players.find(p => p.id === playerId);
    const phase = this.phaseManager?.getCurrentPhase();

    const state = {
      phase: phase?.id || 'waiting',
      players: this.players.map(p => ({
        id: p.id,
        name: p.name,
        alive: p.alive,
        isAI: p.isAI
      })),
      messages: [],
      sheriff: this.sheriff,
      couples: this.couples?.includes(playerId) ? this.couples : null,
      playerCount: this.playerCount || 9,
      dayCount: this.dayCount,
      winner: this.winner
    };

    if (player) {
      state.self = {
        id: player.id,
        name: player.name,
        role: player.role,
        state: player.state,
        alive: player.alive
      };
      state.messages = this.message.getVisibleTo(player, this);
    }

    return state;
  }

  // 初始化游戏
  init(playerConfigs) {
    this.players = playerConfigs.map((cfg, index) => ({
      id: cfg.id || index + 1,
      name: cfg.name,
      role: createPlayerRole(cfg.roleId),
      alive: true,
      state: {},
      isAI: cfg.isAI || false
    }));
    return this;
  }

  // 分配角色
  assignRoles() {
    const count = this.players.length;
    const roles9 = ['werewolf', 'werewolf', 'werewolf', 'seer', 'witch', 'hunter', 'villager', 'villager', 'villager'];
    const roles12 = ['werewolf', 'werewolf', 'werewolf', 'werewolf', 'seer', 'witch', 'hunter', 'guard', 'villager', 'villager', 'villager', 'villager'];

    let roles = count <= 9 ? roles9.slice(0, count) : roles12.slice(0, count);
    this.shuffle(roles);

    this.players.forEach((player, i) => {
      const role = createPlayerRole(roles[i]);
      player.role = role;
      player.state = role.state ? { ...role.state } : {};
    });
  }

  shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }
}

module.exports = { GameEngine };