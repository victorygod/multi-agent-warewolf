const { describe, it, beforeEach, run } = require('../../helpers/test-runner');
const { createGame } = require('../../helpers/game-harness');
const { createPlayerRole, ATTACHMENTS } = require('../../../engine/roles');
const { PHASE, ACTION, CAMP, VISIBILITY, MSG } = require('../../../engine/constants');

function findPlayer(game, roleId) {
  return game.players.find(p => p.role && p.role.id === roleId);
}

describe('werewolf - action_explode', () => {
  let game, wolf;

  beforeEach(() => {
    const harness = createGame({ presetId: '9-standard' });
    game = harness.game;
    wolf = findPlayer(game, 'werewolf');
  });

  it('canUse returns true when alive', () => {
    wolf.alive = true;
    const skill = wolf.role.skills[ACTION.EXPLODE];
    if (skill.canUse(wolf, game) !== true) throw new Error('alive wolf should be able to explode');
  });

  it('canUse returns false when dead', () => {
    wolf.alive = false;
    const skill = wolf.role.skills[ACTION.EXPLODE];
    if (skill.canUse(wolf, game) !== false) throw new Error('dead wolf should not be able to explode');
  });

  it('availablePhases includes day phases', () => {
    const skill = wolf.role.skills[ACTION.EXPLODE];
    const phases = skill.availablePhases;
    if (!phases.includes(PHASE.DAY_VOTE)) throw new Error('DAY_VOTE should be available');
    if (!phases.includes(PHASE.DAY_DISCUSS)) throw new Error('DAY_DISCUSS should be available');
    if (!phases.includes(PHASE.SHERIFF_CAMPAIGN)) throw new Error('SHERIFF_CAMPAIGN should be available');
  });

  it('execute sets alive=false', () => {
    const skill = wolf.role.skills[ACTION.EXPLODE];
    skill.execute(null, wolf, game);
    if (wolf.alive !== false) throw new Error('wolf should be dead after explode');
  });

  it('execute sets interrupt on game', () => {
    const skill = wolf.role.skills[ACTION.EXPLODE];
    const result = skill.execute(null, wolf, game);
    if (!result || result.success !== true) throw new Error('should return success');
  });

  it('execute destroys badge if wolf is sheriff', () => {
    game.sheriff = wolf.id;
    const skill = wolf.role.skills[ACTION.EXPLODE];
    skill.execute(null, wolf, game);
    if (game.sheriff !== null) throw new Error('sheriff badge should be destroyed');
  });

  it('execute adds public message', () => {
    const skill = wolf.role.skills[ACTION.EXPLODE];
    skill.execute(null, wolf, game);
    const msgs = game.message.messages.filter(m => m.type === 'explode');
    if (msgs.length === 0) throw new Error('should add explode message');
  });
});

describe('seer - action_seer', () => {
  let game, seer, target;

  beforeEach(() => {
    const harness = createGame({ presetId: '9-standard' });
    game = harness.game;
    seer = findPlayer(game, 'seer');
    target = findPlayer(game, 'werewolf');
    seer.state.seerChecks = [];
  });

  it('validate rejects self', () => {
    const skill = seer.role.skills[ACTION.SEER];
    if (skill.validate(seer, seer, game) !== false) throw new Error('seer should not check self');
  });

  it('validate rejects dead target', () => {
    target.alive = false;
    const skill = seer.role.skills[ACTION.SEER];
    if (skill.validate(target, seer, game) !== false) throw new Error('should not check dead player');
  });

  it('validate rejects already-checked target', () => {
    const skill = seer.role.skills[ACTION.SEER];
    seer.state.seerChecks = [{ targetId: target.id, result: CAMP.WOLF, night: 1 }];
    if (skill.validate(target, seer, game) !== false) throw new Error('should not re-check same target');
  });

  it('validate accepts valid target', () => {
    const skill = seer.role.skills[ACTION.SEER];
    if (skill.validate(target, seer, game) !== true) throw new Error('should accept valid target');
  });

  it('execute records seerChecks and identifies wolf', () => {
    const skill = seer.role.skills[ACTION.SEER];
    skill.execute(target, seer, game);
    if (seer.state.seerChecks.length !== 1) throw new Error('should have 1 check record');
    if (seer.state.seerChecks[0].targetId !== target.id) throw new Error('targetId mismatch');
    if (seer.state.seerChecks[0].result !== CAMP.WOLF) throw new Error('should identify as wolf');
  });

  it('execute records good for villager', () => {
    const villager = findPlayer(game, 'villager');
    const skill = seer.role.skills[ACTION.SEER];
    skill.execute(villager, seer, game);
    if (seer.state.seerChecks[0].result !== CAMP.GOOD) throw new Error('should identify as good');
  });

  it('execute sends message to seer', () => {
    const skill = seer.role.skills[ACTION.SEER];
    skill.execute(target, seer, game);
    const msgs = game.message.messages.filter(m => m.playerId === seer.id && m.visibility === VISIBILITY.SELF);
    if (msgs.length === 0) throw new Error('should send message to seer');
  });

  it('execute records round number', () => {
    game.round = 3;
    const skill = seer.role.skills[ACTION.SEER];
    skill.execute(target, seer, game);
    if (seer.state.seerChecks[0].night !== 3) throw new Error('should record correct round');
  });
});

describe('witch - action_witch', () => {
  let game, witch, villager;

  beforeEach(() => {
    const harness = createGame({ presetId: '9-standard' });
    game = harness.game;
    witch = findPlayer(game, 'witch');
    villager = findPlayer(game, 'villager');
    game.werewolfTarget = villager.id;
  });

  it('heal saves werewolf target', () => {
    const skill = witch.role.skills[ACTION.WITCH];
    skill.execute({ action: 'heal' }, witch, game, {});
    if (witch.state.heal !== 0) throw new Error('heal should decrement to 0');
    if (game.healTarget !== villager.id) throw new Error('healTarget should be set');
  });

  it('heal adds self-visible message', () => {
    const skill = witch.role.skills[ACTION.WITCH];
    skill.execute({ action: 'heal' }, witch, game, {});
    const msgs = game.message.messages.filter(m => m.playerId === witch.id);
    if (msgs.length === 0) throw new Error('should add heal message');
  });

  it('heal fails when heal is 0', () => {
    witch.state.heal = 0;
    const skill = witch.role.skills[ACTION.WITCH];
    skill.execute({ action: 'heal' }, witch, game, {});
    if (game.healTarget === villager.id) throw new Error('should not heal when heal=0');
  });

  it('heal blocked by canSelfHeal=false when witch is target', () => {
    game.werewolfTarget = witch.id;
    const skill = witch.role.skills[ACTION.WITCH];
    const result = skill.execute({ action: 'heal' }, witch, game, { canSelfHeal: false });
    if (result.success !== false) throw new Error('should fail when cannot self heal');
  });

  it('heal allowed by canSelfHeal=true when witch is target', () => {
    game.werewolfTarget = witch.id;
    const skill = witch.role.skills[ACTION.WITCH];
    skill.execute({ action: 'heal' }, witch, game, { canSelfHeal: true });
    if (game.healTarget !== witch.id) throw new Error('should allow self heal');
  });

  it('heal uses effectiveRules canSelfHeal as fallback', () => {
    game.werewolfTarget = witch.id;
    game.effectiveRules = JSON.parse(JSON.stringify(game.effectiveRules));
    game.effectiveRules.witch = { canSelfHeal: false, canUseBothSameNight: true };
    const skill = witch.role.skills[ACTION.WITCH];
    const result = skill.execute({ action: 'heal' }, witch, game, {});
    if (result.success !== false) throw new Error('should use effectiveRules canSelfHeal');
  });

  it('poison kills a target', () => {
    const wolf = findPlayer(game, 'werewolf');
    const skill = witch.role.skills[ACTION.WITCH];
    skill.execute({ action: 'poison', targetId: wolf.id }, witch, game, {});
    if (witch.state.poison !== 0) throw new Error('poison should decrement to 0');
    if (game.poisonTarget !== wolf.id) throw new Error('poisonTarget should be set');
  });

  it('poison fails when poison is 0', () => {
    witch.state.poison = 0;
    const skill = witch.role.skills[ACTION.WITCH];
    skill.execute({ action: 'poison', targetId: 1 }, witch, game, {});
    if (game.poisonTarget === 1) throw new Error('should not poison when poison=0');
  });

  it('poison fails when target is dead', () => {
    const deadPlayer = game.players.find(p => p.id !== witch.id);
    deadPlayer.alive = false;
    const skill = witch.role.skills[ACTION.WITCH];
    const result = skill.execute({ action: 'poison', targetId: deadPlayer.id }, witch, game, {});
    if (result.success !== false) throw new Error('should fail when target is dead');
  });

  it('poison fails without targetId', () => {
    const skill = witch.role.skills[ACTION.WITCH];
    skill.execute({ action: 'poison' }, witch, game, {});
    if (game.poisonTarget) throw new Error('should not set poisonTarget without targetId');
  });

  it('skip does nothing and returns success', () => {
    const skill = witch.role.skills[ACTION.WITCH];
    const result = skill.execute({ action: 'skip' }, witch, game, {});
    if (result.success !== true) throw new Error('skip should return success');
    if (witch.state.heal !== 1) throw new Error('heal should remain 1');
    if (witch.state.poison !== 1) throw new Error('poison should remain 1');
  });

  it('heal and poison same night', () => {
    const wolf = findPlayer(game, 'werewolf');
    const skill = witch.role.skills[ACTION.WITCH];
    skill.execute({ action: 'heal' }, witch, game, {});
    skill.execute({ action: 'poison', targetId: wolf.id }, witch, game, {});
    if (witch.state.heal !== 0) throw new Error('heal should be 0');
    if (witch.state.poison !== 0) throw new Error('poison should be 0');
    if (game.healTarget !== villager.id) throw new Error('healTarget mismatch');
    if (game.poisonTarget !== wolf.id) throw new Error('poisonTarget mismatch');
  });
});

describe('hunter - action_shoot', () => {
  let game, hunter, target;

  beforeEach(() => {
    const harness = createGame({ presetId: '9-standard' });
    game = harness.game;
    hunter = findPlayer(game, 'hunter');
    target = findPlayer(game, 'villager');
    hunter.alive = false;
  });

  it('canUse returns true when canShoot and dead', () => {
    const skill = hunter.role.skills[ACTION.SHOOT];
    if (skill.canUse(hunter, game, { deathReason: 'wolf' }) !== true) throw new Error('dead hunter with canShoot should be able to shoot');
  });

  it('canUse returns false when canShoot is false', () => {
    hunter.state.canShoot = false;
    const skill = hunter.role.skills[ACTION.SHOOT];
    if (skill.canUse(hunter, game, { deathReason: 'wolf' }) !== false) throw new Error('should not shoot if canShoot=false');
  });

  it('canUse returns false for conflict death', () => {
    const skill = hunter.role.skills[ACTION.SHOOT];
    if (skill.canUse(hunter, game, { deathReason: 'conflict' }) !== false) throw new Error('should not shoot on conflict death');
  });

  it('canUse returns false for poison death by default', () => {
    const skill = hunter.role.skills[ACTION.SHOOT];
    if (skill.canUse(hunter, game, { deathReason: 'poison' }) !== false) throw new Error('should not shoot on poison death by default');
  });

  it('canUse returns true for poison death if canShootIfPoisoned rule', () => {
    game.effectiveRules = JSON.parse(JSON.stringify(game.effectiveRules));
    game.effectiveRules.hunter = { canShootIfPoisoned: true };
    const skill = hunter.role.skills[ACTION.SHOOT];
    if (skill.canUse(hunter, game, { deathReason: 'poison' }) !== true) throw new Error('should shoot on poison if rule allows');
  });

  it('canUse returns false when alive', () => {
    hunter.alive = true;
    const skill = hunter.role.skills[ACTION.SHOOT];
    if (skill.canUse(hunter, game, { deathReason: 'wolf' }) !== false) throw new Error('alive hunter should not shoot');
  });

  it('validate rejects self and dead targets', () => {
    const skill = hunter.role.skills[ACTION.SHOOT];
    if (skill.validate(hunter, hunter, game) !== false) throw new Error('should not shoot self');
    target.alive = false;
    if (skill.validate(target, hunter, game) !== false) throw new Error('should not shoot dead target');
  });

  it('validate accepts alive other target', () => {
    const skill = hunter.role.skills[ACTION.SHOOT];
    if (skill.validate(target, hunter, game) !== true) throw new Error('should accept alive target');
  });

  it('execute kills target and pushes to deathQueue', () => {
    const skill = hunter.role.skills[ACTION.SHOOT];
    skill.execute(target, hunter, game);
    if (hunter.state.canShoot !== false) throw new Error('canShoot should be false after shoot');
    if (target.deathReason !== 'hunter') throw new Error('deathReason should be hunter');
    if (!game.deathQueue.includes(target)) throw new Error('target should be in deathQueue');
  });

  it('execute with null target skips shot', () => {
    const skill = hunter.role.skills[ACTION.SHOOT];
    const result = skill.execute(null, hunter, game);
    if (hunter.state.canShoot !== false) throw new Error('canShoot should be false after skip');
    if (!result || !result.skipped) throw new Error('should return skipped');
    if (game.deathQueue.length !== 0) throw new Error('deathQueue should be empty');
  });

  it('execute with dead target does nothing', () => {
    target.alive = false;
    const skill = hunter.role.skills[ACTION.SHOOT];
    skill.execute(target, hunter, game);
    if (game.deathQueue.includes(target)) throw new Error('should not push dead target');
    if (hunter.state.canShoot !== true) throw new Error('canShoot should remain true');
  });

  it('player:death event disables canShoot on conflict', () => {
    const event = hunter.role.events['player:death'];
    event({ player: hunter, reason: 'conflict' }, game, hunter);
    if (hunter.state.canShoot !== false) throw new Error('canShoot should be false on conflict');
  });

  it('player:death event disables canShoot on poison (default rule)', () => {
    const event = hunter.role.events['player:death'];
    event({ player: hunter, reason: 'poison' }, game, hunter);
    if (hunter.state.canShoot !== false) throw new Error('canShoot should be false on poison');
  });

  it('player:death event keeps canShoot on poison if rule allows', () => {
    game.effectiveRules = JSON.parse(JSON.stringify(game.effectiveRules));
    game.effectiveRules.hunter = { canShootIfPoisoned: true };
    const freshHunter = findPlayer(game, 'hunter');
    const event = freshHunter.role.events['player:death'];
    event({ player: freshHunter, reason: 'poison' }, game, freshHunter);
    if (freshHunter.state.canShoot === false) throw new Error('canShoot should remain true if rule allows');
  });

  it('player:death event does not affect other players', () => {
    const event = hunter.role.events['player:death'];
    event({ player: target, reason: 'conflict' }, game, hunter);
    if (hunter.state.canShoot !== true) throw new Error('should not affect hunter when another player dies');
  });
});

describe('guard - action_guard', () => {
  let game, guard, target;

  beforeEach(() => {
    const harness = createGame({ presetId: '12-guard-cupid' });
    game = harness.game;
    guard = findPlayer(game, 'guard');
    target = findPlayer(game, 'villager');
    game.effectiveRules = JSON.parse(JSON.stringify(game.effectiveRules));
    game.effectiveRules.guard = { allowRepeatGuard: false };
  });

  it('validate rejects dead target', () => {
    target.alive = false;
    const skill = guard.role.skills[ACTION.GUARD];
    if (skill.validate(target, guard, game) !== false) throw new Error('should not guard dead target');
  });

  it('validate rejects same target as last night by default', () => {
    guard.state.lastGuardTarget = target.id;
    const skill = guard.role.skills[ACTION.GUARD];
    if (skill.validate(target, guard, game) !== false) throw new Error('should reject repeat guard');
  });

  it('validate allows same target if allowRepeatGuard is true', () => {
    guard.state.lastGuardTarget = target.id;
    game.effectiveRules.guard = { allowRepeatGuard: true };
    const skill = guard.role.skills[ACTION.GUARD];
    if (skill.validate(target, guard, game) !== true) throw new Error('should allow repeat guard when rule permits');
  });

  it('validate accepts new target', () => {
    const skill = guard.role.skills[ACTION.GUARD];
    if (skill.validate(target, guard, game) !== true) throw new Error('should accept new target');
  });

  it('execute sets lastGuardTarget and game.guardTarget', () => {
    const skill = guard.role.skills[ACTION.GUARD];
    skill.execute(target, guard, game);
    if (guard.state.lastGuardTarget !== target.id) throw new Error('lastGuardTarget should be set');
    if (game.guardTarget !== target.id) throw new Error('guardTarget should be set on game');
  });

  it('execute sends self-visible message', () => {
    const skill = guard.role.skills[ACTION.GUARD];
    skill.execute(target, guard, game);
    const msgs = game.message.messages.filter(m => m.playerId === guard.id && m.visibility === VISIBILITY.SELF);
    if (msgs.length === 0) throw new Error('should send guard message');
  });
});

describe('idiot - player:death event', () => {
  let game, idiot;

  beforeEach(() => {
    const harness = createGame({ presetId: '12-hunter-idiot' });
    game = harness.game;
    idiot = findPlayer(game, 'idiot');
  });

  it('immunity on vote death: cancels and sets revealed/canVote', () => {
    idiot.alive = false;
    const event = idiot.role.events['player:death'];
    const result = event({ player: idiot, reason: 'vote' }, game, idiot);
    if (result?.cancel !== true) throw new Error('should return cancel');
    if (idiot.state.revealed !== true) throw new Error('should set revealed');
    if (idiot.state.canVote !== false) throw new Error('should set canVote=false');
    if (idiot.alive !== true) throw new Error('should restore alive');
  });

  it('does not trigger on non-vote death', () => {
    idiot.alive = false;
    const event = idiot.role.events['player:death'];
    const result = event({ player: idiot, reason: 'wolf' }, game, idiot);
    if (result?.cancel === true) throw new Error('should not cancel on wolf kill');
    if (idiot.state.revealed === true) throw new Error('should not reveal on wolf kill');
  });

  it('does not trigger if already revealed', () => {
    idiot.state.revealed = true;
    idiot.state.canVote = false;
    idiot.alive = false;
    const event = idiot.role.events['player:death'];
    const result = event({ player: idiot, reason: 'vote' }, game, idiot);
    if (result?.cancel === true) throw new Error('should not cancel if already revealed');
    if (idiot.alive !== false) throw new Error('should stay dead if already revealed');
  });

  it('does not trigger for another player death', () => {
    const other = findPlayer(game, 'villager');
    const event = idiot.role.events['player:death'];
    const result = event({ player: other, reason: 'vote' }, game, idiot);
    if (result?.cancel === true) throw new Error('should not cancel for other player');
  });
});

describe('cupid - action_cupid', () => {
  let game, cupid, p1, p2;

  beforeEach(() => {
    const harness = createGame({ presetId: '12-guard-cupid' });
    game = harness.game;
    cupid = findPlayer(game, 'cupid');
    const villagers = game.players.filter(p => p.role.id === 'villager');
    p1 = villagers[0];
    p2 = villagers[1];
  });

  it('validate rejects non-2 targets', () => {
    const skill = cupid.role.skills[ACTION.CUPID];
    if (skill.validate([p1], cupid, game) !== false) throw new Error('should reject 1 target');
    if (skill.validate([p1, p2, cupid], cupid, game) !== false) throw new Error('should reject 3 targets');
  });

  it('validate accepts 2 alive targets', () => {
    const skill = cupid.role.skills[ACTION.CUPID];
    if (skill.validate([p1, p2], cupid, game) !== true) throw new Error('should accept 2 alive targets');
  });

  it('validate rejects if a target is dead', () => {
    p2.alive = false;
    const skill = cupid.role.skills[ACTION.CUPID];
    if (skill.validate([p1, p2], cupid, game) !== false) throw new Error('should reject dead target');
  });

  it('validate allows cupid as one of the targets', () => {
    const skill = cupid.role.skills[ACTION.CUPID];
    if (skill.validate([cupid, p1], cupid, game) !== true) throw new Error('cupid can be a couple target');
  });

  it('execute sets game.couples and notifies', () => {
    const skill = cupid.role.skills[ACTION.CUPID];
    skill.execute([p1, p2], cupid, game);
    if (!game.couples || !game.couples.includes(p1.id) || !game.couples.includes(p2.id)) throw new Error('should set couples');
    const msgs = game.message.messages.filter(m => m.type === MSG.SYSTEM);
    if (msgs.length < 2) throw new Error('should notify both partners');
  });

  it('execute sends cupid a self-visible message', () => {
    const skill = cupid.role.skills[ACTION.CUPID];
    skill.execute([p1, p2], cupid, game);
    const cupidMsg = game.message.messages.filter(m => m.playerId === cupid.id && m.visibility === VISIBILITY.SELF);
    if (cupidMsg.length === 0) throw new Error('cupid should get a message');
  });
});

describe('couple attachment - player:death event', () => {
  let game, p1, p2;

  beforeEach(() => {
    const harness = createGame({ presetId: '12-guard-cupid' });
    game = harness.game;
    const villagers = game.players.filter(p => p.role.id === 'villager');
    p1 = villagers[0];
    p2 = villagers[1];
    game.couples = [p1.id, p2.id];
  });

  it('partner dies when one couple member dies', () => {
    const event = ATTACHMENTS.couple.events['player:death'];
    p1.alive = false;
    p1.deathReason = 'wolf';
    event({ player: p1, reason: 'wolf' }, game, p1);
    if (!game.deathQueue.includes(p2)) throw new Error('living partner should be in deathQueue');
    if (p2.deathReason !== 'couple') throw new Error('partner deathReason should be couple');
  });

  it('no martyrdom if partner already dead', () => {
    const event = ATTACHMENTS.couple.events['player:death'];
    p1.alive = false;
    p2.alive = false;
    p2.deathReason = 'wolf';
    event({ player: p1, reason: 'wolf' }, game, p1);
    if (game.deathQueue.includes(p2)) throw new Error('dead partner should not be in deathQueue');
  });

  it('no effect on non-couple player event', () => {
    const event = ATTACHMENTS.couple.events['player:death'];
    const other = game.players.find(p => !game.couples.includes(p.id));
    other.alive = false;
    event({ player: other, reason: 'wolf' }, game, p1);
    if (game.deathQueue.includes(p2)) throw new Error('non-couple death should not trigger martyrdom');
  });
});

describe('villager', () => {
  let game;

  beforeEach(() => {
    const harness = createGame({ presetId: '9-standard' });
    game = harness.game;
  });

  it('has no skills', () => {
    const villager = findPlayer(game, 'villager');
    if (Object.keys(villager.role.skills).length !== 0) throw new Error('villager should have no skills');
  });

  it('has no events', () => {
    const villager = findPlayer(game, 'villager');
    if (villager.role.events && Object.keys(villager.role.events).length !== 0) throw new Error('villager should have no events');
  });
});

describe('sheriff attachment', () => {
  let game, player1, player2;

  beforeEach(() => {
    const harness = createGame({ presetId: '12-hunter-idiot' });
    game = harness.game;
    player1 = game.players[0];
    player2 = game.players[1];
    player1.state = player1.state || {};
    player2.state = player2.state || {};
    game.sheriff = player1.id;
  });

  it('action_sheriff_campaign sets isCandidate', () => {
    const skill = ATTACHMENTS.sheriff.skills[ACTION.SHERIFF_CAMPAIGN];
    player1.state.withdrew = false;
    if (skill.canUse(player1, game) !== true) throw new Error('alive non-withdrew player should campaign');
    const result = skill.execute(null, player1, game);
    if (player1.state.isCandidate !== true) throw new Error('should set isCandidate');
    if (result?.run !== true) throw new Error('should return run=true');
  });

  it('action_sheriff_campaign canUse false if withdrew', () => {
    player1.state.withdrew = true;
    const skill = ATTACHMENTS.sheriff.skills[ACTION.SHERIFF_CAMPAIGN];
    if (skill.canUse(player1, game) !== false) throw new Error('withdrew player should not campaign');
  });

  it('action_sheriff_campaign canUse false if dead', () => {
    player1.alive = false;
    const skill = ATTACHMENTS.sheriff.skills[ACTION.SHERIFF_CAMPAIGN];
    if (skill.canUse(player1, game) !== false) throw new Error('dead player should not campaign');
  });

  it('action_withdraw sets withdrew', () => {
    player1.state.isCandidate = true;
    player1.state.withdrew = false;
    const skill = ATTACHMENTS.sheriff.skills[ACTION.WITHDRAW];
    if (skill.canUse(player1, game) !== true) throw new Error('candidate should be able to withdraw');
    const result = skill.execute(null, player1, game);
    if (player1.state.withdrew !== true) throw new Error('should set withdrew');
    if (result?.withdraw !== true) throw new Error('should return withdraw=true');
  });

  it('action_withdraw canUse false if not candidate', () => {
    player1.state.isCandidate = false;
    const skill = ATTACHMENTS.sheriff.skills[ACTION.WITHDRAW];
    if (skill.canUse(player1, game) !== false) throw new Error('non-candidate should not withdraw');
  });

  it('action_withdraw canUse false if already withdrew', () => {
    player1.state.isCandidate = true;
    player1.state.withdrew = true;
    const skill = ATTACHMENTS.sheriff.skills[ACTION.WITHDRAW];
    if (skill.canUse(player1, game) !== false) throw new Error('already withdrew should not withdraw again');
  });

  it('action_assignOrder sets sheriffAssignOrder', () => {
    const skill = ATTACHMENTS.sheriff.skills['action_assignOrder'];
    if (skill.canUse(player1, game) !== true) throw new Error('sheriff should be able to assign order');
    skill.execute(player2, player1, game);
    if (game.sheriffAssignOrder !== player2.id) throw new Error('should set sheriffAssignOrder');
  });

  it('action_assignOrder canUse false for non-sheriff', () => {
    const skill = ATTACHMENTS.sheriff.skills['action_assignOrder'];
    if (skill.canUse(player2, game) !== false) throw new Error('non-sheriff should not assign order');
  });

  it('action_assignOrder validate rejects self and dead', () => {
    const skill = ATTACHMENTS.sheriff.skills['action_assignOrder'];
    if (skill.validate(player1, player1, game) !== false) throw new Error('should not assign self');
    player2.alive = false;
    if (skill.validate(player2, player1, game) !== false) throw new Error('should not assign dead');
  });

  it('action_passBadge transfers badge to alive target', () => {
    player1.alive = false;
    const skill = ATTACHMENTS.sheriff.skills['action_passBadge'];
    if (skill.canUse(player1, game) !== true) throw new Error('dead sheriff should be able to pass badge');
    const result = skill.execute(player2, player1, game);
    if (game.sheriff !== player2.id) throw new Error('sheriff should transfer to target');
    if (result?.success !== true) throw new Error('should return success');
  });

  it('action_passBadge null target destroys badge', () => {
    player1.alive = false;
    const skill = ATTACHMENTS.sheriff.skills['action_passBadge'];
    const result = skill.execute(null, player1, game);
    if (game.sheriff !== null) throw new Error('sheriff badge should be destroyed');
    if (result?.flowed !== true) throw new Error('should return flowed=true');
  });

  it('action_passBadge no alive players destroys badge', () => {
    player1.alive = false;
    game.players.forEach(p => { if (p.id !== player1.id) p.alive = false; });
    const skill = ATTACHMENTS.sheriff.skills['action_passBadge'];
    skill.execute(player2, player1, game);
    if (game.sheriff !== null) throw new Error('sheriff badge should be destroyed with no alive players');
  });

  it('action_passBadge canUse false if alive sheriff', () => {
    player1.alive = true;
    const skill = ATTACHMENTS.sheriff.skills['action_passBadge'];
    if (skill.canUse(player1, game) !== false) throw new Error('alive sheriff should not pass badge');
  });

  it('action_passBadge validate rejects self and dead target', () => {
    player1.alive = false;
    const skill = ATTACHMENTS.sheriff.skills['action_passBadge'];
    if (skill.validate(player1, player1, game) !== false) throw new Error('should not pass to self');
    player2.alive = false;
    if (skill.validate(player2, player1, game) !== false) throw new Error('should not pass to dead');
  });
});

describe('createPlayerRole', () => {
  it('returns null for unknown role', () => {
    const result = createPlayerRole('unknown');
    if (result !== null) throw new Error('should return null for unknown role');
  });

  it('copies role properties correctly', () => {
    const r = createPlayerRole('werewolf');
    if (r.id !== 'werewolf') throw new Error('id should be werewolf');
    if (r.camp !== CAMP.WOLF) throw new Error('camp should be wolf');
    if (!r.skills[ACTION.EXPLODE]) throw new Error('should have explode skill');
  });

  it('returns empty state object for roles without state', () => {
    const r = createPlayerRole('werewolf');
    if (typeof r.state !== 'object') throw new Error('state should be object');
  });

  it('witch state has heal=1 poison=1', () => {
    const r = createPlayerRole('witch');
    if (r.state.heal !== 1) throw new Error('heal should be 1');
    if (r.state.poison !== 1) throw new Error('poison should be 1');
  });

  it('hunter state has canShoot=true', () => {
    const r = createPlayerRole('hunter');
    if (r.state.canShoot !== true) throw new Error('canShoot should be true');
  });

  it('guard state has lastGuardTarget=null', () => {
    const r = createPlayerRole('guard');
    if (r.state.lastGuardTarget !== null) throw new Error('lastGuardTarget should be null');
  });

  it('idiot state has revealed=false canVote=true', () => {
    const r = createPlayerRole('idiot');
    if (r.state.revealed !== false) throw new Error('revealed should be false');
    if (r.state.canVote !== true) throw new Error('canVote should be true');
  });

  it('each call returns independent state for primitive values', () => {
    const a = createPlayerRole('witch');
    const b = createPlayerRole('witch');
    a.state.heal = 0;
    if (b.state.heal !== 1) throw new Error('instances should have independent primitive state');
  });
});

run();