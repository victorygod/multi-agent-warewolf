/**
 * 游戏配置 - 所有业务规则定义
 */

// 阵营定义
const CAMPS = {
  good: { name: '好人阵营' },
  wolf: { name: '狼人阵营' },
  third: { name: '第三方阵营' }
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

// 规则配置项
const RULES = {
  witch: {
    canSelfHeal: false,
    canUseBothSameNight: true
  },
  guard: {
    allowRepeatGuard: false
  },
  hunter: {
    canShootIfPoisoned: false
  }
};

// 遗言规则
function hasLastWords(player, reason, game) {
  // 首夜死亡有遗言
  if (game.nightCount === 1 && reason !== 'couple') return true;
  // 白天死亡有遗言
  if (reason === 'vote' || reason === 'hunter') return true;
  // 其他情况无遗言
  return false;
}

// 钩子函数
const HOOKS = {
  getCamp,
  getVoteWeight: (player, game) => game.sheriff === player.id ? 1.5 : 1,
  canVote: (player) => player.alive && player.state?.canVote !== false,
  hasLastWords,
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