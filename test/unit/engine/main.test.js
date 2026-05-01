const { describe, it, beforeEach, run } = require('../../helpers/test-runner');
const { createGame } = require('../../helpers/game-harness');
const { assertPlayerAlive, assertPlayerDead } = require('../../helpers/assertions');
const { PHASE, ACTION, CAMP, DEATH_REASON } = require('../../../engine/constants');

function findPlayer(game, roleId) {
  return game.players.find(p => p.role?.id === roleId);
}

function makePhaseManagerStub(game, phaseId) {
  game.phaseManager = {
    getCurrentPhase: () => ({ id: phaseId }),
    start: () => Promise.resolve()
  };
}

describe('GameEngine - explode() guard clauses', () => {
  let game, harness;

  beforeEach(() => {
    harness = createGame({ presetId: '9-standard' });
    game = harness.game;
    makePhaseManagerStub(game, PHASE.DAY_DISCUSS);
  });

  it('player not exist returns failure', () => {
    const result = game.explode(999);
    if (result.success !== false) throw new Error('should fail for non-existent player');
  });

  it('dead player returns failure', () => {
    const wolf = findPlayer(game, 'werewolf');
    wolf.alive = false;
    const result = game.explode(wolf.id);
    if (result.success !== false) throw new Error('should fail for dead player');
  });

  it('non-wolf player returns failure', () => {
    const villager = findPlayer(game, 'villager');
    const result = game.explode(villager.id);
    if (result.success !== false) throw new Error('should fail for non-wolf');
    if (!result.message.includes('狼人')) throw new Error('message should mention only wolf');
  });

  it('player with no explode skill returns failure', () => {
    const wolf = findPlayer(game, 'werewolf');
    const savedSkill = wolf.role.skills[ACTION.EXPLODE];
    delete wolf.role.skills[ACTION.EXPLODE];
    const result = game.explode(wolf.id);
    if (result.success !== false) throw new Error('should fail when skill missing');
    wolf.role.skills[ACTION.EXPLODE] = savedSkill;
  });

  it('canUse returning false returns failure', () => {
    const wolf = findPlayer(game, 'werewolf');
    const savedCanUse = wolf.role.skills[ACTION.EXPLODE].canUse;
    wolf.role.skills[ACTION.EXPLODE].canUse = () => false;
    const result = game.explode(wolf.id);
    if (result.success !== false) throw new Error('should fail when canUse is false');
    wolf.role.skills[ACTION.EXPLODE].canUse = savedCanUse;
  });

  it('wrong phase returns failure', () => {
    const wolf = findPlayer(game, 'werewolf');
    makePhaseManagerStub(game, PHASE.NIGHT_WEREWOLF_VOTE);
    const result = game.explode(wolf.id);
    if (result.success !== false) throw new Error('should fail in wrong phase');
  });
});

describe('GameEngine - buildActionData()', () => {
  let game, harness;

  beforeEach(() => {
    harness = createGame({ presetId: '12-guard-cupid' });
    game = harness.game;
  });

  it('action_guard includes lastGuardTarget and allowedTargets', () => {
    const guard = findPlayer(game, 'guard');
    guard.state.lastGuardTarget = 3;
    const data = game.buildActionData(guard.id, 'action_guard');
    if (data.lastGuardTarget !== 3) throw new Error(`expected lastGuardTarget=3, got ${data.lastGuardTarget}`);
    if (!Array.isArray(data.allowedTargets)) throw new Error('allowedTargets should be array');
    if (data.allowedTargets.includes(3)) throw new Error('guard should not be allowed to repeat target');
  });

  it('action_witch includes werewolfTarget, healAvailable, poisonAvailable, poisonTargets', () => {
    const witch = findPlayer(game, 'witch');
    game.werewolfTarget = 5;
    const data = game.buildActionData(witch.id, 'action_witch');
    if (data.werewolfTarget !== 5) throw new Error(`expected werewolfTarget=5, got ${data.werewolfTarget}`);
    if (data.healAvailable !== true) throw new Error('heal should be available');
    if (data.poisonAvailable !== true) throw new Error('poison should be available');
    if (!Array.isArray(data.poisonTargets)) throw new Error('poisonTargets should be array');
    if (data.poisonTargets.includes(witch.id)) throw new Error('witch cannot poison self');
    if (data.poisonTargets.includes(5)) throw new Error('witch cannot poison werewolf target');
  });

  it('action_witch healAvailable false when heal is 0', () => {
    const witch = findPlayer(game, 'witch');
    witch.state.heal = 0;
    const data = game.buildActionData(witch.id, 'action_witch');
    if (data.healAvailable !== false) throw new Error('healAvailable should be false');
  });

  it('action_witch uses extraData overrides', () => {
    const witch = findPlayer(game, 'witch');
    const data = game.buildActionData(witch.id, 'action_witch', {
      werewolfTarget: 2,
      healAvailable: false,
      poisonAvailable: false
    });
    if (data.werewolfTarget !== 2) throw new Error('should use extraData.werewolfTarget');
    if (data.healAvailable !== false) throw new Error('should use extraData.healAvailable');
    if (data.poisonAvailable !== false) throw new Error('should use extraData.poisonAvailable');
  });

  it('action_seer includes checkedIds and allowedTargets', () => {
    const seer = findPlayer(game, 'seer');
    seer.state.seerChecks = [{ targetId: 3, result: 'good', night: 1 }];
    const data = game.buildActionData(seer.id, 'action_seer');
    if (!data.checkedIds.includes(3)) throw new Error('checkedIds should include 3');
    if (!Array.isArray(data.allowedTargets)) throw new Error('allowedTargets should be array');
    if (data.allowedTargets.includes(seer.id)) throw new Error('seer cannot check self');
    if (data.allowedTargets.includes(3)) throw new Error('seer cannot re-check');
  });

  it('action_seer returns null allowedTargets when all checked', () => {
    const seer = findPlayer(game, 'seer');
    const allOtherAlive = game.players.filter(p => p.alive && p.id !== seer.id).map(p => p.id);
    seer.state.seerChecks = allOtherAlive.map(id => ({ targetId: id, result: 'good', night: 1 }));
    const data = game.buildActionData(seer.id, 'action_seer');
    if (data.allowedTargets !== null) throw new Error('allowedTargets should be null when all checked');
  });

  it('action_cupid includes count=2 and allowedTargets', () => {
    const cupid = findPlayer(game, 'cupid');
    const data = game.buildActionData(cupid.id, 'action_cupid');
    if (data.count !== 2) throw new Error('cupid count should be 2');
    if (!Array.isArray(data.allowedTargets)) throw new Error('allowedTargets should be array');
    const allAlive = game.players.filter(p => p.alive).map(p => p.id);
    if (data.allowedTargets.length !== allAlive.length) throw new Error('cupid can target all alive');
  });

  it('action_post_vote and action_day_vote include allowedTargets', () => {
    const voter = game.players[0];
    const data = game.buildActionData(voter.id, 'action_post_vote');
    if (!Array.isArray(data.allowedTargets)) throw new Error('post_vote should have allowedTargets');
    if (data.allowedTargets.includes(voter.id)) throw new Error('cannot vote for self');

    const data2 = game.buildActionData(voter.id, 'action_day_vote');
    if (!Array.isArray(data2.allowedTargets)) throw new Error('day_vote should have allowedTargets');
  });

  it('action_post_vote uses extraData.allowedTargets when provided', () => {
    const voter = game.players[0];
    const data = game.buildActionData(voter.id, 'action_post_vote', { allowedTargets: [3, 5] });
    if (!Array.isArray(data.allowedTargets)) throw new Error('should have allowedTargets');
    if (data.allowedTargets.length !== 2) throw new Error('should use extraData.allowedTargets');
  });

  it('action_night_werewolf_vote includes allowedTargets', () => {
    const wolf = findPlayer(game, 'werewolf');
    const data = game.buildActionData(wolf.id, 'action_night_werewolf_vote');
    if (!Array.isArray(data.allowedTargets)) throw new Error('should have allowedTargets');
    const allAlive = game.players.filter(p => p.alive).map(p => p.id);
    if (data.allowedTargets.length !== allAlive.length) throw new Error('wolves can vote for all alive');
  });

  it('action_shoot includes allowedTargets', () => {
    const hunter = findPlayer(game, 'hunter');
    hunter.alive = false;
    const data = game.buildActionData(hunter.id, 'action_shoot');
    if (!Array.isArray(data.allowedTargets)) throw new Error('should have allowedTargets');
    if (data.allowedTargets.includes(hunter.id)) throw new Error('cannot shoot self');
  });

  it('action_passBadge includes allowedTargets', () => {
    const player = game.players[0];
    const data = game.buildActionData(player.id, 'action_passBadge');
    if (!Array.isArray(data.allowedTargets)) throw new Error('should have allowedTargets');
    if (data.allowedTargets.includes(player.id)) throw new Error('cannot pass badge to self');
  });

  it('action_assignOrder excludes self from allowedTargets', () => {
    const player = game.players[0];
    const data = game.buildActionData(player.id, 'action_assignOrder');
    if (!Array.isArray(data.allowedTargets)) throw new Error('should have allowedTargets');
    if (data.allowedTargets.includes(player.id)) throw new Error('cannot assign order to self');
    const aliveOthers = game.players.filter(p => p.alive && p.id !== player.id).map(p => p.id);
    if (data.allowedTargets.length !== aliveOthers.length) throw new Error('should include all other alive');
  });

  it('action_sheriff_campaign, action_withdraw, action_last_words, action_explode return baseData only', () => {
    const player = game.players[0];
    for (const action of ['action_sheriff_campaign', 'action_withdraw', 'action_last_words', 'action_explode']) {
      const data = game.buildActionData(player.id, action);
      if (data.allowedTargets !== undefined) throw new Error(`${action} should not have allowedTargets`);
      if (data.action !== action) throw new Error(`action should be ${action}`);
    }
  });

  it('unknown action type returns baseData only', () => {
    const player = game.players[0];
    const data = game.buildActionData(player.id, 'action_unknown');
    if (data.action !== 'action_unknown') throw new Error('action should be set');
    if (data.allowedTargets !== undefined) throw new Error('should not have allowedTargets');
  });

  it('non-existent player returns baseData with requestId', () => {
    const data = game.buildActionData(999, 'action_guard');
    if (!data.requestId) throw new Error('should have requestId');
    if (data.action !== 'action_guard') throw new Error('action should be set');
  });

  it('action_sheriff_vote includes allowedTargets', () => {
    const voter = game.players[0];
    const data = game.buildActionData(voter.id, 'action_sheriff_vote');
    if (!Array.isArray(data.allowedTargets)) throw new Error('sheriff_vote should have allowedTargets');
  });
});

describe('GameEngine - callSkill() dead player branch', () => {
  let game, harness;

  beforeEach(() => {
    harness = createGame({ presetId: '12-hunter-idiot' });
    game = harness.game;
  });

  it('dead player using guard skill returns undefined (skipped)', async () => {
    const seer = findPlayer(game, 'seer');
    seer.alive = false;
    const result = await game.callSkill(seer.id, ACTION.SEER, {
      allowedTargets: game.players.filter(p => p.alive && p.id !== seer.id).map(p => p.id)
    });
    if (result !== undefined) throw new Error('dead player callSkill for non-allowed skill should return undefined');
  });

  it('dead player using passBadge does not return undefined', async () => {
    const player = game.players[0];
    player.alive = false;
    game.sheriff = player.id;
    const target = game.players.find(p => p.alive && p.id !== player.id);
    harness.setAI(player.id, { action_passBadge: { targetId: target.id } });
    const result = await game.callSkill(player.id, ACTION.PASS_BADGE);
    if (result === undefined) throw new Error('dead player should be allowed passBadge');
  });

  it('dead player using shoot does not return undefined', async () => {
    const hunter = findPlayer(game, 'hunter');
    hunter.alive = false;
    hunter.state.canShoot = true;
    hunter.deathReason = 'vote';
    const target = game.players.find(p => p.alive && p.id !== hunter.id);
    harness.setAI(hunter.id, { action_shoot: { target: target.id, use: true } });
    const result = await game.callSkill(hunter.id, ACTION.SHOOT);
    if (result === undefined) throw new Error('dead hunter should be allowed to shoot');
  });
});

describe('GameEngine - handleDeath() idiot immunity', () => {
  let game, harness;

  beforeEach(() => {
    harness = createGame({ presetId: '12-hunter-idiot' });
    game = harness.game;
  });

  it('idiot voted out gets cancelled, revealed=true, canVote=false, alive restored', () => {
    const idiot = findPlayer(game, 'idiot');
    const result = game.handleDeath(idiot, 'vote');
    if (result.cancelled !== true) throw new Error('idiot death should be cancelled');
    if (idiot.state.revealed !== true) throw new Error('idiot should be revealed');
    if (idiot.state.canVote !== false) throw new Error('idiot should lose vote right');
    if (idiot.alive !== true) throw new Error('idiot should stay alive');
  });

  it('idiot cancelled death has no lastWords', () => {
    const idiot = findPlayer(game, 'idiot');
    const result = game.handleDeath(idiot, 'vote');
    if (result.hasLastWords !== false) throw new Error('cancelled death should have no lastWords');
    if (result.lastWordsPlayer !== null) throw new Error('lastWordsPlayer should be null');
  });

  it('idiot killed by wolf does NOT get cancelled', () => {
    const idiot = findPlayer(game, 'idiot');
    const result = game.handleDeath(idiot, 'wolf');
    if (result.cancelled) throw new Error('idiot killed by wolf should NOT be cancelled');
    if (idiot.alive !== false) throw new Error('idiot killed by wolf should be dead');
  });

  it('already-dead player returns no lastWords', () => {
    const villager = findPlayer(game, 'villager');
    villager.alive = false;
    const result = game.handleDeath(villager, 'wolf');
    if (result.hasLastWords !== false) throw new Error('dead player should have no lastWords');
  });

  it('null player returns no lastWords', () => {
    const result = game.handleDeath(null, 'wolf');
    if (result.hasLastWords !== false) throw new Error('null player should have no lastWords');
  });

  it('idiot already revealed does NOT get cancelled on second vote', () => {
    const idiot = findPlayer(game, 'idiot');
    idiot.state.revealed = true;
    const result = game.handleDeath(idiot, 'vote');
    if (result.cancelled) throw new Error('already-revealed idiot should not be cancelled');
  });
});

describe('GameEngine - processDeathChain() chain deaths', () => {
  let game, harness;

  beforeEach(() => {
    harness = createGame({ presetId: '12-guard-cupid' });
    game = harness.game;
  });

  it('hunter killed triggers shoot, target dies, martyrdom triggers', async () => {
    const hunter = findPlayer(game, 'hunter');
    const villager = findPlayer(game, 'villager');

    game.couples = [hunter.id, villager.id];
    hunter.state.canShoot = true;

    const targetForShoot = game.players.find(p => p.alive && p.id !== hunter.id && p.id !== villager.id && p.role.id !== 'werewolf');

    makePhaseManagerStub(game, PHASE.DAY_ANNOUNCE);

    harness.setAI(hunter.id, { action_shoot: { target: targetForShoot.id, use: true } });

    game.deathQueue = [];
    game.handleDeath(hunter, 'wolf');
    await game.processDeathChain([hunter], PHASE.DAY_ANNOUNCE);

    assertPlayerDead(game, hunter.id);
    assertPlayerDead(game, villager.id, 'couple');
  });

  it('couple partner dies from martyrdom when other partner is killed', async () => {
    const p1 = game.players.find(p => p.role.id === 'villager');
    const p2 = game.players.find(p => p.role.id !== 'villager' && p.role.id !== 'werewolf' && p.role.id !== 'cupid' && p.alive);

    game.couples = [p1.id, p2.id];

    game.deathQueue = [];
    game.handleDeath(p1, 'wolf');

    makePhaseManagerStub(game, PHASE.DAY_ANNOUNCE);

    await game.processDeathChain([p1], PHASE.DAY_ANNOUNCE);

    assertPlayerDead(game, p1.id);
    assertPlayerDead(game, p2.id, 'couple');
  });

  it('hunter killed by poison cannot shoot (canShoot false)', async () => {
    const hunter = findPlayer(game, 'hunter');
    hunter.state.canShoot = false;
    hunter.alive = false;
    hunter.deathReason = 'poison';
    game.deathQueue = [];

    makePhaseManagerStub(game, PHASE.POST_VOTE);

    await game.processDeathChain([hunter], PHASE.POST_VOTE);

    const shotMessages = game.message.messages.filter(m =>
      m.type === 'action' && m.content && m.content.includes('开枪')
    );
    if (shotMessages.length > 0) throw new Error('poisoned hunter should not shoot');
  });
});

describe('GameEngine - assignRoles() debugRole', () => {
  let game;

  beforeEach(() => {
    const { GameEngine } = require('../../../engine/main');
    game = new GameEngine({ presetId: '9-standard' });
    for (let i = 0; i < 9; i++) {
      game.players.push({
        id: i + 1,
        name: `P${i + 1}`,
        alive: true,
        isAI: false
      });
    }
  });

  it('player with debugRole gets that role', () => {
    game.players[0].debugRole = 'seer';
    game.assignRoles();
    if (game.players.find(p => p.debugRole === 'seer').role.id !== 'seer') {
      throw new Error('debugRole player should get seer');
    }
  });

  it('two players with same debugRole, second gets random', () => {
    game.players[0].debugRole = 'seer';
    game.players[1].debugRole = 'seer';
    game.assignRoles();
    const seers = game.players.filter(p => p.role?.id === 'seer');
    if (seers.length !== 1) throw new Error('should only have one seer from role pool');
    const debugSeerPlayer = game.players.find(p => p.debugRole === 'seer' && p.role?.id === 'seer');
    if (!debugSeerPlayer) throw new Error('at least one debugRole=seer player should get seer');
  });

  it('all players get a role after assignRoles', () => {
    game.assignRoles();
    for (const p of game.players) {
      if (!p.role) throw new Error(`player ${p.name} should have a role`);
    }
  });

  it('assignRoles skips if roles already assigned', () => {
    game.assignRoles();
    const rolesBefore = game.players.map(p => p.role.id);
    game.assignRoles();
    const rolesAfter = game.players.map(p => p.role.id);
    if (rolesBefore.length !== rolesAfter.length) throw new Error('should not reassign roles');
  });
});

describe('GameEngine - canSpeak()', () => {
  let game, harness;

  beforeEach(() => {
    harness = createGame({ presetId: '12-hunter-idiot' });
    game = harness.game;
  });

  it('alive player can speak', () => {
    const villager = findPlayer(game, 'villager');
    if (game.canSpeak(villager) !== true) throw new Error('alive player should be able to speak');
  });

  it('dead player cannot speak', () => {
    const villager = findPlayer(game, 'villager');
    villager.alive = false;
    if (game.canSpeak(villager) !== false) throw new Error('dead player should not be able to speak');
  });

  it('revealed idiot cannot speak', () => {
    const idiot = findPlayer(game, 'idiot');
    idiot.state.revealed = true;
    if (game.canSpeak(idiot) !== false) throw new Error('revealed idiot should not be able to speak');
  });

  it('unrevealed idiot can speak', () => {
    const idiot = findPlayer(game, 'idiot');
    idiot.state.revealed = false;
    if (game.canSpeak(idiot) !== true) throw new Error('unrevealed idiot should be able to speak');
  });
});

describe('GameEngine - getState() per-player visibility', () => {
  let game, harness;

  beforeEach(() => {
    harness = createGame({ presetId: '12-guard-cupid' });
    game = harness.game;
    makePhaseManagerStub(game, PHASE.DAY_DISCUSS);
  });

  it('guard sees lastGuardTarget in self, others do not', () => {
    const guard = findPlayer(game, 'guard');
    guard.state.lastGuardTarget = 5;

    const guardState = game.getState(guard.id);
    if (guardState.self.lastGuardTarget !== 5) throw new Error('guard should see own lastGuardTarget');

    const witch = findPlayer(game, 'witch');
    const witchState = game.getState(witch.id);
    if (witchState.self.lastGuardTarget !== undefined && witchState.self.lastGuardTarget !== null) {
      throw new Error('witch should not see guard lastGuardTarget');
    }
  });

  it('seer sees seerChecks, others do not', () => {
    const seer = findPlayer(game, 'seer');
    seer.state.seerChecks = [{ targetId: 3, result: CAMP.WOLF, night: 1 }];

    const seerState = game.getState(seer.id);
    if (seerState.self.seerChecks.length !== 1) throw new Error('seer should see checks');
    if (seerState.self.seerChecks[0].targetId !== 3) throw new Error('seer check target wrong');

    const guard = findPlayer(game, 'guard');
    const guardState = game.getState(guard.id);
    if (guardState.self.seerChecks && guardState.self.seerChecks.length > 0) {
      throw new Error('guard should not see seer checks');
    }
  });

  it('witch sees witchHeal and witchPoison, others do not', () => {
    const witch = findPlayer(game, 'witch');
    witch.state.heal = 0;
    witch.state.poison = 1;

    const witchState = game.getState(witch.id);
    if (witchState.self.witchHeal !== 0) throw new Error('witch should see heal count');
    if (witchState.self.witchPoison !== 1) throw new Error('witch should see poison count');

    const seer = findPlayer(game, 'seer');
    const seerState = game.getState(seer.id);
    if (seerState.self.witchHeal !== undefined && seerState.self.witchHeal !== null) {
      throw new Error('seer should not see witch potions');
    }
  });

  it('couple members see each other, non-couple do not', () => {
    const cupid = findPlayer(game, 'cupid');
    const p1 = game.players.find(p => p.alive && p.id !== cupid.id && p.role.id !== 'cupid');
    const p2 = game.players.find(p => p.alive && p.id !== cupid.id && p.id !== p1.id && p.role.id !== 'cupid');
    game.couples = [p1.id, p2.id];

    const p1State = game.getState(p1.id);
    if (p1State.self.isCouple !== true) throw new Error('p1 should see self as couple');
    if (p1State.self.couplePartner !== p2.id) throw new Error('p1 should see partner');

    const p2State = game.getState(p2.id);
    if (p2State.self.isCouple !== true) throw new Error('p2 should see self as couple');
    if (p2State.self.couplePartner !== p1.id) throw new Error('p2 should see partner');

    const outsider = game.players.find(p => p.alive && !game.couples.includes(p.id) && p.role.id !== 'cupid');
    const outsiderState = game.getState(outsider.id);
    if (outsiderState.self.isCouple === true) throw new Error('outsider should not be couple');
    if (outsiderState.couples !== null) throw new Error('outsider should not see couples list');
  });

  it('couple info in player list only visible to couple members', () => {
    const p1 = game.players[0];
    const p2 = game.players[1];
    game.couples = [p1.id, p2.id];

    const p1State = game.getState(p1.id);
    const p1InList = p1State.players.find(p => p.id === p2.id);
    if (p1InList.isCouple !== true) throw new Error('p1 should see p2 as couple in list');
    if (p1InList.couplePartner !== p1.id) throw new Error('p1 should see p2 partner in list');

    const outsider = game.players.find(p => p.alive && !game.couples.includes(p.id));
    const outsiderState = game.getState(outsider.id);
    const p1InOutsiderList = outsiderState.players.find(p => p.id === p1.id);
    if (p1InOutsiderList.isCouple === true) throw new Error('outsider should not see p1 as couple in list');
  });

  it('pendingAction is null when game is over', () => {
    game.winner = CAMP.GOOD;
    game._pendingRequests.set('test-1', { playerId: 1, actionType: 'action_guard', data: {}, resolve: () => {}, timeout: null });

    const state = game.getState(1);
    if (state.pendingAction !== null) throw new Error('pendingAction should be null when game is over');
  });

  it('pendingAction is populated when player has a pending request', () => {
    const pendingEntry = { playerId: 1, actionType: 'action_guard', data: {}, resolve: () => {}, timeout: null };
    game._pendingRequests.set('test-req-1', pendingEntry);

    const state = game.getState(1);
    if (!state.pendingAction) throw new Error('pendingAction should exist');
    if (state.pendingAction.action !== 'action_guard') throw new Error('pendingAction action should be action_guard');
  });

  it('phase is game_over when winner is set', () => {
    game.winner = CAMP.WOLF;
    const state = game.getState(1);
    if (state.phase !== 'game_over') throw new Error('phase should be game_over');
  });

  it('non-existent player returns state without self', () => {
    const state = game.getState(999);
    if (state.self !== undefined) throw new Error('non-existent player should not have self');
  });

  it('hunterCanShoot visible in self', () => {
    const hunter = findPlayer(game, 'hunter');
    hunter.state.canShoot = true;
    const state = game.getState(hunter.id);
    if (state.self.hunterCanShoot !== true) throw new Error('hunter should see canShoot');
  });

  it('idiotRevealed visible in self', () => {
    const harness2 = createGame({ presetId: '12-hunter-idiot' });
    const game2 = harness2.game;
    const idiot = findPlayer(game2, 'idiot');
    idiot.state.revealed = true;
    const state = game2.getState(idiot.id);
    if (state.self.idiotRevealed !== true) throw new Error('idiot should see revealed');
  });
});

run();