const assert = require('assert');

function assertPlayerAlive(game, playerId) {
  const player = game.players.find(p => p.id === playerId);
  assert(player, `玩家 ${playerId} 不存在`);
  assert(player.alive, `期望玩家 ${playerId} 存活，实际已死亡`);
}

function assertPlayerDead(game, playerId, reason) {
  const player = game.players.find(p => p.id === playerId);
  assert(player, `玩家 ${playerId} 不存在`);
  assert(!player.alive, `期望玩家 ${playerId} 已死亡，实际存活`);
  if (reason) {
    assert(player.deathReason === reason, `期望死因 ${reason}，实际 ${player.deathReason}`);
  }
}

function assertWinner(game, camp) {
  assert(game.winner === camp, `期望获胜方 ${camp}，实际 ${game.winner}`);
}

function assertCouple(game, id1, id2) {
  assert(game.couples, '没有情侣');
  const ids = game.couples.map(c => c.id).sort();
  const expected = [id1, id2].sort();
  assert.deepStrictEqual(ids, expected, `期望情侣 [${expected}]，实际 [${ids}]`);
}

function assertSheriff(game, playerId) {
  assert(game.sheriff === playerId, `期望警长 ${playerId}，实际 ${game.sheriff}`);
}

function assertNoSheriff(game) {
  assert(game.sheriff === null, `期望无警长，实际 ${game.sheriff}`);
}

function assertPhase(phaseManager, phaseId) {
  const current = phaseManager.getCurrentPhase();
  assert(current?.id === phaseId, `期望阶段 ${phaseId}，实际 ${current?.id}`);
}

function assertRevealed(game, playerId) {
  const player = game.players.find(p => p.id === playerId);
  assert(player, `玩家 ${playerId} 不存在`);
  assert(player.state?.revealed, `期望玩家 ${playerId} 已翻牌，实际未翻牌`);
}

function assertNotRevealed(game, playerId) {
  const player = game.players.find(p => p.id === playerId);
  assert(player, `玩家 ${playerId} 不存在`);
  assert(!player.state?.revealed, `期望玩家 ${playerId} 未翻牌，实际已翻牌`);
}

function assertPotionState(game, heal, poison) {
  const witch = game.players.find(p => p.role?.id === 'witch');
  assert(witch, '没有女巫');
  if (heal !== undefined) {
    assert(witch.state.heal === heal, `期望解药 ${heal}，实际 ${witch.state.heal}`);
  }
  if (poison !== undefined) {
    assert(witch.state.poison === poison, `期望毒药 ${poison}，实际 ${witch.state.poison}`);
  }
}

function assertCanShoot(game, playerId, expected) {
  const player = game.players.find(p => p.id === playerId);
  assert(player, `玩家 ${playerId} 不存在`);
  assert(player.state?.canShoot === expected, `期望 canShoot=${expected}，实际 ${player.state?.canShoot}`);
}

function assertCanVote(game, playerId, expected) {
  const player = game.players.find(p => p.id === playerId);
  assert(player, `玩家 ${playerId} 不存在`);
  const canVote = player.state?.canVote !== false;
  assert(canVote === expected, `期望 canVote=${expected}，实际 ${canVote}`);
}

module.exports = {
  assertPlayerAlive,
  assertPlayerDead,
  assertWinner,
  assertCouple,
  assertSheriff,
  assertNoSheriff,
  assertPhase,
  assertRevealed,
  assertNotRevealed,
  assertPotionState,
  assertCanShoot,
  assertCanVote
};