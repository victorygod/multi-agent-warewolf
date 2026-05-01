const { describe, it, run } = require('../../helpers/test-runner');
const { parseMessageContent, getMessageClass } = require('../../../public/message_parser');

describe('parseMessageContent', () => {
  it('移除发言标签', () => {
    const result = parseMessageContent('[发言|3号张三]我是好人');
    if (result !== '我是好人') throw new Error(`期望"我是好人"，实际"${result}"`);
  });

  it('移除系统标签', () => {
    const result = parseMessageContent('[系统]昨夜平安夜');
    if (result !== '昨夜平安夜') throw new Error(`期望"昨夜平安夜"，实际"${result}"`);
  });

  it('移除狼人讨论标签', () => {
    const result = parseMessageContent('[狼人讨论|5号李四]刀3号');
    if (result !== '刀3号') throw new Error(`期望"刀3号"，实际"${result}"`);
  });

  it('移除多个标签', () => {
    const result = parseMessageContent('[私密][女巫]你救了3号');
    if (result !== '你救了3号') throw new Error(`期望"你救了3号"，实际"${result}"`);
  });

  it('无标签返回原内容', () => {
    const result = parseMessageContent('普通消息');
    if (result !== '普通消息') {
      throw new Error('无标签时应返回原内容');
    }
  });

  it('空内容返回空字符串', () => {
    const result = parseMessageContent('');
    if (result !== '') {
      throw new Error('空内容应返回空字符串');
    }
  });
});

describe('getMessageClass', () => {
  it('phase_start返回phase-start', () => {
    if (getMessageClass({ type: 'phase_start' }) !== 'phase-start') {
      throw new Error('应返回phase-start');
    }
  });

  it('system消息返回system', () => {
    if (getMessageClass({ type: 'system', visibility: 'public' }) !== 'system') {
      throw new Error('应返回system');
    }
  });

  it('私密system消息返回system-private', () => {
    if (getMessageClass({ type: 'system', visibility: 'self' }) !== 'system-private') {
      throw new Error('应返回system-private');
    }
  });

  it('speech返回speech', () => {
    if (getMessageClass({ type: 'speech' }) !== 'speech') {
      throw new Error('应返回speech');
    }
  });

  it('vote_result返回vote-result', () => {
    if (getMessageClass({ type: 'vote_result' }) !== 'vote-result') {
      throw new Error('应返回vote-result');
    }
  });

  it('game_over返回game-over', () => {
    if (getMessageClass({ type: 'game_over' }) !== 'game-over') {
      throw new Error('应返回game-over');
    }
  });
});

run();