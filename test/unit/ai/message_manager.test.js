const { describe, it, beforeEach, run } = require('../../helpers/test-runner');

describe('MessageManager - 基础结构', () => {
  it('MessageManager模块可导入', () => {
    const { MessageManager } = require('../../../ai/agent/message_manager');
    if (!MessageManager) throw new Error('MessageManager应可导入');
  });

  it('创建实例', () => {
    const { MessageManager } = require('../../../ai/agent/message_manager');
    const mm = new MessageManager();
    if (!mm) throw new Error('应能创建实例');
  });

  it('初始状态无消息', () => {
    const { MessageManager } = require('../../../ai/agent/message_manager');
    const mm = new MessageManager();
    if (mm.messages && mm.messages.length > 0) throw new Error('初始应无消息');
  });
});

describe('MessageManager - updateSystem', () => {
  it('更新系统消息', () => {
    const { MessageManager } = require('../../../ai/agent/message_manager');
    const mm = new MessageManager();
    const player = { id: 1, name: '张三', role: { id: 'seer', name: '预言家', camp: 'good' }, alive: true, state: {} };
    const game = { players: [], round: 1, effectiveRules: {} };
    mm.updateSystem(player, game);
    if (!mm.messages || mm.messages.length === 0) throw new Error('应有系统消息');
  });
});

describe('MessageManager - appendTurn', () => {
  it('追加消息并更新lastProcessedId', () => {
    const { MessageManager } = require('../../../ai/agent/message_manager');
    const mm = new MessageManager();
    const player = { id: 1, name: '张三', role: { id: 'seer', name: '预言家', camp: 'good' }, alive: true, state: {} };
    const game = { players: [], round: 1, effectiveRules: {} };
    mm.updateSystem(player, game);
    const beforeLen = mm.messages.length;
    const llmMsgs = [{ role: 'user', content: '测试消息' }];
    const gameMsgs = [{ id: 5, type: 'speech', content: '发言' }];
    mm.appendTurn(llmMsgs, gameMsgs);
    if (mm.messages.length <= beforeLen) throw new Error('消息应增加');
    if (mm.lastProcessedId !== 5) throw new Error(`lastProcessedId应为5，实际${mm.lastProcessedId}`);
  });
});

run();