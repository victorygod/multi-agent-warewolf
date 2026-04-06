/**
 * 消息管理 - 存储和可见性控制
 */

class MessageManager {
  constructor() {
    this.messages = [];
  }

  // 添加消息
  add({ type, content, playerId, visibility = 'public', metadata = {} }) {
    const msg = {
      id: this.messages.length + 1,
      type,        // speech/vote/action/system/death
      content,
      playerId,    // 发送者
      visibility,  // public/self/camp/couple
      metadata,    // 额外信息（如投票目标、技能类型等）
      timestamp: Date.now()
    };
    this.messages.push(msg);
    return msg;
  }

  // 获取对某玩家可见的消息
  getVisibleTo(player, game) {
    return this.messages.filter(msg => this.canSee(player, msg, game));
  }

  // 判断玩家是否可见某消息
  canSee(player, msg, game) {
    if (msg.visibility === 'public') return true;
    if (msg.visibility === 'self') return msg.playerId === player.id;
    if (msg.visibility === 'camp') {
      const sender = game.players.find(p => p.id === msg.playerId);
      return this.getCamp(player, game) === this.getCamp(sender, game);
    }
    if (msg.visibility === 'couple') {
      return game.couples?.includes(player.id);
    }
    return false;
  }

  // 获取玩家阵营
  getCamp(player, game) {
    if (game.config.hooks?.getCamp) {
      return game.config.hooks.getCamp(player, game);
    }
    return player.role.camp;
  }

  // 获取所有消息
  getAll() {
    return [...this.messages];
  }
}

module.exports = { MessageManager };