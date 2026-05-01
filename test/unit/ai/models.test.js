const { describe, it, run } = require('../../helpers/test-runner');
const { MockModel } = require('../../../ai/agent/models/mock_model');

describe('MockModel - 基础功能', () => {
  it('isAvailable始终返回true', () => {
    const model = new MockModel();
    if (model.isAvailable() !== true) throw new Error('应返回true');
  });

  it('call返回预设响应', async () => {
    const model = new MockModel();
    model.setResponse('action_post_vote', { target: 3 });
    const result = await model.call({ action: 'action_post_vote' });
    if (!result || !result.raw) throw new Error('应返回响应');
  });

  it('记录调用历史', async () => {
    const model = new MockModel();
    model.setResponse('action_post_vote', { target: 3 });
    await model.call({ action: 'action_post_vote' });
    const history = model.getCallHistory();
    if (history.length !== 1) throw new Error('应有1条调用记录');
  });

  it('clear清空所有设置', async () => {
    const model = new MockModel();
    model.setResponse('action_post_vote', { target: 3 });
    model.clear();
    const history = model.getCallHistory();
    if (history.length !== 0) throw new Error('调用历史应被清空');
  });

  it('clearCallHistory只清空历史', async () => {
    const model = new MockModel();
    model.setResponse('action_post_vote', { target: 3 });
    await model.call({ action: 'action_post_vote' });
    model.clearCallHistory();
    if (model.getCallHistory().length !== 0) throw new Error('历史应被清空');
  });
});

describe('MockModel - normalizeResponse', () => {
  it('数字转为target字符串', () => {
    const model = new MockModel();
    const result = model.normalizeResponse('action_post_vote', 3);
    if (result.target !== '3') throw new Error('数字应转为target字符串');
  });

  it('字符串保留为content', () => {
    const model = new MockModel();
    const result = model.normalizeResponse('action_day_discuss', '我是好人');
    if (result.content !== '我是好人') throw new Error('字符串应保留为content');
  });

  it('对象直接返回', () => {
    const model = new MockModel();
    const result = model.normalizeResponse('action_post_vote', { target: 3 });
    if (result.target !== 3) throw new Error('对象应直接返回');
  });

  it('boolean保留', () => {
    const model = new MockModel();
    const result = model.normalizeResponse('action_sheriff_campaign', true);
    if (result.run !== true) throw new Error('boolean应转为run');
  });
});

describe('MockModel - 快捷设置', () => {
  it('setVoteTarget', async () => {
    const model = new MockModel();
    model.setVoteTarget(5);
    const result = await model.call({ action: 'action_post_vote' });
    if (!result) throw new Error('应返回响应');
  });

  it('setSpeech', async () => {
    const model = new MockModel();
    model.setSpeech('我是好人');
    const result = await model.call({ action: 'action_day_discuss' });
    if (!result) throw new Error('应返回响应');
  });

  it('setSeerCheck', async () => {
    const model = new MockModel();
    model.setSeerCheck(3);
    const result = await model.call({ action: 'action_seer' });
    if (!result) throw new Error('应返回响应');
  });

  it('setGuardTarget', async () => {
    const model = new MockModel();
    model.setGuardTarget(3);
    const result = await model.call({ action: 'action_guard' });
    if (!result) throw new Error('应返回响应');
  });

  it('setHunterShoot', async () => {
    const model = new MockModel();
    model.setHunterShoot(3);
    const result = await model.call({ action: 'action_shoot' });
    if (!result) throw new Error('应返回响应');
  });

  it('setCampaign', async () => {
    const model = new MockModel();
    model.setCampaign(true);
    const result = await model.call({ action: 'action_sheriff_campaign' });
    if (!result) throw new Error('应返回响应');
  });

  it('setWithdraw', async () => {
    const model = new MockModel();
    model.setWithdraw(true);
    const result = await model.call({ action: 'action_withdraw' });
    if (!result) throw new Error('应返回响应');
  });

  it('setPassBadge', async () => {
    const model = new MockModel();
    model.setPassBadge(3);
    const result = await model.call({ action: 'action_passBadge' });
    if (!result) throw new Error('应返回响应');
  });

  it('setCupidLinks', async () => {
    const model = new MockModel();
    model.setCupidLinks(2, 3);
    const result = await model.call({ action: 'action_cupid' });
    if (!result) throw new Error('应返回响应');
  });
});

describe('MockModel - 行为序列', () => {
  it('按序列返回响应', async () => {
    const model = new MockModel();
    model.setBehaviorSequence([
      { phase: 'night', response: { target: 3 } },
      { phase: 'day', response: { content: '发言' } }
    ]);
    const r1 = await model.call({ action: 'action_night_werewolf_vote', phase: 'night' });
    const r2 = await model.call({ action: 'action_day_discuss', phase: 'day' });
    if (!r1 || !r2) throw new Error('序列响应应成功');
  });

  it('addBehavior追加行为', async () => {
    const model = new MockModel();
    model.addBehavior('night', { target: 3 });
    const result = await model.call({ action: 'action_seer', phase: 'night' });
    if (!result) throw new Error('追加行为应成功');
  });

  it('resetSequence重置索引', () => {
    const model = new MockModel();
    model.setBehaviorSequence([{ phase: 'night', response: { target: 3 } }]);
    const r1 = model.getSequenceResponse('night', 'action_seer');
    model.resetSequence();
    const r2 = model.getSequenceResponse('night', 'action_seer');
    if (r1 === undefined) throw new Error('首次应能获取');
    if (r2 === undefined) throw new Error('重置后应能重新获取');
  });
});

describe('MockModel - 自定义策略', () => {
  it('setStrategy按阶段自定义', async () => {
    const model = new MockModel();
    model.setStrategy('action_post_vote', (ctx) => ({ target: ctx.alivePlayers?.[0]?.id || 1 }));
    const result = await model.call({ action: 'action_post_vote', alivePlayers: [{ id: 5, name: 'A' }] });
    if (!result) throw new Error('自定义策略应成功');
  });
});

describe('MockModel - getLastCall和getCallsByPhase', () => {
  it('getLastCall返回最后一次调用', async () => {
    const model = new MockModel();
    model.setResponse('action_post_vote', { target: 3 });
    await model.call({ action: 'action_post_vote', phase: 'day' });
    const last = model.getLastCall();
    if (!last) throw new Error('应有调用记录');
  });

  it('getCallsByPhase按阶段过滤', async () => {
    const model = new MockModel();
    model.setResponse('action_post_vote', { target: 3 });
    await model.call({ action: 'action_post_vote', phase: 'day' });
    await model.call({ action: 'action_post_vote', phase: 'night' });
    const dayCalls = model.getCallsByPhase('day');
    if (dayCalls.length !== 1) throw new Error('应有1条白天调用');
  });
});

run();