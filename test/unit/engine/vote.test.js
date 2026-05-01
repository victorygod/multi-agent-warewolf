const { describe, it, beforeEach, run } = require('../../helpers/test-runner');
const { createGame } = require('../../helpers/game-harness');
const { assertPlayerAlive, assertPlayerDead, assertSheriff, assertNoSheriff } = require('../../helpers/assertions');

describe('VoteManager - calculateVoteResults', () => {
  let game, harness;

  beforeEach(() => {
    harness = createGame({ presetId: '9-standard' });
    game = harness.game;
  });

  it('计算简单多数票', () => {
    game.votes = { 1: 3, 2: 3, 3: 5, 4: 5, 5: 3 };
    const voters = [1, 2, 3, 4, 5].map(id => game.players.find(p => p.id === id));
    const result = game.voteManager.calculateVoteResults(voters, { useWeight: false });
    if (result.voteCounts[5] !== 2) throw new Error(`期望5号得2票，实际${result.voteCounts[5]}`);
  });

  it('弃权票不计入', () => {
    game.votes = { 1: 3, 2: null, 3: null };
    const voters = [1, 2, 3].map(id => game.players.find(p => p.id === id));
    const result = game.voteManager.calculateVoteResults(voters, { useWeight: false });
    if (Object.keys(result.voteCounts).length !== 1) throw new Error('弃权票不应计入');
  });

  it('警长1.5票权重', () => {
    game.sheriff = 1;
    game.votes = { 1: 3, 2: 3 };
    const voters = [1, 2].map(id => game.players.find(p => p.id === id));
    const result = game.voteManager.calculateVoteResults(voters, { useWeight: true });
    if (result.voteCounts[3] !== 2.5) throw new Error(`期望3号得2.5票(1号1.5+2号1)，实际${result.voteCounts[3]}`);
  });
});

describe('VoteManager - findMaxVotes / findTopVotes', () => {
  let game;

  beforeEach(() => {
    const harness = createGame({ presetId: '9-standard' });
    game = harness.game;
  });

  it('findMaxVotes返回最高票', () => {
    const counts = { 3: 2, 5: 4, 7: 1 };
    const { maxVotes, maxPlayer } = game.voteManager.findMaxVotes(counts);
    if (maxVotes !== 4) throw new Error(`期望4票，实际${maxVotes}`);
    if (maxPlayer.id !== 5) throw new Error(`期望5号，实际${maxPlayer.id}`);
  });

  it('findTopVotes返回所有平票玩家', () => {
    const counts = { 3: 3, 5: 3, 7: 1 };
    const top = game.voteManager.findTopVotes(counts, 3);
    if (top.length !== 2) throw new Error(`期望2人平票，实际${top.length}`);
    const ids = top.map(p => p.id).sort();
    if (ids[0] !== 3 || ids[1] !== 5) throw new Error(`期望[3,5]，实际${ids}`);
  });
});

describe('VoteManager - resolve 放逐投票', () => {
  let game, harness;

  beforeEach(() => {
    harness = createGame({ presetId: '9-standard' });
    game = harness.game;
    game.round = 1;
  });

  it('单一最高票放逐', async () => {
    for (let i = 1; i <= 8; i++) harness.setAI(i, { action_post_vote: { target: 5 } });
    harness.setAI(9, { action_post_vote: { target: 1 } });
    game.votes = {};
    const voters = game.players.filter(p => p.alive && p.state?.canVote !== false);
    for (let i = 1; i <= 8; i++) game.votes[i] = 5;
    game.votes[9] = 1;
    await game.voteManager.resolve();
    assertPlayerDead(game, 5, 'vote');
  });

  it('平票进入PK', async () => {
    game.votes = {};
    for (let i = 1; i <= 4; i++) game.votes[i] = 3;
    for (let i = 5; i <= 8; i++) game.votes[i] = 5;
    game.votes[9] = null;
    const result = await game.voteManager.resolve();
    if (!result.done) throw new Error('应完成');
  });
});

describe('VoteManager - _resolveBanishPK', () => {
  let game, harness;

  beforeEach(() => {
    harness = createGame({ presetId: '12-hunter-idiot' });
    game = harness.game;
    game.round = 1;
  });

  it('PK候选人为已翻牌白痴时无人出局', async () => {
    const idiot = game.players.find(p => p.role.id === 'idiot');
    idiot.state.revealed = true;
    idiot.state.canVote = false;
    const topVotes = [idiot];
    game.votes = {};
    const result = await game.voteManager._resolveBanishPK(topVotes);
    if (!result.done) throw new Error('应完成');
    assertPlayerAlive(game, idiot.id);
  });

  it('PK只有一个有效候选人直接放逐', async () => {
    const idiot = game.players.find(p => p.role.id === 'idiot');
    idiot.state.revealed = true;
    idiot.state.canVote = false;
    const other = game.players.find(p => p.role.id === 'werewolf' && p.alive);
    const topVotes = [idiot, other];
    for (let i = 1; i <= 12; i++) game.votes[i] = other.id;
    game.votes = {};
    const result = await game.voteManager._resolveBanishPK(topVotes);
    if (!result.done) throw new Error('应完成');
  });

  it('PK再平票无人出局', async () => {
    const w1 = game.players.filter(p => p.role.id === 'werewolf')[0];
    const w2 = game.players.filter(p => p.role.id === 'werewolf')[1];
    const topVotes = [w1, w2];
    game.votes = {};
    const result = await game.voteManager._resolveBanishPK(topVotes);
    if (!result.done) throw new Error('应完成');
  });
});

describe('VoteManager - resolveElection 警长选举', () => {
  let game, harness;

  beforeEach(() => {
    harness = createGame({ presetId: '12-hunter-idiot' });
    game = harness.game;
    game.round = 1;
    game.effectiveRules.sheriff = { enabled: true };
  });

  it('0人竞选无警长', async () => {
    const result = await game.voteManager.resolveElection([], [], game.players);
    if (!result.done) throw new Error('应完成');
    assertNoSheriff(game);
  });

  it('1人竞选直接当选', async () => {
    const candidate = game.players[0];
    candidate.state.isCandidate = true;
    const result = await game.voteManager.resolveElection([candidate], game.players.filter(p => p.alive), game.players);
    if (!result.done) throw new Error('应完成');
    assertSheriff(game, candidate.id);
  });

  it('1人竞选且警下无人直接当选', async () => {
    const candidate = game.players[0];
    candidate.state.isCandidate = true;
    game.players.forEach(p => { p.state = p.state || {}; p.state.isCandidate = true; });
    const result = await game.voteManager.resolveElection([candidate], game.players.filter(p => p.alive), game.players);
    if (!result.done) throw new Error('应完成');
    assertSheriff(game, candidate.id);
  });

  it('_resolvePK 再平票无警长', async () => {
    const c1 = game.players[0];
    const c2 = game.players[1];
    c1.state.isCandidate = true;
    c2.state.isCandidate = true;
    game.votes = {};
    const result = await game.voteManager._resolvePK([c1, c2]);
    if (!result.done) throw new Error('应完成');
  });
});

describe('VoteManager - _handleBanishResult', () => {
  let game, harness;

  beforeEach(() => {
    harness = createGame({ presetId: '12-hunter-idiot' });
    game = harness.game;
  });

  it('白痴翻牌免疫取消死亡', () => {
    const idiot = game.players.find(p => p.role.id === 'idiot');
    game.voteManager._handleBanishResult(idiot);
    assertPlayerAlive(game, idiot.id);
    if (!idiot.state.revealed) throw new Error('白痴应已翻牌');
  });

  it('普通玩家被放逐死亡', () => {
    const villager = game.players.find(p => p.role.id === 'villager');
    game.voteManager._handleBanishResult(villager);
    assertPlayerDead(game, villager.id, 'vote');
  });
});

run();