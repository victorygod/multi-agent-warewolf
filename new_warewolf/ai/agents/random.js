/**
 * RandomAgent - 随机决策 Agent
 * 用于测试或作为 LLMAgent 的降级方案
 */

class RandomAgent {
  constructor(playerId, game) {
    this.playerId = playerId;
    this.game = game;
  }

  /**
   * 根据上下文做出决策
   * @param {Object} context - 决策上下文
   * @returns {Object} action - 决策结果
   */
  async decide(context) {
    const { phase, alivePlayers, extraData, self } = context;

    switch (phase) {
      case 'day_discuss':
      case 'sheriff_speech':
      case 'last_words':
        return this.speechAction();

      case 'day_vote':
      case 'sheriff_vote':
        return this.voteAction(alivePlayers, extraData?.allowedTargets);

      case 'night_werewolf_discuss':
        return this.wolfSpeechAction();

      case 'night_werewolf_vote':
        return this.wolfVoteAction(alivePlayers, extraData?.allowedTargets);

      case 'seer':
        return this.seerAction(alivePlayers, self?.seerChecks);

      case 'witch':
        return this.witchAction(context);

      case 'guard':
        return this.guardAction(alivePlayers, self?.lastGuardTarget);

      case 'cupid':
        return this.cupidAction(alivePlayers);

      case 'hunter_day':
      case 'shoot':
        return this.hunterAction(alivePlayers);

      case 'sheriff_campaign':
      case 'campaign':
        return this.campaignAction();

      case 'sheriff_withdraw':
      case 'withdraw':
        return this.withdrawAction();

      case 'assignOrder':
        return this.assignOrderAction(alivePlayers);

      case 'pass_badge':
        return this.passBadgeAction(alivePlayers);

      default:
        return { type: 'skip' };
    }
  }

  // 发言
  speechAction() {
    const speeches = [
      '我是好人，请大家相信我。',
      '我怀疑有人是狼人。',
      '我昨晚查验了某人。',
      '请大家投我一票。',
      '我觉得某人很可疑。',
      '我是神职，有信息。',
      '过。'
    ];
    return { type: 'speech', content: speeches[Math.floor(Math.random() * speeches.length)] };
  }

  // 狼人夜间发言
  wolfSpeechAction() {
    const speeches = [
      '刀谁？',
      '我觉得应该刀预言家。',
      '先观察一下。',
      '同意。'
    ];
    return { type: 'speech', content: speeches[Math.floor(Math.random() * speeches.length)] };
  }

  // 投票
  voteAction(alivePlayers, allowedTargets) {
    // 20% 概率弃权
    if (Math.random() < 0.2) {
      return { type: 'skip' };
    }

    let candidates = alivePlayers.filter(p => p.id !== this.playerId);

    // 限制在允许范围内（PK投票）
    if (allowedTargets && allowedTargets.length > 0) {
      candidates = candidates.filter(p => allowedTargets.includes(p.id));
    }

    if (candidates.length === 0) {
      return { type: 'skip' };
    }

    const target = candidates[Math.floor(Math.random() * candidates.length)];
    return { type: 'vote', target: String(target.id) };
  }

  // 狼人投票（允许刀任何人，包括自己和其他狼人）
  wolfVoteAction(alivePlayers, allowedTargets) {
    // 如果有 allowedTargets，优先使用它
    let candidates;
    if (allowedTargets && allowedTargets.length > 0) {
      candidates = alivePlayers.filter(p => allowedTargets.includes(p.id));
    } else {
      // 默认允许刀所有存活玩家（包括自己和其他狼人）
      candidates = alivePlayers.filter(p => p.alive);
    }

    if (candidates.length === 0) {
      return { type: 'skip' };
    }

    const target = candidates[Math.floor(Math.random() * candidates.length)];
    return { type: 'vote', target: String(target.id) };
  }

  // 预言家查验
  seerAction(alivePlayers, seerChecks) {
    let candidates = alivePlayers.filter(p => p.id !== this.playerId);

    // 排除已查验的玩家
    if (seerChecks && seerChecks.length > 0) {
      const checkedIds = seerChecks.map(c => c.targetId);
      candidates = candidates.filter(p => !checkedIds.includes(p.id));
    }

    if (candidates.length === 0) {
      return { type: 'skip' };
    }

    const target = candidates[Math.floor(Math.random() * candidates.length)];
    return { type: 'target', target: String(target.id) };
  }

  // 女巫行动
  witchAction(context) {
    const { werewolfTarget, self } = context;
    const canHeal = self?.witchHeal > 0;
    const canPoison = self?.witchPoison > 0;

    // 有人被杀且有解药，70% 概率救
    if (canHeal && werewolfTarget && werewolfTarget !== this.playerId) {
      if (Math.random() < 0.7) {
        return { type: 'heal' };
      }
    }

    // 有毒药，30% 概率毒人
    if (canPoison && Math.random() < 0.3) {
      const others = context.alivePlayers.filter(p => p.id !== this.playerId);
      if (others.length > 0) {
        const target = others[Math.floor(Math.random() * others.length)];
        return { type: 'poison', target: String(target.id) };
      }
    }

    return { type: 'skip' };
  }

  // 守卫守护
  guardAction(alivePlayers, lastGuardTarget) {
    let candidates = alivePlayers.filter(p => p.id !== lastGuardTarget);

    if (candidates.length === 0) {
      return { type: 'skip' };
    }

    const target = candidates[Math.floor(Math.random() * candidates.length)];
    return { type: 'target', target: String(target.id) };
  }

  // 丘比特连线
  cupidAction(alivePlayers) {
    const others = alivePlayers.filter(p => p.id !== this.playerId);
    if (others.length < 2) {
      return { type: 'skip' };
    }

    // 随机选两个
    const shuffled = [...others].sort(() => Math.random() - 0.5);
    return { type: 'cupid', targetIds: [shuffled[0].id, shuffled[1].id] };
  }

  // 猎人开枪
  hunterAction(alivePlayers) {
    const others = alivePlayers.filter(p => p.id !== this.playerId);
    if (others.length === 0) {
      return { type: 'skip' };
    }

    // 70% 概率开枪
    if (Math.random() < 0.7) {
      const target = others[Math.floor(Math.random() * others.length)];
      return { type: 'shoot', target: String(target.id) };
    }

    return { type: 'skip' };
  }

  // 竞选警长
  campaignAction() {
    // 50% 概率上警
    return { type: 'campaign', confirmed: Math.random() < 0.5 };
  }

  // 退水
  withdrawAction() {
    // 30% 概率退水
    return { type: 'withdraw', confirmed: Math.random() < 0.3 };
  }

  // 传警徽
  passBadgeAction(alivePlayers) {
    const others = alivePlayers.filter(p => p.id !== this.playerId);
    if (others.length === 0) {
      return { type: 'skip' };
    }

    const target = others[Math.floor(Math.random() * others.length)];
    return { type: 'pass_badge', target: String(target.id) };
  }

  // 警长指定发言顺序
  assignOrderAction(alivePlayers) {
    // 随机选择一个存活的玩家（不能是自己）
    const others = alivePlayers.filter(p => p.id !== this.playerId);
    if (others.length === 0) {
      return { type: 'skip' };
    }

    const target = others[Math.floor(Math.random() * others.length)];
    return { type: 'target', target: String(target.id) };
  }
}

module.exports = { RandomAgent };