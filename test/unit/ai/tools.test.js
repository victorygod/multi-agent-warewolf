const { describe, it, run } = require('../../helpers/test-runner');
const { getTool, getToolsForAction } = require('../../../ai/agent/tools');

const alivePlayers = [
  { id: 1, name: '张三' },
  { id: 2, name: '李四' },
  { id: 3, name: '王五' },
  { id: 4, name: '赵六' }
];

describe('tools - getTool', () => {
  it('获取投票工具', () => {
    const tool = getTool('action_post_vote');
    if (!tool || !tool.execute) throw new Error('应返回投票工具');
  });

  it('获取女巫工具', () => {
    const tool = getTool('action_witch');
    if (!tool || !tool.execute) throw new Error('应返回女巫工具');
  });

  it('获取预言家工具', () => {
    const tool = getTool('action_seer');
    if (!tool || !tool.execute) throw new Error('应返回预言家工具');
  });

  it('不存在的工具返回null', () => {
    if (getTool('action_nonexistent') !== null) throw new Error('应返回null');
  });
});

describe('tools - getToolsForAction', () => {
  it('返回OpenAI格式schema', () => {
    const tools = getToolsForAction('action_post_vote', { alivePlayers, extraData: {} });
    if (!Array.isArray(tools) || tools.length !== 1) throw new Error('应返回单元素数组');
    if (tools[0].type !== 'function') throw new Error('type应为function');
    if (!tools[0].function?.name) throw new Error('应有function.name');
  });

  it('不存在的action返回空数组', () => {
    const tools = getToolsForAction('action_nonexistent', { alivePlayers });
    if (tools.length !== 0) throw new Error('应返回空数组');
  });
});

describe('tools - 投票工具 execute', () => {
  const ctx = { alivePlayers, extraData: { allowedTargets: [2, 3, 4] } };

  it('有效投票', () => {
    const tool = getTool('action_post_vote');
    const result = tool.execute({ target: 3 }, ctx);
    if (!result.success || result.action.target !== 3) throw new Error('应投票成功');
  });

  it('弃权', () => {
    const tool = getTool('action_post_vote');
    const result = tool.execute({ target: null }, ctx);
    if (!result.success || !result.skip) throw new Error('应弃权成功');
  });

  it('null输入弃权', () => {
    const tool = getTool('action_post_vote');
    const result = tool.execute(null, ctx);
    if (!result.success || !result.skip) throw new Error('null应弃权');
  });

  it('无效目标返回错误', () => {
    const tool = getTool('action_post_vote');
    const result = tool.execute({ target: 99 }, ctx);
    if (result.success) throw new Error('无效目标应失败');
  });

  it('不在可选范围内返回错误', () => {
    const tool = getTool('action_post_vote');
    const result = tool.execute({ target: 1 }, ctx);
    if (result.success) throw new Error('不在可选范围应失败');
  });

  it('字符串数字目标', () => {
    const tool = getTool('action_post_vote');
    const result = tool.execute('3', ctx);
    if (!result.success || result.action.target !== 3) throw new Error('字符串数字应解析成功');
  });
});

describe('tools - 讨论工具 execute', () => {
  it('有效发言', () => {
    const tool = getTool('action_day_discuss');
    const result = tool.execute({ content: '我是好人' }, {});
    if (!result.success || result.action.content !== '我是好人') throw new Error('应发言成功');
  });

  it('空内容弃权', () => {
    const tool = getTool('action_day_discuss');
    const result = tool.execute({ content: '' }, {});
    if (!result.success || !result.skip) throw new Error('空内容应弃权');
  });

  it('null弃权', () => {
    const tool = getTool('action_day_discuss');
    const result = tool.execute(null, {});
    if (!result.success || !result.skip) throw new Error('null应弃权');
  });

  it('错误参数名返回错误', () => {
    const tool = getTool('action_day_discuss');
    const result = tool.execute({ text: '你好' }, {});
    if (result.success) throw new Error('错误参数名应失败');
  });
});

describe('tools - 女巫工具 execute', () => {
  it('救人', () => {
    const tool = getTool('action_witch');
    const ctx = { alivePlayers, witchPotion: { heal: true, poison: true } };
    const result = tool.execute({ action: 'heal' }, ctx);
    if (!result.success || result.action.action !== 'heal') throw new Error('救人应成功');
  });

  it('毒杀', () => {
    const tool = getTool('action_witch');
    const ctx = { alivePlayers, witchPotion: { heal: false, poison: true }, extraData: { poisonTargets: [2, 3] } };
    const result = tool.execute({ action: 'poison', target: 3 }, ctx);
    if (!result.success || result.action.targetId !== 3) throw new Error('毒杀应成功');
  });

  it('跳过', () => {
    const tool = getTool('action_witch');
    const ctx = { alivePlayers, witchPotion: { heal: false, poison: false } };
    const result = tool.execute({ action: 'skip' }, ctx);
    if (!result.success || !result.skip) throw new Error('跳过应成功');
  });

  it('解药用完不能救', () => {
    const tool = getTool('action_witch');
    const ctx = { alivePlayers, witchPotion: { heal: false, poison: true } };
    const result = tool.execute({ action: 'heal' }, ctx);
    if (result.success) throw new Error('解药用完应失败');
  });

  it('毒药用完不能毒', () => {
    const tool = getTool('action_witch');
    const ctx = { alivePlayers, witchPotion: { heal: true, poison: false } };
    const result = tool.execute({ action: 'poison', target: 3 }, ctx);
    if (result.success) throw new Error('毒药用完应失败');
  });

  it('毒杀无目标返回错误', () => {
    const tool = getTool('action_witch');
    const ctx = { alivePlayers, witchPotion: { heal: false, poison: true } };
    const result = tool.execute({ action: 'poison' }, ctx);
    if (result.success) throw new Error('毒杀无目标应失败');
  });

  it('字符串简写格式', () => {
    const tool = getTool('action_witch');
    const ctx = { alivePlayers, witchPotion: { heal: true, poison: true } };
    const result = tool.execute('heal', ctx);
    if (!result.success || result.action.action !== 'heal') throw new Error('字符串简写应成功');
  });

  it('null弃权', () => {
    const tool = getTool('action_witch');
    const result = tool.execute(null, {});
    if (!result.success || !result.skip) throw new Error('null应弃权');
  });
});

describe('tools - 预言家工具 execute', () => {
  const ctx = { alivePlayers, extraData: { allowedTargets: [2, 3, 4] } };

  it('查验有效目标', () => {
    const tool = getTool('action_seer');
    const result = tool.execute({ target: 2 }, ctx);
    if (!result.success || result.action.target !== 2) throw new Error('查验应成功');
  });

  it('弃权', () => {
    const tool = getTool('action_seer');
    const result = tool.execute(null, ctx);
    if (!result.success || !result.skip) throw new Error('弃权应成功');
  });
});

describe('tools - 丘比特工具 execute', () => {
  const ctx = { alivePlayers };

  it('连接两人', () => {
    const tool = getTool('action_cupid');
    const result = tool.execute({ targets: [2, 3] }, ctx);
    if (!result.success) throw new Error('连线应成功');
    if (result.action.targets[0] !== 2 || result.action.targets[1] !== 3) throw new Error('目标应正确');
  });

  it('数组简写', () => {
    const tool = getTool('action_cupid');
    const result = tool.execute([2, 3], ctx);
    if (!result.success) throw new Error('数组简写应成功');
  });

  it('只选一人返回错误', () => {
    const tool = getTool('action_cupid');
    const result = tool.execute({ targets: [2] }, ctx);
    if (result.success) throw new Error('只选一人应失败');
  });

  it('选同一人返回错误', () => {
    const tool = getTool('action_cupid');
    const result = tool.execute({ targets: [2, 2] }, ctx);
    if (result.success) throw new Error('选同一人应失败');
  });

  it('null弃权', () => {
    const tool = getTool('action_cupid');
    const result = tool.execute(null, ctx);
    if (!result.success || !result.skip) throw new Error('null应弃权');
  });
});

describe('tools - 猎人工具 execute', () => {
  const ctx = { alivePlayers, extraData: { allowedTargets: [2, 3, 4] }, self: { id: 1 } };

  it('开枪', () => {
    const tool = getTool('action_shoot');
    const result = tool.execute({ target: 3 }, ctx);
    if (!result.success || result.action.target !== 3) throw new Error('开枪应成功');
  });

  it('放弃开枪', () => {
    const tool = getTool('action_shoot');
    const result = tool.execute({ target: null }, ctx);
    if (!result.success || !result.skip) throw new Error('放弃开枪应成功');
  });
});

describe('tools - 警长竞选工具 execute', () => {
  it('参与竞选', () => {
    const tool = getTool('action_sheriff_campaign');
    const result = tool.execute({ run: true }, {});
    if (!result.success || !result.action.run) throw new Error('参与竞选应成功');
  });

  it('不参与', () => {
    const tool = getTool('action_sheriff_campaign');
    const result = tool.execute({ run: false }, {});
    if (!result.success || !result.skip) throw new Error('不参与应弃权');
  });

  it('null弃权', () => {
    const tool = getTool('action_sheriff_campaign');
    const result = tool.execute(null, {});
    if (!result.success || !result.skip) throw new Error('null应弃权');
  });
});

describe('tools - 退水工具 execute', () => {
  it('退水', () => {
    const tool = getTool('action_withdraw');
    const result = tool.execute({ withdraw: true }, {});
    if (!result.success || !result.action.withdraw) throw new Error('退水应成功');
  });

  it('继续参选', () => {
    const tool = getTool('action_withdraw');
    const result = tool.execute({ withdraw: false }, {});
    if (!result.success || !result.skip) throw new Error('不退水应弃权');
  });
});

describe('tools - 传警徽工具 execute', () => {
  const ctx = { alivePlayers, extraData: { allowedTargets: [2, 3, 4] } };

  it('传警徽', () => {
    const tool = getTool('action_passBadge');
    const result = tool.execute({ target: 2 }, ctx);
    if (!result.success || result.action.target !== 2) throw new Error('传警徽应成功');
  });

  it('不传警徽', () => {
    const tool = getTool('action_passBadge');
    const result = tool.execute({ target: null }, ctx);
    if (!result.success || !result.skip) throw new Error('不传应弃权');
  });
});

describe('tools - buildSchema', () => {
  it('投票工具schema含allowedTargets', () => {
    const tool = getTool('action_post_vote');
    const ctx = { alivePlayers, extraData: { allowedTargets: [2, 3, 4] } };
    const schema = tool.buildSchema(ctx);
    if (schema.parameters.properties.target.enum.length !== 3) throw new Error('应包含3个可选目标');
  });

  it('女巫工具schema含heal/poison/skip', () => {
    const tool = getTool('action_witch');
    const ctx = { alivePlayers, witchPotion: { heal: true, poison: true } };
    const schema = tool.buildSchema(ctx);
    const actions = schema.parameters.properties.action.enum;
    if (!actions.includes('heal') || !actions.includes('poison') || !actions.includes('skip')) {
      throw new Error('应包含heal/poison/skip');
    }
  });

  it('预言家schema排除已查验', () => {
    const tool = getTool('action_seer');
    const ctx = { alivePlayers, self: { id: 1, seerChecks: [{ targetId: 2 }] } };
    const schema = tool.buildSchema(ctx);
    if (schema.parameters.properties.target.enum.includes(2)) throw new Error('应排除已查验目标');
    if (schema.parameters.properties.target.enum.includes(1)) throw new Error('应排除自己');
  });

  it('守卫schema排除上次守护', () => {
    const tool = getTool('action_guard');
    const ctx = { alivePlayers, self: { id: 1, lastGuardTarget: 3 } };
    const schema = tool.buildSchema(ctx);
    if (schema.parameters.properties.target.enum.includes(3)) throw new Error('应排除上次守护目标');
  });
});

run();