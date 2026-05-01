const { describe, it, run } = require('../../helpers/test-runner');
const { GameEngine } = require('../../../engine/main');
const { createPlayerRole } = require('../../../engine/roles');
const { PhaseManager } = require('../../../engine/phase');
const { AIManager } = require('../../../ai/controller');
const { buildSystemPrompt } = require('../../../ai/agent/prompt');
const { BOARD_PRESETS, getEffectiveRules, RULES } = require('../../../engine/config');

function createTestGameWithRules(presetId, ruleOverrides) {
  const preset = BOARD_PRESETS[presetId];
  if (!preset) throw new Error(`未知的板子: ${presetId}`);
  const game = new GameEngine({ presetId });

  if (ruleOverrides) {
    for (const [category, overrides] of Object.entries(ruleOverrides)) {
      game.effectiveRules[category] = { ...game.effectiveRules[category], ...overrides };
    }
  }

  for (let i = 0; i < preset.playerCount; i++) {
    const role = createPlayerRole(preset.roles[i]);
    game.players.push({
      id: i + 1,
      name: `玩家${i + 1}`,
      alive: true,
      isAI: true,
      role,
      state: role.state ? { ...role.state } : {}
    });
  }

  const aiManager = new AIManager(game);
  const mockAgents = {};
  game.players.forEach(p => {
    const controller = aiManager.createAI(p.id, {
      agentType: 'mock',
      mockOptions: {
        presetResponses: {
          action_day_discuss: { content: '过。' },
          action_last_words: { content: '过。' },
          action_sheriff_speech: { content: '过。' },
          action_night_werewolf_discuss: { content: '过。' },
          action_day_vote: { target: 1 },
          action_night_werewolf_vote: { target: 5 },
          action_sheriff_vote: { target: 1 },
          action_sheriff_campaign: { run: false },
          action_withdraw: { withdraw: false },
          action_guard: { target: 1 },
          action_seer: { target: 1 },
          action_witch: { action: 'skip' },
          action_shoot: { target: 1 },
          action_passBadge: { target: null },
          action_cupid: { targets: [1, 2] },
          action_assignOrder: { target: 1 }
        }
      }
    });
    mockAgents[p.id] = controller.agent.mockModel;
  });

  game.getAIController = (id) => aiManager.get(id);
  game.phaseManager = new PhaseManager(game);
  return { game, aiControllers: mockAgents };
}

describe('GameEngine preset 行为', () => {
  it('presetId 存储', () => {
    const game = new GameEngine({ presetId: '9-standard' });
    if (game.presetId !== '9-standard') throw new Error(`presetId 应为 '9-standard'，实际为 ${game.presetId}`);
  });

  it('preset 对象', () => {
    const game = new GameEngine({ presetId: '9-standard' });
    if (game.preset === null) throw new Error('GameEngine 应存储 preset 对象');
    if (game.preset.name !== '9人标准局') throw new Error(`preset.name 应为 '9人标准局'，实际为 ${game.preset.name}`);
  });

  it('playerCount 从 preset 派生', () => {
    const game = new GameEngine({ presetId: '9-standard' });
    if (game.playerCount !== 9) throw new Error(`有 preset 时 playerCount 应为 9，实际为 ${game.playerCount}`);
  });

  it('effectiveRules 反映 preset 规则', () => {
    const game = new GameEngine({ presetId: '9-standard' });
    if (game.effectiveRules === null) throw new Error('GameEngine 应计算 effectiveRules');
    if (game.effectiveRules.hunter.canShootIfPoisoned !== false) {
      throw new Error('effectiveRules.hunter.canShootIfPoisoned 应为 false');
    }
  });

  it('无 presetId 时 presetId 为 null', () => {
    const game = new GameEngine();
    if (game.presetId !== null) throw new Error(`无 presetId 时 presetId 应为 null，实际为 ${game.presetId}`);
    if (game.preset !== null) throw new Error('无 presetId 时 preset 应为 null');
  });

  it('无 preset 时 playerCount 默认为 9', () => {
    const game = new GameEngine();
    if (game.playerCount !== 9) throw new Error(`无 preset 时 playerCount 默认应为 9，实际为 ${game.playerCount}`);
    if (game.effectiveRules === null) throw new Error('无 preset 时也应计算 effectiveRules');
    if (game.effectiveRules.witch.canSelfHeal !== RULES.witch.canSelfHeal) {
      throw new Error('无 preset 时 effectiveRules 应为 RULES 的深拷贝');
    }
  });

  it('手动设置 playerCount 优先于 preset', () => {
    const game = new GameEngine({ presetId: '9-standard' });
    game.playerCount = 7;
    if (game.playerCount !== 7) throw new Error(`手动设置 playerCount 应为 7，实际为 ${game.playerCount}`);
  });

  it('不存在的 presetId 时 preset 为 undefined', () => {
    const game = new GameEngine({ presetId: 'nonexistent' });
    if (game.preset !== undefined) throw new Error(`不存在的 presetId 时 preset 应为 undefined，实际为 ${game.preset}`);
    if (game.presetId !== 'nonexistent') throw new Error('presetId 仍存储传入的值');
  });

  it('getState 返回 preset 信息', () => {
    const game = new GameEngine({ presetId: '9-standard' });
    game.players = [];
    const state = game.getState();
    if (state.preset === null) throw new Error('getState 应返回 preset 信息');
    if (state.preset.id !== '9-standard') throw new Error(`getState preset.id 应为 '9-standard'，实际为 ${state.preset.id}`);
    if (state.preset.name !== '9人标准局') throw new Error(`getState preset.name 应为 '9人标准局'，实际为 ${state.preset.name}`);
    if (typeof state.preset.ruleDescriptions === 'undefined') throw new Error('getState 应包含 ruleDescriptions');
  });

  it('12人局 playerCount 和 effectiveRules', () => {
    const game = new GameEngine({ presetId: '12-guard-cupid' });
    if (game.playerCount !== 12) throw new Error(`12人局 playerCount 应为 12，实际为 ${game.playerCount}`);
    if (game.effectiveRules.guard.allowRepeatGuard !== false) {
      throw new Error('12人守丘局 effectiveRules.guard.allowRepeatGuard 应为 false');
    }
  });
});

describe('canShootIfPoisoned 配置生效', () => {
  it('默认 false 时被毒不能开枪', () => {
    const { game } = createTestGameWithRules('9-standard', {});
    const hunter = game.players.find(p => p.role.id === 'hunter');
    if (hunter === undefined) throw new Error('9人局应有猎人');
    hunter.alive = false;
    const canUse = hunter.role.skills.action_shoot.canUse(hunter, game, { deathReason: 'poison' });
    if (canUse !== false) throw new Error(`canShootIfPoisoned=false 时被毒不能开枪，实际为 ${canUse}`);
  });

  it('true 时被毒能开枪', () => {
    const { game } = createTestGameWithRules('9-standard', { hunter: { canShootIfPoisoned: true } });
    const hunter = game.players.find(p => p.role.id === 'hunter');
    hunter.alive = false;
    const canUse = hunter.role.skills.action_shoot.canUse(hunter, game, { deathReason: 'poison' });
    if (canUse !== true) throw new Error(`canShootIfPoisoned=true 时被毒能开枪，实际为 ${canUse}`);
  });

  it('被刀时无论配置如何都能开枪', () => {
    const { game } = createTestGameWithRules('9-standard', {});
    const hunter = game.players.find(p => p.role.id === 'hunter');
    hunter.alive = false;
    const canUse = hunter.role.skills.action_shoot.canUse(hunter, game, { deathReason: 'werewolf' });
    if (canUse !== true) throw new Error(`被刀时无论 canShootIfPoisoned 配置如何都能开枪，实际为 ${canUse}`);
  });

  it('被公投时能开枪', () => {
    const { game } = createTestGameWithRules('9-standard', {});
    const hunter = game.players.find(p => p.role.id === 'hunter');
    hunter.alive = false;
    const canUse = hunter.role.skills.action_shoot.canUse(hunter, game, { deathReason: 'vote' });
    if (canUse !== true) throw new Error(`被公投时能开枪，实际为 ${canUse}`);
  });
});

describe('AI prompt 与 ruleDescriptions 同步', () => {
  it('有 preset 时 prompt 包含 ruleDescriptions', () => {
    const game = new GameEngine({ presetId: '9-standard' });
    game.players = [{
      id: 1, name: '测试玩家', alive: true, isAI: true,
      role: createPlayerRole('werewolf'),
      state: { isWolf: true }
    }];
    const prompt = buildSystemPrompt(game.players[0], game);
    if (!prompt.includes('规则:')) throw new Error('有 preset 时 prompt 应包含 "规则:"');
    if (!prompt.includes('女巫仅首夜可自救')) throw new Error('9人局 prompt 应包含女巫自救规则');
    if (!prompt.includes('猎人被毒不能开枪')) throw new Error('9人局 prompt 应包含猎人开枪规则');
  });

  it('不同 preset 的 ruleDescriptions 不同', () => {
    const game9 = new GameEngine({ presetId: '9-standard' });
    game9.players = [{
      id: 1, name: '测试', alive: true, isAI: true,
      role: createPlayerRole('werewolf'), state: { isWolf: true }
    }];

    const game12gc = new GameEngine({ presetId: '12-guard-cupid' });
    game12gc.players = [{
      id: 1, name: '测试', alive: true, isAI: true,
      role: createPlayerRole('werewolf'), state: { isWolf: true }
    }];

    const prompt9 = buildSystemPrompt(game9.players[0], game9);
    const prompt12gc = buildSystemPrompt(game12gc.players[0], game12gc);

    if (prompt9.includes('守卫不可连守')) throw new Error('9人局 prompt 不应包含守卫连守规则');
    if (!prompt12gc.includes('守卫不可连守')) throw new Error('12人守丘局 prompt 应包含守卫连守规则');
    if (!prompt12gc.includes('同守同救则死亡')) throw new Error('12人守丘局 prompt 应包含同守同救规则');
    if (!prompt12gc.includes('情侣一方死亡另一方殉情')) throw new Error('12人守丘局 prompt 应包含情侣殉情规则');
  });

  it('无 preset 时 prompt 不包含规则', () => {
    const game = new GameEngine({ presetId: '9-standard' });
    game.preset = null;
    game.players = [{
      id: 1, name: '测试', alive: true, isAI: true,
      role: createPlayerRole('werewolf'), state: { isWolf: true }
    }];
    const prompt = buildSystemPrompt(game.players[0], game);
    if (prompt.includes('规则:')) throw new Error('无 preset 时 prompt 不应包含 "规则:"');
  });
});

describe('allowRepeatGuard 配置生效', () => {
  it('false 时不能连续守同一人', () => {
    const { game } = createTestGameWithRules('12-guard-cupid', {});
    const guard = game.players.find(p => p.role.id === 'guard');
    if (guard === undefined) throw new Error('12人守丘局应有守卫');
    guard.state.lastGuardTarget = 1;
    const target = game.players[0];
    const canGuard = guard.role.skills.action_guard.validate(target, guard, game);
    if (canGuard !== false) throw new Error(`allowRepeatGuard=false 时不能连续守同一人，实际为 ${canGuard}`);
  });

  it('true 时能连续守同一人', () => {
    const { game } = createTestGameWithRules('12-guard-cupid', { guard: { allowRepeatGuard: true } });
    const guard = game.players.find(p => p.role.id === 'guard');
    guard.state.lastGuardTarget = 1;
    const target = game.players[0];
    const canGuard = guard.role.skills.action_guard.validate(target, guard, game);
    if (canGuard !== true) throw new Error(`allowRepeatGuard=true 时能连续守同一人，实际为 ${canGuard}`);
  });

  it('守不同人无论配置都可以', () => {
    const { game } = createTestGameWithRules('12-guard-cupid', {});
    const guard = game.players.find(p => p.role.id === 'guard');
    guard.state.lastGuardTarget = 1;
    const target = game.players[1];
    const canGuard = guard.role.skills.action_guard.validate(target, guard, game);
    if (canGuard !== true) throw new Error(`守不同人无论配置都可以，实际为 ${canGuard}`);
  });
});

describe('canSelfHeal 配置生效', () => {
  it('9人局默认 canSelfHeal 为 true', () => {
    const game = new GameEngine({ presetId: '9-standard' });
    if (game.effectiveRules.witch.canSelfHeal !== true) {
      throw new Error(`9人局 canSelfHeal 应为 true，实际为 ${game.effectiveRules.witch.canSelfHeal}`);
    }
  });

  it('canSelfHeal=false 时不能自救', () => {
    const { game } = createTestGameWithRules('9-standard', { witch: { canSelfHeal: false } });
    game.round = 1;
    const canSelfHeal = game.effectiveRules.witch.canSelfHeal;
    if (canSelfHeal !== false) throw new Error(`canSelfHeal=false 时不能自救，实际为 ${canSelfHeal}`);
  });

  it('canSelfHeal=true 时首夜可自救', () => {
    const game = new GameEngine({ presetId: '9-standard' });
    if (game.effectiveRules.witch.canSelfHeal !== true) {
      throw new Error(`9人局 canSelfHeal 默认应为 true，实际为 ${game.effectiveRules.witch.canSelfHeal}`);
    }
  });
});

run();