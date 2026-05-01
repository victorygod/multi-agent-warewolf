const { describe, it, run } = require('../../helpers/test-runner');
const { RandomModel, ANALYSIS_TEMPLATES } = require('../../../ai/agent/models/random_model');
const { MockModel } = require('../../../ai/agent/models/mock_model');
const { Agent, ANALYSIS_NODES } = require('../../../ai/agent/agent');
const { VISIBILITY, CAMP } = require('../../../engine/constants');

const alivePlayers = [
  { id: 1, name: '张三', alive: true },
  { id: 2, name: '李四', alive: true },
  { id: 3, name: '王五', alive: true },
  { id: 4, name: '赵六', alive: true }
];

function makeContext(action, extra = {}) {
  return {
    action,
    alivePlayers,
    extraData: extra.extraData || {},
    self: extra.self || { id: 1 },
    _tools: [{ type: 'function', function: { name: action, parameters: {} } }],
    _messagesForLLM: [],
    ...extra
  };
}

describe('RandomModel - 基础', () => {
  it('isAvailable返回true', () => {
    const model = new RandomModel(1);
    if (model.isAvailable() !== true) throw new Error('应返回true');
  });

  it('无tool时返回分析文本', () => {
    const model = new RandomModel(1);
    const result = model.call({ action: 'analyze', _tools: [], _messagesForLLM: [] });
    if (typeof result !== 'string') throw new Error('无tool应返回字符串');
  });

  it('ANALYSIS_TEMPLATES非空', () => {
    if (!Array.isArray(ANALYSIS_TEMPLATES) || ANALYSIS_TEMPLATES.length === 0) {
      throw new Error('ANALYSIS_TEMPLATES应为非空数组');
    }
  });
});

describe('RandomModel - 各action决策', () => {
  it('speechAction返回content', () => {
    const model = new RandomModel(1);
    const result = model.call(makeContext('action_day_discuss'));
    if (!result?.raw?.tool_calls) throw new Error('应返回tool_calls');
  });

  it('voteAction返回target或skip', () => {
    const model = new RandomModel(1);
    for (let i = 0; i < 20; i++) {
      const result = model.call(makeContext('action_day_vote'));
      if (!result?.raw?.tool_calls) throw new Error('应返回tool_calls');
    }
  });

  it('seerAction排除自己', () => {
    const model = new RandomModel(1);
    for (let i = 0; i < 20; i++) {
      const result = model.call(makeContext('action_seer', { self: { id: 1, seerChecks: [] } }));
      if (!result?.raw?.tool_calls) throw new Error('应返回tool_calls');
      const args = result.raw.tool_calls[0].function.arguments;
      if (args !== 'null') {
        const parsed = JSON.parse(args);
        if (parsed.target === '1') throw new Error('预言家不应查验自己');
      }
    }
  });

  it('seerAction排除已查验', () => {
    const model = new RandomModel(1);
    const seerChecks = [{ targetId: 2, round: 1 }];
    for (let i = 0; i < 20; i++) {
      const result = model.call(makeContext('action_seer', { self: { id: 1, seerChecks } }));
      if (!result?.raw?.tool_calls) throw new Error('应返回tool_calls');
      const args = result.raw.tool_calls[0].function.arguments;
      if (args !== 'null') {
        const parsed = JSON.parse(args);
        if (parsed.target === '2') throw new Error('不应查验已查验目标');
      }
    }
  });

  it('guardAction排除上次守护', () => {
    const model = new RandomModel(1);
    for (let i = 0; i < 20; i++) {
      const result = model.call(makeContext('action_guard', { self: { id: 1, lastGuardTarget: 2 } }));
      if (!result?.raw?.tool_calls) throw new Error('应返回tool_calls');
      const args = result.raw.tool_calls[0].function.arguments;
      if (args !== 'null') {
        const parsed = JSON.parse(args);
        if (parsed.target === '2') throw new Error('守卫不应连守同一人');
      }
    }
  });

  it('witchAction有解药可救', () => {
    const model = new RandomModel(1);
    const ctx = makeContext('action_witch', {
      self: { id: 1, witchHeal: 1, witchPoison: 1 },
      werewolfTarget: 3
    });
    let healed = false;
    for (let i = 0; i < 50; i++) {
      const result = model.call(ctx);
      const args = result.raw.tool_calls[0].function.arguments;
      if (args !== 'null') {
        const parsed = JSON.parse(args);
        if (parsed.action === 'heal') { healed = true; break; }
      }
    }
    if (!healed) throw new Error('有解药时应该有时救人');
  });

  it('witchAction无解药不救', () => {
    const model = new RandomModel(1);
    const ctx = makeContext('action_witch', {
      self: { id: 1, witchHeal: 0, witchPoison: 1 },
      werewolfTarget: 3
    });
    for (let i = 0; i < 20; i++) {
      const result = model.call(ctx);
      const args = result.raw.tool_calls[0].function.arguments;
      if (args !== 'null') {
        const parsed = JSON.parse(args);
        if (parsed.action === 'heal') throw new Error('无解药不应救人');
      }
    }
  });

  it('cupidAction选两人', () => {
    const model = new RandomModel(1);
    const result = model.call(makeContext('action_cupid'));
    if (!result?.raw?.tool_calls) throw new Error('应返回tool_calls');
    const args = result.raw.tool_calls[0].function.arguments;
    if (args !== 'null') {
      const parsed = JSON.parse(args);
      if (!parsed.targets || parsed.targets.length !== 2) throw new Error('丘比特应选两人');
    }
  });

  it('hunterAction返回target或skip', () => {
    const model = new RandomModel(1);
    for (let i = 0; i < 20; i++) {
      const result = model.call(makeContext('action_shoot'));
      if (!result?.raw?.tool_calls) throw new Error('应返回tool_calls');
    }
  });

  it('campaignAction返回run布尔', () => {
    const model = new RandomModel(1);
    const result = model.call(makeContext('action_sheriff_campaign'));
    if (!result?.raw?.tool_calls) throw new Error('应返回tool_calls');
  });

  it('withdrawAction返回withdraw布尔', () => {
    const model = new RandomModel(1);
    const result = model.call(makeContext('action_withdraw'));
    if (!result?.raw?.tool_calls) throw new Error('应返回tool_calls');
  });

  it('assignOrderAction返回target', () => {
    const model = new RandomModel(1);
    const result = model.call(makeContext('action_assignOrder'));
    if (!result?.raw?.tool_calls) throw new Error('应返回tool_calls');
  });

  it('passBadgeAction返回target', () => {
    const model = new RandomModel(1);
    const result = model.call(makeContext('action_passBadge'));
    if (!result?.raw?.tool_calls) throw new Error('应返回tool_calls');
  });

  it('未知action返回skip', () => {
    const model = new RandomModel(1);
    const result = model.call(makeContext('action_unknown'));
    if (!result?.raw?.tool_calls) throw new Error('应返回tool_calls');
    const args = result.raw.tool_calls[0].function.arguments;
    const parsed = JSON.parse(args);
    if (!parsed.skip) throw new Error('未知action应skip');
  });
});

describe('MockModel - wildcard行为序列', () => {
  it('wildcard行为不推进序列索引', async () => {
    const model = new MockModel(1);
    model.setBehaviorSequence([
      { phase: 'night', action: 'action_seer', response: { target: 2 }, wildcard: true },
      { phase: 'day', response: { target: 3 } }
    ]);
    const r1 = model.getSequenceResponse('night', 'action_seer');
    const r2 = model.getSequenceResponse('night', 'action_seer');
    if (r1 === undefined) throw new Error('第一次应能获取');
    if (r2 === undefined) throw new Error('wildcard应不推进索引，第二次也能获取');
  });

  it('非wildcard行为推进序列索引', async () => {
    const model = new MockModel(1);
    model.setBehaviorSequence([
      { phase: 'night', response: { target: 2 } },
      { phase: 'day', response: { target: 3 } }
    ]);
    const r1 = model.getSequenceResponse('night', 'action_seer');
    const r2 = model.getSequenceResponse('night', 'action_seer');
    if (r1 === undefined) throw new Error('第一次应能获取');
    if (r2 !== undefined) throw new Error('非wildcard应推进索引，第二次不应获取到');
  });
});

describe('Agent - shouldAnalyzeMessage', () => {
  function makeGame(camp1, camp2, couples) {
    return {
      players: [
        { id: 1, role: { camp: camp1 } },
        { id: 2, role: { camp: camp2 } }
      ],
      couples: couples || [],
      config: { hooks: { getCamp: (p, g) => p.role.camp } }
    };
  }

  it('公开speech消息需分析', () => {
    const agent = new Agent(1);
    const game = makeGame(CAMP.GOOD, CAMP.WOLF);
    const msg = { type: 'speech', playerId: 2, visibility: VISIBILITY.PUBLIC };
    if (agent.shouldAnalyzeMessage(msg, 1, game) !== true) throw new Error('公开speech应分析');
  });

  it('自己发的消息不分析', () => {
    const agent = new Agent(1);
    const game = makeGame(CAMP.GOOD, CAMP.WOLF);
    const msg = { type: 'speech', playerId: 1, visibility: VISIBILITY.PUBLIC };
    if (agent.shouldAnalyzeMessage(msg, 1, game) !== false) throw new Error('自己消息不分析');
  });

  it('SELF可见消息不分析', () => {
    const agent = new Agent(1);
    const game = makeGame(CAMP.GOOD, CAMP.WOLF);
    const msg = { type: 'speech', playerId: 2, visibility: VISIBILITY.SELF };
    if (agent.shouldAnalyzeMessage(msg, 1, game) !== false) throw new Error('SELF消息不分析');
  });

  it('同阵营CAMP消息需分析', () => {
    const agent = new Agent(1);
    const game = makeGame(CAMP.WOLF, CAMP.WOLF);
    const msg = { type: 'speech', playerId: 2, visibility: VISIBILITY.CAMP };
    if (agent.shouldAnalyzeMessage(msg, 1, game) !== true) throw new Error('同阵营CAMP应分析');
  });

  it('不同阵营CAMP消息不分析', () => {
    const agent = new Agent(1);
    const game = makeGame(CAMP.GOOD, CAMP.WOLF);
    const msg = { type: 'speech', playerId: 2, visibility: VISIBILITY.CAMP };
    if (agent.shouldAnalyzeMessage(msg, 1, game) !== false) throw new Error('不同阵营CAMP不分析');
  });

  it('COUPLE消息非情侣不分析', () => {
    const agent = new Agent(1);
    const game = makeGame(CAMP.GOOD, CAMP.WOLF);
    const msg = { type: 'speech', playerId: 2, visibility: VISIBILITY.COUPLE };
    if (agent.shouldAnalyzeMessage(msg, 1, game) !== false) throw new Error('非情侣COUPLE不分析');
  });

  it('COUPLE消息情侣需分析', () => {
    const agent = new Agent(1);
    const game = makeGame(CAMP.GOOD, CAMP.WOLF);
    game.couples = [1, 2];
    const msg = { type: 'speech', playerId: 2, visibility: VISIBILITY.COUPLE };
    if (agent.shouldAnalyzeMessage(msg, 1, game) !== true) throw new Error('情侣COUPLE应分析');
  });

  it('非speech类型不分析', () => {
    const agent = new Agent(1);
    const game = makeGame(CAMP.GOOD, CAMP.WOLF);
    const msg = { type: 'action', playerId: 2, visibility: VISIBILITY.PUBLIC };
    if (agent.shouldAnalyzeMessage(msg, 1, game) !== false) throw new Error('非speech类型不分析');
  });

  it('ANALYSIS_NODES只包含speech', () => {
    if (ANALYSIS_NODES.length !== 1 || ANALYSIS_NODES[0] !== 'speech') {
      throw new Error('ANALYSIS_NODES应只包含speech');
    }
  });
});

describe('Agent - enqueue和processQueue', () => {
  it('enqueue后isProcessing为true（队列开始处理）', () => {
    const agent = new Agent(1);
    const beforeQueue = agent.requestQueue.length;
    if (beforeQueue !== 0) throw new Error('初始队列应为空');
  });

  it('Agent有requestQueue属性', () => {
    const agent = new Agent(1);
    if (!Array.isArray(agent.requestQueue)) throw new Error('应有requestQueue');
  });

  it('Agent有messages属性', () => {
    const agent = new Agent(1);
    if (!Array.isArray(agent.messages)) throw new Error('应有messages');
  });
});

describe('MessageManager - compress', () => {
  it('compressionEnabled=false不压缩', async () => {
    const { MessageManager } = require('../../../ai/agent/message_manager');
    const mm = new MessageManager(1, { compressionEnabled: false });
    const player = { id: 1, name: '张三', role: { id: 'seer', name: '预言家', camp: 'good' }, alive: true, state: {} };
    const game = { players: [], round: 1, effectiveRules: {} };
    mm.updateSystem(player, game);
    mm.setCompressContext({ players: [], self: player });
    const beforeLen = mm.messages.length;
    await mm.compress(null);
    if (mm.messages.length !== beforeLen) throw new Error('禁用压缩时消息数不应变');
  });

  it('setCompressContext保存上下文', () => {
    const { MessageManager } = require('../../../ai/agent/message_manager');
    const mm = new MessageManager(1);
    const ctx = { players: [], self: { id: 1 } };
    mm.setCompressContext(ctx);
    if (mm._lastContext !== ctx) throw new Error('应保存上下文');
  });

  it('formatIncomingMessages过滤已处理消息', () => {
    const { MessageManager } = require('../../../ai/agent/message_manager');
    const mm = new MessageManager(1);
    const messages = [
      { id: 1, type: 'speech', content: '第一条' },
      { id: 2, type: 'speech', content: '第二条' },
      { id: 3, type: 'speech', content: '第三条' }
    ];
    mm.lastProcessedId = 1;
    const result = mm.formatIncomingMessages({ messages, players: [] });
    if (result.newMessages.length !== 2) throw new Error('应只返回id>1的消息');
  });
});

run();