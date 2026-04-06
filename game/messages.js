/**
 * 消息管理系统
 * 统一管理所有消息的生成、存储和可见性
 */

const { ROLES } = require('./roles');

// 消息类型
const MESSAGE_TYPES = {
  // 发言类
  SPEECH: 'speech',                    // 普通发言
  WOLF_SPEECH: 'wolf_speech',          // 狼人夜间发言

  // 行为类（仅自己可见）
  VOTE: 'vote',                        // 投票
  SKILL_USE: 'skill_use',              // 技能使用
  SKILL_RESULT: 'skill_result',        // 技能结果

  // 公告类
  PHASE_START: 'phase_start',          // 阶段开始
  DEATH: 'death',                      // 夜晚死亡公告
  EXILE: 'exile',                      // 放逐公告
  GAME_OVER: 'game_over',              // 游戏结束
  HUNTER_SHOOT: 'hunter_shoot',        // 猎人开枪

  // 遗言
  LAST_WORDS: 'last_words'
};

// 阶段名称（不依赖 engine.js 避免循环依赖）
const PHASE_NAMES = {
  night_werewolf_discuss: '狼人讨论',
  night_werewolf_vote: '狼人投票',
  night_seer: '预言家查验',
  night_witch: '女巫行动',
  night_guard: '守卫守护',
  day_discuss: '白天讨论',
  day_vote: '投票放逐',
  vote_result: '投票结果',
  last_words: '遗言',
  hunter_shoot: '猎人开枪'
};

class MessageManager {
  constructor() {
    this.messages = [];
    this.messageIdCounter = 0;
  }

  reset() {
    this.messages = [];
    this.messageIdCounter = 0;
  }

  // 添加消息
  addMessage(type, data) {
    const message = {
      id: ++this.messageIdCounter,
      type,
      timestamp: Date.now(),
      ...data
    };
    this.messages.push(message);
    return message;
  }

  // ========== 发言类消息 ==========

  // 添加发言
  addSpeech(playerId, playerName, content, phase, dayCount, debugInfo = null) {
    const isWolfPhase = phase === 'night_werewolf_discuss' || phase === 'night_werewolf_vote';
    const message = {
      playerId,
      playerName,
      content,
      phase,
      dayCount
    };

    // 添加调试信息
    if (debugInfo) {
      message.debugInfo = debugInfo;
    }

    return this.addMessage(isWolfPhase ? MESSAGE_TYPES.WOLF_SPEECH : MESSAGE_TYPES.SPEECH, message);
  }

  // ========== 行为类消息（私有） ==========

  // 投票消息
  addVoteMessage(voterId, targetName, isWolfVote, phase, dayCount) {
    let content;
    if (targetName === '弃权') {
      content = '你选择了弃权';
    } else {
      const action = isWolfVote ? '击杀' : '投票放逐';
      content = `你选择${action}了 ${targetName}`;
    }
    return this.addMessage(MESSAGE_TYPES.VOTE, {
      playerId: voterId,
      content,
      phase,
      dayCount,
      visibility: 'private'
    });
  }

  // 技能使用消息
  addSkillUseMessage(playerId, skillType, targetName, phase, dayCount) {
    const skillNames = {
      seer_check: '查验',
      guard_protect: '守护',
      witch_heal: '使用解药救了',
      witch_poison: '使用毒药毒杀了',
      witch_skip: '选择不使用药水'
    };

    const actionText = skillNames[skillType] || skillType;
    const content = targetName
      ? `你${actionText} ${targetName}`
      : `你${actionText}`;

    return this.addMessage(MESSAGE_TYPES.SKILL_USE, {
      playerId,
      content,
      phase,
      dayCount,
      visibility: 'private'
    });
  }

  // 技能结果消息
  addSkillResultMessage(playerId, content, phase, dayCount) {
    return this.addMessage(MESSAGE_TYPES.SKILL_RESULT, {
      playerId,
      content,
      phase,
      dayCount,
      visibility: 'private'
    });
  }

  // ========== 公告类消息 ==========

  // 阶段开始（始终对所有人可见）
  addPhaseStart(phase, dayCount) {
    const isNight = phase.startsWith('night');
    const phaseName = PHASE_NAMES[phase] || phase;
    const text = isNight ? `第${dayCount}夜 - ${phaseName}` : `第${dayCount}天 - ${phaseName}`;

    return this.addMessage(MESSAGE_TYPES.PHASE_START, {
      content: text,
      phase,
      dayCount,
      visibility: 'public'
    });
  }

  // 夜晚死亡公告
  addDeathMessage(deadPlayers, allPlayers, dayCount) {
    if (!deadPlayers || deadPlayers.length === 0) {
      return this.addMessage(MESSAGE_TYPES.DEATH, {
        content: `昨晚是平安夜，没有人死亡`,
        phase: 'day_discuss',
        dayCount,
        visibility: 'public'
      });
    }
    const names = deadPlayers.map(deadP => {
      // 查找位置号（1-based）
      const pos = allPlayers.findIndex(p => p.id === deadP.id) + 1;
      return `${pos}号${deadP.name}`;
    }).join('、');
    return this.addMessage(MESSAGE_TYPES.DEATH, {
      content: `昨晚 ${names} 死亡了`,
      phase: 'day_discuss',
      dayCount,
      visibility: 'public'
    });
  }

  // 放逐公告（带票型）
  addExileMessage(exiledPlayer, voteDetails, players, dayCount) {
    // 按得票人分组统计
    const voteCount = {}; // targetIndex -> count
    const voteBy = {};    // targetIndex -> [{index, name}]

    if (voteDetails && Object.keys(voteDetails).length > 0) {
      for (const [voterId, targetId] of Object.entries(voteDetails)) {
        const voterIndex = players.findIndex(p => p.id === voterId);
        const targetIndex = players.findIndex(p => p.id === targetId);
        if (voterIndex !== -1 && targetIndex !== -1) {
          const targetKey = String(targetIndex);
          voteCount[targetKey] = (voteCount[targetKey] || 0) + 1;
          if (!voteBy[targetKey]) {
            voteBy[targetKey] = [];
          }
          voteBy[targetKey].push({ index: voterIndex, name: players[voterIndex].name });
        }
      }
    }

    // 按得票数排序，构建票型文本
    const sortedTargets = Object.entries(voteCount)
      .sort((a, b) => b[1] - a[1]);

    const voteLines = sortedTargets.map(([targetIndex, count]) => {
      const idx = parseInt(targetIndex);
      const target = players[idx];
      const voters = voteBy[targetIndex] || [];
      const voterTexts = voters.map(v => `${v.index + 1}号${v.name}`);
      return `${idx + 1}号${target?.name || '未知'}：${count}票（${voterTexts.join('、')}）`;
    });

    const voteText = voteLines.length > 0 ? voteLines.join('<br>') : '无人投票';

    // 计算被放逐玩家的位置号
    const exiledIndex = exiledPlayer ? players.findIndex(p => p.id === exiledPlayer.id) : -1;
    const exiledPosition = exiledIndex !== -1 ? exiledIndex + 1 : null;

    const content = exiledPlayer
      ? `【票型】<br>${voteText}<br><br>${exiledPosition}号${exiledPlayer.name} 被投票放逐了`
      : `【票型】<br>${voteText}<br><br>平票，无人被放逐`;

    return this.addMessage(MESSAGE_TYPES.EXILE, {
      content,
      phase: 'vote_result',
      dayCount,
      visibility: 'public'
    });
  }

  // 游戏结束
  addGameOverMessage(winner, players) {
    const winnerText = winner === 'werewolf' ? '狼人阵营获胜！' : '好人阵营获胜！';

    const roleReveal = players.map((p, index) => {
      const roleName = getRoleName(p.role);
      const deathReason = getDeathReasonText(p.deathReason, p.alive);
      const position = index + 1;
      return `${position}号${p.name}：${roleName}${deathReason}`;
    }).join('\n');

    return this.addMessage(MESSAGE_TYPES.GAME_OVER, {
      content: `${winnerText}\n\n【角色揭示】\n${roleReveal}`,
      visibility: 'public'
    });
  }

  // 遗言
  addLastWords(playerId, playerName, content, position) {
    return this.addMessage(MESSAGE_TYPES.LAST_WORDS, {
      playerId,
      playerName,
      content: `【${position}号${playerName}的遗言】\n${content}`,
      visibility: 'public'
    });
  }

  // ========== 获取可见消息 ==========

  getVisibleMessages(playerId, playerRole, currentPhase) {
    return this.messages.filter(msg => {
      // 根据 visibility 和消息类型判断可见性
      switch (msg.visibility) {
        case 'public':
          return true;

        case 'private':
          return msg.playerId === playerId;

        case 'werewolf':
          return playerRole === ROLES.WEREWOLF;

        case 'seer':
          return playerRole === ROLES.SEER;

        case 'witch':
          return playerRole === ROLES.WITCH;

        case 'guard':
          return playerRole === ROLES.GUARD;

        default:
          // 根据消息类型判断
          if (msg.type === MESSAGE_TYPES.WOLF_SPEECH) {
            return playerRole === ROLES.WEREWOLF;
          }
          return true;
      }
    });
  }

  // 获取消息用于前端显示
  getMessagesForDisplay(playerId, playerRole, currentPhase) {
    const visibleMessages = this.getVisibleMessages(playerId, playerRole, currentPhase);

    return visibleMessages.map(msg => ({
      id: msg.id,
      type: msg.type,
      content: msg.content,
      playerId: msg.playerId,
      playerName: msg.playerName,
      className: getMessageClassName(msg.type),
      timestamp: msg.timestamp,
      debugInfo: msg.debugInfo || null
    }));
  }
}

// 辅助函数：获取消息样式类名
function getMessageClassName(type) {
  const classNames = {
    [MESSAGE_TYPES.SPEECH]: '',
    [MESSAGE_TYPES.WOLF_SPEECH]: 'wolf-channel',
    [MESSAGE_TYPES.VOTE]: 'private',
    [MESSAGE_TYPES.SKILL_USE]: 'private',
    [MESSAGE_TYPES.SKILL_RESULT]: 'private',
    [MESSAGE_TYPES.PHASE_START]: 'phase-divider',
    [MESSAGE_TYPES.DEATH]: 'system death',
    [MESSAGE_TYPES.EXILE]: 'system exile',
    [MESSAGE_TYPES.GAME_OVER]: 'system gameover',
    [MESSAGE_TYPES.HUNTER_SHOOT]: 'system hunter',
    [MESSAGE_TYPES.LAST_WORDS]: 'system lastwords'
  };
  return classNames[type] || '';
}

// 辅助函数：获取角色名称
function getRoleName(role) {
  const names = {
    [ROLES.WEREWOLF]: '狼人',
    [ROLES.SEER]: '预言家',
    [ROLES.WITCH]: '女巫',
    [ROLES.GUARD]: '守卫',
    [ROLES.HUNTER]: '猎人',
    [ROLES.VILLAGER]: '村民'
  };
  return names[role] || role;
}

// 辅助函数：获取死因文本
function getDeathReasonText(reason, alive) {
  if (alive) return '（存活）';
  switch (reason) {
    case 'wolf': return '（狼杀）';
    case 'poison': return '（毒杀）';
    case 'hunter': return '（枪杀）';
    case 'vote': return '（放逐）';
    default: return '（死亡）';
  }
}

module.exports = {
  MessageManager,
  MESSAGE_TYPES,
  PHASE_NAMES
};