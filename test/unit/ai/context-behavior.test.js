const { describe, it, before, run } = require('../../helpers/test-runner');
const { GameEngine } = require('../../../engine/main');
const { createPlayerRole } = require('../../../engine/roles');
const { PhaseManager } = require('../../../engine/phase');
const { AIManager } = require('../../../ai/controller');
const { buildSystemPrompt, getCurrentTask, SYSTEM_MESSAGE_SUFFIX } = require('../../../ai/agent/prompt');
const { formatMessageHistory } = require('../../../ai/agent/formatter');

const ROLES_9 = ['werewolf', 'werewolf', 'werewolf', 'seer', 'witch', 'hunter', 'villager', 'villager', 'villager'];
const ROLES_12 = ['werewolf', 'werewolf', 'werewolf', 'werewolf', 'seer', 'witch', 'guard', 'hunter', 'cupid', 'villager', 'villager', 'villager'];

function createTestGame(playerCount = 9, options = {}) {
  const presetId = options.presetId || '9-standard';
  const roles = options.roles || ROLES_9;
  const game = new GameEngine({ presetId });

  for (let i = 0; i < playerCount; i++) {
    const role = createPlayerRole(roles[i]);
    game.players.push({
      id: i + 1, name: `P${i + 1}`, alive: true, isAI: true,
      role, state: role.state ? { ...role.state } : {}, thinking: `thinking${i + 1}`, speaking: `speaking${i + 1}`
    });
  }

  const aiManager = new AIManager(game);
  const aiControllers = new Map();
  game.players.forEach(p => {
    const controller = aiManager.createAI(p.id, { agentType: 'mock', mockOptions: { presetResponses: {} } });
    aiControllers.set(p.id, controller);
  });

  game.getAIController = (playerId) => aiControllers.get(playerId);
  game.assignRoles = function () {};
  game.start = async function () { this.phaseManager = new PhaseManager(this); };

  return { game, aiControllers, aiManager };
}

function getMock(aiControllers, playerId) {
  return aiControllers.get(playerId)?.agent?.mockModel;
}

function setAI(aiControllers, playerId, actionType, response) {
  const m = getMock(aiControllers, playerId);
  if (m) m.setResponse(actionType, response);
}

function setAllWolves(aiControllers, game, discuss, vote) {
  for (const w of game.players.filter(p => p.role?.camp === 'wolf' && p.alive)) {
    setAI(aiControllers, w.id, 'action_night_werewolf_discuss', discuss);
    setAI(aiControllers, w.id, 'action_night_werewolf_vote', vote);
  }
}

function setAllAlive(aiControllers, game, actionType, response) {
  for (const p of game.players) {
    if (p.alive) setAI(aiControllers, p.id, actionType, response);
  }
}

function initSystemMessages(game, aiControllers) {
  for (const p of game.players) {
    const ctrl = aiControllers.get(p.id);
    if (ctrl) ctrl.updateSystemMessage();
  }
}

function getLastMessagesForPhase(mockModel, phase) {
  const calls = mockModel.getCallsByPhase(phase);
  return calls.length > 0 ? calls[calls.length - 1].messagesForLLM : null;
}

function getLastUserMsg(messages) {
  if (!messages) return null;
  const userMsgs = messages.filter(m => m.role === 'user');
  return userMsgs.length > 0 ? userMsgs[userMsgs.length - 1].content : null;
}

function includes(actual, expected) {
  if (!actual || !actual.includes(expected)) throw new Error(`应包含 "${expected}"，实际: ${(actual || '').substring(0, 300)}`);
}

function notIncludes(actual, expected) {
  if (actual && actual.includes(expected)) throw new Error(`不应包含 "${expected}"，实际: ${(actual || '').substring(0, 300)}`);
}

describe('System Prompt 上下文', () => {
  it('狼人system prompt包含队友', () => {
    const { game, aiControllers } = createTestGame();
    initSystemMessages(game, aiControllers);
    const sysMsg = aiControllers.get(1).agent.mm.messages[0];
    if (sysMsg.role !== 'system') throw new Error('第一条应为system');
    includes(sysMsg.content, '名字:P1');
    includes(sysMsg.content, '位置:1号位');
    includes(sysMsg.content, '角色:狼人');
    includes(sysMsg.content, '队友:2号P2,3号P3');
  });

  it('好人角色system prompt无队友', () => {
    const { game, aiControllers } = createTestGame();
    initSystemMessages(game, aiControllers);
    notIncludes(aiControllers.get(4).agent.mm.messages[0].content, '队友');
    notIncludes(aiControllers.get(5).agent.mm.messages[0].content, '队友');
    notIncludes(aiControllers.get(6).agent.mm.messages[0].content, '队友');
    notIncludes(aiControllers.get(7).agent.mm.messages[0].content, '队友');
  });

  it('所有狼人互为队友', () => {
    const { game, aiControllers } = createTestGame();
    initSystemMessages(game, aiControllers);
    includes(aiControllers.get(1).agent.mm.messages[0].content, '队友:2号P2,3号P3');
    includes(aiControllers.get(2).agent.mm.messages[0].content, '队友:1号P1,3号P3');
    includes(aiControllers.get(3).agent.mm.messages[0].content, '队友:1号P1,2号P2');
    for (const id of [4, 5, 6, 7, 8, 9]) {
      notIncludes(aiControllers.get(id).agent.mm.messages[0].content, '队友');
    }
  });
});

describe('Phase Prompt 精确匹配', () => {
  it('静态phase prompt精确匹配', () => {
    const { game } = createTestGame();
    const alivePlayers = game.players.filter(p => p.alive);
    const ctx = { players: game.players, alivePlayers, self: { thinking: 'thinking1' } };
    const tests = [
      { phase: 'action_night_werewolf_discuss', expected: '【狼人讨论】' },
      { phase: 'action_day_discuss', expected: '【白天发言】' },
      { phase: 'action_last_words', expected: '【遗言】' },
      { phase: 'action_sheriff_campaign', expected: '【警长竞选】' },
      { phase: 'action_withdraw', expected: '【退水】' },
      { phase: 'action_sheriff_speech', expected: '【警长竞选发言】' }
    ];
    for (const tc of tests) {
      const prompt = getCurrentTask(tc.phase, ctx);
      if (!prompt.includes(tc.expected)) throw new Error(`phase "${tc.phase}" 应包含 "${tc.expected}"，实际: ${prompt}`);
    }
  });

  it('带存活列表的phase prompt', () => {
    const { game } = createTestGame();
    const alivePlayers = game.players.filter(p => p.alive);
    const ctx = { players: game.players, alivePlayers, self: { thinking: 'thinking1' } };
    const wolfVote = getCurrentTask('action_night_werewolf_vote', ctx);
    includes(wolfVote, '【狼人投票】');
    includes(wolfVote, '1号: P1');
    includes(wolfVote, '9号: P9');
    includes(wolfVote, '请选择今晚要击杀的玩家');
    const seer = getCurrentTask('action_seer', ctx);
    includes(seer, '【预言家】');
    includes(seer, '请选择要查验的玩家');
    const dayVote = getCurrentTask('action_day_vote', ctx);
    includes(dayVote, '【白天投票】');
    includes(dayVote, '请选择要放逐的玩家');
  });

  it('allowedTargets过滤phase prompt', () => {
    const { game } = createTestGame();
    const alivePlayers = game.players.filter(p => p.alive);
    const ctx = { players: game.players, alivePlayers, self: { thinking: 'thinking1' }, extraData: { allowedTargets: [2, 5, 8] } };
    const prompt = getCurrentTask('action_day_vote', ctx);
    includes(prompt, '2号: P2');
    includes(prompt, '5号: P5');
    includes(prompt, '8号: P8');
    notIncludes(prompt, '1号: P1');
    notIncludes(prompt, '3号: P3');
  });

  it('女巫phase prompt含被杀信息', () => {
    const { game } = createTestGame();
    const alivePlayers = game.players.filter(p => p.alive);
    const ctx = { players: game.players, alivePlayers, self: { thinking: 'thinking5' }, werewolfTarget: 7, witchPotion: { heal: true, poison: true } };
    const prompt = getCurrentTask('action_witch', ctx);
    includes(prompt, '【女巫】');
    includes(prompt, '7号P7');
    includes(prompt, '被狼人杀害');
    includes(prompt, '解药：可用');
    includes(prompt, '毒药：可用');
  });
});

describe('buildContext 直接测试', () => {
  it('女巫buildContext药水状态', () => {
    const { game, aiControllers } = createTestGame();
    initSystemMessages(game, aiControllers);
    game.players[4].state.heal = 0;
    game.werewolfTarget = 7;
    const ctx = aiControllers.get(5).buildContext({ actionType: 'action_witch' });
    if (ctx.witchPotion.heal !== false) throw new Error('heal应为false');
    if (ctx.witchPotion.poison !== true) throw new Error('poison应为true');
    if (ctx.werewolfTarget !== 7) throw new Error('werewolfTarget应为7');
  });

  it('预言家buildContext查验历史', () => {
    const { game, aiControllers } = createTestGame();
    initSystemMessages(game, aiControllers);
    game.players[3].state.seerChecks = [{ targetId: 1, result: 'wolf', night: 1 }];
    const ctx = aiControllers.get(4).buildContext({ actionType: 'action_seer' });
    if (!ctx.self.seerChecks || ctx.self.seerChecks.length !== 1) throw new Error('应有1条查验记录');
    if (ctx.self.seerChecks[0].targetId !== 1) throw new Error('查验目标应为1');
  });

  it('守卫buildContext上一晚目标', () => {
    const { game, aiControllers } = createTestGame(12, { presetId: '12-guard-cupid', roles: ROLES_12 });
    initSystemMessages(game, aiControllers);
    game.players[6].state.lastGuardTarget = 4;
    const ctx = aiControllers.get(7).buildContext({ actionType: 'action_guard' });
    if (ctx.self.lastGuardTarget !== 4) throw new Error('lastGuardTarget应为4');
  });
});

describe('buildSystemPrompt 精确匹配', () => {
  it('各角色格式正确', () => {
    const { game } = createTestGame();
    const wolf1 = game.players[0];
    includes(buildSystemPrompt(wolf1, game), '名字:P1 位置:1号位 角色:狼人 队友:2号P2,3号P3');
    const seer4 = game.players[3];
    includes(buildSystemPrompt(seer4, game), '名字:P4 位置:4号位 角色:预言家');
    notIncludes(buildSystemPrompt(seer4, game), '队友');
    const villager7 = game.players[6];
    includes(buildSystemPrompt(villager7, game), '名字:P7 位置:7号位 角色:村民');
  });
});

describe('多Agent上下文差异', () => {
  it('狼人投票上下文', async () => {
    const { game, aiControllers } = createTestGame();
    game.phaseManager = new PhaseManager(game);
    initSystemMessages(game, aiControllers);
    setAllWolves(aiControllers, game, { content: '刀预言家' }, { target: '4' });
    setAI(aiControllers, 4, 'action_seer', 7);
    setAI(aiControllers, 5, 'action_witch', { action: 'skip' });
    await game.phaseManager.executePhase('night_werewolf_discuss');
    await game.phaseManager.executePhase('night_werewolf_vote');
    const msgs = getLastMessagesForPhase(getMock(aiControllers, 1), 'night_werewolf_vote');
    if (!msgs) throw new Error('狼人1应有投票上下文');
    const lastUser = getLastUserMsg(msgs);
    includes(lastUser, '【狼人投票】');
    includes(lastUser, '可选玩家');
    includes(lastUser, '请选择今晚要击杀的玩家');
    includes(lastUser, 'thinking1');
  });

  it('预言家查验上下文', async () => {
    const { game, aiControllers } = createTestGame();
    game.phaseManager = new PhaseManager(game);
    initSystemMessages(game, aiControllers);
    setAllWolves(aiControllers, game, { content: '过' }, { target: '7' });
    setAI(aiControllers, 4, 'action_seer', 7);
    setAI(aiControllers, 5, 'action_witch', { action: 'skip' });
    await game.phaseManager.executePhase('night_werewolf_discuss');
    await game.phaseManager.executePhase('night_werewolf_vote');
    await game.phaseManager.executePhase('witch');
    await game.phaseManager.executePhase('seer');
    const msgs = getLastMessagesForPhase(getMock(aiControllers, 4), 'seer');
    if (!msgs) throw new Error('预言家应有查验上下文');
    const lastUser = getLastUserMsg(msgs);
    includes(lastUser, '【预言家】');
    includes(lastUser, '请选择要查验的玩家');
    includes(lastUser, 'thinking4');
  });

  it('女巫技能上下文', async () => {
    const { game, aiControllers } = createTestGame();
    game.phaseManager = new PhaseManager(game);
    initSystemMessages(game, aiControllers);
    setAllWolves(aiControllers, game, { content: '过' }, { target: '7' });
    setAI(aiControllers, 4, 'action_seer', 8);
    setAI(aiControllers, 5, 'action_witch', { action: 'skip' });
    await game.phaseManager.executePhase('night_werewolf_discuss');
    await game.phaseManager.executePhase('night_werewolf_vote');
    await game.phaseManager.executePhase('witch');
    const msgs = getLastMessagesForPhase(getMock(aiControllers, 5), 'witch');
    if (!msgs) throw new Error('女巫应有技能上下文');
    const lastUser = getLastUserMsg(msgs);
    includes(lastUser, '【女巫】');
    includes(lastUser, '被狼人杀害');
    includes(lastUser, '解药：可用');
    includes(lastUser, '毒药：可用');
    includes(lastUser, 'thinking5');
  });

  it('白天发言上下文', async () => {
    const { game, aiControllers } = createTestGame();
    game.phaseManager = new PhaseManager(game);
    initSystemMessages(game, aiControllers);
    setAllWolves(aiControllers, game, { content: '过' }, { target: '7' });
    setAI(aiControllers, 4, 'action_seer', 8);
    setAI(aiControllers, 5, 'action_witch', { action: 'heal' });
    await game.phaseManager.executePhase('night_werewolf_discuss');
    await game.phaseManager.executePhase('night_werewolf_vote');
    await game.phaseManager.executePhase('witch');
    await game.phaseManager.executePhase('seer');
    setAllAlive(aiControllers, game, 'action_day_discuss', { content: '我是好人' });
    setAllAlive(aiControllers, game, 'action_day_vote', { target: '2' });
    await game.phaseManager.executePhase('day_announce');
    await game.phaseManager.executePhase('day_discuss');
    const msgs = getLastMessagesForPhase(getMock(aiControllers, 7), 'day_discuss');
    if (!msgs) throw new Error('村民7应有发言上下文');
    const lastUser = getLastUserMsg(msgs);
    includes(lastUser, '【白天发言】');
    includes(lastUser, 'thinking7');
  });
});

describe('多Agent可见性', () => {
  it('狼人vs非狼人可见性差异', async () => {
    const { game, aiControllers } = createTestGame();
    game.phaseManager = new PhaseManager(game);
    initSystemMessages(game, aiControllers);
    setAllWolves(aiControllers, game, { content: '刀预言家' }, { target: '4' });
    setAI(aiControllers, 4, 'action_seer', 7);
    setAI(aiControllers, 5, 'action_witch', { action: 'skip' });
    await game.phaseManager.executePhase('night_werewolf_discuss');
    await game.phaseManager.executePhase('night_werewolf_vote');
    if (getMock(aiControllers, 1).getCallsByPhase('night_werewolf_vote').length === 0) throw new Error('狼人应有投票调用');
    if (getMock(aiControllers, 4).getCallsByPhase('night_werewolf_vote').length !== 0) throw new Error('预言家无狼人投票调用');
    if (getMock(aiControllers, 7).getCallsByPhase('night_werewolf_discuss').length !== 0) throw new Error('村民无狼人讨论调用');
  });

  it('狼人讨论看到队友', async () => {
    const { game, aiControllers } = createTestGame();
    game.phaseManager = new PhaseManager(game);
    initSystemMessages(game, aiControllers);
    setAllWolves(aiControllers, game, { content: '刀预言家' }, { target: '4' });
    await game.phaseManager.executePhase('night_werewolf_discuss');
    const wolfCalls = getMock(aiControllers, 1).getCallsByPhase('night_werewolf_discuss');
    if (wolfCalls.length === 0) throw new Error('狼人1应有讨论调用');
    const lastUser = getLastUserMsg(wolfCalls[wolfCalls.length - 1].messagesForLLM);
    includes(lastUser, '【狼人讨论】');
    const sysMsg = wolfCalls[wolfCalls.length - 1].messagesForLLM.find(m => m.role === 'system');
    includes(sysMsg.content, '队友');
  });
});

describe('多Agent全流程', () => {
  it('多角色全流程上下文', async () => {
    const { game, aiControllers } = createTestGame();
    game.phaseManager = new PhaseManager(game);
    initSystemMessages(game, aiControllers);
    setAllWolves(aiControllers, game, { content: '刀7号' }, { target: '7' });
    setAI(aiControllers, 4, 'action_seer', 1);
    setAI(aiControllers, 5, 'action_witch', { action: 'skip' });
    await game.phaseManager.executePhase('night_werewolf_discuss');
    await game.phaseManager.executePhase('night_werewolf_vote');
    await game.phaseManager.executePhase('witch');
    await game.phaseManager.executePhase('seer');
    includes(aiControllers.get(1).agent.mm.messages[0].content, '队友:2号P2,3号P3');
    notIncludes(aiControllers.get(4).agent.mm.messages[0].content, '队友');
    if (getMock(aiControllers, 1).getCallsByPhase('night_werewolf_discuss').length === 0) throw new Error('狼人应有讨论调用');
    if (getMock(aiControllers, 1).getCallsByPhase('night_werewolf_vote').length === 0) throw new Error('狼人应有投票调用');
    if (getMock(aiControllers, 4).getCallsByPhase('seer').length === 0) throw new Error('预言家应有查验调用');
    if (getMock(aiControllers, 4).getCallsByPhase('night_werewolf_vote').length !== 0) throw new Error('预言家无狼人投票调用');
    const witchCalls = getMock(aiControllers, 5).getCallsByPhase('witch');
    if (witchCalls.length === 0) throw new Error('女巫应有技能调用');
    includes(getLastUserMsg(witchCalls[witchCalls.length - 1].messagesForLLM), '7号P7');
    includes(getLastUserMsg(witchCalls[witchCalls.length - 1].messagesForLLM), '被狼人杀害');
  });

  it('12人守丘局上下文', async () => {
    const { game, aiControllers } = createTestGame(12, { presetId: '12-guard-cupid', roles: ROLES_12 });
    game.phaseManager = new PhaseManager(game);
    initSystemMessages(game, aiControllers);
    setAI(aiControllers, 9, 'action_cupid', { targets: [5, 7] });
    setAI(aiControllers, 7, 'action_guard', 4);
    setAllWolves(aiControllers, game, { content: '过' }, { target: '8' });
    setAI(aiControllers, 5, 'action_seer', 1);
    setAI(aiControllers, 6, 'action_witch', { action: 'skip' });
    await game.phaseManager.executePhase('cupid');
    await game.phaseManager.executePhase('guard');
    await game.phaseManager.executePhase('night_werewolf_discuss');
    await game.phaseManager.executePhase('night_werewolf_vote');
    await game.phaseManager.executePhase('witch');
    await game.phaseManager.executePhase('seer');
    const cupidCalls = getMock(aiControllers, 9).getCallsByPhase('cupid');
    if (cupidCalls.length === 0) throw new Error('丘比特应有连线调用');
    includes(getLastUserMsg(cupidCalls[cupidCalls.length - 1].messagesForLLM), '【丘比特】');
    includes(getLastUserMsg(cupidCalls[cupidCalls.length - 1].messagesForLLM), '请选择两名玩家连接为情侣');
    const guardCalls = getMock(aiControllers, 7).getCallsByPhase('guard');
    if (guardCalls.length === 0) throw new Error('守卫应有守护调用');
    includes(getLastUserMsg(guardCalls[guardCalls.length - 1].messagesForLLM), '【守卫】');
    includes(getLastUserMsg(guardCalls[guardCalls.length - 1].messagesForLLM), '请选择要守护的玩家');
  });
});

describe('状态变化上下文', () => {
  it('女巫解药用完上下文', async () => {
    const { game, aiControllers } = createTestGame();
    game.phaseManager = new PhaseManager(game);
    initSystemMessages(game, aiControllers);
    setAllWolves(aiControllers, game, { content: '过' }, { target: '7' });
    setAI(aiControllers, 4, 'action_seer', 8);
    setAI(aiControllers, 5, 'action_witch', { action: 'heal' });
    await game.phaseManager.executePhase('night_werewolf_discuss');
    await game.phaseManager.executePhase('night_werewolf_vote');
    await game.phaseManager.executePhase('witch');
    await game.phaseManager.executePhase('seer');
    setAllAlive(aiControllers, game, 'action_day_discuss', { content: '过' });
    setAllAlive(aiControllers, game, 'action_day_vote', { target: '2' });
    await game.phaseManager.executePhase('day_announce');
    await game.phaseManager.executePhase('day_discuss');
    await game.phaseManager.executePhase('day_vote');
    setAllWolves(aiControllers, game, { content: '过' }, { target: '8' });
    setAI(aiControllers, 4, 'action_seer', 2);
    setAI(aiControllers, 5, 'action_witch', { action: 'skip' });
    await game.phaseManager.executePhase('night_werewolf_discuss');
    await game.phaseManager.executePhase('night_werewolf_vote');
    await game.phaseManager.executePhase('witch');
    const witchCalls = getMock(aiControllers, 5).getCallsByPhase('witch');
    if (witchCalls.length < 2) throw new Error('女巫应有至少2次技能调用');
    const secondCall = witchCalls[witchCalls.length - 1];
    const lastUser = getLastUserMsg(secondCall.messagesForLLM);
    includes(lastUser, '解药：已用完');
  });

  it('预言家查验历史上下文', async () => {
    const { game, aiControllers } = createTestGame();
    game.phaseManager = new PhaseManager(game);
    initSystemMessages(game, aiControllers);
    setAllWolves(aiControllers, game, { content: '过' }, { target: '7' });
    setAI(aiControllers, 4, 'action_seer', 1);
    setAI(aiControllers, 5, 'action_witch', { action: 'skip' });
    await game.phaseManager.executePhase('night_werewolf_discuss');
    await game.phaseManager.executePhase('night_werewolf_vote');
    await game.phaseManager.executePhase('witch');
    await game.phaseManager.executePhase('seer');
    setAllAlive(aiControllers, game, 'action_day_discuss', { content: '过' });
    setAllAlive(aiControllers, game, 'action_day_vote', { target: '2' });
    await game.phaseManager.executePhase('day_announce');
    await game.phaseManager.executePhase('day_discuss');
    await game.phaseManager.executePhase('day_vote');
    setAllWolves(aiControllers, game, { content: '过' }, { target: '8' });
    setAI(aiControllers, 4, 'action_seer', 2);
    setAI(aiControllers, 5, 'action_witch', { action: 'skip' });
    await game.phaseManager.executePhase('night_werewolf_discuss');
    await game.phaseManager.executePhase('night_werewolf_vote');
    await game.phaseManager.executePhase('witch');
    await game.phaseManager.executePhase('seer');
    const seerCalls = getMock(aiControllers, 4).getCallsByPhase('seer');
    if (seerCalls.length < 2) throw new Error('预言家应有至少2次查验调用');
    const secondCall = seerCalls[seerCalls.length - 1];
    const allContent = secondCall.messagesForLLM.map(m => m.content).join('\n');
    includes(allContent, '1号P1');
  });
});

run();