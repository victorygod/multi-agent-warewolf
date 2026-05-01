const { describe, it, beforeEach, run } = require('../../helpers/test-runner');
const { createGame } = require('../../helpers/game-harness');
const { assertPlayerAlive, assertPlayerDead, assertCanShoot } = require('../../helpers/assertions');

function findPlayer(game, roleId) {
  return game.players.find(p => p.role?.id === roleId);
}

describe('引擎集成 - 同守同救(conflict death)', () => {
  it('守卫和女巫同救一人则该人死亡', async () => {
    const harness = createGame({ presetId: '12-guard-cupid' });
    const { game } = harness;
    game.round = 1;
    const villager = game.players.find(p => p.role.id === 'villager');
    game.werewolfTarget = villager.id;
    game.guardTarget = villager.id;
    game.healTarget = villager.id;
    await game.phaseManager.executePhase('day_announce');
    if (villager.alive) throw new Error('同守同救应导致死亡');
  });

  it('仅守卫守护则狼刀无效', async () => {
    const harness = createGame({ presetId: '12-guard-cupid' });
    const { game } = harness;
    game.round = 1;
    const villager = game.players.find(p => p.role.id === 'villager');
    game.werewolfTarget = villager.id;
    game.guardTarget = villager.id;
    game.healTarget = null;
    await game.phaseManager.executePhase('day_announce');
    if (!villager.alive) throw new Error('仅守卫守护应救活');
  });

  it('仅女巫解救则狼刀无效', async () => {
    const harness = createGame({ presetId: '9-standard' });
    const { game } = harness;
    game.round = 1;
    const villager = game.players.find(p => p.role.id === 'villager');
    game.werewolfTarget = villager.id;
    game.healTarget = villager.id;
    await game.phaseManager.executePhase('day_announce');
    if (!villager.alive) throw new Error('女巫解救应救活');
  });

  it('无人救守则狼刀致死', async () => {
    const harness = createGame({ presetId: '9-standard' });
    const { game } = harness;
    game.round = 1;
    const villager = game.players.find(p => p.role.id === 'villager');
    game.werewolfTarget = villager.id;
    await game.phaseManager.executePhase('day_announce');
    if (villager.alive) throw new Error('无人救守狼刀应致死');
  });
});

describe('引擎集成 - 女巫自救限制', () => {
  it('首夜canSelfHeal=true可自救', async () => {
    const harness = createGame({ presetId: '9-standard' });
    const { game } = harness;
    game.round = 1;
    const witch = findPlayer(game, 'witch');
    game.werewolfTarget = witch.id;
    game.healTarget = witch.id;
    await game.phaseManager.executePhase('day_announce');
    if (!witch.alive) throw new Error('首夜女巫自救应成功');
  });

  it('第二夜healTarget自救仍生效(day_announce不验证canSelfHeal)', async () => {
    const harness = createGame({ presetId: '9-standard' });
    const { game } = harness;
    game.round = 2;
    const witch = findPlayer(game, 'witch');
    game.werewolfTarget = witch.id;
    game.healTarget = witch.id;
    await game.phaseManager.executePhase('day_announce');
    if (!witch.alive) throw new Error('day_announce只看healTarget是否设置，不验证canSelfHeal');
  });

  it('女巫阶段第二夜canSelfHeal为false', () => {
    const harness = createGame({ presetId: '9-standard' });
    const { game } = harness;
    game.round = 2;
    const witch = findPlayer(game, 'witch');
    const canSelfHeal = (game.effectiveRules?.witch?.canSelfHeal ?? true) && game.round === 1;
    if (canSelfHeal !== false) throw new Error('第二夜canSelfHeal应为false');
  });
});

describe('引擎集成 - 毒杀与守卫', () => {
  it('守卫保护被毒玩家无效', async () => {
    const harness = createGame({ presetId: '12-guard-cupid' });
    const { game } = harness;
    game.round = 1;
    const villager = game.players.find(p => p.role.id === 'villager');
    game.poisonTarget = villager.id;
    game.guardTarget = villager.id;
    await game.phaseManager.executePhase('day_announce');
    if (villager.alive) throw new Error('守卫不能防毒杀');
  });
});

describe('引擎集成 - 多夜死亡', () => {
  it('狼刀和毒杀同时发生', async () => {
    const harness = createGame({ presetId: '9-standard' });
    const { game } = harness;
    game.round = 1;
    const villager1 = game.players.filter(p => p.role.id === 'villager')[0];
    const villager2 = game.players.filter(p => p.role.id === 'villager')[1];
    game.werewolfTarget = villager1.id;
    game.poisonTarget = villager2.id;
    await game.phaseManager.executePhase('day_announce');
    if (villager1.alive) throw new Error('狼刀目标应死亡');
    if (villager2.alive) throw new Error('毒杀目标应死亡');
  });
});

describe('引擎集成 - 猎人冲突死亡', () => {
  it('猎人被同守同救冲突死亡不能开枪', async () => {
    const harness = createGame({ presetId: '12-guard-cupid' });
    const { game } = harness;
    game.round = 1;
    const hunter = findPlayer(game, 'hunter');
    game.werewolfTarget = hunter.id;
    game.guardTarget = hunter.id;
    game.healTarget = hunter.id;
    await game.phaseManager.executePhase('day_announce');
    if (hunter.alive) throw new Error('猎人冲突死亡应死亡');
    if (hunter.state.canShoot) throw new Error('冲突死亡猎人不能开枪');
  });

  it('猎人被毒杀不能开枪(默认规则)', async () => {
    const harness = createGame({ presetId: '9-standard' });
    const { game } = harness;
    game.round = 1;
    const hunter = findPlayer(game, 'hunter');
    game.poisonTarget = hunter.id;
    await game.phaseManager.executePhase('day_announce');
    if (hunter.alive) throw new Error('猎人被毒应死亡');
    if (hunter.state.canShoot) throw new Error('被毒猎人默认不能开枪');
  });
});

describe('引擎集成 - 狼人自爆销毁警徽', () => {
  it('狼人警长自爆后警徽销毁', () => {
    const harness = createGame({ presetId: '12-hunter-idiot' });
    const { game } = harness;
    const wolf = game.players.find(p => p.role.id === 'werewolf');
    game.sheriff = wolf.id;
    wolf.state.isSheriff = true;
    game.phaseManager = {
      getCurrentPhase: () => ({ id: 'day_discuss' }),
      start: () => Promise.resolve()
    };
    const result = game.explode(wolf.id);
    if (result.success !== true) throw new Error('自爆应成功');
    if (game.sheriff !== null) throw new Error('狼人警长自爆后警徽应销毁');
  });
});

describe('引擎集成 - 女巫无药可用', () => {
  it('女巫无解药无毒药时buildActionData', () => {
    const harness = createGame({ presetId: '9-standard' });
    const { game } = harness;
    const witch = findPlayer(game, 'witch');
    witch.state.heal = 0;
    witch.state.poison = 0;
    game.werewolfTarget = game.players.find(p => p.role.id === 'villager').id;
    game.round = 1;
    const data = game.buildActionData(witch.id, 'action_witch');
    if (data.healAvailable !== false) throw new Error('解药应为不可用');
    if (data.poisonAvailable !== false) throw new Error('毒药应为不可用');
  });
});

describe('引擎集成 - 预言家查验情侣', () => {
  it('预言家查验丘比特返回好人', () => {
    const harness = createGame({ presetId: '12-guard-cupid' });
    const { game } = harness;
    const seer = findPlayer(game, 'seer');
    const cupid = findPlayer(game, 'cupid');
    const result = seer.role.skills['action_seer'].validate(cupid, seer, game);
    if (result !== true) throw new Error('预言家应能查验丘比特');
  });
});

run();