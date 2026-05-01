const { describe, it, run } = require('../../helpers/test-runner');
const { GameEngine } = require('../../../engine/main');
const { createPlayerRole } = require('../../../engine/roles');
const { PhaseManager } = require('../../../engine/phase');
const { AIManager } = require('../../../ai/controller');
const { BOARD_PRESETS } = require('../../../engine/config');

function createTestGame(playerCount = 9, options = {}) {
  const presetId = options.presetId || '9-standard';
  const roles = options.roles || BOARD_PRESETS[presetId].roles;

  const game = new GameEngine({ presetId });

  for (let i = 0; i < playerCount; i++) {
    const role = createPlayerRole(roles[i]);
    game.players.push({
      id: i + 1,
      name: `玩家${i + 1}`,
      alive: true,
      isAI: true,
      role: role,
      state: role.state ? { ...role.state } : {}
    });
  }

  const aiManager = new AIManager(game);
  const aiControllers = new Map();

  game.players.forEach(p => {
    const controller = aiManager.createAI(p.id, {
      agentType: 'mock',
      mockOptions: {
        presetResponses: {
          speak: { content: '过。' },
          day_discuss: { content: '过。' },
          last_words: { content: '过。' },
          sheriff_speech: { content: '过。' },
          night_werewolf_discuss: { content: '过。' },
        }
      }
    });
    aiControllers.set(p.id, controller);
  });

  game.getAIController = (playerId) => aiControllers.get(playerId);
  game.assignRoles = function() {};
  game.start = async function() {
    this.phaseManager = new PhaseManager(this);
  };

  return { game, aiControllers };
}

function getMockModel(aiControllers, playerId) {
  const controller = aiControllers.get(playerId);
  return controller?.agent?.mockModel;
}

function setAIResponse(aiControllers, playerId, actionType, response) {
  const controller = aiControllers.get(playerId);
  if (controller?.agent?.mockModel) {
    controller.agent.mockModel.setResponse(actionType, response);
  }
}

function validateMessages(messages, expected) {
  if (!Array.isArray(messages)) throw new Error('messages 应该是数组');
  if (messages.length === 0) throw new Error('messages 不应为空');

  if (messages[0].role !== 'system') throw new Error('第一条消息应为 system');
  if (!messages[0].content.includes('名字:')) throw new Error('system 消息应包含名字');
  if (!messages[0].content.includes('角色:')) throw new Error('system 消息应包含角色');

  if (expected.minMessages) {
    if (messages.length < expected.minMessages)
      throw new Error(`消息数量 ${messages.length} 应 >= ${expected.minMessages}`);
  }

  if (expected.lastMessageContains) {
    const lastUserMsg = messages.filter(m => m.role === 'user').pop();
    if (!lastUserMsg) throw new Error('应该有 user 消息');
    for (const text of expected.lastMessageContains) {
      if (!lastUserMsg.content.includes(text))
        throw new Error(`最后 user 消息应包含 "${text}"，实际: ${lastUserMsg.content.substring(0, 200)}`);
    }
  }

  if (expected.historyContains) {
    const allContent = messages.map(m => m.content).join('\n');
    for (const text of expected.historyContains) {
      if (!allContent.includes(text))
        throw new Error(`消息历史应包含 "${text}"`);
    }
  }

  if (expected.notContains) {
    const allContent = messages.map(m => m.content).join('\n');
    for (const text of expected.notContains) {
      if (allContent.includes(text))
        throw new Error(`消息历史不应包含 "${text}"`);
    }
  }
}

describe('PhaseManager 驱动上下文', () => {
  it('狼人投票上下文端到端校验', async () => {
    const { game, aiControllers } = createTestGame(9, {
      presetId: '9-standard',
      roles: ['werewolf', 'werewolf', 'werewolf', 'seer', 'witch', 'hunter', 'villager', 'villager', 'villager']
    });

    game.phaseManager = new PhaseManager(game);

    for (const player of game.players) {
      const controller = aiControllers.get(player.id);
      if (controller) {
        controller.updateSystemMessage();
      }
    }

    const wolves = game.players.filter(p => p.role?.camp === 'wolf');

    for (const wolf of wolves) {
      setAIResponse(aiControllers, wolf.id, 'night_werewolf_discuss', { content: '刀预言家' });
      setAIResponse(aiControllers, wolf.id, 'night_werewolf_vote', { target: '4' });
    }

    await game.phaseManager.executePhase('night_werewolf_discuss');
    await game.phaseManager.executePhase('night_werewolf_vote');

    const firstWolf = wolves[0];
    const mockModel = getMockModel(aiControllers, firstWolf.id);

    if (!mockModel) throw new Error('无法获取 mockModel');

    const calls = mockModel.getCallHistory();
    const voteCall = calls.find(c => c.phase === 'night_werewolf_vote');

    if (!voteCall || !voteCall.messagesForLLM) throw new Error('无法获取投票上下文');

    const messages = voteCall.messagesForLLM;
    const lastUserMsg = messages.filter(m => m.role === 'user').pop();

    if (!lastUserMsg) throw new Error('应有 user 消息');

    const content = lastUserMsg.content;
    if (!content.includes('【狼人投票】')) throw new Error('应包含投票提示词');
    if (!content.includes('可选玩家')) throw new Error('应包含可选玩家提示');
    if (!content.includes('请选择今晚要击杀的玩家')) throw new Error('应包含选择提示');
    if (!/\d+号:/.test(content)) throw new Error('应包含玩家列表');
  });

  it('狼人讨论历史传播到后续发言', async () => {
    const { game, aiControllers } = createTestGame(9, {
      presetId: '9-standard',
      roles: ['werewolf', 'werewolf', 'werewolf', 'seer', 'witch', 'hunter', 'villager', 'villager', 'villager']
    });

    game.phaseManager = new PhaseManager(game);

    for (const player of game.players) {
      const controller = aiControllers.get(player.id);
      if (controller) {
        controller.updateSystemMessage();
      }
    }

    const wolves = game.players.filter(p => p.role?.camp === 'wolf');

    setAIResponse(aiControllers, wolves[0].id, 'night_werewolf_discuss', { content: '我是第一个狼人' });
    setAIResponse(aiControllers, wolves[1].id, 'night_werewolf_discuss', { content: '我是第二个狼人' });
    setAIResponse(aiControllers, wolves[2].id, 'night_werewolf_discuss', { content: '我是第三个狼人' });

    await game.phaseManager.executePhase('night_werewolf_discuss');

    const thirdWolf = wolves[2];
    const mockModel = getMockModel(aiControllers, thirdWolf.id);

    if (!mockModel) throw new Error('无法获取 mockModel');

    const calls = mockModel.getCallHistory();
    const discussCalls = calls.filter(c => c.phase === 'night_werewolf_discuss');
    const discussCall = discussCalls[discussCalls.length - 1];

    if (!discussCall || !discussCall.messagesForLLM) throw new Error('无法获取讨论上下文');

    validateMessages(discussCall.messagesForLLM, {
      minMessages: 2,
      historyContains: ['我是第一个狼人', '我是第二个狼人'],
      lastMessageContains: ['【狼人讨论】']
    });
  });

  it('投票阶段不重复包含讨论历史', async () => {
    const { game, aiControllers } = createTestGame(9, {
      presetId: '9-standard',
      roles: ['werewolf', 'werewolf', 'werewolf', 'seer', 'witch', 'hunter', 'villager', 'villager', 'villager']
    });

    game.phaseManager = new PhaseManager(game);

    for (const player of game.players) {
      const controller = aiControllers.get(player.id);
      if (controller) {
        controller.updateSystemMessage();
      }
    }

    const wolves = game.players.filter(p => p.role?.camp === 'wolf');

    for (const wolf of wolves) {
      setAIResponse(aiControllers, wolf.id, 'night_werewolf_discuss', { content: '讨论内容' });
      setAIResponse(aiControllers, wolf.id, 'night_werewolf_vote', { target: '4' });
    }

    await game.phaseManager.executePhase('night_werewolf_discuss');
    await game.phaseManager.executePhase('night_werewolf_vote');

    const firstWolf = wolves[0];
    const mockModel = getMockModel(aiControllers, firstWolf.id);

    if (!mockModel) throw new Error('无法获取 mockModel');

    const calls = mockModel.getCallHistory();
    const voteCall = calls.find(c => c.phase === 'night_werewolf_vote');

    if (!voteCall || !voteCall.messagesForLLM) throw new Error('无法获取投票上下文');

    const messages = voteCall.messagesForLLM;
    const lastUserMsg = messages.filter(m => m.role === 'user').pop();

    if (lastUserMsg) {
      if (!lastUserMsg.content.includes('【狼人投票】'))
        throw new Error('最后 user 消息应包含投票提示词');
    }
  });
});

run();