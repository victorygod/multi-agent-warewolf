/**
 * 游戏状态机引擎
 */

const { ROLES, CAMPS, generateRoles, shuffleArray } = require('./roles');
const { MessageManager, MESSAGE_TYPES } = require('./messages');
const { getRandomProfiles, resetUsedNames } = require('../ai/profiles');

// 游戏阶段
const PHASES = {
  WAITING: 'waiting',
  NIGHT_WEREWOLF_DISCUSS: 'night_werewolf_discuss',
  NIGHT_WEREWOLF_VOTE: 'night_werewolf_vote',
  NIGHT_SEER: 'night_seer',
  NIGHT_WITCH: 'night_witch',
  NIGHT_GUARD: 'night_guard',
  DAY_DISCUSS: 'day_discuss',
  DAY_VOTE: 'day_vote',
  VOTE_RESULT: 'vote_result',
  LAST_WORDS: 'last_words',      // 遗言阶段
  HUNTER_SHOOT: 'hunter_shoot',  // 猎人开枪阶段
  GAME_OVER: 'game_over'
};

class GameEngine {
  constructor() {
    this.reset();
  }

  reset() {
    resetUsedNames(); // 重置 AI 名字池
    this.phase = PHASES.WAITING;
    this.players = [];
    this.dayCount = 0;
    this.currentSpeakerIndex = 0;
    this.messages = new MessageManager();
    this.votes = {};
    this.voteDetails = {};
    this.nightActions = {};
    this.werewolfTarget = null;
    this.guardTarget = null;
    this.lastGuardTarget = null;
    this.witchPotion = { heal: true, poison: true };
    this.deadTonight = [];
    this.lastExiled = null;
    this.winner = null;
    this.hostId = null;
    this.playerCount = 9;
    // 遗言和猎人相关
    this.lastWordsPlayer = null;    // 正在发表遗言的玩家
    this.hunterCanShoot = false;    // 猎人是否可以开枪
    this.hunterTarget = null;       // 猎人开枪目标
  }

  join(playerId, playerName, isAI = false, soul = null) {
    if (this.phase !== PHASES.WAITING) {
      throw new Error('游戏已开始，无法加入');
    }
    if (this.players.length >= this.playerCount) {
      throw new Error('房间已满');
    }
    if (this.players.find(p => p.id === playerId)) {
      throw new Error('已在游戏中');
    }

    if (this.players.length === 0) {
      this.hostId = playerId;
    }

    this.players.push({
      id: playerId,
      name: playerName,
      isAI,
      role: null,
      alive: true,
      soul,
      messages: []
    });

    return this.players.length;
  }

  setPlayerCount(count) {
    if (this.phase !== PHASES.WAITING) {
      throw new Error('游戏已开始，无法修改配置');
    }
    if (! [9, 12, 16].includes(count)) {
      throw new Error('只支持 9/12/16 人局');
    }
    this.playerCount = count;
  }

  addAIPlayers(count) {
    const available = this.playerCount - this.players.length;
    const toAdd = Math.min(count, available);

    const profiles = getRandomProfiles(toAdd);

    for (let i = 0; i < toAdd; i++) {
      const profile = profiles[i];
      this.join(`ai_${Date.now()}_${i}`, profile.name, true, profile.soul);
    }

    return toAdd;
  }

  // 随机打乱玩家顺序
  shufflePlayers() {
    for (let i = this.players.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.players[i], this.players[j]] = [this.players[j], this.players[i]];
    }
  }

  start(debugConfig = null) {
    if (this.players.length !== this.playerCount) {
      throw new Error(`需要 ${this.playerCount} 名玩家才能开始`);
    }
    if (this.phase !== PHASES.WAITING) {
      throw new Error('游戏已开始');
    }

    // 随机 shuffle 玩家顺序
    this.shufflePlayers();

    const roles = generateRoles(this.playerCount);

    // 调试模式：支持指定玩家角色
    if (debugConfig && debugConfig.playerId && debugConfig.role) {
      const playerIndex = this.players.findIndex(p => p.id === debugConfig.playerId);
      if (playerIndex !== -1) {
        const targetRole = debugConfig.role;
        const roleIndex = roles.findIndex(r => r === targetRole);
        if (roleIndex !== -1) {
          // 交换角色
          [roles[playerIndex], roles[roleIndex]] = [roles[roleIndex], roles[playerIndex]];
        }
      }
    }

    this.players.forEach((player, index) => {
      player.role = roles[index];
    });

    this.dayCount = 1;
    this.phase = PHASES.NIGHT_WEREWOLF_DISCUSS;
    this.currentSpeakerIndex = 0;
    this.nightActions = {};

    // 添加阶段开始消息
    this.messages.addPhaseStart(this.phase, this.dayCount);

    return this.getState();
  }

  getCurrentSpeaker() {
    const speakers = this.getSpeakersForPhase();
    if (this.currentSpeakerIndex >= speakers.length) {
      return null;
    }
    return speakers[this.currentSpeakerIndex];
  }

  getSpeakersForPhase() {
    switch (this.phase) {
      case PHASES.NIGHT_WEREWOLF_DISCUSS:
        return this.players.filter(p => p.alive && p.role === ROLES.WEREWOLF);
      case PHASES.DAY_DISCUSS:
        return this.players.filter(p => p.alive);
      default:
        return [];
    }
  }

  speak(playerId, content, debugInfo = null) {
    const player = this.players.find(p => p.id === playerId);
    if (!player || !player.alive) {
      throw new Error('玩家不存在或已死亡');
    }

    const currentSpeaker = this.getCurrentSpeaker();
    if (!currentSpeaker || currentSpeaker.id !== playerId) {
      throw new Error('还没轮到你发言');
    }

    // 添加发言消息（带调试信息）
    this.messages.addSpeech(playerId, player.name, content, this.phase, this.dayCount, debugInfo);

    this.currentSpeakerIndex++;

    const speakers = this.getSpeakersForPhase();
    if (this.currentSpeakerIndex >= speakers.length) {
      this.advancePhase();
    }

    return this.getState(playerId);
  }

  vote(voterId, targetId) {
    const voter = this.players.find(p => p.id === voterId);

    if (!voter || !voter.alive) {
      throw new Error('投票者不存在或已死亡');
    }

    // 弃权：targetId 为 null
    if (targetId !== null) {
      const target = this.players.find(p => p.id === targetId);
      if (!target || !target.alive) {
        throw new Error('投票目标不存在或已死亡');
      }
      if (voterId === targetId && this.phase === PHASES.DAY_VOTE) {
        throw new Error('不能投自己');
      }
    }

    if (this.phase === PHASES.NIGHT_WEREWOLF_VOTE) {
      if (voter.role !== ROLES.WEREWOLF) {
        throw new Error('只有狼人可以投票');
      }
    } else if (this.phase === PHASES.DAY_VOTE) {
      // 白天投票
    } else {
      throw new Error('当前不是投票阶段');
    }

    this.votes[voterId] = targetId;

    // 添加投票私有消息
    const isWolfVote = this.phase === PHASES.NIGHT_WEREWOLF_VOTE;
    const targetPlayer = targetId ? this.players.find(p => p.id === targetId) : null;
    const targetName = targetPlayer ? `${this.players.findIndex(p => p.id === targetId) + 1}号${targetPlayer.name}` : '弃权';
    this.messages.addVoteMessage(voterId, targetName, isWolfVote, this.phase, this.dayCount);

    const expectedVoters = this.phase === PHASES.NIGHT_WEREWOLF_VOTE
      ? this.players.filter(p => p.alive && p.role === ROLES.WEREWOLF)
      : this.players.filter(p => p.alive);

    if (Object.keys(this.votes).length >= expectedVoters.length) {
      this.resolveVotes();
    }

    return this.getState(voterId);
  }

  resolveVotes() {
    const voteCount = {};
    for (const targetId of Object.values(this.votes)) {
      // 弃权票不计入
      if (targetId !== null) {
        voteCount[targetId] = (voteCount[targetId] || 0) + 1;
      }
    }

    let maxVotes = 0;
    let targets = [];
    for (const [targetId, count] of Object.entries(voteCount)) {
      if (count > maxVotes) {
        maxVotes = count;
        targets = [targetId];
      } else if (count === maxVotes) {
        targets.push(targetId);
      }
    }

    if (this.phase === PHASES.NIGHT_WEREWOLF_VOTE) {
      if (targets.length === 1) {
        this.werewolfTarget = targets[0];
      } else {
        this.werewolfTarget = targets[Math.floor(Math.random() * targets.length)];
      }
      this.votes = {};
      this.advancePhase();
    } else if (this.phase === PHASES.DAY_VOTE) {
      // 保存投票详情
      this.voteDetails = { ...this.votes };
      this.phase = PHASES.VOTE_RESULT;

      if (targets.length === 1) {
        const exiled = this.players.find(p => p.id === targets[0]);
        if (exiled) {
          exiled.alive = false;
          exiled.deathReason = 'vote'; // 记录死因
          this.lastExiled = exiled;
        }
      } else {
        this.lastExiled = null;
      }

      // 添加放逐公告消息
      this.messages.addExileMessage(this.lastExiled, this.voteDetails, this.players, this.dayCount);

      // 第一天白天放逐才有遗言
      if (this.lastExiled && this.dayCount === 1) {
        this.phase = PHASES.LAST_WORDS;
        this.lastWordsPlayer = this.lastExiled;
        const pos = this.players.findIndex(p => p.id === this.lastExiled.id) + 1;
        this.messages.addMessage('last_words_start', {
          content: `请 ${pos}号${this.lastExiled.name} 发表遗言`,
          phase: this.phase,
          dayCount: this.dayCount,
          visibility: 'public'
        });
      } else {
        this.advancePhase();
      }
    }
  }

  seerCheck(seerId, targetId) {
    const seer = this.players.find(p => p.id === seerId);
    const target = this.players.find(p => p.id === targetId);

    if (!seer || seer.role !== ROLES.SEER || !seer.alive) {
      throw new Error('你不是预言家或已死亡');
    }
    if (!target || !target.alive) {
      throw new Error('目标不存在或已死亡');
    }
    if (this.phase !== PHASES.NIGHT_SEER) {
      throw new Error('现在不是查验时间');
    }

    const isWolf = target.role === ROLES.WEREWOLF;

    // 添加技能使用和结果消息
    const targetPos = this.players.findIndex(p => p.id === targetId) + 1;
    this.messages.addSkillUseMessage(seerId, 'seer_check', `${targetPos}号${target.name}`, this.phase, this.dayCount);
    this.messages.addSkillResultMessage(seerId, `查验结果：${targetPos}号${target.name} ${isWolf ? '是狼人' : '是好人'}`, this.phase, this.dayCount);

    this.advancePhase();
    return { targetId, isWolf };
  }

  witchAction(witchId, action, targetId = null) {
    const witch = this.players.find(p => p.id === witchId);
    if (!witch || witch.role !== ROLES.WITCH || !witch.alive) {
      throw new Error('你不是女巫或已死亡');
    }
    if (this.phase !== PHASES.NIGHT_WITCH) {
      throw new Error('现在不是女巫行动时间');
    }

    if (action === 'heal') {
      if (!this.witchPotion.heal) {
        throw new Error('解药已用完');
      }
      if (this.nightActions.healed) {
        throw new Error('今晚已经用过解药了');
      }
      if (this.werewolfTarget) {
        this.witchPotion.heal = false;
        this.nightActions.healed = this.werewolfTarget;
        const targetPlayer = this.players.find(p => p.id === this.werewolfTarget);
        const targetPos = this.players.findIndex(p => p.id === this.werewolfTarget) + 1;
        const targetName = targetPlayer ? `${targetPos}号${targetPlayer.name}` : '某人';
        this.messages.addSkillUseMessage(witchId, 'witch_heal', targetName, this.phase, this.dayCount);
      }
    } else if (action === 'poison') {
      if (!this.witchPotion.poison) {
        throw new Error('毒药已用完');
      }
      if (this.nightActions.poisonTarget) {
        throw new Error('今晚已经用过毒药了');
      }
      const target = this.players.find(p => p.id === targetId);
      if (!target || !target.alive) {
        throw new Error('目标无效');
      }
      // 不能毒今晚被刀的人
      if (targetId === this.werewolfTarget) {
        throw new Error('不能毒今晚被狼人杀害的人');
      }
      this.witchPotion.poison = false;
      this.nightActions.poisonTarget = targetId;
      const targetPos = this.players.findIndex(p => p.id === targetId) + 1;
      this.messages.addSkillUseMessage(witchId, 'witch_poison', `${targetPos}号${target.name}`, this.phase, this.dayCount);
    } else if (action === 'skip') {
      // 记录跳过
      this.messages.addSkillUseMessage(witchId, 'witch_skip', null, this.phase, this.dayCount);
      // 结束行动
      this.advancePhase();
      return this.getState(witchId);
    }

    // 检查是否还有药可用
    const canHeal = this.witchPotion.heal && this.werewolfTarget && !this.nightActions.healed;
    const canPoison = this.witchPotion.poison && !this.nightActions.poisonTarget;

    // 如果没有药可用了，自动进入下一阶段
    if (!canHeal && !canPoison) {
      this.advancePhase();
    }

    return this.getState(witchId);
  }

  guardProtect(guardId, targetId) {
    const guard = this.players.find(p => p.id === guardId);
    const target = this.players.find(p => p.id === targetId);

    if (!guard || guard.role !== ROLES.GUARD || !guard.alive) {
      throw new Error('你不是守卫或已死亡');
    }
    if (!target || !target.alive) {
      throw new Error('目标无效');
    }
    if (targetId === this.lastGuardTarget) {
      throw new Error('不能连续两晚守护同一人');
    }
    if (this.phase !== PHASES.NIGHT_GUARD) {
      throw new Error('现在不是守护时间');
    }

    this.guardTarget = targetId;
    this.lastGuardTarget = targetId;

    // 添加技能使用消息
    const targetPos = this.players.findIndex(p => p.id === targetId) + 1;
    this.messages.addSkillUseMessage(guardId, 'guard_protect', `${targetPos}号${target.name}`, this.phase, this.dayCount);

    this.advancePhase();
    return this.getState(guardId);
  }

  advancePhase() {
    switch (this.phase) {
      case PHASES.NIGHT_WEREWOLF_DISCUSS:
        this.phase = PHASES.NIGHT_WEREWOLF_VOTE;
        this.votes = {};
        this.messages.addPhaseStart(this.phase, this.dayCount);
        break;

      case PHASES.NIGHT_WEREWOLF_VOTE:
        this.phase = PHASES.NIGHT_SEER;
        this.messages.addPhaseStart(this.phase, this.dayCount);
        break;

      case PHASES.NIGHT_SEER:
        this.phase = PHASES.NIGHT_WITCH;
        this.messages.addPhaseStart(this.phase, this.dayCount);
        break;

      case PHASES.NIGHT_WITCH:
        // 检查是否有存活的守卫
        const hasGuard = this.players.some(p => p.alive && p.role === ROLES.GUARD);
        if (hasGuard) {
          this.phase = PHASES.NIGHT_GUARD;
          this.messages.addPhaseStart(this.phase, this.dayCount);
        } else {
          // 没有守卫，直接结算夜晚
          this.resolveNight();
          this.messages.addDeathMessage(this.deadTonight, this.players, this.dayCount);

          // 检查是否有猎人需要开枪（非第一夜被刀死的猎人）
          const deadHunterNoGuard = this.deadTonight.find(p =>
            p.role === ROLES.HUNTER && p.deathReason === 'wolf'
          );

          // 第一夜有人死才有遗言
          if (this.deadTonight.length > 0 && this.dayCount === 1) {
            this.phase = PHASES.LAST_WORDS;
            this.lastWordsPlayer = this.deadTonight[0];
            const pos = this.players.findIndex(p => p.id === this.lastWordsPlayer.id) + 1;
            this.messages.addMessage('last_words_start', {
              content: `请 ${pos}号${this.lastWordsPlayer.name} 发表遗言`,
              phase: this.phase,
              dayCount: this.dayCount,
              visibility: 'public'
            });
          } else if (deadHunterNoGuard && this.dayCount > 1) {
            // 非第一夜猎人被刀，进入开枪阶段（无遗言）
            this.phase = PHASES.HUNTER_SHOOT;
            this.hunterCanShoot = true;
            const pos = this.players.findIndex(p => p.id === deadHunterNoGuard.id) + 1;
            this.messages.addMessage('hunter_shoot_start', {
              content: `猎人 ${pos}号${deadHunterNoGuard.name} 请决定是否开枪`,
              phase: this.phase,
              dayCount: this.dayCount,
              visibility: 'public'
            });
          } else {
            if (this.checkWinCondition()) {
              this.phase = PHASES.GAME_OVER;
              this.messages.addGameOverMessage(this.winner, this.players);
            } else {
              this.phase = PHASES.DAY_DISCUSS;
              this.currentSpeakerIndex = 0;
              this.messages.addPhaseStart(this.phase, this.dayCount);
            }
          }
        }
        break;

      case PHASES.NIGHT_GUARD:
        this.resolveNight();
        // 添加死亡消息
        this.messages.addDeathMessage(this.deadTonight, this.players, this.dayCount);

        // 检查是否有猎人需要开枪（非第一夜被刀死的猎人）
        const deadHunter = this.deadTonight.find(p =>
          p.role === ROLES.HUNTER && p.deathReason === 'wolf'
        );

        // 第一夜有人死才有遗言
        if (this.deadTonight.length > 0 && this.dayCount === 1) {
          this.phase = PHASES.LAST_WORDS;
          this.lastWordsPlayer = this.deadTonight[0];
          const pos = this.players.findIndex(p => p.id === this.lastWordsPlayer.id) + 1;
          this.messages.addMessage('last_words_start', {
            content: `请 ${pos}号${this.lastWordsPlayer.name} 发表遗言`,
            phase: this.phase,
            dayCount: this.dayCount,
            visibility: 'public'
          });
        } else if (deadHunter && this.dayCount > 1) {
          // 非第一夜猎人被刀，进入开枪阶段（无遗言）
          this.phase = PHASES.HUNTER_SHOOT;
          this.hunterCanShoot = true;
          const pos = this.players.findIndex(p => p.id === deadHunter.id) + 1;
          this.messages.addMessage('hunter_shoot_start', {
            content: `猎人 ${pos}号${deadHunter.name} 请决定是否开枪`,
            phase: this.phase,
            dayCount: this.dayCount,
            visibility: 'public'
          });
        } else {
          // 没有遗言，直接进入白天
          if (this.checkWinCondition()) {
            this.phase = PHASES.GAME_OVER;
            this.messages.addGameOverMessage(this.winner, this.players);
          } else {
            this.phase = PHASES.DAY_DISCUSS;
            this.currentSpeakerIndex = 0;
            this.messages.addPhaseStart(this.phase, this.dayCount);
          }
        }
        break;

      case PHASES.DAY_DISCUSS:
        this.phase = PHASES.DAY_VOTE;
        this.votes = {};
        this.messages.addPhaseStart(this.phase, this.dayCount);
        break;

      case PHASES.DAY_VOTE:
        // 在 resolveVotes 中处理
        break;

      case PHASES.VOTE_RESULT:
        if (this.checkWinCondition()) {
          this.phase = PHASES.GAME_OVER;
          this.messages.addGameOverMessage(this.winner, this.players);
        } else {
          this.dayCount++;
          this.phase = PHASES.NIGHT_WEREWOLF_DISCUSS;
          this.currentSpeakerIndex = 0;
          this.votes = {};
          this.voteDetails = {};
          this.nightActions = {};
          this.werewolfTarget = null;
          this.guardTarget = null;
          this.deadTonight = [];
          this.lastExiled = null;
          this.messages.addPhaseStart(this.phase, this.dayCount);
        }
        break;
    }
  }

  resolveNight() {
    this.deadTonight = [];

    if (this.werewolfTarget) {
      const target = this.players.find(p => p.id === this.werewolfTarget);
      const isGuarded = this.guardTarget === this.werewolfTarget;
      const isHealed = this.nightActions.healed === this.werewolfTarget;

      if (!isGuarded && !isHealed && target) {
        target.alive = false;
        target.deathReason = 'wolf'; // 记录死因
        this.deadTonight.push(target);
      }
    }

    if (this.nightActions.poisonTarget) {
      const target = this.players.find(p => p.id === this.nightActions.poisonTarget);
      if (target && target.alive) {
        target.alive = false;
        target.deathReason = 'poison'; // 被毒死
        if (!this.deadTonight.includes(target)) {
          this.deadTonight.push(target);
        }
      }
    }
  }

  // 发表遗言
  lastWords(playerId, content) {
    const player = this.players.find(p => p.id === playerId);
    if (!player || player.alive) {
      throw new Error('玩家不存在或还活着');
    }
    if (this.phase !== PHASES.LAST_WORDS) {
      throw new Error('现在不是遗言阶段');
    }
    if (this.lastWordsPlayer?.id !== playerId) {
      throw new Error('还没轮到你发表遗言');
    }

    // 添加遗言消息
    const position = this.players.findIndex(p => p.id === playerId) + 1;
    this.messages.addLastWords(playerId, player.name, content, position);

    // 检查是否是猎人且可以开枪
    if (player.role === ROLES.HUNTER && player.deathReason !== 'poison') {
      this.hunterCanShoot = true;
      this.phase = PHASES.HUNTER_SHOOT;
    } else {
      this.finishDeathPhase();
    }

    return this.getState();
  }

  // 猎人开枪
  hunterShoot(hunterId, targetId) {
    const hunter = this.players.find(p => p.id === hunterId);
    const target = this.players.find(p => p.id === targetId);

    if (!hunter || hunter.role !== ROLES.HUNTER) {
      throw new Error('你不是猎人');
    }
    if (this.phase !== PHASES.HUNTER_SHOOT) {
      throw new Error('现在不是开枪时间');
    }
    if (!target || !target.alive) {
      throw new Error('目标无效');
    }

    target.alive = false;
    target.deathReason = 'hunter';

    // 添加开枪消息
    const hunterPos = this.players.findIndex(p => p.id === hunterId) + 1;
    const targetPos = this.players.findIndex(p => p.id === targetId) + 1;
    this.messages.addMessage(MESSAGE_TYPES.HUNTER_SHOOT, {
      content: `猎人 ${hunterPos}号${hunter.name} 开枪带走了 ${targetPos}号${target.name}`,
      phase: this.phase,
      dayCount: this.dayCount,
      visibility: 'public'
    });

    // 检查被带走的人是否是猎人（递归开枪？不，规则上不允许）
    this.hunterCanShoot = false;
    this.finishDeathPhase();

    return this.getState();
  }

  // 猎人选择不开枪
  hunterSkip(hunterId) {
    const hunter = this.players.find(p => p.id === hunterId);
    if (!hunter || hunter.role !== ROLES.HUNTER) {
      throw new Error('你不是猎人');
    }
    if (this.phase !== PHASES.HUNTER_SHOOT) {
      throw new Error('现在不是开枪时间');
    }

    this.hunterCanShoot = false;
    this.finishDeathPhase();

    return this.getState();
  }

  // 完成死亡阶段（遗言+开枪后）
  finishDeathPhase() {
    if (this.checkWinCondition()) {
      this.phase = PHASES.GAME_OVER;
      this.messages.addGameOverMessage(this.winner, this.players);
    } else if (this.lastWordsPlayer?.deathReason === 'vote') {
      // 白天放逐后，进入夜晚
      this.dayCount++;
      this.phase = PHASES.NIGHT_WEREWOLF_DISCUSS;
      this.currentSpeakerIndex = 0;
      this.votes = {};
      this.voteDetails = {};
      this.nightActions = {};
      this.werewolfTarget = null;
      this.guardTarget = null;
      this.deadTonight = [];
      this.lastExiled = null;
      this.lastWordsPlayer = null;
      this.messages.addPhaseStart(this.phase, this.dayCount);
    } else {
      // 夜晚死亡后，进入白天讨论
      this.phase = PHASES.DAY_DISCUSS;
      this.currentSpeakerIndex = 0;
      this.lastWordsPlayer = null;
      this.messages.addPhaseStart(this.phase, this.dayCount);
    }
  }

  checkWinCondition() {
    const aliveWolves = this.players.filter(p => p.alive && p.role === ROLES.WEREWOLF).length;
    const aliveGods = this.players.filter(p => p.alive && CAMPS[p.role] === 'god').length;
    const aliveVillagers = this.players.filter(p => p.alive && p.role === ROLES.VILLAGER).length;

    // 狼全死 → 好人胜
    if (aliveWolves === 0) {
      this.winner = 'villager';
      return true;
    }

    // 神全死 → 狼人胜
    if (aliveGods === 0) {
      this.winner = 'werewolf';
      return true;
    }

    // 村民全死 → 狼人胜
    if (aliveVillagers === 0) {
      this.winner = 'werewolf';
      return true;
    }

    return false;
  }

  getState(forPlayerId = null) {
    const player = forPlayerId ? this.players.find(p => p.id === forPlayerId) : null;
    const playerRole = player?.role;

    // 获取该玩家可见的消息
    const visibleMessages = this.messages.getMessagesForDisplay(forPlayerId, playerRole, this.phase);

    // 判断是否应该返回 currentSpeaker（夜晚只给相关角色）
    let currentSpeaker = null;
    const isNight = this.phase.startsWith('night');

    if (isNight) {
      // 夜晚只有相关角色能看到 currentSpeaker
      if (this.phase === PHASES.NIGHT_WEREWOLF_DISCUSS && playerRole === ROLES.WEREWOLF) {
        currentSpeaker = this.getCurrentSpeaker()?.id || null;
      }
      // 其他夜晚阶段（预言家/女巫/守卫）是单人行动，不需要 currentSpeaker
    } else {
      // 白天所有人都能看到
      currentSpeaker = this.getCurrentSpeaker()?.id || null;
    }

    // 夜晚阶段不返回 deadTonight，天亮后才公开
    const shouldShowDeadTonight = !isNight || this.phase === PHASES.GAME_OVER;

    const baseState = {
      phase: this.phase,
      dayCount: this.dayCount,
      players: this.players.map(p => ({
        id: p.id,
        name: p.name,
        isAI: p.isAI,
        alive: p.alive,
        role: this.phase === PHASES.GAME_OVER ? p.role : null,
        deathReason: p.deathReason || null
      })),
      currentSpeaker,
      messages: visibleMessages,
      votes: Object.keys(this.votes).length,
      hasVoted: forPlayerId ? this.votes.hasOwnProperty(forPlayerId) : false,
      voteDetails: this.phase === PHASES.VOTE_RESULT ? this.voteDetails : null,
      deadTonight: shouldShowDeadTonight ? this.deadTonight.map(p => p.name) : [],
      lastExiled: this.lastExiled ? { id: this.lastExiled.id, name: this.lastExiled.name } : null,
      lastWordsPlayer: this.lastWordsPlayer ? { id: this.lastWordsPlayer.id, name: this.lastWordsPlayer.name } : null,
      winner: this.winner,
      hostId: this.hostId,
      playerCount: this.playerCount
    };

    if (player) {
      const playerIndex = this.players.findIndex(p => p.id === forPlayerId);
      baseState.players[playerIndex].role = player.role;

      if (player.role === ROLES.WEREWOLF) {
        this.players.forEach((p, i) => {
          if (p.role === ROLES.WEREWOLF) {
            baseState.players[i].role = ROLES.WEREWOLF;
          }
        });
      }

      if (player.role === ROLES.WITCH) {
        baseState.witchPotion = this.witchPotion;
        // 女巫行动阶段，返回刀口和今晚已使用的药水
        if (this.phase === PHASES.NIGHT_WITCH) {
          if (this.werewolfTarget) {
            baseState.werewolfTarget = this.players.find(p => p.id === this.werewolfTarget)?.name;
          }
          // 返回今晚已使用的药水
          baseState.witchUsedTonight = {
            healed: !!this.nightActions.healed,
            poisoned: !!this.nightActions.poisonTarget
          };
        }
      }
    }

    return baseState;
  }

  getAIContext(aiPlayerId) {
    const player = this.players.find(p => p.id === aiPlayerId);
    if (!player || !player.isAI) return null;

    // 获取AI可见的消息
    const visibleMessages = this.messages.getVisibleMessages(aiPlayerId, player.role, this.phase);

    // 提取所有相关消息（发言、死亡、放逐等）
    const messageHistory = visibleMessages.map(m => ({
      type: m.type,
      playerId: m.playerId,
      playerName: m.playerName,
      content: m.content,
      phase: m.phase,
      dayCount: m.dayCount
    }));

    const context = {
      player,
      phase: this.phase,
      dayCount: this.dayCount,
      messageHistory,
      alivePlayers: this.players.filter(p => p.alive),
      teammates: player.role === ROLES.WEREWOLF
        ? this.players.filter(p => p.role === ROLES.WEREWOLF && p.id !== aiPlayerId).map(p => p.name)
        : []
    };

    if (player.role === ROLES.WITCH) {
      context.witchPotion = this.witchPotion;
      context.werewolfTarget = this.werewolfTarget
        ? this.players.find(p => p.id === this.werewolfTarget)
        : null;
      context.nightActions = {
        healed: !!this.nightActions.healed,
        poisonTarget: this.nightActions.poisonTarget
          ? this.players.find(p => p.id === this.nightActions.poisonTarget)
          : null
      };
    }

    if (player.role === ROLES.GUARD) {
      context.lastGuardTarget = this.lastGuardTarget
        ? this.players.find(p => p.id === this.lastGuardTarget)
        : null;
    }

    return context;
  }
}

module.exports = {
  PHASES,
  GameEngine
};