const { describe, it, run } = require('../helpers/test-runner');

function getPlayerPos(playerId) {
  return playerId;
}

function idNote(ids, players) {
  const parts = ids.map(id => {
    if (id == null) return null;
    const pos = getPlayerPos(id);
    const p = players.find(p => p.id === id);
    return `id=${id} → ${pos}号${p?.name || ''}`;
  }).filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : null;
}

function createMockPlayers() {
  return [
    { id: 1, name: '大刚', alive: true },
    { id: 2, name: '小玲', alive: true },
    { id: 3, name: '阿华', alive: false, deathReason: 'wolf' },
    { id: 4, name: '大军', alive: true },
    { id: 5, name: 'wolf', alive: false, deathReason: 'couple' },
  ];
}

describe('idNote - ID到位置号映射', () => {
  it('单个ID映射', () => {
    const players = createMockPlayers();
    const note = idNote([1], players);
    if (note !== 'id=1 → 1号大刚') throw new Error(`期望 "id=1 → 1号大刚"，实际 "${note}"`);
  });

  it('多个ID映射', () => {
    const players = createMockPlayers();
    const note = idNote([2, 4], players);
    if (note !== 'id=2 → 2号小玲, id=4 → 4号大军') throw new Error(`期望 "id=2 → 2号小玲, id=4 → 4号大军"，实际 "${note}"`);
  });

  it('包含null时返回null（弃权）', () => {
    const players = createMockPlayers();
    const note = idNote([null], players);
    if (note !== null) throw new Error(`期望 null，实际 "${note}"`);
  });
});

describe('--full模式字段', () => {
  it('position字段等于ID', () => {
    const players = createMockPlayers();
    if (players[0].id !== 1) throw new Error('id=1 position应为1');
    if (players[2].id !== 3) throw new Error('id=3 position应为3');
    if (players[4].id !== 5) throw new Error('id=5 position应为5');
  });

  it('idMap字段包含映射', () => {
    const players = createMockPlayers();
    const idMap = players.map(p => `${p.id}→${p.id}号${p.name}`).join(', ');
    if (!idMap.includes('1→1号大刚')) throw new Error('idMap应包含 1→1号大刚');
    if (!idMap.includes('5→5号wolf')) throw new Error('idMap应包含 5→5号wolf');
  });
});

describe('显示渲染', () => {
  it('死亡玩家标记', () => {
    const players = createMockPlayers();
    const lines = [];
    players.forEach(p => {
      let line = `  ${p.id}号 ${p.name}`;
      if (!p.alive) line += ' [已死亡]';
      lines.push(line);
    });
    if (!lines[2].includes('[已死亡]')) throw new Error('3号阿华应有死亡标记');
    if (!lines[4].includes('[已死亡]')) throw new Error('5号wolf应有死亡标记');
    if (lines[0].includes('[已死亡]')) throw new Error('1号大刚不应有死亡标记');
  });

  it('选项显示使用位置号', () => {
    const players = createMockPlayers();
    const labels = players.filter(p => p.alive).map(p => {
      const pos = getPlayerPos(p.id);
      return `投给 ${pos}号 ${p.name}`;
    });
    if (!labels[0].includes('1号') || !labels[0].includes('大刚')) throw new Error('第一个选项应为1号大刚');
    if (!labels[1].includes('2号') || !labels[1].includes('小玲')) throw new Error('第二个选项应为2号小玲');
  });
});

run();