const { describe, it, run } = require('../../helpers/test-runner');
const {
  formatMessageHistory,
  getPlayerDisplay
} = require('../../../ai/agent/formatter');
const { buildSystemPrompt, getCurrentTask } = require('../../../ai/agent/prompt');

const mockPlayers = [
  { id: 1, name: '小明', role: { id: 'seer', camp: 'good' } },
  { id: 2, name: '小红', role: { id: 'villager', camp: 'good' } },
  { id: 3, name: '小刚', role: { id: 'werewolf', camp: 'wolf' } },
  { id: 4, name: '小丽', role: { id: 'werewolf', camp: 'wolf' } },
  { id: 5, name: '小华', role: { id: 'witch', camp: 'good' } }
];

describe('formatMessageHistory - 简化版', () => {
  it('系统消息显示第N夜', () => {
    const messages = [
      { type: 'system', content: '[系统]第1夜', round: 1 }
    ];
    const result = formatMessageHistory(messages, mockPlayers);
    if (!result.includes('第1夜')) throw new Error('应显示第1夜');
  });

  it('系统消息显示第N天', () => {
    const messages = [
      { type: 'system', content: '[系统]第1天', round: 1 }
    ];
    const result = formatMessageHistory(messages, mockPlayers);
    if (!result.includes('第1天')) throw new Error('应显示第1天');
  });

  it('多个夜晚/白天正确计数', () => {
    const messages = [
      { type: 'system', content: '[系统]第1夜', round: 1 },
      { type: 'system', content: '[系统]第1天', round: 1 },
      { type: 'system', content: '[系统]第2夜', round: 2 },
      { type: 'system', content: '[系统]第2天', round: 2 }
    ];
    const result = formatMessageHistory(messages, mockPlayers);
    if (!result.includes('第1夜')) throw new Error('应有第1夜');
    if (!result.includes('第1天')) throw new Error('应有第1天');
    if (!result.includes('第2夜')) throw new Error('应有第2夜');
    if (!result.includes('第2天')) throw new Error('应有第2天');
  });

  it('直接显示带标签的content', () => {
    const messages = [
      { type: 'speech', content: '[发言|1号小明]我是预言家', visibility: 'public' }
    ];
    const result = formatMessageHistory(messages, mockPlayers);
    if (!result.includes('[发言|1号小明]我是预言家')) throw new Error('应显示完整content');
  });

  it('格式化所有消息（可见性由controller过滤）', () => {
    const messages = [
      { type: 'action', content: '[私密]你查验了3号', visibility: 'self', playerId: 1 },
      { type: 'system', content: '[系统]游戏开始', visibility: 'public' }
    ];
    const wolf = { id: 3, name: '小刚', role: { camp: 'wolf' } };
    const result = formatMessageHistory(messages, mockPlayers, wolf);
    if (!result.includes('你查验了')) throw new Error('应显示所有消息（可见性由controller过滤）');
    if (!result.includes('游戏开始')) throw new Error('应显示公开消息');
  });

  it('情侣消息可见', () => {
    const messages = [
      { type: 'system', content: '[私密]你的伴侣是2号', visibility: 'couple', playerId: 1 }
    ];
    const result = formatMessageHistory(messages, mockPlayers);
    if (!result.includes('你的伴侣是2号')) throw new Error('应显示情侣消息');
  });

  it('狼人可见队友消息', () => {
    const messages = [
      { type: 'system', content: '[狼人讨论|3号小刚]刀5号', visibility: 'camp', playerId: 3 }
    ];
    const wolf = { id: 3, name: '小刚', role: { camp: 'wolf' } };
    const result = formatMessageHistory(messages, mockPlayers, wolf);
    if (!result.includes('刀5号')) throw new Error('狼人应看到队友的camp消息');
  });
});

describe('完整流程格式化', () => {
  it('完整夜晚流程', () => {
    const messages = [
      { type: 'system', content: '[系统]第1夜', round: 1 },
      { type: 'wolf_speech', content: '[狼人讨论|3号小刚]刀5号吧', visibility: 'camp', playerId: 3 },
      { type: 'wolf_vote_result', content: '[私密]狼刀票型：5号小华(3号小刚,4号小丽)', visibility: 'camp' },
      { type: 'action', content: '[私密]5号小华使用解药', visibility: 'self', playerId: 5 }
    ];
    const wolfPlayer = mockPlayers.find(p => p.id === 3);
    const result = formatMessageHistory(messages, mockPlayers, wolfPlayer);
    if (!result.includes('第1夜')) throw new Error('应包含第1夜');
    if (!result.includes('刀5号吧')) throw new Error('应包含狼人发言');
  });

  it('完整白天流程', () => {
    const messages = [
      { type: 'system', content: '[系统]第1天', round: 1 },
      { type: 'death_announce', content: '[系统]5号小华死亡' },
      { type: 'sheriff_candidates', content: '警上：1号小明 警下：2号小红' },
      { type: 'speech', content: '[警长竞选发言|1号小明]我是预言家' },
      { type: 'vote_result', content: '票型：1号小明(2号小红)' },
      { type: 'sheriff_elected', content: '[警长]1号小明当选' }
    ];
    const result = formatMessageHistory(messages, mockPlayers);
    if (!result.includes('第1天')) throw new Error('应包含第1天');
    if (!result.includes('5号小华死亡')) throw new Error('应包含死亡公告');
  });
});

describe('buildSystemPrompt角色攻略', () => {
  it('加载女巫攻略', () => {
    const player = { id: 5, name: '小华', role: { id: 'witch', camp: 'good' }, soul: '你是一个优秀的玩家。' };
    const game = { presetId: '12-hunter-idiot', preset: { ruleDescriptions: ['女巫仅首夜可自救', '猎人被毒不能开枪'] }, players: mockPlayers };
    const prompt = buildSystemPrompt(player, game);
    if (!prompt.includes('名字:小华')) throw new Error('应包含名字');
    if (!prompt.includes('位置:5号位')) throw new Error('应包含位置');
    if (!prompt.includes('角色:女巫')) throw new Error('应包含角色');
    if (!prompt.includes('规则:女巫仅首夜可自救|猎人被毒不能开枪')) throw new Error('应包含规则');
    if (!prompt.includes('【角色攻略】')) throw new Error('应包含攻略标题');
    if (!prompt.includes('自救')) throw new Error('应包含自救策略');
  });

  it('无攻略时正常返回', () => {
    const player = { id: 8, name: '小强', role: { id: 'cupid', camp: 'neutral' }, soul: '测试' };
    const game = { presetId: '12-hunter-idiot', preset: { ruleDescriptions: ['测试规则'] }, players: mockPlayers };
    const prompt = buildSystemPrompt(player, game);
    if (!prompt.includes('名字:小强')) throw new Error('应包含名字');
    if (!prompt.includes('角色:丘比特')) throw new Error('应包含角色');
    if (!prompt.includes('规则:测试规则')) throw new Error('应包含规则');
    if (prompt.includes('【角色攻略】\n\n')) throw new Error('攻略为空时不应有空标题');
  });

  it('9人标准局狼人攻略', () => {
    const player = { id: 3, name: '小刚', role: { id: 'werewolf', camp: 'wolf' }, soul: '测试' };
    const game = { presetId: '9-standard', preset: { ruleDescriptions: ['标准规则'] }, players: mockPlayers };
    const prompt = buildSystemPrompt(player, game);
    if (!prompt.includes('队友')) throw new Error('狼人应包含队友信息');
  });
});

describe('getCurrentTask', () => {
  it('返回非空字符串', () => {
    const context = { players: mockPlayers, alivePlayers: mockPlayers };
    const prompt = getCurrentTask('action_day_discuss', context);
    if (!prompt || typeof prompt !== 'string') throw new Error('应返回字符串');
  });

  it('不同阶段返回不同内容', () => {
    const context = { players: mockPlayers, alivePlayers: mockPlayers };
    const dayPrompt = getCurrentTask('action_day_discuss', context);
    const nightPrompt = getCurrentTask('action_night_werewolf_vote', context);
    if (dayPrompt === nightPrompt) throw new Error('不同阶段应返回不同内容');
  });
});

run();