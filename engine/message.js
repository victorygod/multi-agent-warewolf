/**
 * 消息管理 - 存储和可见性控制
 */

const { EventEmitter } = require('./event');
const { MSG, VISIBILITY } = require('./constants');

// 可见性规则
const VisibilityRules = {
  // 公开消息：所有人都可见
  [VISIBILITY.PUBLIC]: (player, msg, game) => true,

  // 私人消息：只有发送者可见
  [VISIBILITY.SELF]: (player, msg, game) => msg.playerId === player.id,

  // 阵营消息：同阵营可见
  [VISIBILITY.CAMP]: (player, msg, game) => {
    const sender = game.players.find(p => p.id === msg.playerId);
    if (!sender) return false;
    return game.config.hooks?.getCamp(player, game) === game.config.hooks?.getCamp(sender, game);
  },

  // 情侣消息：只有情侣可见（可见情侣身份，角色身份不可见）
  [VISIBILITY.COUPLE]: (player, msg, game) => {
    return game.couples?.includes(player.id);
  },

  // 情侣可见对方情侣身份（仅可见情侣身份，角色身份不可见）
  // 用于情侣之间互相知道对方是情侣，但不知道对方角色
  [VISIBILITY.COUPLE_IDENTITY]: (player, msg, game) => {
    // 发送者是情侣，且接收者也是情侣
    if (!msg.playerId || !game.couples?.includes(msg.playerId)) return false;
    return game.couples?.includes(player.id);
  },

  // 丘比特可见所有情侣身份（仅可见情侣身份，角色身份不可见）
  [VISIBILITY.CUPID_IDENTITY]: (player, msg, game) => {
    // 发送者是丘比特
    const sender = game.players.find(p => p.id === msg.playerId);
    if (!sender || sender.role?.id !== 'cupid') return false;
    // 接收者是情侣
    return game.couples?.includes(player.id);
  }
};

class MessageManager extends EventEmitter {
  constructor() {
    super();
    this.messages = [];
    this._nextId = 1;
  }

  // 添加消息
  add({ type, content, playerId, playerName, visibility = VISIBILITY.PUBLIC, metadata = {}, voteDetails, voteCounts, phase, phaseName, deaths, round }) {
    // 死亡消息不暴露死亡原因（原因只在游戏结束时公布）
    const safeDeaths = deaths?.map(d => ({ id: d.id, name: d.name }));
    const msg = {
      id: this._nextId++,
      type,        // speech/vote/action/system/death/phase_start
      content,
      playerId,    // 发送者
      playerName,  // 玩家名称
      visibility,  // public/self/camp/couple
      metadata,    // 额外信息（如投票目标、技能类型等）
      voteDetails, // 投票详情（用于显示票型）
      voteCounts,  // 投票计数（用于显示各候选人票数）
      phase,       // 阶段ID（用于 phase_start 消息）
      phaseName,   // 阶段名称
      round,       // 当前轮次（由 engine 写入，第N夜/第N天共用）
      deaths: safeDeaths,  // 死亡玩家数组（不含死亡原因）
      timestamp: Date.now()
    };
    this.messages.push(msg);

    // 通知新消息添加（用于实时同步）
    this.emit('message:added', msg);

    return msg;
  }

  // 获取对某玩家可见的消息
  getVisibleTo(player, game) {
    return this.messages.filter(msg => this.canSee(player, msg, game));
  }

  // 判断玩家是否可见某消息
  canSee(player, msg, game) {
    const rule = VisibilityRules[msg.visibility];
    if (!rule) return false;
    return rule(player, msg, game);
  }
}

module.exports = { MessageManager };