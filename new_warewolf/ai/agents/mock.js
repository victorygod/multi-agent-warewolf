/**
 * MockAgent - 可定制策略的模拟 AI Agent
 * 用于测试，必须预设行为，没有兜底
 */

class MockAgent {
  constructor(playerId, game, options = {}) {
    this.playerId = playerId;
    this.game = game;
    this.options = options;

    // 预设行为序列 - 按顺序执行
    // 格式: [{ phase: 'vote', response: { targetId: 5 } }, ...]
    this.behaviorSequence = [];

    // 当前序列索引
    this.sequenceIndex = 0;

    // 预设响应映射（精确匹配）
    this.presetResponses = {};

    // 自定义策略函数
    this.customStrategies = {};
  }

  /**
   * 设置预设行为序列
   * @param {Array} sequence - 行为序列，每个元素可以是:
   *   - { phase: 'vote', response: { targetId: 5 } }
   *   - { phase: 'speak', response: { content: '我是预言家' } }
   *   - { actions: { vote: { targetId: 5 }, speak: { content: '过' } } } // 通配符
   */
  setBehaviorSequence(sequence) {
    this.behaviorSequence = sequence || [];
    this.sequenceIndex = 0;
  }

  /**
   * 添加到行为序列
   */
  addBehavior(phase, response) {
    this.behaviorSequence.push({ phase, response });
  }

  /**
   * 设置预设响应（精确匹配）
   * @param {string} actionType - 动作类型
   * @param {*} response - 响应内容
   */
  setResponse(actionType, response) {
    this.presetResponses[actionType] = response;
  }

  /**
   * 批量设置响应
   */
  setResponses(responses) {
    Object.assign(this.presetResponses, responses);
  }

  /**
   * 设置自定义策略函数
   * @param {string} phase - 阶段名称
   * @param {Function} strategyFn - 策略函数
   */
  setStrategy(phase, strategyFn) {
    this.customStrategies[phase] = strategyFn;
  }

  /**
   * 决策入口
   * 优先级: 自定义策略 > 预设响应 > 序列匹配
   * 注意: 没有兜底，必须预设行为
   */
  async decide(context) {
    const { phase, action, extraData } = context;

    // 1. 检查自定义策略
    const customStrategy = this.customStrategies[phase] || this.customStrategies[action];
    if (customStrategy) {
      const result = customStrategy.call(this, context);
      if (result !== undefined) return result;
    }

    // 2. 检查预设响应（使用 in 操作符检查key是否存在）
    const presetResponse = action in this.presetResponses
      ? this.presetResponses[action]
      : (phase in this.presetResponses ? this.presetResponses[phase] : undefined);
    if (presetResponse !== undefined) {
      return this.normalizeResponse(action, presetResponse);
    }

    // 3. 检查行为序列（按顺序匹配）
    const sequenceResponse = this.getSequenceResponse(phase, action);
    if (sequenceResponse !== undefined) {
      return this.normalizeResponse(action, sequenceResponse);
    }

    // 没有预设行为，抛出错误
    throw new Error(`MockAgent ${this.playerId} 没有预设行为: phase=${phase}, action=${action}`);
  }

  /**
   * 从行为序列获取响应
   */
  getSequenceResponse(phase, action) {
    // 优先精确匹配
    for (let i = this.sequenceIndex; i < this.behaviorSequence.length; i++) {
      const behavior = this.behaviorSequence[i];
      if (behavior.phase === phase || behavior.phase === action) {
        // 如果不是通配符，移动索引
        if (!behavior.wildcard) {
          this.sequenceIndex = i + 1;
        }
        return behavior.response;
      }
    }

    // 检查通配符
    for (let i = this.sequenceIndex; i < this.behaviorSequence.length; i++) {
      const behavior = this.behaviorSequence[i];
      if (behavior.actions) {
        // 通配符：匹配任何 actions 中的键
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

  /**
   * 标准化响应格式
   */
  normalizeResponse(actionType, response) {
    if (response === null || response === undefined) {
      return { type: 'skip' };
    }

    // 如果已经是正确格式，直接返回
    if (typeof response === 'object' && response.type) {
      return response;
    }

    // 数字 -> 投票/目标
    if (typeof response === 'number') {
      return { type: 'vote', target: String(response) };
    }

    // 字符串 -> 发言内容
    if (typeof response === 'string') {
      return { type: 'speech', content: response };
    }

    // 对象但没有type -> 根据 actionType 添加 type
    if (typeof response === 'object') {
      // 如果有 targetId，转换为 target 并添加 type
      if (response.targetId !== undefined) {
        return { type: 'vote', target: String(response.targetId) };
      }
      // 如果有 content，添加 type
      if (response.content !== undefined) {
        return { type: 'speech', content: response.content };
      }
      // 如果有 action (witch 等)
      if (response.action !== undefined) {
        return response;
      }
      // 其他情况直接返回
      return response;
    }

    return response;
  }

  // ========== 便捷方法 ==========

  /**
   * 设置投票目标
   */
  setVoteTarget(targetId) {
    this.setResponse('vote', { targetId });
    this.setResponse('wolf_vote', { targetId });
    this.setResponse('sheriff_vote', { targetId });
  }

  /**
   * 设置发言内容
   */
  setSpeech(content) {
    this.setResponse('speak', { content });
    this.setResponse('last_words', { content });
    this.setResponse('sheriff_speech', { content });
  }

  /**
   * 设置竞选
   */
  setCampaign(shouldRun) {
    this.setResponse('campaign', { run: shouldRun });
  }

  /**
   * 设置退水
   */
  setWithdraw(shouldWithdraw) {
    this.setResponse('withdraw', { withdraw: shouldWithdraw });
  }

  /**
   * 设置技能目标
   */
  setSkillTarget(actionType, targetId) {
    this.setResponse(actionType, { targetId });
  }

  /**
   * 设置女巫行动
   */
  setWitchAction(action, targetId = null) {
    if (action === 'skip' || action === 'pass') {
      this.setResponse('witch', { action: 'skip' });
    } else if (action === 'heal') {
      this.setResponse('witch', { action: 'heal' });
    } else if (action === 'poison') {
      this.setResponse('witch', { action: 'poison', targetId });
    }
  }

  /**
   * 设置丘比特连接
   */
  setCupidLinks(targetId1, targetId2) {
    this.setResponse('cupid', { targetIds: [targetId1, targetId2] });
  }

  /**
   * 设置猎人射击
   */
  setHunterShoot(targetId) {
    this.setResponse('shoot', { targetId });
  }

  /**
   * 设置警长传递
   */
  setPassBadge(targetId) {
    this.setResponse('pass_badge', { targetId });
  }

  /**
   * 设置守卫守护
   */
  setGuardTarget(targetId) {
    this.setResponse('guard', { targetId });
  }

  /**
   * 设置预言家查验
   */
  setSeerCheck(targetId) {
    this.setResponse('seer', { targetId });
  }

  /**
   * 重置序列索引
   */
  resetSequence() {
    this.sequenceIndex = 0;
  }

  /**
   * 清空所有预设
   */
  clear() {
    this.behaviorSequence = [];
    this.presetResponses = {};
    this.customStrategies = {};
    this.sequenceIndex = 0;
  }
}

/**
 * 创建带有预设行为的 MockAgent 工厂函数
 * @param {Object} behaviors - 预设行为
 * @returns {Function} 创建 MockAgent 的函数
 */
function createMockAgentFactory(behaviors) {
  return function(playerId, game) {
    const agent = new MockAgent(playerId, game);

    // 设置行为序列
    if (Array.isArray(behaviors)) {
      agent.setBehaviorSequence(behaviors);
    } else if (behaviors) {
      // 转换为序列格式
      const sequence = [];
      for (const [action, response] of Object.entries(behaviors)) {
        sequence.push({ phase: action, response });
      }
      agent.setBehaviorSequence(sequence);
    }

    return agent;
  };
}

/**
 * 创建投票策略
 */
function createVotingStrategy(targetId) {
  return function(context) {
    const { extraData } = context;
    // 检查是否在允许范围内
    if (extraData?.allowedTargets) {
      if (extraData.allowedTargets.includes(targetId)) {
        return { type: 'vote', target: String(targetId) };
      }
      // 随机选择允许的目标
      const allowed = extraData.allowedTargets;
      const randomTarget = allowed[Math.floor(Math.random() * allowed.length)];
      return { type: 'vote', target: String(randomTarget) };
    }
    return { type: 'vote', target: String(targetId) };
  };
}

/**
 * 创建发言策略
 */
function createSpeechStrategy(content) {
  return function(context) {
    return { type: 'speech', content };
  };
}

/**
 * 创建技能策略
 */
function createSkillStrategy(actionType, targetId) {
  return function(context) {
    return { type: 'target', target: String(targetId) };
  };
}

module.exports = {
  MockAgent,
  createMockAgentFactory,
  createVotingStrategy,
  createSpeechStrategy,
  createSkillStrategy
};