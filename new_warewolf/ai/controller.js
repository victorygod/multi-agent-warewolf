/**
 * AI Controller - 与前端 Controller 接口对齐
 * 维护自己看到的消息历史、状态，直接操作 gameEngine
 */

const { AIAgent } = require('./agent');

class AIController {
  constructor(playerId, gameEngine) {
    this.playerId = playerId;
    this.game = gameEngine;
    this.agent = null;

    // 自己看到的消息历史
    this.messageHistory = [];

    // 自己的状态缓存
    this.cachedState = null;
  }

  // 初始化 Agent
  initAgent() {
    if (!this.agent) {
      this.agent = new AIAgent(this.playerId, this.game);
      this.agent.init(this.getContext());
    }
  }

  // 获取当前状态（接口对齐）
  getState() {
    const state = this.game.getState(this.playerId);
    this.cachedState = state;

    // 更新消息历史
    if (state?.messages) {
      const lastId = this.messageHistory.length > 0
        ? this.messageHistory[this.messageHistory.length - 1].id
        : 0;
      state.messages.forEach(msg => {
        if (msg.id > lastId) {
          this.messageHistory.push(msg);
        }
      });
    }

    return state;
  }

  // 获取上下文（给 Agent 用）
  getContext() {
    const state = this.getState();
    const player = this.game.players.find(p => p.id === this.playerId);
    // 优先使用 game.phase.currentPhase.id，这是更可靠的阶段来源
    const phase = this.game.phase?.currentPhase?.id || state?.phase;

    return {
      phase,
      alivePlayers: this.game.players.filter(p => p.alive),
      messageHistory: this.messageHistory,
      werewolfTarget: this.game.werewolfTarget,
      witchPotion: player?.state,
      dayCount: this.game.dayCount,
      game: this.game
    };
  }

  // 发言（接口对齐）
  async speak(content) {
    const player = this.game.players.find(p => p.id === this.playerId);
    console.log(`[AI] ${player?.name} 发言阶段`);

    if (content) {
      this.game.speak(this.playerId, content);
      console.log(`[AI] ${player?.name}: ${content}`);
      return { success: true };
    }

    // 让 AI 决策
    this.initAgent();
    const action = await this.agent.getAction(this.getContext());
    const speech = action?.type === 'speech' ? action.content : '过。';
    this.game.speak(this.playerId, speech);
    console.log(`[AI] ${player?.name}: ${speech}`);
    return { success: true, content: speech };
  }

  // 投票（接口对齐）
  async vote(targetId) {
    const player = this.game.players.find(p => p.id === this.playerId);

    if (targetId !== undefined && targetId !== null) {
      const target = this.game.players.find(p => p.id === targetId);
      const targetPos = this.game.players.findIndex(p => p.id === targetId) + 1;
      console.log(`[AI] ${player?.name} 投票给 ${targetPos}号 ${target?.name}`);
      this.game.vote(this.playerId, targetId);
      return { success: true };
    }

    // 让 AI 决策
    this.initAgent();
    const action = await this.agent.getAction(this.getContext());
    let resolvedTargetId = null;

    if (action?.type === 'skip') {
      console.log(`[AI] ${player?.name} 选择弃权`);
      resolvedTargetId = null;
    } else if (action?.type === 'vote' && action.target) {
      const targetNum = parseInt(action.target);
      if (!isNaN(targetNum) && targetNum > 0 && targetNum <= this.game.players.length) {
        resolvedTargetId = this.game.players[targetNum - 1]?.id;
        const target = this.game.players[targetNum - 1];
        console.log(`[AI] ${player?.name} 投票给 ${targetNum}号 ${target?.name}`);
      }
    }

    this.game.vote(this.playerId, resolvedTargetId);
    return { success: true, targetId: resolvedTargetId };
  }

  // 弃权（接口对齐）
  abstain() {
    const player = this.game.players.find(p => p.id === this.playerId);
    console.log(`[AI] ${player?.name} 选择弃权`);
    this.game.vote(this.playerId, null);
    return { success: true };
  }

  // 使用技能（接口对齐）
  async useSkill(data) {
    const player = this.game.players.find(p => p.id === this.playerId);
    // 优先使用 game.phase.currentPhase.id，这是最可靠的阶段来源
    const phase = this.game.phase?.currentPhase?.id || this.cachedState?.phase;

    if (data) {
      const target = data.targetId ? this.game.players.find(p => p.id === data.targetId) : null;
      const targetPos = target ? this.game.players.findIndex(p => p.id === target.id) + 1 : '';
      console.log(`[AI] ${player?.name} 使用技能 ${phase}${target ? ` -> ${targetPos}号 ${target.name}` : ''}`);
      this.game.useSkill(this.playerId, data.phase || phase, data.targetId, data.action);
      return { success: true };
    }

    // 让 AI 决策
    this.initAgent();
    const context = this.getContext();
    const action = await this.agent.getAction(context);
    console.log(`[AI] ${player?.name} 技能决策:`, action);

    if (action?.type === 'witch') {
      let targetId = null;
      if (action.target) {
        const targetNum = parseInt(action.target);
        if (!isNaN(targetNum) && targetNum > 0 && targetNum <= this.game.players.length) {
          targetId = this.game.players[targetNum - 1]?.id;
        }
      }
      console.log(`[AI] 女巫 ${player?.name} ${action.action}${targetId ? ` -> ${action.target}号` : ''}`);
      this.game.useSkill(this.playerId, 'witch', targetId, action.action);
    } else if (action?.type === 'vote' && action.target) {
      const targetNum = parseInt(action.target);
      if (!isNaN(targetNum) && targetNum > 0 && targetNum <= this.game.players.length) {
        const targetId = this.game.players[targetNum - 1]?.id;
        const target = this.game.players[targetNum - 1];
        console.log(`[AI] ${player?.name} 选择目标 ${targetNum}号 ${target?.name}`);
        // 使用当前阶段
        this.game.useSkill(this.playerId, context.phase, targetId);
      }
    } else if (action?.type === 'skip') {
      console.log(`[AI] ${player?.name} 跳过技能`);
      // 对于女巫阶段，需要调用 skip
      if (context.phase === 'witch') {
        this.game.useSkill(this.playerId, 'witch', null, 'skip');
      }
    } else {
      console.log(`[AI] ${player?.name} 未知行动类型，跳过`);
    }

    return { success: true };
  }

  // 使用全局能力（接口对齐）
  useGlobalAbility(abilityId, data) {
    return this.game.useGlobalAbility(this.playerId, abilityId, data);
  }
}

// AI 管理器
class AIManager {
  constructor(gameEngine) {
    this.game = gameEngine;
    this.controllers = new Map();
    this.processing = false; // 防止并发处理
  }

  // 创建 AI 控制器
  createAI(playerId) {
    const controller = new AIController(playerId, this.game);
    this.controllers.set(playerId, controller);
    return controller;
  }

  // 获取 AI 控制器
  get(playerId) {
    return this.controllers.get(playerId);
  }

  // 清空
  clear() {
    this.controllers.clear();
    this.processing = false;
  }

  // 获取所有 AI 玩家 ID
  getAllPlayerIds() {
    return Array.from(this.controllers.keys());
  }
}

module.exports = { AIController, AIManager };