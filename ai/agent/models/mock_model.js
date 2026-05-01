/**
 * mock_model.js - 预设行为模型（用于测试）
 * 从 ai/agents/mock.js 迁移，保持接口兼容
 */

const { ACTION } = require('../../../engine/constants');

class MockModel {
  constructor(playerId, options = {}) {
    this.playerId = playerId;
    this.options = options;

    this.behaviorSequence = [];
    this.sequenceIndex = 0;
    this.presetResponses = options.presetResponses || {};
    this.presetAnalysis = options.presetAnalysis || {};
    this.customStrategies = options.customStrategies || {};

    // 记录每次调用收到的上下文，用于测试校验
    this.callHistory = [];
  }

  isAvailable() {
    return true;
  }

  async call(context) {
    const record = {
      phase: context.phase,
      action: context.action,
      messagesForLLM: context._messagesForLLM ? JSON.parse(JSON.stringify(context._messagesForLLM)) : null,
      timestamp: Date.now()
    };
    this.callHistory.push(record);

    const { phase, action, extraData } = context;

    // 1. 自定义策略
    const customStrategy = this.customStrategies[phase] || this.customStrategies[action];
    if (customStrategy) {
      const result = customStrategy.call(this, context);
      if (result !== undefined) return this._wrapResponse(result, context);
    }

    // 2. 预设响应
    const presetResponse = action in this.presetResponses
      ? this.presetResponses[action]
      : (phase in this.presetResponses ? this.presetResponses[phase] : undefined);
    if (presetResponse !== undefined) {
      const normalized = this.normalizeResponse(action, presetResponse);
      return this._wrapResponse(normalized, context);
    }

    // 3. 行为序列
    const sequenceResponse = this.getSequenceResponse(phase, action);
    if (sequenceResponse !== undefined) {
      const normalized = this.normalizeResponse(action, sequenceResponse);
      return this._wrapResponse(normalized, context);
    }

    // 没有预设行为，无 tool 时返回空内容，有 tool 时抛出错误
    if (!context._tools || context._tools.length === 0) {
      return { raw: { content: this.presetAnalysis.content || '' }, messages: context._messagesForLLM || [] };
    }
    throw new Error(`MockModel ${this.playerId} 没有预设行为：action=${action}`);
  }

  _wrapResponse(decision, context) {
    const tool = context._tools?.[0];

    // 弃权：通过 tool 传入 null
    if (!decision) {
      if (tool) {
        return {
          raw: {
            tool_calls: [{
              id: `call_mock_${Date.now()}`,
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
            id: `call_mock_${Date.now()}`,
            function: {
              name: tool.function.name,
              arguments: JSON.stringify(decision)
            }
          }]
        },
        messages: context._messagesForLLM || []
      };
    }

    // decision 可能是字符串或对象
    const content = typeof decision === 'string' ? decision : (decision.content || '');
    return { raw: { content }, messages: context._messagesForLLM || [] };
  }

  // ========== 预设管理 ==========

  setResponse(actionType, response) {
    this.presetResponses[actionType] = response;
  }

  setResponses(responses) {
    Object.assign(this.presetResponses, responses);
  }

  setBehaviorSequence(sequence) {
    this.behaviorSequence = sequence || [];
    this.sequenceIndex = 0;
  }

  addBehavior(phase, response) {
    this.behaviorSequence.push({ phase, response });
  }

  setStrategy(phase, strategyFn) {
    this.customStrategies[phase] = strategyFn;
  }

  getSequenceResponse(phase, action) {
    for (let i = this.sequenceIndex; i < this.behaviorSequence.length; i++) {
      const behavior = this.behaviorSequence[i];
      if (behavior.phase === phase || behavior.phase === action) {
        if (!behavior.wildcard) this.sequenceIndex = i + 1;
        return behavior.response;
      }
    }

    for (let i = this.sequenceIndex; i < this.behaviorSequence.length; i++) {
      const behavior = this.behaviorSequence[i];
      if (behavior.actions) {
        if (behavior.actions[action] !== undefined) {
          this.sequenceIndex = i + 1;
          return behavior.actions[action];
        }
        if (behavior.actions[phase] !== undefined) {
          this.sequenceIndex = i + 1;
          return behavior.actions[phase];
        }
      }
    }

    return undefined;
  }

  normalizeResponse(actionType, response) {
    // 统一返回对象格式
    // 弃权
    if (response === null || response === undefined) return null;
    // 数字 = 单目标（vote, seer, guard, shoot, etc.）
    if (typeof response === 'number') return { target: String(response) };
    // 字符串 = 发言内容
    if (typeof response === 'string') return { content: response };
    // 布尔值 = campaign/withdraw
    if (typeof response === 'boolean') {
      if (actionType === ACTION.WITHDRAW) return { withdraw: response };
      return { run: response };
    }
    // 对象：已经是新格式（target, targets, content, action 等）
    if (typeof response === 'object') {
      // 兼容旧格式 { type: 'vote', target: N } → 转为 { target: N }
      if (response.type && response.target) return { target: String(response.target) };
      if (response.type && response.targetIds) return { targets: response.targetIds };
      if (response.type && response.content) return { content: response.content };
      // 新格式直接返回
      return response;
    }
    return { content: String(response) };
  }

  // ========== 快捷方法 ==========

  setVoteTarget(targetId) {
    this.setResponse(ACTION.POST_VOTE, { targetId });
    this.setResponse(ACTION.DAY_VOTE, { targetId });
    this.setResponse(ACTION.NIGHT_WEREWOLF_VOTE, { targetId });
    this.setResponse(ACTION.SHERIFF_VOTE, { targetId });
  }

  setSpeech(content) {
    this.setResponse(ACTION.LAST_WORDS, { content });
    this.setResponse(ACTION.SHERIFF_SPEECH, { content });
  }

  setCampaign(shouldRun) {
    this.setResponse(ACTION.SHERIFF_CAMPAIGN, { run: shouldRun });
  }

  setWithdraw(shouldWithdraw) {
    this.setResponse(ACTION.WITHDRAW, { withdraw: shouldWithdraw });
  }

  setSkillTarget(actionType, targetId) {
    this.setResponse(actionType, { targetId });
  }

  setWitchAction(action, targetId = null) {
    if (action === 'skip' || action === 'pass') {
      this.setResponse(ACTION.WITCH, { action: 'skip' });
    } else if (action === 'heal') {
      this.setResponse(ACTION.WITCH, { action: 'heal' });
    } else if (action === 'poison') {
      this.setResponse(ACTION.WITCH, { action: 'poison', targetId });
    }
  }

  setCupidLinks(targetId1, targetId2) {
    this.setResponse(ACTION.CUPID, { targetIds: [targetId1, targetId2] });
  }

  setHunterShoot(targetId) {
    this.setResponse(ACTION.SHOOT, { targetId });
  }

  setPassBadge(targetId) {
    this.setResponse(ACTION.PASS_BADGE, { targetId });
  }

  setGuardTarget(targetId) {
    this.setResponse(ACTION.GUARD, { targetId });
  }

  setSeerCheck(targetId) {
    this.setResponse(ACTION.SEER, { targetId });
  }

  setAnalysis(content) {
    this.presetAnalysis.content = content;
  }

  resetSequence() {
    this.sequenceIndex = 0;
  }

  clear() {
    this.behaviorSequence = [];
    this.presetResponses = {};
    this.customStrategies = {};
    this.sequenceIndex = 0;
    this.callHistory = [];
  }

  // 获取调用历史
  getCallHistory() {
    return this.callHistory;
  }

  // 获取最后一次调用的上下文
  getLastCall() {
    return this.callHistory[this.callHistory.length - 1] || null;
  }

  // 获取特定阶段的调用记录
  getCallsByPhase(phase) {
    return this.callHistory.filter(r => r.phase === phase);
  }

  // 清空调用历史
  clearCallHistory() {
    this.callHistory = [];
  }
}

module.exports = { MockModel };