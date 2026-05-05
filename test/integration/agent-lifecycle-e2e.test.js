const { describe, it, beforeEach, afterEach, run } = require('../helpers/test-runner');
const { ServerHarness, DEFAULT_MOCK_OPTIONS } = require('../helpers/server-harness');

let portCounter = 12001;

function createServer(options = {}) {
  return new ServerHarness(portCounter++, options);
}

describe('Agent 生命周期集成测试', () => {
  let server;

  beforeEach(() => {
    server = createServer();
  });

  afterEach(() => {
    if (server) server.stop();
  });

  it('L1: 游戏结束后 Agent 保持同一实例', async () => {
    await server.start();
    const human = await server.addHuman('人类玩家', {
      speak: { content: '过。' },
      vote: { targetId: 2 },
      witch: { action: 'skip' },
      campaign: { confirmed: true, run: true }
    });
    await server.addAI(8);

    const controller = server.core.aiManager.controllers.values().next().value;
    const originalAgent = controller.agent;

    server.startGame();
    await server.waitForPhase('game_over', 30000);

    if (controller.agent !== originalAgent) {
      throw new Error('游戏结束后 Agent 应保持同一实例');
    }
  });

  it('L2: 游戏结束后 Agent 切换到 chat 模式', async () => {
    await server.start();
    const human = await server.addHuman('人类玩家', {
      speak: { content: '过。' },
      vote: { targetId: 2 },
      witch: { action: 'skip' },
      campaign: { confirmed: true, run: true }
    });
    await server.addAI(8);

    server.startGame();
    await server.waitForPhase('game_over', 30000);

    await new Promise(resolve => setTimeout(resolve, 500));

    const controller = server.core.aiManager.controllers.values().next().value;
    const sysMsg = controller.agent.messages[0];
    if (!sysMsg || sysMsg.role !== 'system') throw new Error('应有 system 消息');
    if (sysMsg.content.includes('狼人杀游戏')) {
      throw new Error('游戏结束后 system prompt 应为 chat 模式，不应包含游戏角色信息');
    }
  });

  it('L3: handleReset 保留 Agent 且重置水位线', async () => {
    await server.start();
    const human = await server.addHuman('人类玩家', {
      speak: { content: '过。' },
      vote: { targetId: 2 },
      witch: { action: 'skip' },
      campaign: { confirmed: true, run: true }
    });
    await server.addAI(8);

    server.startGame();
    await server.waitForPhase('game_over', 30000);
    await new Promise(resolve => setTimeout(resolve, 500));

    const controller = server.core.aiManager.controllers.values().next().value;
    const originalAgent = controller.agent;
    const playerIdBefore = controller.playerId;

    await server.core.handleReset({}, {});

    const controllerAfter = server.core.aiManager.controllers.values().next().value;
    if (!controllerAfter) throw new Error('reset 后应有 controller');
    if (controllerAfter.agent !== originalAgent) throw new Error('reset 后 Agent 应保持同一实例');
    if (controllerAfter.agent.lastProcessedId !== 0) throw new Error('reset 后 lastProcessedId 应为 0');
  });

  it('L4: handleReset 保留 mockModel 配置', async () => {
    await server.start();
    const human = await server.addHuman('人类玩家', {
      speak: { content: '过。' },
      vote: { targetId: 2 },
      witch: { action: 'skip' },
      campaign: { confirmed: true, run: true }
    });
    await server.addAI(8);

    server.startGame();
    await server.waitForPhase('game_over', 30000);
    await new Promise(resolve => setTimeout(resolve, 500));

    const controllerBefore = server.core.aiManager.controllers.values().next().value;
    if (!controllerBefore.agent.mockModel) throw new Error('应有 mockModel');

    await server.core.handleReset({}, {});

    const controllerAfter = server.core.aiManager.controllers.values().next().value;
    if (!controllerAfter.agent.mockModel) throw new Error('reset 后 mockModel 应保留');
  });

  it('L5: startGame 时 enterGame 注入聊天历史', async () => {
    await server.start();
    const human = await server.addHuman('人类玩家', {
      speak: { content: '过。' },
      vote: { targetId: 2 },
      witch: { action: 'skip' },
      campaign: { confirmed: true, run: true }
    });
    await server.addAI(8);

    server.core.chatMessages.push({
      id: 1,
      type: 'chat',
      playerId: 'spectator_1',
      playerName: '旁观者',
      content: '大家好',
      timestamp: Date.now(),
      event: 'waiting'
    });
    server.core.displayMessages.push({
      id: 1, source: 'chat', displayId: 1,
      type: 'chat', playerId: 'spectator_1',
      playerName: '旁观者', content: '大家好',
      timestamp: Date.now(), event: 'waiting'
    });

    server.startGame();
    await human.waitFor('role_assigned', 5000);

    const controller = server.core.aiManager.controllers.values().next().value;
    const hasChatHistory = controller.agent.messages.some(
      m => m.content?.includes('旁观者') || m.content?.includes('大家好')
    );
    if (!hasChatHistory) throw new Error('startGame 后 Agent 应包含聊天历史');
  });

  it('L6: removeAI 调用 destroy', async () => {
    await server.start();
    await server.addAI(3);

    const aiPlayer = server.core.game.players.find(p => p.isAI);
    const controllerBefore = server.core.aiManager.get(aiPlayer.id);
    if (!controllerBefore) throw new Error('应有 AI controller');

    server.core.handleRemoveAI({}, { playerId: aiPlayer.id });

    const controllerAfter = server.core.aiManager.get(aiPlayer.id);
    if (controllerAfter) throw new Error('removeAI 后 controller 应被移除');
  });

  it('L7: 完整生命周期 聊天→游戏→重置→游戏', async () => {
    await server.start();
    const human = await server.addHuman('人类玩家', {
      speak: { content: '过。' },
      vote: { targetId: 2 },
      witch: { action: 'skip' },
      campaign: { confirmed: true, run: true }
    });
    await server.addAI(8);

    const controller = server.core.aiManager.controllers.values().next().value;
    const originalAgent = controller.agent;

    server.core.chatMessages.push({
      id: 1, type: 'chat', playerId: 'spectator_1',
      playerName: '路人', content: '第一局前聊天', timestamp: Date.now(), event: 'waiting'
    });
    server.core.displayMessages.push({
      id: 1, source: 'chat', displayId: 1,
      type: 'chat', playerId: 'spectator_1',
      playerName: '路人', content: '第一局前聊天',
      timestamp: Date.now(), event: 'waiting'
    });

    server.startGame();
    await server.waitForPhase('game_over', 30000);
    await new Promise(resolve => setTimeout(resolve, 500));

    if (controller.agent !== originalAgent) throw new Error('第一局后 Agent 应保持同一实例');

    await server.core.handleReset({}, {});

    if (controller.agent !== originalAgent) throw new Error('reset 后 Agent 应保持同一实例');

    server.core.chatMessages.push({
      id: 2, type: 'chat', playerId: 'spectator_1',
      playerName: '路人', content: '第二局前聊天', timestamp: Date.now(), event: 'waiting'
    });
    server.core.displayMessages.push({
      id: 2, source: 'chat', displayId: 2,
      type: 'chat', playerId: 'spectator_1',
      playerName: '路人', content: '第二局前聊天',
      timestamp: Date.now(), event: 'waiting'
    });

    server.startGame();
    await human.waitFor('role_assigned', 5000);

    if (controller.agent !== originalAgent) throw new Error('第二局开始后 Agent 应保持同一实例');
    if (controller.agent.lastProcessedId !== 0) throw new Error('第二局开始后 lastProcessedId 应为 0');
  });
});

run();