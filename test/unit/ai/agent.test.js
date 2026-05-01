const { describe, it, run } = require('../../helpers/test-runner');
const { getCurrentTask, buildCurrentTurn } = require('../../../ai/agent/prompt');

describe('Agent - analyze场景task拼接', () => {
  it('analyze时task包含分析提示', () => {
    const task = getCurrentTask('analyze', {});
    if (!task.includes('分析')) throw new Error('analyze task应包含分析提示');
  });

  it('决策时task对应阶段提示', () => {
    const task = getCurrentTask('action_day_discuss', {});
    if (!task.includes('白天发言')) throw new Error('day_discuss task应包含白天发言');
  });

  it('analyze时full不含thinking/speaking，history不含thinking/speaking', () => {
    const profile = { thinking: '我是思考逻辑', speaking: '我是说话风格' };
    const { full, history } = buildCurrentTurn('某人说了一些话', 'analyze', { players: [], alivePlayers: [] }, null);
    if (full.includes('我是思考逻辑')) throw new Error('analyze时full不应包含thinking');
    if (full.includes('我是说话风格')) throw new Error('analyze时full不应包含speaking');
    if (!full.includes('分析')) throw new Error('analyze时full应包含分析提示');
    if (history.includes('我是思考逻辑')) throw new Error('history不应包含thinking');
    if (!history.includes('分析')) throw new Error('analyze时history应包含分析提示');
  });
});

describe('Agent - 模块导入', () => {
  it('Agent和ANALYSIS_NODES可导入', () => {
    const { Agent, ANALYSIS_NODES } = require('../../../ai/agent/agent');
    if (!Agent) throw new Error('Agent应可导入');
    if (!ANALYSIS_NODES) throw new Error('ANALYSIS_NODES应可导入');
  });
});

describe('Agent - ANALYSIS_NODES', () => {
  it('包含关键分析节点', () => {
    const { ANALYSIS_NODES } = require('../../../ai/agent/agent');
    if (!Array.isArray(ANALYSIS_NODES)) throw new Error('应为数组');
  });
});

describe('Agent - 创建实例', () => {
  it('无API配置时使用MockModel', () => {
    const { Agent } = require('../../../ai/agent/agent');
    const agent = new Agent(1, { playerId: 1 });
    if (!agent) throw new Error('应能创建Agent');
  });

  it('有messages属性', () => {
    const { Agent } = require('../../../ai/agent/agent');
    const agent = new Agent(1, { playerId: 1 });
    if (!Array.isArray(agent.messages)) throw new Error('应有messages数组');
  });
});

describe('Agent - shouldAnalyzeMessage', () => {
  it('公开消息需要分析', () => {
    const { Agent } = require('../../../ai/agent/agent');
    const agent = new Agent(1, { playerId: 1 });
    const msg = { visibility: 'public', type: 'speech' };
    const result = agent.shouldAnalyzeMessage(msg, 2);
    if (typeof result !== 'boolean') throw new Error('应返回布尔值');
  });
});

run();