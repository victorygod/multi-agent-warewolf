const { describe, it, run } = require('../../helpers/test-runner');
const { buildMessage, formatVoteDetails } = require('../../../engine/message_template');
const { getPlayerDisplay } = require('../../../engine/utils');
const { MSG_TEMPLATE: TEMPLATES } = require('../../../engine/constants');

describe('buildMessage', () => {
  it('使用{player}占位符', () => {
    const result = buildMessage('WITHDRAW', { player: '3号张三' });
    if (result !== '[系统]3号张三退水') throw new Error(`期望"[系统]3号张三退水"，实际"${result}"`);
  });

  it('使用{target}占位符', () => {
    const result = buildMessage('HUNTER_SHOOT', { player: '3号张三', target: '5号李四' });
    if (result !== '[系统]3号张三开枪带走了5号李四') throw new Error(`格式错误: ${result}`);
  });

  it('使用{票型}占位符', () => {
    const result = buildMessage('DAY_VOTE', { 票型: '5号(1,2,3)' });
    if (!result.includes('5号(1,2,3)')) throw new Error(`格式错误: ${result}`);
  });

  it('空参数返回模板原样', () => {
    const result = buildMessage('PEACEFUL_NIGHT', {});
    if (result !== '[系统]昨夜平安夜') throw new Error(`期望"[系统]昨夜平安夜"，实际"${result}"`);
  });

  it('未知模板返回空字符串', () => {
    const result = buildMessage('UNKNOWN_TEMPLATE', { player: 'test' });
    if (result !== '') throw new Error(`期望空字符串，实际"${result}"`);
  });
});

describe('MSG_TEMPLATE完整性', () => {
  const requiredTemplates = [
    'SEER_CHECK', 'GUARD_PROTECT', 'WITCH_HEAL', 'WITCH_POISON',
    'CUPID_LINK_SELF', 'CUPLE_NOTIFY', 'WEREWOLF_EXPLODE',
    'WITHDRAW', 'SHERIFF_ASSIGN_ORDER', 'SHERIFF_ELECTED',
    'VOTE_ANNOUNCE', 'HUNTER_SHOOT', 'HUNTER_PASS',
    'NIGHT_DEATH', 'PEACEFUL_NIGHT', 'GAME_OVER'
  ];

  requiredTemplates.forEach(template => {
    it(`包含${template}模板`, () => {
      if (!TEMPLATES[template]) throw new Error(`缺少模板: ${template}`);
    });
  });
});

describe('getPlayerDisplay', () => {
  const players = [
    { id: 1, name: '张三' },
    { id: 2, name: '李四' },
    { id: 3, name: '王五' }
  ];

  it('返回id号name格式', () => {
    const result = getPlayerDisplay(players, players[0]);
    if (result !== '1号张三') throw new Error(`期望"1号张三"，实际"${result}"`);
  });

  it('不同id返回正确格式', () => {
    const result = getPlayerDisplay(players, players[1]);
    if (result !== '2号李四') throw new Error(`期望"2号李四"，实际"${result}"`);
  });

  it('null player返回未知', () => {
    const result = getPlayerDisplay(players, null);
    if (result !== '未知') throw new Error(`期望"未知"，实际"${result}"`);
  });

  it('空players数组不检查，直接返回player格式', () => {
    const result = getPlayerDisplay([], players[0]);
    if (result !== '1号张三') throw new Error(`期望"1号张三"，实际"${result}"`);
  });
});

describe('formatVoteDetails', () => {
  it('正确聚合投票', () => {
    const voteDetails = [
      { voter: '1号张三', target: '3号李四' },
      { voter: '2号王五', target: '3号李四' },
      { voter: '3号李四', target: '弃权' }
    ];
    const result = formatVoteDetails(voteDetails);
    if (!result.includes('3号李四(1号张三,2号王五)')) throw new Error(`格式错误: ${result}`);
    if (!result.includes('弃权(3号李四)')) throw new Error(`格式错误: ${result}`);
  });

  it('空数组返回空字符串', () => {
    const result = formatVoteDetails([]);
    if (result !== '') throw new Error(`期望空字符串，实际"${result}"`);
  });
});

run();