const { describe, it, run } = require('../../helpers/test-runner');
const {
  getPlayerDisplay, formatMessageHistory,
  buildToolResultMessage
} = require('../../../ai/agent/formatter');

const players = [
  { id: 1, name: '张三' },
  { id: 2, name: '李四' },
  { id: 3, name: '王五' },
  { id: 4, name: '赵六' }
];

describe('formatter - getPlayerDisplay', () => {
  it('返回N号Name格式', () => {
    if (getPlayerDisplay(1, players) !== '1号张三') throw new Error('格式错误');
  });

  it('找不到玩家返回N号', () => {
    if (getPlayerDisplay(99, players) !== '99号') throw new Error('应返回99号');
  });

  it('字符串ID也能匹配', () => {
    if (getPlayerDisplay('2', players) !== '2号李四') throw new Error('字符串ID应匹配');
  });
});

describe('formatter - formatMessageHistory', () => {
  it('空消息返回空字符串', () => {
    if (formatMessageHistory([], players) !== '') throw new Error('应返回空字符串');
  });

  it('null返回空字符串', () => {
    if (formatMessageHistory(null, players) !== '') throw new Error('应返回空字符串');
  });

  it('phase_start被跳过', () => {
    const msgs = [
      { type: 'phase_start', phase: 'night_werewolf_vote', round: 1 }
    ];
    const result = formatMessageHistory(msgs, players);
    if (result !== '') throw new Error('phase_start不应输出内容');
  });

  it('系统消息显示第N夜', () => {
    const msgs = [
      { type: 'system', content: '[系统]第1夜', round: 1 }
    ];
    const result = formatMessageHistory(msgs, players);
    if (!result.includes('第1夜')) throw new Error('应显示第1夜');
  });

  it('系统消息显示第N天', () => {
    const msgs = [
      { type: 'system', content: '[系统]第1天', round: 1 }
    ];
    const result = formatMessageHistory(msgs, players);
    if (!result.includes('第1天')) throw new Error('应显示第1天');
  });

  it('系统消息直接显示content', () => {
    const msgs = [
      { type: 'system', content: '[系统]昨夜平安夜' }
    ];
    const result = formatMessageHistory(msgs, players);
    if (!result.includes('昨夜平安夜')) throw new Error('应显示系统消息内容');
  });

  it('发言消息直接显示content', () => {
    const msgs = [
      { type: 'speech', content: '[发言|3号张三]我是好人', visibility: 'public' }
    ];
    const result = formatMessageHistory(msgs, players);
    if (!result.includes('[发言|3号张三]我是好人')) throw new Error('应显示发言内容');
  });

  it('格式化所有消息（可见性由controller过滤）', () => {
    const msgs = [
      { type: 'action', content: '[私密]你查验了3号', visibility: 'self', playerId: 1 },
      { type: 'system', content: '[系统]游戏开始', visibility: 'public' }
    ];
    const wolf = { id: 2, name: '狼', role: { camp: 'wolf' } };
    const result = formatMessageHistory(msgs, players, wolf);
    if (!result.includes('你查验了')) throw new Error('应显示所有消息（可见性由controller过滤）');
    if (!result.includes('游戏开始')) throw new Error('应显示公开消息');
  });

  it('游戏结束格式', () => {
    const msgs = [
      { type: 'game_over', content: '[系统]游戏结束：好人阵营获胜' }
    ];
    const result = formatMessageHistory(msgs, players);
    if (!result.includes('游戏结束')) throw new Error('应显示游戏结束');
  });
});

describe('formatter - buildToolResultMessage', () => {
  const ctx = { players, werewolfTarget: { id: 3 } };

  it('投票结果', () => {
    const result = buildToolResultMessage('action_post_vote', { target: 2 }, ctx);
    if (!result.includes('投票给了') || !result.includes('2号李四')) throw new Error('格式错误');
  });

  it('弃权', () => {
    const result = buildToolResultMessage('action_post_vote', { skip: true }, ctx);
    if (!result.includes('弃权')) throw new Error('应显示弃权');
  });

  it('女巫救人', () => {
    const result = buildToolResultMessage('action_witch', { action: 'heal' }, ctx);
    if (!result.includes('解药')) throw new Error('应显示解药');
  });

  it('女巫毒杀', () => {
    const result = buildToolResultMessage('action_witch', { action: 'poison', target: 4 }, ctx);
    if (!result.includes('毒药')) throw new Error('应显示毒药');
  });

  it('预言家查验', () => {
    const result = buildToolResultMessage('action_seer', { target: 2 }, ctx);
    if (!result.includes('查验了')) throw new Error('应显示查验');
  });

  it('守卫守护', () => {
    const result = buildToolResultMessage('action_guard', { target: 2 }, ctx);
    if (!result.includes('守护了')) throw new Error('应显示守护');
  });

  it('丘比特连线', () => {
    const result = buildToolResultMessage('action_cupid', { targets: [2, 3] }, ctx);
    if (!result.includes('连接为情侣')) throw new Error('应显示情侣');
  });

  it('猎人开枪', () => {
    const result = buildToolResultMessage('action_shoot', { target: 2 }, ctx);
    if (!result.includes('开枪带走了')) throw new Error('应显示开枪');
  });

  it('猎人放弃开枪', () => {
    const result = buildToolResultMessage('action_shoot', { target: null }, ctx);
    if (!result.includes('放弃开枪')) throw new Error('应显示放弃开枪');
  });

  it('竞选警长', () => {
    const result = buildToolResultMessage('action_sheriff_campaign', { run: true }, ctx);
    if (!result.includes('参与警长竞选')) throw new Error('应显示参与竞选');
  });

  it('退水', () => {
    const result = buildToolResultMessage('action_withdraw', { withdraw: true }, ctx);
    if (!result.includes('退出警长竞选')) throw new Error('应显示退水');
  });

  it('传警徽', () => {
    const result = buildToolResultMessage('action_passBadge', { target: 2 }, ctx);
    if (!result.includes('警徽传给了')) throw new Error('应显示传警徽');
  });

  it('指定发言顺序', () => {
    const result = buildToolResultMessage('action_assignOrder', { target: 2 }, ctx);
    if (!result.includes('指定从') || !result.includes('开始发言')) throw new Error('应显示指定发言');
  });

  it('发言内容', () => {
    const result = buildToolResultMessage('action_day_discuss', { content: '我是好人' }, ctx);
    if (!result.includes('你说') || !result.includes('我是好人')) throw new Error('应显示发言');
  });

  it('未知工具返回操作成功', () => {
    const result = buildToolResultMessage('action_unknown', {}, ctx);
    if (result !== '操作成功') throw new Error('应返回操作成功');
  });
});

run();