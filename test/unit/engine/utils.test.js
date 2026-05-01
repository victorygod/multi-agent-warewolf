const { describe, it, run } = require('../../helpers/test-runner');
const { shuffle, getPlayerDisplay, getSpeakerOrder } = require('../../../engine/utils');

describe('shuffle', () => {
  it('保持数组长度', () => {
    const arr = [1, 2, 3, 4, 5];
    shuffle(arr);
    if (arr.length !== 5) throw new Error(`期望长度5，实际${arr.length}`);
  });

  it('包含相同元素', () => {
    const arr = [1, 2, 3, 4, 5];
    const copy = [...arr];
    shuffle(arr);
    copy.sort((a, b) => a - b);
    arr.sort((a, b) => a - b);
    if (arr.join(',') !== copy.join(',')) throw new Error('洗牌后元素不一致');
  });

  it('确实打乱顺序', () => {
    let sameCount = 0;
    for (let i = 0; i < 20; i++) {
      const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const before = arr.join(',');
      shuffle(arr);
      if (arr.join(',') === before) sameCount++;
    }
    if (sameCount > 15) throw new Error('洗牌未生效，20次中太多次顺序不变');
  });
});

describe('getPlayerDisplay', () => {
  it('返回N号Name格式', () => {
    const players = [{ id: 1, name: '张三' }];
    if (getPlayerDisplay(players, players[0]) !== '1号张三') throw new Error('格式错误');
  });

  it('null返回未知', () => {
    if (getPlayerDisplay([], null) !== '未知') throw new Error('null应返回未知');
  });
});

describe('getSpeakerOrder', () => {
  function makePlayer(id, alive = true) {
    return { id, name: `P${id}`, alive, state: {} };
  }

  it('无警长按ID升序', () => {
    const players = [makePlayer(3), makePlayer(1), makePlayer(2)];
    const order = getSpeakerOrder(players, {});
    const ids = order.map(p => p.id);
    if (ids.join(',') !== '1,2,3') throw new Error(`期望1,2,3，实际${ids}`);
  });

  it('无警长从死者下一位开始', () => {
    const players = [makePlayer(1), makePlayer(2), makePlayer(3), makePlayer(4), makePlayer(5)];
    const order = getSpeakerOrder(players, { lastDeathPlayer: 2 });
    const ids = order.map(p => p.id);
    if (ids[0] !== 3) throw new Error(`期望从3号开始，实际${ids[0]}`);
  });

  it('有警长且指定顺序', () => {
    const players = [makePlayer(1), makePlayer(2), makePlayer(3), makePlayer(4), makePlayer(5)];
    players[1].state.isSheriff = true;
    const order = getSpeakerOrder(players, { sheriff: 2, sheriffAssignOrder: 4 });
    const ids = order.map(p => p.id);
    if (ids[ids.length - 1] !== 2) throw new Error('警长应最后发言');
    if (ids[0] !== 4) throw new Error(`期望从4号开始，实际${ids[0]}`);
  });

  it('警长死亡时不使用警长顺序', () => {
    const players = [makePlayer(1), makePlayer(2), makePlayer(3), makePlayer(4), makePlayer(5)];
    players[1].alive = false;
    players[1].state.isSheriff = true;
    const order = getSpeakerOrder(players, { sheriff: 2, sheriffAssignOrder: 4 });
    const ids = order.map(p => p.id);
    if (ids.includes(2)) throw new Error('死亡警长不应在发言列表中');
  });

  it('canSpeak过滤', () => {
    const players = [makePlayer(1), makePlayer(2), makePlayer(3)];
    players[1].state.revealed = true;
    const order = getSpeakerOrder(players, {
      canSpeak: (p) => !p.state?.revealed
    });
    const ids = order.map(p => p.id);
    if (ids.includes(2)) throw new Error('已翻牌白痴不应发言');
  });

  it('空玩家列表返回空数组', () => {
    const order = getSpeakerOrder([], {});
    if (order.length !== 0) throw new Error('应返回空数组');
  });
});

run();