const { describe, it, beforeEach, afterEach, run } = require('../helpers/test-runner');
const { ServerHarness, DEFAULT_MOCK_OPTIONS } = require('../helpers/server-harness');

let portCounter = 12001;

function createServer() {
  return new ServerHarness(portCounter++, { mockOptions: DEFAULT_MOCK_OPTIONS });
}

describe('AI上下文E2E - system prompt', () => {
  let server;

  beforeEach(() => {
    server = createServer();
  });

  afterEach(() => {
    if (server) server.stop();
  });

  it('E1: 狼人system prompt含角色名', async () => {
    await server.start();
    server.setForcedRole('人类玩家', 'hunter');
    const human = await server.addHuman('人类玩家', {
      campaign: { confirmed: false },
      speak: { content: '过。' }
    });
    await server.addAI(8);
    server.startGame();
    await human.waitFor('role_assigned', 3000);

    const game = server.getGame();
    const wolf = game.players.find(p => p.role?.camp === 'wolf' && p.isAI);
    if (!wolf) return;

    await server.waitForAICalls(wolf.id, 1, 5000);
    const messages = server.getAILastMessages(wolf.id);
    if (!messages || messages.length === 0) throw new Error('狼人AI未收到消息');
    const systemMsg = messages.find(m => m.role === 'system');
    if (!systemMsg) throw new Error('无system消息');
    if (!systemMsg.content.includes('狼人')) throw new Error('system prompt应包含角色名');
    if (!systemMsg.content.includes('队友')) throw new Error('狼人system prompt应包含队友信息');
  }, 10000);

  it('E2: 好人system prompt不含队友', async () => {
    await server.start();
    server.setForcedRole('人类玩家', 'hunter');
    const human = await server.addHuman('人类玩家', {
      campaign: { confirmed: false },
      speak: { content: '过。' }
    });
    await server.addAI(8);
    server.startGame();
    await human.waitFor('role_assigned', 3000);

    const game = server.getGame();
    const seer = game.players.find(p => p.role?.id === 'seer' && p.isAI);
    if (!seer) return;

    await server.waitForAICalls(seer.id, 1, 5000);
    const messages = server.getAILastMessages(seer.id);
    if (!messages || messages.length === 0) throw new Error('预言家AI未收到消息');
    const systemMsg = messages.find(m => m.role === 'system');
    if (!systemMsg) throw new Error('无system消息');
    if (/队友[:：]/.test(systemMsg.content)) throw new Error('好人system prompt不应包含队友信息（队友:xxx格式）');
  }, 10000);

  it('E3: 预言家messagesForLLM包含查验阶段信息', async () => {
    await server.start();
    server.setForcedRole('人类玩家', 'werewolf');
    const human = await server.addHuman('人类玩家', {
      campaign: { confirmed: false },
      speak: { content: '过。' }
    });
    await server.addAI(8);
    server.startGame();
    await human.waitFor('role_assigned', 3000);

    const game = server.getGame();
    const seer = game.players.find(p => p.role?.id === 'seer' && p.isAI);
    if (!seer) return;

    await server.waitForAICalls(seer.id, 1, 5000);
    const callHistory = server.getAICallHistory(seer.id);
    const seerCall = callHistory.find(c => c.phase === 'seer');
    if (!seerCall) throw new Error('未找到预言家查验阶段调用');

    const messages = seerCall.messagesForLLM;
    if (!messages || messages.length === 0) throw new Error('预言家messagesForLLM为空');

    const systemMsg = messages.find(m => m.role === 'system');
    if (!systemMsg) throw new Error('无system消息');
    if (!systemMsg.content.includes('预言家')) throw new Error('system prompt应包含预言家角色名');
    if (/队友[:：]/.test(systemMsg.content)) throw new Error('预言家system prompt不应包含队友信息（队友:xxx格式）');

    const userMsg = messages.find(m => m.role === 'user');
    if (!userMsg) throw new Error('无user消息');
    if (!userMsg.content.includes('【预言家】')) throw new Error('user message应包含【预言家】阶段标记');
    if (!userMsg.content.includes('可选玩家')) throw new Error('user message应包含可选玩家列表');
  }, 10000);

  it('E3b: 预言家查验结果消息格式正确', async () => {
    await server.start();
    server.setForcedRole('人类玩家', 'werewolf');
    const human = await server.addHuman('人类玩家', {
      campaign: { confirmed: false },
      speak: { content: '过。' }
    });
    await server.addAI(8);
    server.startGame();
    await human.waitFor('role_assigned', 3000);

    const game = server.getGame();
    const seer = game.players.find(p => p.role?.id === 'seer' && p.isAI);
    if (!seer) return;

    // 等待预言家查验阶段
    await server.waitForAICalls(seer.id, 1, 5000);

    // 检查游戏消息中的查验结果
    const checkResultMsg = game.message.messages.find(m =>
      m.content && m.content.includes('查验') && m.content.includes('=')
    );
    if (!checkResultMsg) throw new Error('未找到查验结果消息');

    // 验证查验结果格式正确，不应包含 {result} 占位符
    if (checkResultMsg.content.includes('{result}')) {
      throw new Error('查验结果不应显示占位符 {result}');
    }
    // 应该包含 "狼人" 或 "好人"
    if (!checkResultMsg.content.includes('狼人') && !checkResultMsg.content.includes('好人')) {
      throw new Error('查验结果应包含 "狼人" 或 "好人"');
    }
  }, 10000);

  it('E4: 女巫messagesForLLM包含药水状态', async () => {
    await server.start();
    server.setForcedRole('人类玩家', 'werewolf');
    const human = await server.addHuman('人类玩家', {
      campaign: { confirmed: false },
      speak: { content: '过。' }
    });
    await server.addAI(8);
    server.startGame();
    await human.waitFor('role_assigned', 3000);

    const game = server.getGame();
    const witch = game.players.find(p => p.role?.id === 'witch' && p.isAI);
    if (!witch) return;

    await server.waitForAICalls(witch.id, 1, 5000);
    const callHistory = server.getAICallHistory(witch.id);
    const witchCall = callHistory.find(c => c.phase === 'witch');
    if (!witchCall) throw new Error('未找到女巫阶段调用');

    const messages = witchCall.messagesForLLM;
    if (!messages || messages.length === 0) throw new Error('女巫messagesForLLM为空');

    const systemMsg = messages.find(m => m.role === 'system');
    if (!systemMsg) throw new Error('无system消息');
    if (!systemMsg.content.includes('女巫')) throw new Error('system prompt应包含女巫角色名');

    const userMsg = messages.find(m => m.role === 'user');
    if (!userMsg) throw new Error('无user消息');
    if (!userMsg.content.includes('【女巫】')) throw new Error('user message应包含【女巫】阶段标记');
    if (!userMsg.content.includes('被狼人杀害')) throw new Error('user message应包含被狼人杀害信息');

    const hasHealInfo = userMsg.content.includes('解药');
    const hasPoisonInfo = userMsg.content.includes('毒药');
    if (!hasHealInfo || !hasPoisonInfo) throw new Error('user message应包含解药和毒药状态');
  }, 10000);

  it('E5: 狼人夜间messagesForLLM包含队友和阶段标记', async () => {
    await server.start();
    server.setForcedRole('人类玩家', 'seer');
    const human = await server.addHuman('人类玩家', {
      campaign: { confirmed: false },
      speak: { content: '过。' }
    });
    await server.addAI(8);
    server.startGame();
    await human.waitFor('role_assigned', 3000);

    const game = server.getGame();
    const wolf = game.players.find(p => p.role?.camp === 'wolf' && p.isAI);
    if (!wolf) return;

    await server.waitForAICalls(wolf.id, 1, 5000);
    const callHistory = server.getAICallHistory(wolf.id);
    const wolfVoteCall = callHistory.find(c => c.phase === 'night_werewolf_vote');
    if (!wolfVoteCall) throw new Error('未找到狼人投票阶段调用');

    const messages = wolfVoteCall.messagesForLLM;
    if (!messages || messages.length === 0) throw new Error('狼人messagesForLLM为空');

    const systemMsg = messages.find(m => m.role === 'system');
    if (!systemMsg) throw new Error('无system消息');
    if (!systemMsg.content.includes('狼人')) throw new Error('system prompt应包含狼人角色名');
    if (!systemMsg.content.includes('队友')) throw new Error('狼人system prompt应包含队友信息');

    const userMsg = messages.find(m => m.role === 'user');
    if (!userMsg) throw new Error('无user消息');
    const hasWolfMarker = userMsg.content.includes('【狼人讨论】') || userMsg.content.includes('【狼人投票】');
    if (!hasWolfMarker) throw new Error('user message应包含【狼人讨论】或【狼人投票】阶段标记');
    if (!userMsg.content.includes('第1夜')) throw new Error('历史记录应包含第1夜标记');
  }, 10000);

  it('E5b: 狼人可以看到队友的发言', async () => {
    await server.start();
    server.setForcedRole('人类玩家', 'seer');
    const human = await server.addHuman('人类玩家', {
      campaign: { confirmed: false },
      speak: { content: '过。' }
    });
    await server.addAI(8);
    server.startGame();
    await human.waitFor('role_assigned', 3000);

    const game = server.getGame();
    const wolves = game.players.filter(p => p.role?.camp === 'wolf' && p.isAI);
    if (wolves.length < 2) return;

    // 等待狼人讨论阶段完成（通过等待 AI 调用）
    await server.waitForAICalls(wolves[0].id, 1, 5000);

    // 检查游戏消息中是否有狼人讨论消息
    const wolfDiscussMessages = game.message.messages.filter(m =>
      m.type === 'wolf_speech' && m.visibility === 'camp'
    );
    if (wolfDiscussMessages.length === 0) throw new Error('未找到狼人讨论消息');

    // 检查第二个狼人的可见消息中是否包含队友的发言
    const secondWolf = wolves[1];
    const controller = server.core.aiManager.get(secondWolf.id);
    const visibleMessages = controller.getVisibleMessages();
    const teammateSpeech = visibleMessages.filter(m => m.type === 'wolf_speech');

    if (teammateSpeech.length === 0) throw new Error('第二个狼人应能看到队友的发言');
  }, 10000);

  it('E6: 白天阶段messagesForLLM包含发言格式', async () => {
    await server.start();
    server.setForcedRole('人类玩家', 'werewolf');
    const human = await server.addHuman('人类玩家', {
      campaign: { confirmed: false },
      speak: { content: '我是平民，过。' },
      vote: { targetId: 2 }
    });
    await server.addAI(8);
    server.startGame();
    await human.waitFor('role_assigned', 3000);

    // 等待人类玩家发言完成
    await new Promise(r => setTimeout(r, 2000));

    const game = server.getGame();
    const aiPlayers = game.players.filter(p => p.isAI && p.alive);

    let dayCall = null;
    await server._waitForCondition(() => {
      for (const p of aiPlayers) {
        const history = server.getAICallHistory(p.id);
        const found = history.find(c => {
          if (!c.messagesForLLM) return false;
          const userMsg = c.messagesForLLM.find(m => m.role === 'user');
          if (!userMsg) return false;
          return userMsg.content.includes('【白天发言】') ||
                 userMsg.content.includes('【白天投票】');
        });
        if (found) { dayCall = found; return true; }
      }
      return false;
    }, 5000, '等待白天阶段AI调用超时');

    if (!dayCall) throw new Error('未找到白天阶段AI调用');

    const messages = dayCall.messagesForLLM;
    if (!messages || messages.length === 0) throw new Error('白天messagesForLLM为空');

    const systemMsg = messages.find(m => m.role === 'system');
    if (!systemMsg) throw new Error('无system消息');

    const userMsg = messages.find(m => m.role === 'user');
    if (!userMsg) throw new Error('无user消息');

    const dayMarkers = ['【白天发言】', '【白天投票】', '【警长竞选】', '【警长投票】'];
    const hasDayMarker = dayMarkers.some(m => userMsg.content.includes(m));
    if (!hasDayMarker) throw new Error(`user message应包含白天阶段标记之一: ${dayMarkers.join(', ')}`);

    const hasRoundMarker = userMsg.content.includes('第1天') || userMsg.content.includes('第1夜');
    if (!hasRoundMarker) throw new Error('历史记录应包含第1天或第1夜标记');

    // 发言格式现在是 [发言|x号名字] 内容
    const hasNewFormat = /\[发言\|\d+号[^\]]+\]/.test(userMsg.content);
    // 旧格式 x号名字:内容 也可能存在
    const hasOldFormat = /\d+号[^:]+:/.test(userMsg.content);
    if (!hasNewFormat && !hasOldFormat) throw new Error('应包含发言格式 "[发言|x号名字]" 或 "x号名字:"');
  }, 8000);
});

run();