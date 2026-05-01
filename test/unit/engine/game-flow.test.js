const { describe, it, run } = require('../../helpers/test-runner');
const { GameEngine } = require('../../../engine/main');
const { createPlayerRole } = require('../../../engine/roles');
const { PhaseManager } = require('../../../engine/phase');
const { AIManager } = require('../../../ai/controller');
const { BOARD_PRESETS } = require('../../../engine/config');

function createTestGame(presetId = '9-standard') {
  const preset = BOARD_PRESETS[presetId];
  if (!preset) throw new Error(`未知板子: ${presetId}`);
  const game = new GameEngine({ presetId });

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
          action_post_vote: { target: 1 },
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

function setAI(controllers, playerId, actionType, response) {
  const m = controllers[playerId];
  if (m) m.setResponse(actionType, response);
}

function setAllWolves(controllers, game, discuss, vote) {
  for (const w of game.players.filter(p => p.role?.camp === 'wolf' && p.alive)) {
    setAI(controllers, w.id, 'action_night_werewolf_discuss', discuss);
    setAI(controllers, w.id, 'action_night_werewolf_vote', vote);
  }
}

function setAllAlive(controllers, game, actionType, response) {
  for (const p of game.players) {
    if (p.alive) setAI(controllers, p.id, actionType, response);
  }
}

function initSystemMessages(game, controllers) {
  for (const p of game.players) {
    const ctrl = game.getAIController(p.id);
    if (ctrl) ctrl.updateSystemMessage();
  }
}

describe('完整游戏流程 - 好人胜', () => {
  it('所有狼人死亡好人胜', async () => {
    const { game, aiControllers } = createTestGame('9-standard');
    initSystemMessages(game, aiControllers);

    setAllWolves(aiControllers, game, { content: '过' }, { target: '7' });
    setAI(aiControllers, 4, 'action_seer', 1);
    setAI(aiControllers, 5, 'action_witch', { action: 'skip' });

    await game.phaseManager.executePhase('night_werewolf_discuss');
    await game.phaseManager.executePhase('night_werewolf_vote');
    await game.phaseManager.executePhase('witch');
    await game.phaseManager.executePhase('seer');

    const wolves = game.players.filter(p => p.role?.camp === 'wolf');
    for (const w of wolves) {
      w.alive = false;
    }
    const result = game.config.hooks.checkWin(game);
    if (result !== 'good') throw new Error(`应返回good，实际${result}`);
  });
});

describe('完整游戏流程 - 狼人胜', () => {
  it('神职全灭狼人胜', async () => {
    const { game, aiControllers } = createTestGame('9-standard');
    initSystemMessages(game, aiControllers);

    setAllWolves(aiControllers, game, { content: '过' }, { target: '7' });
    setAI(aiControllers, 4, 'action_seer', 1);
    setAI(aiControllers, 5, 'action_witch', { action: 'skip' });

    await game.phaseManager.executePhase('night_werewolf_discuss');
    await game.phaseManager.executePhase('night_werewolf_vote');
    await game.phaseManager.executePhase('witch');
    await game.phaseManager.executePhase('seer');

    const gods = game.players.filter(p => p.role?.type === 'god');
    for (const g of gods) {
      g.alive = false;
    }
    const result = game.config.hooks.checkWin(game);
    if (result !== 'wolf') throw new Error(`应返回wolf，实际${result}`);
  });
});

describe('完整游戏流程 - 白痴翻牌后好人胜', () => {
  it('白痴翻牌后狼人全灭好人胜', async () => {
    const { game, aiControllers } = createTestGame('12-hunter-idiot');
    initSystemMessages(game, aiControllers);

    const idiot = game.players.find(p => p.role.id === 'idiot');
    idiot.state.revealed = true;
    idiot.state.canVote = false;

    const wolves = game.players.filter(p => p.role?.camp === 'wolf');
    for (const w of wolves) {
      w.alive = false;
    }
    const result = game.config.hooks.checkWin(game);
    if (result !== 'good') throw new Error(`应返回good，实际${result}`);
  });
});

describe('完整游戏流程 - 丘比特情侣胜', () => {
  it('人狼情侣第三方胜利', async () => {
    const { game, aiControllers } = createTestGame('12-guard-cupid');
    initSystemMessages(game, aiControllers);

    const cupid = game.players.find(p => p.role.id === 'cupid');
    const wolves = game.players.filter(p => p.role?.camp === 'wolf');
    const goodPlayers = game.players.filter(p => p.role?.camp === 'good' && p.role.id !== 'cupid');

    game.couples = [cupid.id, wolves[0].id];

    for (const p of game.players) {
      if (!game.couples.includes(p.id) && p.id !== cupid.id) {
        p.alive = false;
      }
    }

    const result = game.config.hooks.checkWin(game);
    if (result !== 'third') throw new Error(`应返回third，实际${result}`);
  });
});

describe('完整游戏流程 - 多轮游戏', () => {
  it('第一夜+白天+第二夜完整流程', async () => {
    const { game, aiControllers } = createTestGame('9-standard');
    initSystemMessages(game, aiControllers);

    setAllWolves(aiControllers, game, { content: '过' }, { target: '7' });
    setAI(aiControllers, 4, 'action_seer', 2);
    setAI(aiControllers, 5, 'action_witch', { action: 'skip' });

    await game.phaseManager.executePhase('night_werewolf_discuss');
    await game.phaseManager.executePhase('night_werewolf_vote');
    await game.phaseManager.executePhase('witch');
    await game.phaseManager.executePhase('seer');

    const seer = game.players.find(p => p.role.id === 'seer');
    if (!seer.alive) throw new Error('预言家应存活');
    const seerChecks = seer.state?.seerChecks;
    if (!seerChecks || seerChecks.length === 0) throw new Error('预言家应有查验记录');

    setAllAlive(aiControllers, game, 'action_day_discuss', { content: '过' });
    setAllAlive(aiControllers, game, 'action_day_vote', { target: '1' });

    await game.phaseManager.executePhase('day_announce');
    await game.phaseManager.executePhase('day_discuss');

    if (game.round !== 1) throw new Error(`第一轮round应为1，实际${game.round}`);
  });
});

describe('AI行为测试', () => {
  it('AI统一投票', async () => {
    const { game, aiControllers } = createTestGame('9-standard');
    initSystemMessages(game, aiControllers);

    setAllWolves(aiControllers, game, { content: '过' }, { target: '7' });
    setAI(aiControllers, 4, 'action_seer', 1);
    setAI(aiControllers, 5, 'action_witch', { action: 'skip' });

    await game.phaseManager.executePhase('night_werewolf_discuss');
    await game.phaseManager.executePhase('night_werewolf_vote');

    const wolfCalls = aiControllers[1].getCallsByPhase('night_werewolf_vote');
    if (!wolfCalls || wolfCalls.length === 0) throw new Error('狼人应有投票调用');
  });

  it('AI预言家查验', async () => {
    const { game, aiControllers } = createTestGame('9-standard');
    initSystemMessages(game, aiControllers);

    setAllWolves(aiControllers, game, { content: '过' }, { target: '7' });
    setAI(aiControllers, 4, 'action_seer', 2);
    setAI(aiControllers, 5, 'action_witch', { action: 'skip' });

    await game.phaseManager.executePhase('night_werewolf_discuss');
    await game.phaseManager.executePhase('night_werewolf_vote');
    await game.phaseManager.executePhase('witch');
    await game.phaseManager.executePhase('seer');

    const seerCalls = aiControllers[4].getCallsByPhase('seer');
    if (!seerCalls || seerCalls.length === 0) throw new Error('预言家应有查验调用');
  });

  it('AI女巫跳过', async () => {
    const { game, aiControllers } = createTestGame('9-standard');
    initSystemMessages(game, aiControllers);

    setAllWolves(aiControllers, game, { content: '过' }, { target: '7' });
    setAI(aiControllers, 4, 'action_seer', 1);
    setAI(aiControllers, 5, 'action_witch', { action: 'skip' });

    await game.phaseManager.executePhase('night_werewolf_discuss');
    await game.phaseManager.executePhase('night_werewolf_vote');
    await game.phaseManager.executePhase('witch');

    const witchCalls = aiControllers[5].getCallsByPhase('witch');
    if (!witchCalls || witchCalls.length === 0) throw new Error('女巫应有技能调用');
  });
});

describe('死亡公告格式', () => {
  it('day_announce产生死亡公告', async () => {
    const { game } = createTestGame('9-standard');
    game.round = 1;
    const villager = game.players.find(p => p.role.id === 'villager');
    game.werewolfTarget = villager.id;
    await game.phaseManager.executePhase('day_announce');
    if (villager.alive) throw new Error('村民应死亡');
    const deathMessages = game.message.messages.filter(m => m.type === 'death_announce');
    if (deathMessages.length === 0) throw new Error('应有死亡公告');
  });
});

describe('9人局无警长', () => {
  it('9人标准局无警长配置', () => {
    const { game } = createTestGame('9-standard');
    if (game.effectiveRules.sheriff.enabled !== false) throw new Error('9人局应无警长');
  });
});

describe('12人守丘局完整流程', () => {
  it('丘比特连线+守卫守护', async () => {
    const { game, aiControllers } = createTestGame('12-guard-cupid');
    initSystemMessages(game, aiControllers);

    const cupid = game.players.find(p => p.role.id === 'cupid');
    const guard = game.players.find(p => p.role.id === 'guard');
    if (!cupid) throw new Error('应有丘比特');
    if (!guard) throw new Error('应有守卫');

    setAI(aiControllers, cupid.id, 'action_cupid', { targets: [5, 7] });
    setAI(aiControllers, guard.id, 'action_guard', 4);
    setAllWolves(aiControllers, game, { content: '过' }, { target: '8' });
    setAI(aiControllers, game.players.find(p => p.role.id === 'seer').id, 'action_seer', 1);
    setAI(aiControllers, game.players.find(p => p.role.id === 'witch').id, 'action_witch', { action: 'skip' });

    await game.phaseManager.executePhase('cupid');
    await game.phaseManager.executePhase('guard');
    await game.phaseManager.executePhase('night_werewolf_discuss');
    await game.phaseManager.executePhase('night_werewolf_vote');
    await game.phaseManager.executePhase('witch');
    await game.phaseManager.executePhase('seer');

    if (!game.couples || game.couples.length !== 2) throw new Error('应有2个情侣');
    const cupidCalls = aiControllers[cupid.id].getCallsByPhase('cupid');
    if (!cupidCalls || cupidCalls.length === 0) throw new Error('丘比特应有连线调用');
  });
});

run();