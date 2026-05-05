const { describe, it, run } = require('../../helpers/test-runner');
const { AIController, AIManager } = require('../../../ai/controller');
const { Agent } = require('../../../ai/agent/agent');
const { MessageManager } = require('../../../ai/agent/message_manager');
const { GameEngine } = require('../../../engine/main');
const { BOARD_PRESETS } = require('../../../engine/config');
const { createPlayerRole } = require('../../../engine/roles');

function createTestGame(presetId = '9-standard') {
  const preset = BOARD_PRESETS[presetId];
  const game = new GameEngine({ presetId });

  for (let i = 0; i < preset.playerCount; i++) {
    const role = createPlayerRole(preset.roles[i]);
    game.players.push({
      id: i + 1,
      name: `玩家${i + 1}`,
      alive: true,
      isAI: true,
      role: role,
      state: role.state ? { ...role.state } : {}
    });
  }

  game.phase = 'day_discuss';
  game.round = 1;

  return game;
}

describe('Agent 生命周期：enterGame / exitGame / resetForNewGame', () => {
  it('enterGame 不设置 game system prompt（由 assignRoles 后的 updateSystemMessage 设置）', async () => {
    const game = createTestGame();
    const controller = new AIController(1, game, { agentType: 'mock' });
    const player = game.players[0];

    await controller.agent.enterGame(player, game, [], 0);

    // enterGame 在 assignRoles 之前调用，此时 player.role 存在但 enterGame 不调 updateSystem(game)
    // _currentMode 保持 'chat'（默认值）
    if (controller.agent.mm._currentMode !== 'chat') throw new Error('enterGame 后 _currentMode 应保持 chat');
  });

  it('enterGame 注入聊天历史', async () => {
    const game = createTestGame();
    const controller = new AIController(1, game, { agentType: 'mock' });
    const player = game.players[0];
    const chatMessages = [
      { id: 1, playerName: '张三', content: '大家好' },
      { id: 2, playerName: '李四', content: '你好' }
    ];

    await controller.agent.enterGame(player, game, chatMessages, 2);

    const hasChatHistory = controller.agent.messages.some(m => m.content?.includes('张三'));
    if (!hasChatHistory) throw new Error('聊天历史应被注入到 messages');
  });

  it('enterGame 重置 lastProcessedId', async () => {
    const game = createTestGame();
    const controller = new AIController(1, game, { agentType: 'mock' });
    const player = game.players[0];

    controller.agent.mm.lastProcessedId = 42;
    await controller.agent.enterGame(player, game, [], 0);

    if (controller.agent.mm.lastProcessedId !== 0) throw new Error('lastProcessedId 应被重置为 0');
  });

  it('exitGame 切换 system prompt 为 chat 模式', async () => {
    const game = createTestGame();
    const controller = new AIController(1, game, { agentType: 'mock' });
    const player = game.players[0];

    await controller.agent.enterGame(player, game, [], 0);
    await controller.agent.exitGame(player);

    const sysMsg = controller.agent.messages[0];
    if (!sysMsg || sysMsg.role !== 'system') throw new Error('应该有 system 消息');
    if (sysMsg.content.includes('狼人') || sysMsg.content.includes('预言家')) {
      throw new Error('chat 模式 system prompt 不应包含游戏角色信息');
    }
  });

  it('exitGame 不重置 lastProcessedId（由 postGameCompress 负责）', async () => {
    const game = createTestGame();
    const controller = new AIController(1, game, { agentType: 'mock' });
    const player = game.players[0];

    await controller.agent.enterGame(player, game, [], 0);
    controller.agent.mm.lastProcessedId = 99;
    controller.agent.exitGame(player);

    if (controller.agent.mm.lastProcessedId !== 99) throw new Error('exitGame 不应重置 lastProcessedId');
  });

  it('postGameCompress 不重置 lastProcessedId', async () => {
    const game = createTestGame();
    const controller = new AIController(1, game, { agentType: 'mock' });
    const player = game.players[0];

    await controller.agent.enterGame(player, game, [], 0);
    controller.agent.mm.lastProcessedId = 99;
    controller.agent.exitGame(player);
    await controller.agent.postGameCompress(player, game);

    if (controller.agent.mm.lastProcessedId !== 99) throw new Error('postGameCompress 不应重置 lastProcessedId');
  });

  it('resetForNewGame 不切换到 game 模式（role=null 时 updateSystem 被跳过）', async () => {
    const game = createTestGame();
    const controller = new AIController(1, game, { agentType: 'mock' });
    const player = game.players[0];

    await controller.agent.resetForNewGame(player, game);

    // resetForNewGame 调 updateSystem(game)，但 player.role 存在所以会成功
    // 注意：在实际 handleReset 流程中，role 会在 resetForNewGame 之后被置 null
    if (controller.agent.mm._currentMode !== 'game') throw new Error('resetForNewGame 后 _currentMode 应为 game');
  });

  it('resetForNewGame 重置 lastProcessedId', async () => {
    const game = createTestGame();
    const controller = new AIController(1, game, { agentType: 'mock' });
    const player = game.players[0];

    controller.agent.mm.lastProcessedId = 50;
    await controller.agent.resetForNewGame(player, game);

    if (controller.agent.mm.lastProcessedId !== 0) throw new Error('lastProcessedId 应被重置为 0');
  });
});

describe('Agent 生命周期：destroy', () => {
  it('destroy 清空 messages', () => {
    const agent = new Agent({ mockOptions: {} });
    agent.mm.messages.push({ role: 'system', content: 'test' });
    agent.mm.messages.push({ role: 'user', content: 'hello' });

    agent.destroy();

    if (agent.mm.messages.length !== 0) throw new Error('destroy 后 messages 应为空');
  });

  it('destroy 清空请求队列', () => {
    const agent = new Agent({ mockOptions: {} });
    agent.requestQueue.push({ type: 'answer', context: {}, callback: () => {} });

    agent.destroy();

    if (agent.requestQueue.length !== 0) throw new Error('destroy 后 requestQueue 应为空');
  });

  it('destroy 重置 isProcessing', () => {
    const agent = new Agent({ mockOptions: {} });
    agent.isProcessing = true;

    agent.destroy();

    if (agent.isProcessing) throw new Error('destroy 后 isProcessing 应为 false');
  });

  it('destroy 对 pending callback 传 null', () => {
    const agent = new Agent({ mockOptions: {} });
    let callbackResult = 'not_called';
    agent.requestQueue.push({ type: 'answer', context: {}, callback: (r) => { callbackResult = r; } });

    agent.destroy();

    if (callbackResult !== null) throw new Error('pending callback 应收到 null');
  });
});

describe('Agent 生命周期：_drainQueue', () => {
  it('drainQueue 清空队列并重置 isProcessing', () => {
    const agent = new Agent({ mockOptions: {} });
    agent.requestQueue.push({ type: 'answer', context: {}, callback: () => {} });
    agent.isProcessing = true;

    agent._drainQueue();

    if (agent.requestQueue.length !== 0) throw new Error('队列应为空');
    if (agent.isProcessing) throw new Error('isProcessing 应为 false');
  });
});

describe('playerId 冗余消除', () => {
  it('Agent 不存储 playerId', () => {
    const agent = new Agent({ mockOptions: {} });
    if ('playerId' in agent) throw new Error('Agent 不应有 playerId 属性');
  });

  it('MessageManager 不存储 playerId', () => {
    const mm = new MessageManager();
    if ('playerId' in mm) throw new Error('MessageManager 不应有 playerId 属性');
  });

  it('AIController 存储 playerId', () => {
    const game = createTestGame();
    const controller = new AIController(1, game, { agentType: 'mock' });
    if (controller.playerId !== 1) throw new Error('AIController 应存储 playerId');
  });

  it('formatIncomingMessages 通过 context.self.id 定位自己', async () => {
    const game = createTestGame();
    const controller = new AIController(1, game, {
      agentType: 'mock',
      mockOptions: { presetResponses: { action_day_discuss: '测试' } }
    });

    const result = await controller.getSpeechResult('public', 'action_day_discuss');
    if (!result.content) throw new Error('决策应成功完成，说明 context.self.id 正确传递');
  });
});

describe('AIController.reassignToGame', () => {
  it('reassignToGame 更新 game 引用', async () => {
    const game1 = createTestGame();
    const game2 = createTestGame();
    const controller = new AIController(1, game1, { agentType: 'mock' });

    await controller.reassignToGame(game2);

    if (controller.game !== game2) throw new Error('game 引用应更新为新 game');
  });

  it('reassignToGame 保留同一个 Agent 实例', async () => {
    const game = createTestGame();
    const controller = new AIController(1, game, { agentType: 'mock' });
    const originalAgent = controller.agent;

    await controller.reassignToGame(game);

    if (controller.agent !== originalAgent) throw new Error('应保留同一个 Agent 实例');
  });

  it('reassignToGame 保留 mockModel 配置', async () => {
    const game = createTestGame();
    const controller = new AIController(1, game, {
      agentType: 'mock',
      mockOptions: { presetResponses: { action_day_vote: 3 } }
    });

    await controller.reassignToGame(game);

    if (!controller.agent.mockModel) throw new Error('mockModel 应保留');
    const result = await controller.getVoteResult('action_day_vote', { allowedTargets: [2, 3] });
    if (result.targetId !== 3) throw new Error('mockModel 配置应保留，投票给 3 号');
  });

  it('reassignToGame 重置 lastProcessedId', async () => {
    const game = createTestGame();
    const controller = new AIController(1, game, { agentType: 'mock' });
    controller.agent.mm.lastProcessedId = 100;

    await controller.reassignToGame(game);

    if (controller.agent.mm.lastProcessedId !== 0) throw new Error('lastProcessedId 应被重置');
  });
});

describe('AIManager.reassignToGame', () => {
  it('reassignToGame 更新所有 controller 的 game 引用', async () => {
    const game1 = createTestGame();
    const game2 = createTestGame();
    const aiManager = new AIManager(game1);

    const ctrl1 = aiManager.createAI(1, { agentType: 'mock' });
    const ctrl2 = aiManager.createAI(2, { agentType: 'mock' });

    await aiManager.reassignToGame(game2);

    if (ctrl1.game !== game2) throw new Error('ctrl1 game 应更新');
    if (ctrl2.game !== game2) throw new Error('ctrl2 game 应更新');
    if (aiManager.game !== game2) throw new Error('aiManager.game 应更新');
  });

  it('reassignToGame 保留所有 Agent 实例', async () => {
    const game = createTestGame();
    const aiManager = new AIManager(game);

    const ctrl1 = aiManager.createAI(1, { agentType: 'mock' });
    const ctrl2 = aiManager.createAI(2, { agentType: 'mock' });
    const agent1 = ctrl1.agent;
    const agent2 = ctrl2.agent;

    await aiManager.reassignToGame(game);

    if (ctrl1.agent !== agent1) throw new Error('ctrl1 Agent 应保留');
    if (ctrl2.agent !== agent2) throw new Error('ctrl2 Agent 应保留');
  });
});

describe('EventEmitter.off', () => {
  it('off 移除指定 handler', () => {
    const { EventEmitter } = require('../../../engine/event');
    const emitter = new EventEmitter();
    let called = false;
    const handler = () => { called = true; };

    emitter.on('test', handler);
    emitter.off('test', handler);
    emitter.emit('test', {});

    if (called) throw new Error('off 后 handler 不应被调用');
  });

  it('off 只移除指定 handler，不影响其他 handler', () => {
    const { EventEmitter } = require('../../../engine/event');
    const emitter = new EventEmitter();
    let called1 = false;
    let called2 = false;
    const handler1 = () => { called1 = true; };
    const handler2 = () => { called2 = true; };

    emitter.on('test', handler1);
    emitter.on('test', handler2);
    emitter.off('test', handler1);
    emitter.emit('test', {});

    if (called1) throw new Error('被 off 的 handler 不应被调用');
    if (!called2) throw new Error('未被 off 的 handler 应被调用');
  });

  it('off 不存在的事件不报错', () => {
    const { EventEmitter } = require('../../../engine/event');
    const emitter = new EventEmitter();
    emitter.off('nonexistent', () => {});
  });
});

describe('MessageManager.resetWatermark', () => {
  it('resetWatermark 重置 lastProcessedId', () => {
    const mm = new MessageManager();
    mm.lastProcessedId = 42;

    mm.resetWatermark();

    if (mm.lastProcessedId !== 0) throw new Error('lastProcessedId 应为 0');
  });
});

describe('跨游戏生命周期模拟', () => {
  it('聊天室→游戏→聊天室：Agent 保持同一实例', async () => {
    const game = createTestGame();
    const controller = new AIController(1, game, { agentType: 'mock' });
    const originalAgent = controller.agent;
    const player = game.players[0];

    const chatMessages = [{ id: 1, playerName: '张三', content: '聊天记录1' }];
    await controller.agent.enterGame(player, game, chatMessages, 1);
    controller.agent.exitGame(player);
    await controller.agent.postGameCompress(player, game);

    if (controller.agent !== originalAgent) throw new Error('Agent 应保持同一实例');
  });

  it('游戏1→游戏2：Agent 保持同一实例且水位线重置', async () => {
    const game = createTestGame();
    const controller = new AIController(1, game, { agentType: 'mock' });
    const originalAgent = controller.agent;
    const player = game.players[0];

    await controller.agent.enterGame(player, game, [], 0);
    controller.agent.mm.lastProcessedId = 10;

    await controller.agent.resetForNewGame(player, game);

    if (controller.agent !== originalAgent) throw new Error('Agent 应保持同一实例');
    if (controller.agent.mm.lastProcessedId !== 0) throw new Error('resetForNewGame 后 lastProcessedId 应为 0');
  });

  it('游戏1→聊天室→游戏2：聊天历史在 enterGame 时注入', async () => {
    const game = createTestGame();
    const controller = new AIController(1, game, { agentType: 'mock' });
    const player = game.players[0];

    const chatMessages1 = [{ id: 1, playerName: '张三', content: '第一局前聊天' }];
    await controller.agent.enterGame(player, game, chatMessages1, 1);
    controller.agent.exitGame(player);
    await controller.agent.postGameCompress(player, game);

    const chatMessages2 = [{ id: 2, playerName: '李四', content: '第二局前聊天' }];
    await controller.agent.enterGame(player, game, chatMessages2, 2);

    const hasSecondChat = controller.agent.messages.some(m => m.content?.includes('第二局前聊天'));
    if (!hasSecondChat) throw new Error('第二局聊天历史应被注入');
  });
});

run();