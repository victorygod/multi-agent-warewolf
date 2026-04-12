/**
 * 通用工具函数
 */

// 数组随机打乱（Fisher-Yates 洗牌算法）
function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// 通过玩家ID获取位置号（1-based）
function getPosition(players, playerId) {
  const index = players.findIndex(p => p.id === playerId);
  return index >= 0 ? index + 1 : playerId;
}

// 通过位置号获取玩家（位置号1-based）
function getPlayerByPosition(players, position) {
  const index = position - 1;
  return players[index] || null;
}

// 获取玩家显示名称（带位置编号）
function getPlayerDisplay(players, player) {
  if (!player) return '未知';
  const pos = getPosition(players, player.id);
  return `${pos}号${player.name}`;
}

// 通过 ID 获取玩家
function getPlayerById(players, playerId) {
  return players.find(p => p.id === playerId);
}

// 获取某角色的存活玩家
function getAlivePlayersByRole(players, roleId) {
  return players.filter(p => p.alive && p.role?.id === roleId);
}

// 随机从数组中选择一个元素
function randomPick(array) {
  if (!array || array.length === 0) return null;
  return array[Math.floor(Math.random() * array.length)];
}

// 随机从数组中选择多个不重复元素
function randomPickMultiple(array, count) {
  if (!array || array.length === 0) return [];
  const shuffled = [...array].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, array.length));
}

// ========== 发言顺序计算 ==========

// 计算发言顺序（主入口）
function getSpeakerOrder(players, options = {}) {
  const { sheriff, sheriffAssignOrder, lastDeathPlayer, canSpeak } = options;
  const canSpeakFn = canSpeak || ((p) => p.alive);

  // 如果有警长且警长指定了起始位置
  if (sheriff && sheriffAssignOrder) {
    const sheriffPlayer = players.find(p => p.id === sheriff);
    if (sheriffPlayer && canSpeakFn(sheriffPlayer)) {
      return calculateSpeakerOrderWithSheriff(players, sheriffAssignOrder, sheriff, canSpeakFn);
    }
  }

  // 无警长：自动计算
  return calculateDefaultSpeakerOrder(players, lastDeathPlayer, canSpeakFn);
}

// 有警长时的发言顺序：从起始位置开始顺时针，警长跳过，最后发言
function calculateSpeakerOrderWithSheriff(players, startPlayerId, sheriff, canSpeak) {
  const startIndex = players.findIndex(p => p.id === startPlayerId);
  if (startIndex === -1) return calculateDefaultSpeakerOrder(players, null, canSpeak);

  const sheriffPlayer = players.find(p => p.id === sheriff);
  const totalPlayers = players.length;
  const order = [];

  // 从起始位置开始顺时针，跳过警长
  for (let i = 0; i < totalPlayers; i++) {
    const index = (startIndex + i) % totalPlayers;
    const player = players[index];
    if (canSpeak(player) && player.id !== sheriff) {
      order.push(player);
    }
  }

  // 警长最后发言
  if (sheriffPlayer && canSpeak(sheriffPlayer)) {
    order.push(sheriffPlayer);
  }

  return order;
}

// 从指定位置开始顺时针计算发言顺序
function calculateSpeakerOrderFrom(players, startPlayerId, canSpeak) {
  const startIndex = players.findIndex(p => p.id === startPlayerId);
  if (startIndex === -1) return calculateDefaultSpeakerOrder(players, null, canSpeak);

  const totalPlayers = players.length;
  const order = [];
  for (let i = 0; i < totalPlayers; i++) {
    const index = (startIndex + i) % totalPlayers;
    const player = players[index];
    if (canSpeak(player)) {
      order.push(player);
    }
  }
  return order;
}

// 计算默认发言顺序（无警长）
function calculateDefaultSpeakerOrder(players, lastDeathPlayer, canSpeak) {
  const canSpeakFn = canSpeak || ((p) => p.alive);
  const alivePlayers = players.filter(p => canSpeakFn(p));
  if (alivePlayers.length === 0) return [];

  // 无警长：从昨夜第一个死亡的人的下一位开始
  if (lastDeathPlayer) {
    const lastDeathIndex = players.findIndex(p => p.id === lastDeathPlayer);
    if (lastDeathIndex !== -1) {
      const totalPlayers = players.length;
      const order = [];
      // 从死者下一位开始顺时针
      for (let i = 1; i <= totalPlayers; i++) {
        const index = (lastDeathIndex + i) % totalPlayers;
        const player = players[index];
        if (canSpeakFn(player)) {
          order.push(player);
        }
      }
      return order;
    }
  }

  // 无警长且平安夜：从1号座位开始顺时针（players数组顺序就是座位顺序）
  return alivePlayers;
}

module.exports = {
  // 数组工具
  shuffle,
  randomPick,
  randomPickMultiple,

  // 玩家查找
  getPlayerById,
  getPlayerByPosition,
  getAlivePlayersByRole,

  // 玩家显示
  getPosition,
  getPlayerDisplay,

  // 发言顺序
  getSpeakerOrder,
  calculateSpeakerOrderWithSheriff,
  calculateSpeakerOrderFrom,
  calculateDefaultSpeakerOrder
};