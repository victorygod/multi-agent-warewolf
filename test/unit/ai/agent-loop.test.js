const { describe, it, run } = require('../../helpers/test-runner');
const { Agent } = require('../../../ai/agent/agent');

function makeCallFn(toolName, callId, args) {
  return async (context) => {
    const tool = context._tools?.[0];
    if (tool) {
      return {
        raw: {
          tool_calls: [{
            id: callId,
            function: { name: toolName || tool.function.name, arguments: JSON.stringify(args) }
          }]
        },
        messages: context._messagesForLLM || []
      };
    }
    return { raw: { content: 'test' }, messages: context._messagesForLLM || [] };
  };
}

function makeMockModel(toolName, toolId, args) {
  return {
    isAvailable: () => true,
    call: makeCallFn(toolName, toolId, args)
  };
}

function makeAgentAndContext(action, toolName, callId, args) {
  const mockModel = { isAvailable: () => true, call: makeCallFn(toolName, callId, args) };
  const agent = new Agent(1, { mockOptions: {} });
  agent._models = [{ model: mockModel, name: 'MockModel' }];
  agent.mm.messages = [{ role: 'system', content: 'test system' }];

  const newContent = 'test content';
  const newMessages = [];
  const llmView = [
    { role: 'system', content: 'test system' },
    { role: 'user', content: newContent }
  ];
  const tools = [{ type: 'function', function: { name: toolName, description: toolName, parameters: {} } }];
  const context = {
    phase: 'day_vote',
    action,
    players: [{ id: 1, name: '玩家1', alive: true }, { id: 2, name: '玩家2', alive: true }, { id: 3, name: '玩家3', alive: true }],
    alivePlayers: [{ id: 1, name: '玩家1', alive: true }, { id: 2, name: '玩家2', alive: true }, { id: 3, name: '玩家3', alive: true }],
    messages: [],
    self: { id: 1, name: '玩家1' }
  };

  return { mockModel, agent, context, newContent, newMessages, llmView, tools };
}

describe('_agentLoop tool_calls消息格式', () => {
  it('llmView 正确添加 tool_calls 和 tool 消息', async () => {
    const { mockModel, agent, context, newContent, newMessages, llmView, tools } = makeAgentAndContext('action_post_vote', 'action_post_vote', 'call_test_123', { target: '3' });

    await agent._agentLoop(mockModel, context, { name: 'action_post_vote' }, newContent, newMessages, llmView, tools, '【白天投票】');

    const assistantMsgs = llmView.filter(m => m.role === 'assistant');
    const assistantWithToolCalls = assistantMsgs.find(m => m.tool_calls && m.tool_calls.length > 0);
    if (!assistantWithToolCalls) throw new Error('应有包含 tool_calls 的 assistant 消息');

    const toolMsgs = llmView.filter(m => m.role === 'tool');
    if (toolMsgs.length === 0) throw new Error('应有 tool 消息');
    if (!toolMsgs[toolMsgs.length - 1].tool_call_id) throw new Error('tool 消息应有 tool_call_id');
  });

  it('this.messages 正确保存 tool_calls 和 tool 消息', async () => {
    const { mockModel, agent, context, newContent, newMessages, llmView, tools } = makeAgentAndContext('action_post_vote', 'action_post_vote', 'call_vote_456', { target: '2' });

    await agent._agentLoop(mockModel, context, { name: 'action_post_vote' }, newContent, newMessages, llmView, tools, '【白天投票】');

    if (agent.mm.messages.length !== 4) throw new Error('agent.mm.messages 应有 4 条消息');
    if (agent.mm.messages[0].role !== 'system') throw new Error('第一条应为 system');

    const userMsg = agent.mm.messages[1];
    if (userMsg.role !== 'user') throw new Error('第二条应为 user');

    const assistantMsg = agent.mm.messages[2];
    if (assistantMsg.role !== 'assistant') throw new Error('第三条应为 assistant');
    if (!assistantMsg.tool_calls) throw new Error('assistant 消息应有 tool_calls');
    if (assistantMsg.tool_calls[0].function.name !== 'action_post_vote') throw new Error('tool_calls 应为 action_post_vote');

    const toolMsg = agent.mm.messages[3];
    if (toolMsg.role !== 'tool') throw new Error('第四条应为 tool');
    if (!toolMsg.tool_call_id) throw new Error('tool 消息应有 tool_call_id');
  });

  it('发言阶段保存 tool_calls + tool', async () => {
    const { mockModel, agent, context, newContent, newMessages, llmView, tools } = makeAgentAndContext('action_day_discuss', 'action_day_discuss', 'call_speech_789', { content: '我是好人，请大家相信我。' });

    await agent._agentLoop(mockModel, context, { name: 'action_day_discuss' }, newContent, newMessages, llmView, tools, '【白天发言】');

    if (agent.mm.messages.length !== 4) throw new Error('agent.mm.messages 应有 4 条消息');

    const assistantMsg = agent.mm.messages[2];
    if (assistantMsg.role !== 'assistant') throw new Error('第三条应为 assistant');
    if (!assistantMsg.tool_calls) throw new Error('发言阶段 assistant 消息应有 tool_calls');
    if (assistantMsg.tool_calls[0].function.name !== 'action_day_discuss') throw new Error('tool_calls 应为 action_day_discuss');

    const toolMsg = agent.mm.messages[3];
    if (toolMsg.role !== 'tool') throw new Error('第四条应为 tool');
    if (!toolMsg.content.includes('我是好人')) throw new Error('tool result 应包含发言内容');
  });
});

describe('阶段决策消息历史', () => {
  it('day_discuss 阶段存储 assistant(tool_calls) + tool', async () => {
    const mockModel = makeMockModel('action_day_discuss', 'call_test_speech', { content: '我是好人，请大家相信我。' });
    const agent = new Agent(1, { mockOptions: {} });
    agent._models = [{ model: mockModel, name: 'MockModel' }];
    agent.mm.messages = [{ role: 'system', content: 'test system' }];

    const newContent = 'test content';
    const newMessages = [];
    const llmView = [
      { role: 'system', content: 'test system' },
      { role: 'user', content: newContent }
    ];
    const tools = [{ type: 'function', function: { name: 'action_day_discuss' } }];
    const context = {
      phase: 'day_discuss',
      action: 'day_discuss',
      players: [{ id: 1, name: '玩家1', alive: true }],
      alivePlayers: [{ id: 1, name: '玩家1', alive: true }],
      messages: [],
      self: { id: 1, name: '玩家1' }
    };

    await agent._agentLoop(mockModel, context, { name: 'action_day_discuss' }, newContent, newMessages, llmView, tools, '【白天发言】');

    const msgs = agent.mm.messages;
    const lastMsg = msgs[msgs.length - 1];
    const secondLastMsg = msgs[msgs.length - 2];

    if (lastMsg.role !== 'tool') throw new Error('最后一条消息应为 tool');
    if (lastMsg.tool_call_id !== 'call_test_speech') throw new Error('tool 消息应有正确的 tool_call_id');
    if (!lastMsg.content.includes('你说')) throw new Error('tool 消息 content 应包含发言内容');

    if (secondLastMsg.role !== 'assistant') throw new Error('倒数第二条消息应为 assistant');
    if (!secondLastMsg.tool_calls) throw new Error('assistant 消息应有 tool_calls');
    if (secondLastMsg.tool_calls[0].function.name !== 'action_day_discuss') throw new Error('tool_calls 应为 action_day_discuss');
  });

  it('post_vote 阶段存储 assistant(tool_calls) + tool', async () => {
    const mockModel = makeMockModel('action_post_vote', 'call_test_vote', { target: '3' });
    const agent = new Agent(1, { mockOptions: {} });
    agent._models = [{ model: mockModel, name: 'MockModel' }];
    agent.mm.messages = [{ role: 'system', content: 'test system' }];

    const newContent = 'test content';
    const newMessages = [];
    const llmView = [
      { role: 'system', content: 'test system' },
      { role: 'user', content: newContent }
    ];
    const tools = [{ type: 'function', function: { name: 'action_post_vote' } }];
    const context = {
      phase: 'day_vote',
      action: 'day_vote',
      players: [{ id: 1, name: '玩家1', alive: true }, { id: 2, name: '玩家2', alive: true }, { id: 3, name: '玩家3', alive: true }],
      alivePlayers: [{ id: 1, name: '玩家1', alive: true }, { id: 2, name: '玩家2', alive: true }, { id: 3, name: '玩家3', alive: true }],
      messages: [],
      self: { id: 1, name: '玩家1' }
    };

    await agent._agentLoop(mockModel, context, { name: 'action_post_vote' }, newContent, newMessages, llmView, tools, '【白天投票】');

    const msgs = agent.mm.messages;
    const lastMsg = msgs[msgs.length - 1];
    const secondLastMsg = msgs[msgs.length - 2];

    if (lastMsg.role !== 'tool') throw new Error('最后一条消息应为 tool');
    if (lastMsg.tool_call_id !== 'call_test_vote') throw new Error('tool 消息应有正确的 tool_call_id');
    if (!lastMsg.content) throw new Error('tool 消息应有 content');

    if (secondLastMsg.role !== 'assistant') throw new Error('倒数第二条消息应为 assistant');
    if (!secondLastMsg.tool_calls) throw new Error('assistant 消息应有 tool_calls');
    if (secondLastMsg.tool_calls[0].function.name !== 'action_post_vote') throw new Error('tool_calls 应为 action_post_vote');
  });

  it('seer 阶段存储 assistant(tool_calls) + tool', async () => {
    const mockModel = makeMockModel('action_seer', 'call_test_seer', { target: '2' });
    const agent = new Agent(1, { mockOptions: {} });
    agent._models = [{ model: mockModel, name: 'MockModel' }];
    agent.mm.messages = [{ role: 'system', content: 'test system' }];

    const newContent = 'test content';
    const newMessages = [];
    const llmView = [
      { role: 'system', content: 'test system' },
      { role: 'user', content: newContent }
    ];
    const tools = [{ type: 'function', function: { name: 'action_seer' } }];
    const context = {
      phase: 'seer',
      action: 'seer',
      players: [{ id: 1, name: '玩家1', alive: true }, { id: 2, name: '玩家2', alive: true }],
      alivePlayers: [{ id: 1, name: '玩家1', alive: true }, { id: 2, name: '玩家2', alive: true }],
      messages: [],
      self: { id: 1, name: '玩家1' }
    };

    await agent._agentLoop(mockModel, context, { name: 'action_seer' }, newContent, newMessages, llmView, tools, '【预言家】');

    const msgs = agent.mm.messages;
    const lastMsg = msgs[msgs.length - 1];
    const secondLastMsg = msgs[msgs.length - 2];

    if (lastMsg.role !== 'tool') throw new Error('最后一条消息应为 tool');
    if (secondLastMsg.role !== 'assistant') throw new Error('倒数第二条消息应为 assistant');
    if (secondLastMsg.tool_calls[0].function.name !== 'action_seer') throw new Error('tool_calls 应为 action_seer');
  });
});

describe('多tool_calls边界', () => {
  it('LLM返回analyze+action_post_vote时只保存期望的action到messages', async () => {
    const mockModel = {
      isAvailable: () => true,
      call: async (context) => {
        return {
          raw: {
            tool_calls: [
              {
                id: 'call_analyze_1',
                function: { name: 'analyze', arguments: JSON.stringify({ thought: '分析局势...' }) }
              },
              {
                id: 'call_vote_2',
                function: { name: 'action_post_vote', arguments: JSON.stringify({ target: '3' }) }
              }
            ]
          },
          messages: context._messagesForLLM || []
        };
      }
    };

    const agent = new Agent(1, { mockOptions: {} });
    agent._models = [{ model: mockModel, name: 'MockModel' }];
    agent.mm.messages = [{ role: 'system', content: 'test system' }];

    const newContent = 'test content';
    const newMessages = [];
    const llmView = [
      { role: 'system', content: 'test system' },
      { role: 'user', content: newContent }
    ];
    const tools = [
      { type: 'function', function: { name: 'analyze' } },
      { type: 'function', function: { name: 'action_post_vote' } }
    ];
    const context = {
      phase: 'day_vote',
      action: 'day_vote',
      players: [{ id: 1, name: '玩家1', alive: true }, { id: 2, name: '玩家2', alive: true }, { id: 3, name: '玩家3', alive: true }],
      alivePlayers: [{ id: 1, name: '玩家1', alive: true }, { id: 2, name: '玩家2', alive: true }, { id: 3, name: '玩家3', alive: true }],
      messages: [],
      self: { id: 1, name: '玩家1' }
    };

    await agent._agentLoop(mockModel, context, { name: 'action_post_vote' }, newContent, newMessages, llmView, tools, '【白天投票】');

    const assistantMsg = llmView.find(m => m.role === 'assistant' && m.tool_calls);
    const toolMsgs = llmView.filter(m => m.role === 'tool');

    if (assistantMsg?.tool_calls?.length !== 2) throw new Error('llmView 应包含 2 个 tool_calls');
    if (toolMsgs.length !== 2) throw new Error('llmView 应包含 2 个 tool 结果');

    const savedAssistant = agent.mm.messages.find(m => m.role === 'assistant' && m.tool_calls);
    const savedTool = agent.mm.messages.find(m => m.role === 'tool');

    if (savedAssistant?.tool_calls?.length !== 1) throw new Error('this.messages 应只保存 1 个 tool_call');
    if (savedAssistant?.tool_calls?.[0]?.function?.name !== 'action_post_vote') throw new Error('保存的 tool_call 应为 action_post_vote');
    if (savedTool?.tool_call_id !== 'call_vote_2') throw new Error('保存的 tool 消息应对应 action_post_vote');
  });
});

run();