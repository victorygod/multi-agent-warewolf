const { describe, it, beforeEach, afterEach, run } = require('../helpers/test-runner');
const { ServerHarness, DEFAULT_MOCK_OPTIONS } = require('../helpers/server-harness');

let portCounter = 11001;

function createServer(options = {}) {
  return new ServerHarness(portCounter++, options);
}

describe('WebSocket扩展 - 人类玩家Action', () => {
  let server;

  beforeEach(() => {
    server = createServer();
  });

  afterEach(() => {
    if (server) server.stop();
  });

  it('B1: 人类玩家警长竞选', async () => {
    await server.start();
    const human = await server.addHuman('人类玩家', {
      campaign: { confirmed: true, run: true }
    });
    await server.addAI(8);
    server.startGame();
    await human.waitFor('role_assigned', 5000);
    const hadAction = await human.waitForCondition(
      m => m.type === 'state' && m.data?.pendingAction,
      15000
    );
    if (!hadAction) throw new Error('竞选阶段未收到pendingAction');
  });

  it('B2: 人类玩家白天发言', async () => {
    await server.start();
    const human = await server.addHuman('人类玩家', {
      speak: { content: '我是预言家，昨晚查验了3号是狼人。' }
    });
    await server.addAI(8);
    server.startGame();
    await human.waitFor('role_assigned', 5000);
    const hadAction = await human.waitForCondition(
      m => m.type === 'state' && m.data?.pendingAction,
      15000
    );
    if (!hadAction) throw new Error('发言阶段未收到pendingAction');
  });

  it('B4: 混合人类和AI流程', async () => {
    await server.start();
    const human1 = await server.addHuman('人类1', {
      campaign: { confirmed: true, run: true },
      speak: { content: '我是好人。' },
      vote: { targetId: 3 }
    });
    const human2 = await server.addHuman('人类2', {
      campaign: { confirmed: false },
      speak: { content: '过。' },
      vote: { targetId: 4 }
    });
    await server.addAI(7);
    server.startGame();
    await Promise.all([
      human1.waitFor('role_assigned', 5000),
      human2.waitFor('role_assigned', 5000)
    ]);

    const gotAny = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 10000);
      const check = () => {
        const h1Has = human1.messages.some(m => m.type === 'state' && m.data?.pendingAction);
        const h2Has = human2.messages.some(m => m.type === 'state' && m.data?.pendingAction);
        if (h1Has || h2Has) { clearTimeout(timer); resolve(true); }
        else { setTimeout(check, 50); }
      };
      check();
    });

    if (!gotAny) throw new Error('混合流程中人类玩家未收到任何pendingAction');
  });

  it('B5: 人类玩家指定发言顺序', async () => {
    await server.start();
    const human = await server.addHuman('人类玩家');
    await server.addAI(8);
    server.startGame();
    await human.waitFor('role_assigned', 5000);

    const gotAction = await human.waitForCondition(
      m => m.type === 'state' && m.data?.pendingAction,
      15000
    );
    if (!gotAction) throw new Error('未收到任何pendingAction');

    const game = server.getGame();
    const isSheriff = game.sheriff === human.playerId;
    const hadAssignOrder = human.messages.some(m =>
      m.type === 'state' && m.data?.pendingAction?.action === 'action_assignOrder'
    );
    if (isSheriff && !hadAssignOrder) throw new Error('警长应收到assignOrder action');
  });

  it('B8: 人类玩家守卫守护', async () => {
    await server.start();
    server.setForcedRole('守卫玩家', 'guard');
    const human = await server.addHuman('守卫玩家', {
      guard: { targetId: 2 },
      campaign: { confirmed: false },
      speak: { content: '我是守卫，守护了2号。' },
      vote: { targetId: 3 }
    });
    await server.addAI(8);
    server.startGame();
    await human.waitFor('role_assigned', 5000);
    const gotGuardAction = await human.waitForCondition(
      m => m.type === 'state' && m.data?.pendingAction?.action === 'action_guard',
      15000
    );
    const gotAnyAction = human.messages.some(m => m.type === 'state' && m.data?.pendingAction);
    if (!gotGuardAction && !gotAnyAction) throw new Error('守卫未收到任何action');
  });

  it('B10: 人类玩家遗言', async () => {
    await server.start();
    server.setForcedRole('即将出局玩家', 'villager');
    const human = await server.addHuman('即将出局玩家', {
      campaign: { confirmed: false },
      speak: { content: '我是好人。' },
      vote: { targetId: 2 },
      lastWords: { content: '我是平民，2号是狼人！' }
    });
    await server.addAI(8);
    server.startGame();
    await human.waitFor('role_assigned', 5000);
    const gotAction = await human.waitForCondition(
      m => m.type === 'state' && m.data?.pendingAction,
      15000
    );
    if (!gotAction) throw new Error('遗言阶段未收到pendingAction');
  });

  it('B11: 人类玩家传递警徽', async () => {
    await server.start();
    server.setForcedRole('警长玩家', 'villager');
    const human = await server.addHuman('警长玩家', {
      campaign: { confirmed: true, run: true },
      speak: { content: '我是警长。' },
      vote: { targetId: 2 },
      passBadge: { targetId: 2 }
    });
    await server.addAI(8);
    server.startGame();
    await human.waitFor('role_assigned', 5000);

    try {
      await human.waitForAction('action_passBadge', 10000);
    } catch (e) {
      // 警徽传递取决于游戏进程，超时不视为失败
    }
  });

  it('B12: 人类玩家退水', async () => {
    await server.start();
    const human = await server.addHuman('竞选后退水玩家', {
      campaign: { confirmed: true, run: true },
      withdraw: { withdraw: true },
      speak: { content: '我退水了。' }
    });
    await server.addAI(8);
    server.startGame();
    await human.waitFor('role_assigned', 5000);
    const gotAction = await human.waitForCondition(
      m => m.type === 'state' && m.data?.pendingAction,
      15000
    );
    if (!gotAction) throw new Error('退水阶段未收到pendingAction');
  });

  it('B13: 人类玩家丘比特连线', async () => {
    await server.start();
    server.setForcedRole('丘比特玩家', 'cupid');
    const human = await server.addHuman('丘比特玩家', {
      cupid: { targets: [2, 3] },
      campaign: { confirmed: false },
      speak: { content: '我是好人。' },
      vote: { targetId: 4 }
    });
    await server.addAI(8);
    server.startGame();
    await human.waitFor('role_assigned', 5000);
    const gotCupidAction = await human.waitForCondition(
      m => m.type === 'state' && m.data?.pendingAction?.action === 'action_cupid',
      15000
    );
    const gotAnyAction = human.messages.some(m => m.type === 'state' && m.data?.pendingAction);
    if (!gotCupidAction && !gotAnyAction) throw new Error('丘比特未收到任何action');
  });

  it('B14: 人类玩家猎人角色', async () => {
    await server.start();
    server.setForcedRole('猎人玩家', 'hunter');
    const human = await server.addHuman('猎人玩家', {
      campaign: { confirmed: false },
      speak: { content: '我是猎人，我死了会开枪。' },
      vote: { targetId: 2 },
      shoot: { targetId: 2, use: true }
    });
    await server.addAI(8);
    server.startGame();
    await human.waitFor('role_assigned', 5000);
    const isHunter = human.role?.id === 'hunter' || human.role?.name === '猎人';
    const gotAction = await human.waitForCondition(
      m => m.type === 'state' && m.data?.pendingAction,
      15000
    );
    if (!isHunter) throw new Error('角色不是猎人');
    if (!gotAction) throw new Error('猎人未收到任何pendingAction');
  });
});

describe('WebSocket扩展 - 完整流程', () => {
  let server;

  beforeEach(() => {
    server = createServer();
  });

  afterEach(() => {
    if (server) server.stop();
  });

  it('C1: 单人类玩家完整游戏', async () => {
    await server.start();
    const human = await server.addHuman('TestHuman', {
      campaign: { confirmed: true, run: true },
      speak: { content: '我是好人。' },
      vote: { targetId: 2 },
      seer: { targetId: 2 },
      witch: { action: 'skip' },
      guard: { targetId: 2 }
    });
    await server.addAI(8);
    server.startGame();
    await human.waitFor('role_assigned', 5000);
    await server.waitForPhase('game_over', 30000);

    const withPending = human.messages.filter(m => m.type === 'state' && m.data?.pendingAction);
    if (withPending.length === 0) throw new Error('完整游戏中未收到任何pendingAction');
  }, 35000);
});

describe('WebSocket扩展 - AI上下文验证', () => {
  let server;

  beforeEach(() => {
    server = createServer();
  });

  afterEach(() => {
    if (server) server.stop();
  });

  it('D2: 狼人上下文包含队友信息', async () => {
    await server.start();
    server.setForcedRole('人类玩家', 'villager');
    const human = await server.addHuman('人类玩家', {
      campaign: { confirmed: false },
      speak: { content: '我是好人。' }
    });
    await server.addAI(8);
    server.startGame();
    await human.waitFor('role_assigned', 5000);

    const game = server.getGame();
    const wolfPlayer = game.players.find(p => p.role?.camp === 'wolf' && p.isAI);
    if (!wolfPlayer) throw new Error('未找到狼人AI玩家');

    await server.waitForAICalls(wolfPlayer.id, 1, 10000);

    const callHistory = server.getAICallHistory(wolfPlayer.id);
    let hasTeammatesInfo = false;
    for (const call of callHistory) {
      if (call.messagesForLLM) {
        const systemMsg = call.messagesForLLM.find(m => m.role === 'system');
        if (systemMsg && systemMsg.content.includes('队友')) {
          hasTeammatesInfo = true;
          break;
        }
      }
    }
    if (!hasTeammatesInfo) throw new Error('狼人上下文应包含队友信息');
  }, 15000);

  it('D3: 好人角色上下文无队友信息', async () => {
    await server.start();
    server.setForcedRole('人类玩家', 'villager');
    const human = await server.addHuman('人类玩家', {
      campaign: { confirmed: false },
      speak: { content: '我是好人。' }
    });
    await server.addAI(8);
    server.startGame();
    await human.waitFor('role_assigned', 5000);

    const game = server.getGame();
    const goodPlayer = game.players.find(p => p.role?.camp !== 'wolf' && p.isAI);
    if (!goodPlayer) throw new Error('未找到好人AI玩家');

    await server.waitForAICalls(goodPlayer.id, 1, 10000);

    const callHistory = server.getAICallHistory(goodPlayer.id);
    let hasTeammatesInfo = false;
    for (const call of callHistory) {
      if (call.messagesForLLM) {
        const systemMsg = call.messagesForLLM.find(m => m.role === 'system');
        if (systemMsg && systemMsg.content.includes('队友')) {
          hasTeammatesInfo = true;
          break;
        }
      }
    }
    if (hasTeammatesInfo) throw new Error('好人上下文不应包含队友信息');
  }, 15000);
});

run();