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
    const mm = new MessageManager({ compressionEnabled: false });
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
    const mm = new MessageManager({ compressionEnabled: false });
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
    const mm = new MessageManager({ compressionEnabled: false });
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
    const mm = new MessageManager({ compressionEnabled: false });
    mm.messages = [
      { role: 'system', content: '系统提示' }
    ];

    const result = mm._compactHistoryAfterSummary();
    if (result !== null) throw new Error(`期望 null, 实际 ${JSON.stringify(result)}`);
  });

  it('system+摘要无新消息时返回 null', () => {
    const mm = new MessageManager({ compressionEnabled: false });
    mm.messages = [
      { role: 'system', content: '系统提示' },
      { role: 'user', content: '【之前压缩摘要】\n旧摘要' }
    ];

    const result = mm._compactHistoryAfterSummary();
    if (result !== null) throw new Error(`期望 null, 实际 ${JSON.stringify(result)}`);
  });

  it('assistant content 为空时跳过', () => {
    const mm = new MessageManager({ compressionEnabled: false });
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
    const mm = new MessageManager({ compressionEnabled: false });
    mm.messages = [
      { role: 'system', content: '系统提示' },
      { role: 'user', content: '普通消息' }
    ];

    if (mm._findPrevSummary() !== null) throw new Error('无摘要时应返回 null');
  });

  it('有摘要时返回摘要文本', () => {
    const mm = new MessageManager({ compressionEnabled: false });
    mm.messages = [
      { role: 'system', content: '系统提示' },
      { role: 'user', content: '【之前压缩摘要】\n第1天：3号可疑，2号跳预言家' }
    ];

    if (mm._findPrevSummary() !== '第1天：3号可疑，2号跳预言家') {
      throw new Error(`期望 '第1天：3号可疑，2号跳预言家', 实际 '${mm._findPrevSummary()}'`);
    }
  });

  it('index 1 不是摘要时返回 null', () => {
    const mm = new MessageManager({ compressionEnabled: false });
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
    const mm = new MessageManager({ compressionEnabled: true });
    mm.messages = [
      { role: 'system', content: '系统提示' },
      { role: 'user', content: '第1天发言' },
      { role: 'assistant', content: '3号可疑' }
    ];
    const context = makeContext(players, players[0]);

    await mm.compress(null, 'game', context);

    if (mm.messages.length !== 2) throw new Error(`messages.length 期望 2, 实际 ${mm.messages.length}`);
    if (mm.messages[0].role !== 'system') throw new Error(`messages[0].role 期望 'system', 实际 '${mm.messages[0].role}'`);
    if (mm.messages[1].role !== 'user') throw new Error(`messages[1].role 期望 'user', 实际 '${mm.messages[1].role}'`);
    if (!mm.messages[1].content.startsWith('【之前压缩摘要】')) {
      throw new Error('压缩后第二条消息应以【之前压缩摘要】开头');
    }
  });

  it('二次压缩时旧摘要被注入 prompt', async () => {
    const mm = new MessageManager({ compressionEnabled: true });
    const longContent = '这是很长的一天发言内容，需要超过八百字符的阈值才能触发LLM压缩而不是短内容直接拼接路径。'.repeat(20);
    mm.messages = [
      { role: 'system', content: '系统提示' },
      { role: 'user', content: `【之前压缩摘要】\n第1天摘要` },
      { role: 'user', content: longContent },
      { role: 'assistant', content: '2号狼面大' }
    ];
    const context = makeContext(players, players[0]);

    let capturedPrompt = null;
    const fakeLLM = {
      isAvailable: () => true,
      call: async (msgs) => {
        capturedPrompt = msgs[0].content;
        return { choices: [{ message: { content: '融合摘要' } }] };
      }
    };

    await mm.compress(fakeLLM, 'game', context);

    if (mm.messages.length !== 2) throw new Error(`messages.length 期望 2, 实际 ${mm.messages.length}`);
    if (mm.messages[1].content !== '【之前压缩摘要】\n融合摘要') {
      throw new Error(`messages[1].content 期望 '【之前压缩摘要】\\n融合摘要', 实际 '${mm.messages[1].content}'`);
    }
    if (!capturedPrompt.includes('第1天摘要')) {
      throw new Error('二次压缩 prompt 应包含旧摘要');
    }
    if (!capturedPrompt.includes(longContent)) {
      throw new Error('二次压缩 prompt 应包含新消息');
    }
    if (!capturedPrompt.includes('[分析]2号狼面大')) {
      throw new Error('二次压缩 prompt 应包含紧凑格式的分析内容');
    }
  });

  it('压缩后 messages 只剩 system 和摘要', async () => {
    const mm = new MessageManager({ compressionEnabled: true });
    const longContent = '这是很长的一天发言内容，需要超过八百字符的阈值才能触发LLM压缩而不是短内容直接拼接路径。'.repeat(20);
    mm.messages = [
      { role: 'system', content: '系统提示' },
      { role: 'user', content: longContent },
      { role: 'assistant', content: '分析1' },
      { role: 'user', content: '消息2' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'tc1', function: { name: 'vote', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'tc1', content: '投票结果' },
      { role: 'user', content: '消息3' },
      { role: 'assistant', content: '分析3' }
    ];
    const context = makeContext(players, players[0]);

    const fakeLLM = {
      isAvailable: () => true,
      call: async () => ({ choices: [{ message: { content: '综合摘要' } }] })
    };

    await mm.compress(fakeLLM, 'game', context);

    if (mm.messages.length !== 2) throw new Error(`messages.length 期望 2, 实际 ${mm.messages.length}`);
    if (mm.messages[0].role !== 'system') throw new Error(`messages[0].role 期望 'system', 实际 '${mm.messages[0].role}'`);
    if (mm.messages[1].role !== 'user') throw new Error(`messages[1].role 期望 'user', 实际 '${mm.messages[1].role}'`);
    if (!mm.messages[1].content.includes('综合摘要')) {
      throw new Error('压缩后应包含 LLM 生成的摘要');
    }
  });

  it('紧凑格式正确处理各角色消息', async () => {
    const mm = new MessageManager({ compressionEnabled: true });
    const longContent = '这是很长的一天发言内容，需要超过八百字符的阈值才能触发LLM压缩而不是短内容直接拼接路径。'.repeat(20);
    mm.messages = [
      { role: 'system', content: '系统提示' },
      { role: 'user', content: longContent },
      { role: 'assistant', content: '3号发言有漏洞' },
      { role: 'user', content: '投票阶段' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'tc1', function: { name: 'vote', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'tc1', content: '你投票给了3号' },
      { role: 'user', content: '第2天白天发言' },
      { role: 'assistant', content: '2号可能是狼' }
    ];
    const context = makeContext(players, players[0]);

    let capturedPrompt = null;
    const fakeLLM = {
      isAvailable: () => true,
      call: async (msgs) => {
        capturedPrompt = msgs[0].content;
        return { choices: [{ message: { content: '摘要' } }] };
      }
    };

    await mm.compress(fakeLLM, 'game', context);

    if (!capturedPrompt.includes(longContent)) throw new Error('prompt 应包含长内容');
    if (!capturedPrompt.includes('[分析]3号发言有漏洞')) throw new Error('prompt 应包含紧凑格式分析');
    if (!capturedPrompt.includes('投票阶段')) throw new Error('prompt 应包含投票阶段');
    if (!capturedPrompt.includes('你投票给了3号')) throw new Error('prompt 应包含投票结果');
    if (!capturedPrompt.includes('第2天白天发言')) throw new Error('prompt 应包含第2天白天发言');
    if (!capturedPrompt.includes('[分析]2号可能是狼')) throw new Error('prompt 应包含紧凑格式分析2');
  });

  it('compressionEnabled=false 时不压缩', async () => {
    const mm = new MessageManager({ compressionEnabled: false });
    mm.messages = [
      { role: 'system', content: '系统提示' },
      { role: 'user', content: '消息' }
    ];

    await mm.compress(null, 'game', makeContext(players, players[0]));

    if (mm.messages.length !== 2) throw new Error(`messages.length 期望 2, 实际 ${mm.messages.length}`);
  });

  it('无 context.self 时不压缩', async () => {
    const mm = new MessageManager({ compressionEnabled: true });
    mm.messages = [
      { role: 'system', content: '系统提示' },
      { role: 'user', content: '消息' }
    ];

    await mm.compress(null, 'game', { players: [], self: null });

    if (mm.messages.length !== 2) throw new Error(`messages.length 期望 2, 实际 ${mm.messages.length}`);
  });

  it('prompt 包含身份信息', async () => {
    const mm = new MessageManager({ compressionEnabled: true });
    const longContent = '这是很长的一天发言内容，需要超过八百字符的阈值才能触发LLM压缩而不是短内容直接拼接路径。'.repeat(20);
    mm.messages = [
      { role: 'system', content: '系统提示' },
      { role: 'user', content: longContent },
      { role: 'assistant', content: '分析' }
    ];
    const context = makeContext(players, players[0]);

    let capturedPrompt = null;
    const fakeLLM = {
      isAvailable: () => true,
      call: async (msgs) => {
        capturedPrompt = msgs[0].content;
        return { choices: [{ message: { content: '摘要' } }] };
      }
    };

    await mm.compress(fakeLLM, 'game', context);

    if (!capturedPrompt.includes('张三')) {
      throw new Error('prompt 应包含玩家名字');
    }
    if (!capturedPrompt.includes('1号位')) {
      throw new Error('prompt 应包含玩家位置');
    }
    if (!capturedPrompt.includes('预言家')) {
      throw new Error('prompt 应包含玩家角色');
    }
  });

  it('狼人身份包含队友信息', async () => {
    const mm = new MessageManager({ compressionEnabled: true });
    const wolfPlayers = [
      makePlayer({ id: 1, name: '张三', role: { id: 'werewolf', camp: 'wolf' } }),
      makePlayer({ id: 2, name: '李四', role: { id: 'werewolf', camp: 'wolf' } }),
      makePlayer({ id: 3, name: '王五', role: { id: 'villager', camp: 'good' } })
    ];
    const wolfPlayer = wolfPlayers[0];
    const longContent = '这是很长的一天发言内容，需要超过八百字符的阈值才能触发LLM压缩而不是短内容直接拼接路径。'.repeat(20);
    mm.messages = [
      { role: 'system', content: '系统提示' },
      { role: 'user', content: longContent },
      { role: 'assistant', content: '分析' }
    ];
    const context = makeContext(wolfPlayers, wolfPlayer);

    let capturedPrompt = null;
    const fakeLLM = {
      isAvailable: () => true,
      call: async (msgs) => {
        capturedPrompt = msgs[0].content;
        return { choices: [{ message: { content: '摘要' } }] };
      }
    };

    await mm.compress(fakeLLM, 'game', context);

    if (!capturedPrompt.includes('队友')) {
      throw new Error('狼人身份的 prompt 应包含队友信息');
    }
  });

  it('短内容跳过 LLM 直接用原文', async () => {
    const mm = new MessageManager({ compressionEnabled: true });
    mm.messages = [
      { role: 'system', content: '系统提示' },
      { role: 'user', content: '短消息' }
    ];
    const context = makeContext(players, players[0]);

    let llmCalled = false;
    const fakeLLM = {
      isAvailable: () => true,
      call: async () => { llmCalled = true; return { choices: [{ message: { content: '不应该到这里' } }] }; }
    };

    await mm.compress(fakeLLM, 'game', context);

    if (llmCalled) throw new Error('短内容不应调用 LLM');
    if (mm.messages.length !== 2) throw new Error(`messages.length 期望 2, 实际 ${mm.messages.length}`);
    if (!mm.messages[1].content.startsWith('【之前压缩摘要】')) {
      throw new Error('短内容压缩后应以【之前压缩摘要】开头');
    }
    if (!mm.messages[1].content.includes('短消息')) {
      throw new Error('短内容压缩后应包含原文');
    }
  });

  it('短内容与已有摘要合并', async () => {
    const mm = new MessageManager({ compressionEnabled: true });
    mm.messages = [
      { role: 'system', content: '系统提示' },
      { role: 'user', content: '【之前压缩摘要】\n旧摘要内容' },
      { role: 'user', content: '短消息' }
    ];
    const context = makeContext(players, players[0]);

    let llmCalled = false;
    const fakeLLM = {
      isAvailable: () => true,
      call: async () => { llmCalled = true; return { choices: [{ message: { content: '不应该到这里' } }] }; }
    };

    await mm.compress(fakeLLM, 'game', context);

    if (llmCalled) throw new Error('短内容不应调用 LLM');
    if (mm.messages.length !== 2) throw new Error(`messages.length 期望 2, 实际 ${mm.messages.length}`);
    if (!mm.messages[1].content.includes('旧摘要内容')) {
      throw new Error('合并后应包含旧摘要');
    }
    if (!mm.messages[1].content.includes('短消息')) {
      throw new Error('合并后应包含新内容');
    }
  });

  it('chat 模式使用 chat 提示词模板', async () => {
    const mm = new MessageManager({ compressionEnabled: true });
    mm.messages = [
      { role: 'system', content: '系统提示' },
      { role: 'user', content: '聊天消息1'.repeat(100) },
      { role: 'assistant', content: '聊天回复1'.repeat(100) }
    ];
    const context = makeContext(players, players[0]);

    let capturedPrompt = null;
    const fakeLLM = {
      isAvailable: () => true,
      call: async (msgs) => {
        capturedPrompt = msgs[0].content;
        return { choices: [{ message: { content: '聊天摘要' } }] };
      }
    };

    await mm.compress(fakeLLM, 'chat', context);

    if (!capturedPrompt.includes('聊天记录')) {
      throw new Error('chat 模式应使用聊天提示词模板');
    }
  });
});

describe('appendContent', () => {
  it('追加内容到 messages 尾部', () => {
    const mm = new MessageManager({ compressionEnabled: false });
    mm.messages = [
      { role: 'system', content: '系统提示' }
    ];

    mm.appendContent('新增内容');

    if (mm.messages.length !== 2) throw new Error(`messages.length 期望 2, 实际 ${mm.messages.length}`);
    if (mm.messages[1].role !== 'user') throw new Error('追加的消息应为 user 角色');
    if (mm.messages[1].content !== '新增内容') throw new Error('追加的内容不正确');
  });

  it('空内容不追加', () => {
    const mm = new MessageManager({ compressionEnabled: false });
    mm.messages = [
      { role: 'system', content: '系统提示' }
    ];

    mm.appendContent(null);
    mm.appendContent('');
    mm.appendContent(undefined);

    if (mm.messages.length !== 1) throw new Error('空内容不应追加');
  });
});

describe('updateSystem 与 _currentMode', () => {
  it('game 模式成功时设置 _currentMode', () => {
    const mm = new MessageManager({ compressionEnabled: false });
    const player = makePlayer();
    const game = { players: [], round: 1, effectiveRules: {} };

    mm.updateSystem(player, game, 'game');

    if (mm._currentMode !== 'game') throw new Error(`_currentMode 期望 'game', 实际 '${mm._currentMode}'`);
  });

  it('chat 模式成功时设置 _currentMode', () => {
    const mm = new MessageManager({ compressionEnabled: false });
    const player = makePlayer();

    mm.updateSystem(player, null, 'chat');

    if (mm._currentMode !== 'chat') throw new Error(`_currentMode 期望 'chat', 实际 '${mm._currentMode}'`);
  });

  it('game 模式无 role 时不更新 system 也不改 _currentMode', () => {
    const mm = new MessageManager({ compressionEnabled: false });
    mm._currentMode = 'chat';
    const player = makePlayer({ role: null });

    mm.updateSystem(player, { players: [] }, 'game');

    if (mm._currentMode !== 'chat') throw new Error('game 模式无 role 时 _currentMode 应保持不变');
    if (mm.messages.length !== 0) throw new Error('game 模式无 role 时不应添加 system 消息');
  });

  it('无 player 时不更新', () => {
    const mm = new MessageManager({ compressionEnabled: false });
    mm._currentMode = 'chat';

    mm.updateSystem(null, null, 'game');

    if (mm._currentMode !== 'chat') throw new Error('无 player 时 _currentMode 应保持不变');
    if (mm.messages.length !== 0) throw new Error('无 player 时不应添加 system 消息');
  });
});

run();