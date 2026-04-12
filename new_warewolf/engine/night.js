/**
 * 夜晚结算管理器
 */

class NightManager {
  constructor(game) {
    this.game = game;
  }

  // 夜晚结算
  resolve() {
    const deaths = [];
    const deathReasons = new Map(); // 保存死亡原因

    // 狼刀
    if (this.game.werewolfTarget) {
      const target = this.game.players.find(p => p.id === this.game.werewolfTarget);
      const guarded = this.game.guardTarget === this.game.werewolfTarget;
      const healed = this.game.healTarget === this.game.werewolfTarget;

      // 同守同救 = 死亡
      if (guarded && healed) {
        deaths.push(target);
        deathReasons.set(target.id, 'conflict');
      } else if (!guarded && !healed) {
        deaths.push(target);
        deathReasons.set(target.id, 'wolf');
      }
    }

    // 毒杀
    if (this.game.poisonTarget) {
      const target = this.game.players.find(p => p.id === this.game.poisonTarget);
      if (!deaths.includes(target)) {
        deaths.push(target);
        deathReasons.set(target.id, 'poison');
      }
    }

    // 保存死亡原因供 process() 使用
    this.game._deathReasons = deathReasons;

    // 重置夜晚状态
    this.game.werewolfTarget = null;
    this.game.guardTarget = null;
    this.game.healTarget = null;
    this.game.poisonTarget = null;

    // 保留现有的 deathQueue 条目（如猎人开枪），添加到队列末尾
    const existingQueue = this.game.deathQueue || [];
    this.game.deathQueue = [...deaths, ...existingQueue];
    return deaths;
  }

  // 处理死亡
  process() {
    // 保存死亡信息用于公布死讯
    this.game._lastNightDeaths = this.game.deathQueue.map(p => ({
      id: p.id,
      name: p.name,
      reason: this.getDeathReason(p)
    }));

    while (this.game.deathQueue.length > 0) {
      const player = this.game.deathQueue.shift();
      if (!player.alive) continue;

      const reason = this.getDeathReason(player);

      // 使用统一的死亡处理（殉情已通过 couple 事件自动处理）
      this.game.handleDeath(player, reason);
    }
  }

  // 获取死亡原因
  getDeathReason(player) {
    // 优先使用 resolve() 中保存的死亡原因
    if (this.game._deathReasons?.has(player.id)) {
      return this.game._deathReasons.get(player.id);
    }
    // 后备逻辑（兼容旧代码）
    if (this.game.poisonTarget === player.id) return 'poison';
    if (this.game.werewolfTarget === player.id) return 'wolf';
    if (this.game.healTarget === player.id && this.game.guardTarget === player.id) return 'conflict';
    // 检查玩家是否已有死亡原因（如猎人射杀）
    if (player.deathReason) return player.deathReason;
    return 'vote';
  }
}

module.exports = { NightManager };