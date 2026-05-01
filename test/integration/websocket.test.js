const { describe, it, beforeEach, afterEach, run } = require('../helpers/test-runner');
const { ServerHarness, DEFAULT_MOCK_OPTIONS } = require('../helpers/server-harness');

let portCounter = 10001;

function createServer(options = {}) {
  return new ServerHarness(portCounter++, options);
}

describe('WebSocket集成 - 基础连接', () => {
  let server;

  beforeEach(() => {
    server = createServer();
  });

  afterEach(() => {
    if (server) server.stop();
  });

  it('A1: assignRoles分配角色', async () => {
    await server.start();
    const humans = [];
    for (let i = 0; i < 9; i++) {
      humans.push(await server.addHuman(`玩家${i + 1}`));
    }
    server.startGame();
    await Promise.all(humans.map(h => h.waitFor('role_assigned', 3000)));
    const game = server.getGame();
    const roles = game.players.map(p => p.role?.name);
    const hasWolf = roles.some(r => r === '狼人');
    const hasSeer = roles.some(r => r === '预言家');
    const hasWitch = roles.some(r => r === '女巫');
    if (!hasWolf || !hasSeer || !hasWitch) throw new Error('角色分配不完整');
  });

  it('A2: 混合AI和人类玩家', async () => {
    await server.start();
    const human1 = await server.addHuman('人类1');
    const human2 = await server.addHuman('人类2');
    const human3 = await server.addHuman('人类3');
    await server.addAI(6);
    server.startGame();
    await Promise.all([
      human1.waitFor('role_assigned', 3000),
      human2.waitFor('role_assigned', 3000),
      human3.waitFor('role_assigned', 3000)
    ]);
    const game = server.getGame();
    const humanCount = game.players.filter(p => !p.isAI).length;
    const aiCount = game.players.filter(p => p.isAI).length;
    if (humanCount !== 3) throw new Error(`人类玩家应为3，实际${humanCount}`);
    if (aiCount !== 6) throw new Error(`AI玩家应为6，实际${aiCount}`);
    if (!game.players.every(p => p.role)) throw new Error('有玩家未分配角色');
  });
});

describe('WebSocket集成 - 人类玩家Action', () => {
  let server;

  beforeEach(() => {
    server = createServer();
  });

  afterEach(() => {
    if (server) server.stop();
  });

  it('B3: 人类玩家收到pendingAction', async () => {
    await server.start();
    const human = await server.addHuman('人类玩家');
    await server.addAI(8);
    server.startGame();
    await human.waitFor('role_assigned', 3000);
    const hadAction = await human.waitForCondition(
      m => m.type === 'state' && m.data?.pendingAction,
      5000
    );
    if (!hadAction) throw new Error('未收到任何pendingAction');
  });

  it('B6: 人类预言家收到查验action', async () => {
    await server.start();
    server.setForcedRole('人类玩家', 'seer');
    const human = await server.addHuman('人类玩家');
    await server.addAI(8);
    server.startGame();
    await human.waitFor('role_assigned', 3000);
    const gotSeerAction = await human.waitForCondition(
      m => m.type === 'state' && m.data?.pendingAction?.action === 'action_seer',
      5000
    );
    if (!gotSeerAction) throw new Error('预言家未收到查验action');
  });

  it('B7: 人类女巫收到用药action', async () => {
    await server.start();
    server.setForcedRole('人类玩家', 'witch');
    const human = await server.addHuman('人类玩家');
    await server.addAI(8);
    server.startGame();
    await human.waitFor('role_assigned', 3000);
    const gotAction = await human.waitForCondition(
      m => m.type === 'state' && m.data?.pendingAction,
      5000
    );
    if (!gotAction) {
      const game = server.getGame();
      const phase = game?.phaseManager?.getCurrentPhase()?.id;
      throw new Error(`女巫未收到任何action，当前阶段: ${phase}`);
    }
    const gotWitchAction = human.messages.some(
      m => m.type === 'state' && m.data?.pendingAction?.action === 'action_witch'
    );
    if (!gotWitchAction) {
      const actions = human.messages
        .filter(m => m.type === 'state' && m.data?.pendingAction)
        .map(m => m.data.pendingAction.action);
      throw new Error(`女巫未收到witch action，收到的action: ${actions.join(', ')}`);
    }
  });

  it('B9: 人类狼人收到夜间投票action', async () => {
    await server.start();
    server.setForcedRole('人类玩家', 'werewolf');
    const human = await server.addHuman('人类玩家');
    await server.addAI(8);
    server.startGame();
    await human.waitFor('role_assigned', 3000);
    const gotWolfAction = await human.waitForCondition(
      m => m.type === 'state' && m.data?.pendingAction?.action === 'action_night_werewolf_vote',
      5000
    );
    if (!gotWolfAction) throw new Error('狼人未收到夜间投票action');
  });
});

describe('WebSocket集成 - AI决策', () => {
  let server;

  beforeEach(() => {
    server = createServer();
  });

  afterEach(() => {
    if (server) server.stop();
  });

  it('D1: AI收到action并决策', async () => {
    await server.start();
    const human = await server.addHuman('人类玩家', {
      campaign: { confirmed: false },
      speak: { content: '过。' },
      vote: { targetId: 2 },
      witch: { action: 'skip' },
      seer: { targetId: 2 },
      guard: { targetId: 2 }
    });
    await server.addAI(8);
    server.startGame();
    await human.waitFor('role_assigned', 3000);
    const game = server.getGame();
    const aiPlayers = game.players.filter(p => p.isAI);
    if (aiPlayers.length === 0) throw new Error('未找到AI玩家');
    const aiWithModel = aiPlayers.find(p => server.getAIMockModel(p.id));
    if (!aiWithModel) throw new Error('AI无mockModel');
    const mockModel = server.getAIMockModel(aiWithModel.id);
    if (mockModel.getCallHistory().length >= 1) return;
    await server.waitForAICalls(aiWithModel.id, 1, 5000);
  });
});

run();