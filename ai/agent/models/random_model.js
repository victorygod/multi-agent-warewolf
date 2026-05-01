/**
 * random_model.js - 随机决策模型
 * 从 ai/agents/random.js 迁移
 */

const { createLogger } = require('../../../utils/logger');
const { ACTION } = require('../../../engine/constants');

let backendLogger = null;
function getLogger() {
  if (!backendLogger) {
    backendLogger = global.backendLogger || createLogger('backend.log');
  }
  return backendLogger;
}

const ANALYSIS_TEMPLATES = [
  '局势不明，需要继续观察。',
  '有人跳身份了，需要验证真假。',
  '票型显示有对立阵营，需要站队。',
  '这个发言有矛盾，可能在撒谎。',
  '暂时相信这个玩家，后续再验证。',
  '信息不足，无法判断。',
  '有玩家行为不符合身份声称。'
];

class RandomModel {
  constructor(playerId) {
    this.playerId = playerId;
  }

  isAvailable() {
    return true;
  }

  call(context) {
    // 无 tool 时返回分析文本
    if (!context._tools || context._tools.length === 0) {
      return ANALYSIS_TEMPLATES[Math.floor(Math.random() * ANALYSIS_TEMPLATES.length)];
    }

    this.logContext(context);
    const decision = this._decideInternal(context);

    // 对齐 LLMModel 输出格式
    return this._wrapResponse(decision, context);
  }

  _wrapResponse(decision, context) {
    const tool = context._tools?.[0];

    // 弃权：通过 tool 传入 null
    if (!decision || decision.type === 'skip') {
      if (tool) {
        return {
          raw: {
            tool_calls: [{
              id: `call_random_${Date.now()}`,
              function: {
                name: tool.function.name,
                arguments: 'null'
              }
            }]
          },
          messages: context._messagesForLLM || []
        };
      }
      return { raw: { content: '' }, messages: context._messagesForLLM || [] };
    }

    if (tool) {
      return {
        raw: {
          tool_calls: [{
            id: `call_random_${Date.now()}`,
            function: {
              name: tool.function.name,
              arguments: JSON.stringify(decision)
            }
          }]
        },
        messages: context._messagesForLLM || []
      };
    }

    return { raw: { content: decision.content || '' }, messages: context._messagesForLLM || [] };
  }

  _decideInternal(context) {
    const { action, alivePlayers, extraData, self } = context;

    if (!alivePlayers) {
      getLogger().error(`[RandomModel] alivePlayers 不存在：playerId=${this.playerId}, action=${action}`);
      return { type: 'skip' };
    }

    switch (action) {
      case ACTION.DAY_DISCUSS:
      case ACTION.SHERIFF_SPEECH:
      case ACTION.LAST_WORDS:
        return this.speechAction();

      case ACTION.DAY_VOTE:
      case ACTION.SHERIFF_VOTE:
        return this.voteAction(alivePlayers, extraData?.allowedTargets);

      case ACTION.NIGHT_WEREWOLF_DISCUSS:
        return this.wolfSpeechAction();

      case ACTION.NIGHT_WEREWOLF_VOTE:
        return this.wolfVoteAction(alivePlayers, extraData?.allowedTargets);

      case ACTION.SEER:
        return this.seerAction(alivePlayers, self?.seerChecks);

      case ACTION.WITCH:
        return this.witchAction(context);

      case ACTION.GUARD:
        return this.guardAction(alivePlayers, self?.lastGuardTarget);

      case ACTION.CUPID:
        return this.cupidAction(alivePlayers);

      case ACTION.SHOOT:
        return this.hunterAction(alivePlayers);

      case ACTION.SHERIFF_CAMPAIGN:
        return this.campaignAction();

      case ACTION.WITHDRAW:
        return this.withdrawAction();

      case ACTION.ASSIGN_ORDER:
        return this.assignOrderAction(alivePlayers);

      case ACTION.PASS_BADGE:
        return this.passBadgeAction(alivePlayers);

      default:
        return { skip: true };
    }
  }

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
    return { content: speeches[Math.floor(Math.random() * speeches.length)] };
  }

  wolfSpeechAction() {
    const speeches = ['刀谁？', '我觉得应该刀预言家。', '先观察一下。', '同意。'];
    return { content: speeches[Math.floor(Math.random() * speeches.length)] };
  }

  voteAction(alivePlayers, allowedTargets) {
    if (Math.random() < 0.2) return { skip: true };

    let candidates = alivePlayers.filter(p => p.id !== this.playerId);
    if (allowedTargets && allowedTargets.length > 0) {
      candidates = candidates.filter(p => allowedTargets.includes(p.id));
    }
    if (candidates.length === 0) return { skip: true };

    const target = candidates[Math.floor(Math.random() * candidates.length)];
    return { target: String(target.id) };
  }

  wolfVoteAction(alivePlayers, allowedTargets) {
    let candidates;
    if (allowedTargets && allowedTargets.length > 0) {
      candidates = alivePlayers.filter(p => allowedTargets.includes(p.id));
    } else {
      candidates = alivePlayers.filter(p => p.alive);
    }
    if (candidates.length === 0) return { skip: true };

    const target = candidates[Math.floor(Math.random() * candidates.length)];
    return { target: String(target.id) };
  }

  seerAction(alivePlayers, seerChecks) {
    let candidates = alivePlayers.filter(p => p.id !== this.playerId);
    if (seerChecks && seerChecks.length > 0) {
      const checkedIds = seerChecks.map(c => c.targetId);
      candidates = candidates.filter(p => !checkedIds.includes(p.id));
    }
    if (candidates.length === 0) return { skip: true };

    const target = candidates[Math.floor(Math.random() * candidates.length)];
    return { target: String(target.id) };
  }

  witchAction(context) {
    const { werewolfTarget, self } = context;
    const canHeal = self?.witchHeal > 0;
    const canPoison = self?.witchPoison > 0;

    if (canHeal && werewolfTarget && werewolfTarget !== this.playerId) {
      if (Math.random() < 0.7) return { action: 'heal' };
    }

    if (canPoison && Math.random() < 0.3) {
      const others = context.alivePlayers.filter(p => p.id !== this.playerId);
      if (others.length > 0) {
        const target = others[Math.floor(Math.random() * others.length)];
        return { action: 'poison', target: String(target.id) };
      }
    }

    return { action: 'skip' };
  }

  guardAction(alivePlayers, lastGuardTarget) {
    let candidates = alivePlayers.filter(p => p.id !== lastGuardTarget);
    if (candidates.length === 0) return { skip: true };

    const target = candidates[Math.floor(Math.random() * candidates.length)];
    return { target: String(target.id) };
  }

  cupidAction(alivePlayers) {
    const others = alivePlayers.filter(p => p.id !== this.playerId);
    if (others.length < 2) return { skip: true };

    const shuffled = [...others].sort(() => Math.random() - 0.5);
    return { targets: [shuffled[0].id, shuffled[1].id] };
  }

  hunterAction(alivePlayers) {
    const others = alivePlayers.filter(p => p.id !== this.playerId);
    if (others.length === 0) return { skip: true };

    if (Math.random() < 0.7) {
      const target = others[Math.floor(Math.random() * others.length)];
      return { target: String(target.id) };
    }
    return { skip: true };
  }

  campaignAction() {
    return { run: Math.random() < 0.5 };
  }

  withdrawAction() {
    return { withdraw: Math.random() < 0.3 };
  }

  passBadgeAction(alivePlayers) {
    const others = alivePlayers.filter(p => p.id !== this.playerId);
    if (others.length === 0) return { skip: true };

    const target = others[Math.floor(Math.random() * others.length)];
    return { target: String(target.id) };
  }

  assignOrderAction(alivePlayers) {
    const others = alivePlayers.filter(p => p.id !== this.playerId);
    if (others.length === 0) return { skip: true };

    const target = others[Math.floor(Math.random() * others.length)];
    return { target: String(target.id) };
  }

  logContext(context) {
    getLogger().info(`[RandomModel] playerId=${this.playerId} 决策上下文 (${context.action})`);

    // DEBUG 模式下打印 LLM 消息
    if (global.DEBUG_MODE && context._messagesForLLM?.length > 0) {
      getLogger().debug(`[RandomModel] playerId=${this.playerId} LLM消息: ${JSON.stringify(context._messagesForLLM, null, 2)}`);
    }
  }
}

module.exports = { RandomModel, ANALYSIS_TEMPLATES };