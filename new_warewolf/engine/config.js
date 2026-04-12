/**
 * 游戏配置 - 所有业务规则定义
 */

// 阵营定义
const CAMPS = {
  good: { name: '好人阵营' },
  wolf: { name: '狼人阵营' },
  third: { name: '第三方阵营' }
};

// 规则配置
const RULES = {
  guard: {
    allowRepeatGuard: false
  },
  witch: {
    canSelfHeal: false,
    canUseBothSameNight: true
  },
  hunter: {
    canShootIfPoisoned: false
  },
  sheriff: {
    enabled: true,
    sheriffAssignOrder: true
  }
};

// 胜利条件
const WIN_CONDITIONS = {
  good: (game) => {
    const wolves = game.players.filter(p => p.alive && getCamp(p, game) === 'wolf');
    return wolves.length === 0;
  },
  wolf: (game) => {
    const gods = game.players.filter(p => p.alive && p.role.type === 'god');
    const villagers = game.players.filter(p => p.alive && p.role.type === 'villager');
    return gods.length === 0 || villagers.length === 0; // 屠边
  },
  third: (game) => {
    // 情侣存活，其他人全死
    if (!game.couples || game.couples.length < 2) return false;
    const couples = game.players.filter(p => game.couples.includes(p.id));
    const others = game.players.filter(p => !game.couples.includes(p.id));
    return couples.every(p => p.alive) && others.every(p => !p.alive);
  }
};

// 获取玩家阵营（考虑动态阵营）
function getCamp(player, game) {
  // 情侣阵营判断
  if (game.couples?.includes(player.id)) {
    const couplePlayers = game.couples.map(id => game.players.find(p => p.id === id));
    const camps = couplePlayers.map(p => p.role.camp);
    if (camps.includes('good') && camps.includes('wolf')) {
      return 'third'; // 人狼恋
    }
  }
  return player.role.camp;
}

// 遗言规则
function hasLastWords(player, reason, game) {
  // 殉情死亡无遗言
  if (reason === 'couple') return false;

  // 白天死亡有遗言
  if (reason === 'vote' || reason === 'hunter') return true;

  // 首夜死亡有遗言
  if (game.nightCount === 0) return true;

  // 第二夜及之后的夜晚死亡无遗言
  return false;
}

// 行动目标过滤规则（用于 buildActionData）
const ACTION_FILTERS = {
  // 守卫：不能守护自己、不能连续守护同一人、不能守护死亡玩家
  guard: (game, player) => {
    const lastTarget = player.state?.lastGuardTarget;
    return game.players
      .filter(p => p.id !== player.id && p.alive && p.id !== lastTarget)
      .map(p => p.id);
  },

  // 女巫毒药：不能毒自己、不能毒被狼刀的人、不能毒死亡玩家
  witch_poison: (game, player, extraData) => {
    const werewolfTarget = extraData?.werewolfTarget;
    return game.players
      .filter(p => p.id !== player.id && p.id !== werewolfTarget && p.alive)
      .map(p => p.id);
  },

  // 预言家：不能查验自己、不能查验已查验的、不能查验死亡玩家
  seer: (game, player) => {
    const checkedIds = (player.state?.seerChecks || []).map(c => c.targetId);
    return game.players
      .filter(p => p.id !== player.id && p.alive && !checkedIds.includes(p.id))
      .map(p => p.id);
  },

  // 丘比特：固定选2人
  cupid: (game, player) => null, // 由 action 本身控制数量

  // 白天投票：不能投自己、只能投存活玩家
  vote: (game, player) => {
    return game.players
      .filter(p => p.alive && p.id !== player.id)
      .map(p => p.id);
  },

  // 狼人投票：所有存活玩家（包括自己阵营的狼人）
  wolf_vote: (game, player) => {
    return game.players
      .filter(p => p.alive)
      .map(p => p.id);
  },

  // 猎人射击：不能射自己、只能射存活玩家
  shoot: (game, player) => {
    return game.players
      .filter(p => p.alive && p.id !== player.id)
      .map(p => p.id);
  },

  // 警长传徽：不能传给自己、只能传给存活玩家
  pass_badge: (game, player) => {
    return game.players
      .filter(p => p.id !== player.id && p.alive)
      .map(p => p.id);
  }
};

// 钩子函数
const HOOKS = {
  getCamp,
  getVoteWeight: (player, game) => game.sheriff === player.id ? 1.5 : 1,
  canVote: (player) => player.alive && player.state?.canVote !== false,
  hasLastWords,
  RULES,
  ACTION_FILTERS,
  checkWin: (game) => {
    for (const [camp, condition] of Object.entries(WIN_CONDITIONS)) {
      if (condition(game)) return camp;
    }
    return null;
  }
};

module.exports = {
  CAMPS,
  WIN_CONDITIONS,
  RULES,
  HOOKS,
  getCamp
};