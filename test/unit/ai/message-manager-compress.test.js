const { describe, it, run } = require('../../helpers/test-runner');
const { MessageManager } = require('../../../ai/agent/message_manager');

function makePlayer(overrides = {}) {
  return {
    id: 1,
    name: '张三',
    role: { id: 'seer', camp: 'good' },
    alive: true,
    ...overrides
  };
}

function makeContext(players, self, messages = []) {
  return { players, self, messages };
}

const players = [
  makePlayer({ id: 1, name: '张三', role: { id: 'seer', camp: 'good' } }),
  makePlayer({ id: 2, name: '李四', role: { id: 'werewolf', camp: 'wolf' } }),
  makePlayer({ id: 3, name: '王五', role: { id: 'villager', camp: 'good' } })
];

describe('_compactHistoryAfterSummary', () => {
  it('无摘要时从 index 1 开始提取', () => {
    const mm = new MessageManager(1, { compressionEnabled: false });
    mm.messages = [
      { role: 'system', content: '系统提示' },
      { role: 'user', content: '第1天发言内容' },
      { role: 'assistant', content: '分析：3号可疑' },
      { role: 'user', content: '第1天投票内容' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'tc1', function: { name: 'vote', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'tc1', content: '你投票给了3号王五' }
    ];

    const result = mm._compactHistoryAfterSummary();
    const lines = result.split('\n');

    if (lines[0] !== '第1天发言内容') throw new Error(`lines[0] 期望 '第1天发言内容', 实际 '${lines[0]}'`);
    if (lines[1] !== '[分析]分析：3号可疑') throw new Error(`lines[1] 期望 '[分析]分析：3号可疑', 实际 '${lines[1]}'`);
    if (lines[2] !== '第1天投票内容') throw new Error(`lines[2] 期望 '第1天投票内容', 实际 '${lines[2]}'`);
    if (lines[3] !== '你投票给了3号王五') throw new Error(`lines[3] 期望 '你投票给了3号王五', 实际 '${lines[3]}'`);
    if (lines.length !== 4) throw new Error(`lines.length 期望 4, 实际 ${lines.length}`);
  });

  it('有摘要时从 index 2 开始提取', () => {
    const mm = new MessageManager(1, { compressionEnabled: false });
    mm.messages = [
      { role: 'system', content: '系统提示' },
      { role: 'user', content: '【之前压缩摘要】\n第1天：3号可疑' },
      { role: 'user', content: '第2天发言内容' },
      { role: 'assistant', content: '分析：2号跳预言家' }
    ];

    const result = mm._compactHistoryAfterSummary();
    const lines = result.split('\n');

    if (lines[0] !== '第2天发言内容') throw new Error(`lines[0] 期望 '第2天发言内容', 实际 '${lines[0]}'`);
    if (lines[1] !== '[分析]分析：2号跳预言家') throw new Error(`lines[1] 期望 '[分析]分析：2号跳预言家', 实际 '${lines[1]}'`);
    if (lines.length !== 2) throw new Error(`lines.length 期望 2, 实际 ${lines.length}`);
  });

  it('tool_calls 的 assistant 消息被跳过', () => {
    const mm = new MessageManager(1, { compressionEnabled: false });
    mm.messages = [
      { role: 'system', content: '系统提示' },
      { role: 'user', content: '投票' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'tc1', function: { name: 'vote', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'tc1', content: '你投票给了2号' },
      { role: 'user', content: '下一轮发言' }
    ];

    const result = mm._compactHistoryAfterSummary();
    const lines = result.split('\n');

    if (lines.length !== 3) throw new Error(`lines.length 期望 3, 实际 ${lines.length}`);
    if (lines[0] !== '投票') throw new Error(`lines[0] 期望 '投票', 实际 '${lines[0]}'`);
    if (lines[1] !== '你投票给了2号') throw new Error(`lines[1] 期望 '你投票给了2号', 实际 '${lines[1]}'`);
    if (lines[2] !== '下一轮发言') throw new Error(`lines[2] 期望 '下一轮发言', 实际 '${lines[2]}'`);
  });

  it('只有 system 时返回 null', () => {
    const mm = new MessageManager(1, { compressionEnabled: false });
    mm.messages = [
      { role: 'system', content: '系统提示' }
    ];

    const result = mm._compactHistoryAfterSummary();
    if (result !== null) throw new Error(`期望 null, 实际 ${JSON.stringify(result)}`);
  });

  it('system+摘要无新消息时返回 null', () => {
    const mm = new MessageManager(1, { compressionEnabled: false });
    mm.messages = [
      { role: 'system', content: '系统提示' },
      { role: 'user', content: '【之前压缩摘要】\n旧摘要' }
    ];

    const result = mm._compactHistoryAfterSummary();
    if (result !== null) throw new Error(`期望 null, 实际 ${JSON.stringify(result)}`);
  });

  it('assistant content 为空时跳过', () => {
    const mm = new MessageManager(1, { compressionEnabled: false });
    mm.messages = [
      { role: 'system', content: '系统提示' },
      { role: 'user', content: '发言' },
      { role: 'assistant', content: '' },
      { role: 'user', content: '下一轮' }
    ];

    const result = mm._compactHistoryAfterSummary();
    const lines = result.split('\n');

    if (lines.length !== 2) throw new Error(`lines.length 期望 2, 实际 ${lines.length}`);
    if (lines[0] !== '发言') throw new Error(`lines[0] 期望 '发言', 实际 '${lines[0]}'`);
    if (lines[1] !== '下一轮') throw new Error(`lines[1] 期望 '下一轮', 实际 '${lines[1]}'`);
  });
});

describe('_findPrevSummary', () => {
  it('无摘要时返回 null', () => {
    const mm = new MessageManager(1, { compressionEnabled: false });
    mm.messages = [
      { role: 'system', content: '系统提示' },
      { role: 'user', content: '普通消息' }
    ];

    if (mm._findPrevSummary() !== null) throw new Error('无摘要时应返回 null');
  });

  it('有摘要时返回摘要文本', () => {
    const mm = new MessageManager(1, { compressionEnabled: false });
    mm.messages = [
      { role: 'system', content: '系统提示' },
      { role: 'user', content: '【之前压缩摘要】\n第1天：3号可疑，2号跳预言家' }
    ];

    if (mm._findPrevSummary() !== '第1天：3号可疑，2号跳预言家') {
      throw new Error(`期望 '第1天：3号可疑，2号跳预言家', 实际 '${mm._findPrevSummary()}'`);
    }
  });

  it('index 1 不是摘要时返回 null', () => {
    const mm = new MessageManager(1, { compressionEnabled: false });
    mm.messages = [
      { role: 'system', content: '系统提示' },
      { role: 'user', content: '普通消息' },
      { role: 'user', content: '【之前压缩摘要】\n不应该在这里' }
    ];

    if (mm._findPrevSummary() !== null) throw new Error('index 1 不是摘要时应返回 null');
  });
});

describe('compress 整体流程', () => {
  it('无 LLM 时用占位符替换 messages', async () => {
    const mm = new MessageManager(1, { compressionEnabled: true });
    mm.messages = [
      { role: 'system', content: '系统提示' },
      { role: 'user', content: '第1天发言' },
      { role: 'assistant', content: '3号可疑' }
    ];
    mm.setCompressContext(makeContext(players, players[0]));

    await mm.compress(null);

    if (mm.messages.length !== 2) throw new Error(`messages.length 期望 2, 实际 ${mm.messages.length}`);
    if (mm.messages[0].role !== 'system') throw new Error(`messages[0].role 期望 'system', 实际 '${mm.messages[0].role}'`);
    if (mm.messages[1].role !== 'user') throw new Error(`messages[1].role 期望 'user', 实际 '${mm.messages[1].role}'`);
    if (!mm.messages[1].content.startsWith('【之前压缩摘要】')) {
      throw new Error('压缩后第二条消息应以【之前压缩摘要】开头');
    }
  });

  it('二次压缩时旧摘要被注入 prompt', async () => {
    const mm = new MessageManager(1, { compressionEnabled: true });
    mm.messages = [
      { role: 'system', content: '系统提示' },
      { role: 'user', content: '【之前压缩摘要】\n第1天摘要' },
      { role: 'user', content: '第2天发言' },
      { role: 'assistant', content: '2号狼面大' }
    ];
    mm.setCompressContext(makeContext(players, players[0]));

    let capturedPrompt = null;
    const fakeLLM = {
      isAvailable: () => true,
      call: async (msgs) => {
        capturedPrompt = msgs[0].content;
        return { choices: [{ message: { content: '融合摘要' } }] };
      }
    };

    await mm.compress(fakeLLM);

    if (mm.messages.length !== 2) throw new Error(`messages.length 期望 2, 实际 ${mm.messages.length}`);
    if (mm.messages[1].content !== '【之前压缩摘要】\n融合摘要') {
      throw new Error(`messages[1].content 期望 '【之前压缩摘要】\\n融合摘要', 实际 '${mm.messages[1].content}'`);
    }
    if (!capturedPrompt.includes('第1天摘要')) {
      throw new Error('二次压缩 prompt 应包含旧摘要');
    }
    if (!capturedPrompt.includes('第2天发言')) {
      throw new Error('二次压缩 prompt 应包含新消息');
    }
    if (!capturedPrompt.includes('[分析]2号狼面大')) {
      throw new Error('二次压缩 prompt 应包含紧凑格式的分析内容');
    }
  });

  it('压缩后 messages 只剩 system 和摘要', async () => {
    const mm = new MessageManager(1, { compressionEnabled: true });
    mm.messages = [
      { role: 'system', content: '系统提示' },
      { role: 'user', content: '消息1' },
      { role: 'assistant', content: '分析1' },
      { role: 'user', content: '消息2' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'tc1', function: { name: 'vote', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'tc1', content: '投票结果' },
      { role: 'user', content: '消息3' },
      { role: 'assistant', content: '分析3' }
    ];
    mm.setCompressContext(makeContext(players, players[0]));

    const fakeLLM = {
      isAvailable: () => true,
      call: async () => ({ choices: [{ message: { content: '综合摘要' } }] })
    };

    await mm.compress(fakeLLM);

    if (mm.messages.length !== 2) throw new Error(`messages.length 期望 2, 实际 ${mm.messages.length}`);
    if (mm.messages[0].role !== 'system') throw new Error(`messages[0].role 期望 'system', 实际 '${mm.messages[0].role}'`);
    if (mm.messages[1].role !== 'user') throw new Error(`messages[1].role 期望 'user', 实际 '${mm.messages[1].role}'`);
    if (!mm.messages[1].content.includes('综合摘要')) {
      throw new Error('压缩后应包含 LLM 生成的摘要');
    }
  });

  it('紧凑格式正确处理各角色消息', async () => {
    const mm = new MessageManager(1, { compressionEnabled: true });
    mm.messages = [
      { role: 'system', content: '系统提示' },
      { role: 'user', content: '第1天白天发言' },
      { role: 'assistant', content: '3号发言有漏洞' },
      { role: 'user', content: '投票阶段' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'tc1', function: { name: 'vote', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'tc1', content: '你投票给了3号' },
      { role: 'user', content: '第2天白天发言' },
      { role: 'assistant', content: '2号可能是狼' }
    ];
    mm.setCompressContext(makeContext(players, players[0]));

    let capturedPrompt = null;
    const fakeLLM = {
      isAvailable: () => true,
      call: async (msgs) => {
        capturedPrompt = msgs[0].content;
        return { choices: [{ message: { content: '摘要' } }] };
      }
    };

    await mm.compress(fakeLLM);

    const newMsgSection = capturedPrompt.split('## 新增消息（从上次压缩点到当前）\n')[1]?.split('\n\n请生成')[0];
    const lines = newMsgSection.split('\n');

    if (lines[0] !== '第1天白天发言') throw new Error(`lines[0] 期望 '第1天白天发言', 实际 '${lines[0]}'`);
    if (lines[1] !== '[分析]3号发言有漏洞') throw new Error(`lines[1] 期望 '[分析]3号发言有漏洞', 实际 '${lines[1]}'`);
    if (lines[2] !== '投票阶段') throw new Error(`lines[2] 期望 '投票阶段', 实际 '${lines[2]}'`);
    if (lines[3] !== '你投票给了3号') throw new Error(`lines[3] 期望 '你投票给了3号', 实际 '${lines[3]}'`);
    if (lines[4] !== '第2天白天发言') throw new Error(`lines[4] 期望 '第2天白天发言', 实际 '${lines[4]}'`);
    if (lines[5] !== '[分析]2号可能是狼') throw new Error(`lines[5] 期望 '[分析]2号可能是狼', 实际 '${lines[5]}'`);
  });

  it('compressionEnabled=false 时不压缩', async () => {
    const mm = new MessageManager(1, { compressionEnabled: false });
    mm.messages = [
      { role: 'system', content: '系统提示' },
      { role: 'user', content: '消息' }
    ];

    await mm.compress(null);

    if (mm.messages.length !== 2) throw new Error(`messages.length 期望 2, 实际 ${mm.messages.length}`);
  });

  it('无 lastContext 时不压缩', async () => {
    const mm = new MessageManager(1, { compressionEnabled: true });
    mm.messages = [
      { role: 'system', content: '系统提示' },
      { role: 'user', content: '消息' }
    ];

    await mm.compress(null);

    if (mm.messages.length !== 2) throw new Error(`messages.length 期望 2, 实际 ${mm.messages.length}`);
  });

  it('prompt 包含身份信息', async () => {
    const mm = new MessageManager(1, { compressionEnabled: true });
    mm.messages = [
      { role: 'system', content: '系统提示' },
      { role: 'user', content: '发言' },
      { role: 'assistant', content: '分析' }
    ];
    mm.setCompressContext(makeContext(players, players[0]));

    let capturedPrompt = null;
    const fakeLLM = {
      isAvailable: () => true,
      call: async (msgs) => {
        capturedPrompt = msgs[0].content;
        return { choices: [{ message: { content: '摘要' } }] };
      }
    };

    await mm.compress(fakeLLM);

    if (!capturedPrompt.includes('名字:张三')) {
      throw new Error('prompt 应包含玩家名字');
    }
    if (!capturedPrompt.includes('位置:1号位')) {
      throw new Error('prompt 应包含玩家位置');
    }
    if (!capturedPrompt.includes('角色:预言家')) {
      throw new Error('prompt 应包含玩家角色');
    }
  });

  it('狼人身份包含队友信息', async () => {
    const mm = new MessageManager(1, { compressionEnabled: true });
    const wolfPlayers = [
      makePlayer({ id: 1, name: '张三', role: { id: 'werewolf', camp: 'wolf' } }),
      makePlayer({ id: 2, name: '李四', role: { id: 'werewolf', camp: 'wolf' } }),
      makePlayer({ id: 3, name: '王五', role: { id: 'villager', camp: 'good' } })
    ];
    const wolfPlayer = wolfPlayers[0];
    mm.messages = [
      { role: 'system', content: '系统提示' },
      { role: 'user', content: '发言' },
      { role: 'assistant', content: '分析' }
    ];
    mm.setCompressContext(makeContext(wolfPlayers, wolfPlayer));

    let capturedPrompt = null;
    const fakeLLM = {
      isAvailable: () => true,
      call: async (msgs) => {
        capturedPrompt = msgs[0].content;
        return { choices: [{ message: { content: '摘要' } }] };
      }
    };

    await mm.compress(fakeLLM);

    if (!capturedPrompt.includes('队友')) {
      throw new Error('狼人身份的 prompt 应包含队友信息');
    }
  });
});

run();