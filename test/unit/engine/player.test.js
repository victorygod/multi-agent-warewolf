const { describe, it, beforeEach, run } = require('../../helpers/test-runner');
const { createGame } = require('../../helpers/game-harness');
const { PlayerController, HumanController } = require('../../../engine/player');

describe('PlayerController - getPlayer', () => {
  it('返回对应ID的玩家', () => {
    const harness = createGame({ presetId: '9-standard' });
    const ctrl = new PlayerController(1, harness.game);
    const player = ctrl.getPlayer();
    if (!player || player.id !== 1) throw new Error('应返回1号玩家');
  });

  it('不存在的ID返回undefined', () => {
    const harness = createGame({ presetId: '9-standard' });
    const ctrl = new PlayerController(999, harness.game);
    if (ctrl.getPlayer() !== undefined) throw new Error('应返回undefined');
  });
});

describe('PlayerController - getSkill', () => {
  it('获取角色技能', () => {
    const harness = createGame({ presetId: '9-standard' });
    const seer = harness.game.players.find(p => p.role.id === 'seer');
    const ctrl = new PlayerController(seer.id, harness.game);
    const skill = ctrl.getSkill('action_seer');
    if (!skill) throw new Error('预言家应有action_seer技能');
  });

  it('获取全局机制技能（警长）', () => {
    const harness = createGame({ presetId: '12-hunter-idiot' });
    const player = harness.game.players[0];
    const ctrl = new PlayerController(player.id, harness.game);
    const skill = ctrl.getSkill('action_sheriff_campaign');
    if (!skill) throw new Error('应能获取警长竞选技能');
  });

  it('不存在的技能返回undefined', () => {
    const harness = createGame({ presetId: '9-standard' });
    const ctrl = new PlayerController(1, harness.game);
    if (ctrl.getSkill('action_nonexistent') !== undefined) throw new Error('应返回undefined');
  });

  it('技能有id属性', () => {
    const harness = createGame({ presetId: '9-standard' });
    const seer = harness.game.players.find(p => p.role.id === 'seer');
    const ctrl = new PlayerController(seer.id, harness.game);
    const skill = ctrl.getSkill('action_seer');
    if (skill.id !== 'action_seer') throw new Error('技能id应为action_seer');
  });
});

describe('PlayerController - canUseSkill', () => {
  it('可用技能返回ok', () => {
    const harness = createGame({ presetId: '9-standard' });
    const seer = harness.game.players.find(p => p.role.id === 'seer');
    const ctrl = new PlayerController(seer.id, harness.game);
    const skill = ctrl.getSkill('action_seer');
    const result = ctrl.canUseSkill(skill);
    if (!result.ok) throw new Error(`预言家存活应可用: ${result.message}`);
  });

  it('canUse返回false时不可用', () => {
    const harness = createGame({ presetId: '9-standard' });
    const wolf = harness.game.players.find(p => p.role.id === 'werewolf');
    wolf.alive = false;
    const ctrl = new PlayerController(wolf.id, harness.game);
    const skill = ctrl.getSkill('action_explode');
    const result = ctrl.canUseSkill(skill);
    if (result.ok) throw new Error('死亡狼人不能自爆');
  });

  it('玩家不存在返回失败', () => {
    const harness = createGame({ presetId: '9-standard' });
    const ctrl = new PlayerController(999, harness.game);
    const result = ctrl.canUseSkill({ canUse: () => true });
    if (result.ok) throw new Error('不存在的玩家应返回失败');
  });
});

describe('PlayerController - executeTargetSkill', () => {
  it('有效目标执行成功', () => {
    const harness = createGame({ presetId: '9-standard' });
    const seer = harness.game.players.find(p => p.role.id === 'seer');
    const target = harness.game.players.find(p => p.role.id === 'werewolf');
    const ctrl = new PlayerController(seer.id, harness.game);
    const skill = ctrl.getSkill('action_seer');
    const result = ctrl.executeSkill(skill, { target: target.id });
    if (!result.success) throw new Error(`应成功: ${result.message}`);
  });

  it('无效目标返回失败', () => {
    const harness = createGame({ presetId: '9-standard' });
    const seer = harness.game.players.find(p => p.role.id === 'seer');
    const ctrl = new PlayerController(seer.id, harness.game);
    const skill = ctrl.getSkill('action_seer');
    const result = ctrl.executeSkill(skill, { target: 999 });
    if (result.success) throw new Error('无效目标应失败');
  });

  it('未选择目标返回失败', () => {
    const harness = createGame({ presetId: '9-standard' });
    const seer = harness.game.players.find(p => p.role.id === 'seer');
    const ctrl = new PlayerController(seer.id, harness.game);
    const skill = ctrl.getSkill('action_seer');
    const result = ctrl.executeSkill(skill, {});
    if (result.success) throw new Error('未选择目标应失败');
  });

  it('猎人开枪允许null目标（放弃）', () => {
    const harness = createGame({ presetId: '9-standard' });
    const hunter = harness.game.players.find(p => p.role.id === 'hunter');
    hunter.alive = false;
    hunter.state.canShoot = true;
    const ctrl = new PlayerController(hunter.id, harness.game);
    const skill = ctrl.getSkill('action_shoot');
    const result = ctrl.executeSkill(skill, { target: null });
    if (!result.success) throw new Error('猎人放弃开枪应成功');
  });

  it('警徽移交允许null目标（警徽流失）', () => {
    const harness = createGame({ presetId: '12-hunter-idiot' });
    const player = harness.game.players.find(p => p.id === 1);
    harness.game.sheriff = player.id;
    player.alive = false;
    const ctrl = new PlayerController(player.id, harness.game);
    const skill = ctrl.getSkill('action_passBadge');
    const result = ctrl.executeSkill(skill, { target: null });
    if (!result.success) throw new Error('警徽流失应成功');
  });

  it('validate失败返回失败', () => {
    const harness = createGame({ presetId: '9-standard' });
    const guard = harness.game.players.find(p => p.role.id === 'guard');
    if (!guard) return;
    const target = harness.game.players.find(p => p.id !== guard.id && p.alive);
    guard.state.lastGuardTarget = target.id;
    const ctrl = new PlayerController(guard.id, harness.game);
    const skill = ctrl.getSkill('action_guard');
    const result = ctrl.executeSkill(skill, { target: target.id });
    if (result.success) throw new Error('守卫连守同一人应失败');
  });
});

describe('PlayerController - executeDoubleTargetSkill', () => {
  it('丘比特选两个目标成功', () => {
    const harness = createGame({ presetId: '12-guard-cupid' });
    const cupid = harness.game.players.find(p => p.role.id === 'cupid');
    const targets = harness.game.players.filter(p => p.id !== cupid.id).slice(0, 2);
    const ctrl = new PlayerController(cupid.id, harness.game);
    const skill = ctrl.getSkill('action_cupid');
    const result = ctrl.executeSkill(skill, { targets: targets.map(t => t.id) });
    if (!result.success) throw new Error(`丘比特选两人应成功: ${result.message}`);
  });

  it('丘比特不选两人返回失败', () => {
    const harness = createGame({ presetId: '12-guard-cupid' });
    const cupid = harness.game.players.find(p => p.role.id === 'cupid');
    const ctrl = new PlayerController(cupid.id, harness.game);
    const skill = ctrl.getSkill('action_cupid');
    const result = ctrl.executeSkill(skill, { targets: [1] });
    if (result.success) throw new Error('只选一人应失败');
  });

  it('丘比特选不存在的目标返回失败', () => {
    const harness = createGame({ presetId: '12-guard-cupid' });
    const cupid = harness.game.players.find(p => p.role.id === 'cupid');
    const ctrl = new PlayerController(cupid.id, harness.game);
    const skill = ctrl.getSkill('action_cupid');
    const result = ctrl.executeSkill(skill, { targets: [999, 998] });
    if (result.success) throw new Error('无效目标应失败');
  });
});

describe('PlayerController - executeChoiceSkill', () => {
  it('女巫救人成功', () => {
    const harness = createGame({ presetId: '9-standard' });
    const witch = harness.game.players.find(p => p.role.id === 'witch');
    const wolfTarget = harness.game.players.find(p => p.role.id === 'villager');
    wolfTarget.alive = false;
    const ctrl = new PlayerController(witch.id, harness.game);
    const skill = ctrl.getSkill('action_witch');
    const extraData = { werewolfTarget: wolfTarget.id, healAvailable: true, poisonAvailable: true };
    const result = ctrl.executeSkill(skill, { action: 'heal', targetId: wolfTarget.id }, extraData);
    if (!result.success) throw new Error(`女巫救人应成功: ${result.message}`);
  });

  it('女巫跳过成功', () => {
    const harness = createGame({ presetId: '9-standard' });
    const witch = harness.game.players.find(p => p.role.id === 'witch');
    const ctrl = new PlayerController(witch.id, harness.game);
    const skill = ctrl.getSkill('action_witch');
    const extraData = { healAvailable: false, poisonAvailable: true };
    const result = ctrl.executeSkill(skill, { action: 'skip' }, extraData);
    if (!result.success) throw new Error('女巫跳过应成功');
  });
});

describe('PlayerController - executeInstantSkill', () => {
  it('竞选警长成功', () => {
    const harness = createGame({ presetId: '12-hunter-idiot' });
    const player = harness.game.players[0];
    const ctrl = new PlayerController(player.id, harness.game);
    const skill = ctrl.getSkill('action_sheriff_campaign');
    const result = ctrl.executeSkill(skill, { confirmed: true });
    if (!result.success || !result.run) throw new Error('竞选应成功且run=true');
  });

  it('竞选警长未确认返回失败', () => {
    const harness = createGame({ presetId: '12-hunter-idiot' });
    const player = harness.game.players[0];
    const ctrl = new PlayerController(player.id, harness.game);
    const skill = ctrl.getSkill('action_sheriff_campaign');
    const result = ctrl.executeSkill(skill, {});
    if (result.success) throw new Error('未确认应失败');
  });

  it('退水成功', () => {
    const harness = createGame({ presetId: '12-hunter-idiot' });
    const player = harness.game.players[0];
    player.state.isCandidate = true;
    const ctrl = new PlayerController(player.id, harness.game);
    const skill = ctrl.getSkill('action_withdraw');
    const result = ctrl.executeSkill(skill, { withdraw: true });
    if (!result.success || !result.withdraw) throw new Error('退水应成功且withdraw=true');
  });
});

describe('PlayerController - formatAllowedTargets', () => {
  it('target类型格式化玩家列表', () => {
    const harness = createGame({ presetId: '9-standard' });
    const ctrl = new PlayerController(1, harness.game);
    const result = ctrl.formatAllowedTargets('action_seer', { allowedTargets: [2, 3] });
    if (!result.includes('2号') || !result.includes('3号')) throw new Error(`应包含玩家编号: ${result}`);
  });

  it('choice类型格式化女巫选项', () => {
    const harness = createGame({ presetId: '9-standard' });
    const ctrl = new PlayerController(1, harness.game);
    const result = ctrl.formatAllowedTargets('action_witch', { healAvailable: true, poisonAvailable: false });
    if (!result.includes('救') || !result.includes('跳过')) throw new Error(`应包含救和跳过: ${result}`);
  });

  it('空目标返回无', () => {
    const harness = createGame({ presetId: '9-standard' });
    const ctrl = new PlayerController(1, harness.game);
    const result = ctrl.formatAllowedTargets('action_unknown', {});
    if (result !== '无') throw new Error(`应返回无，实际: ${result}`);
  });
});

describe('PlayerController - 未知技能类型', () => {
  it('executeSkill未知类型返回失败', () => {
    const harness = createGame({ presetId: '9-standard' });
    const player = harness.game.players[0];
    const ctrl = new PlayerController(player.id, harness.game);
    const result = ctrl.executeSkill({ type: 'unknown' }, {});
    if (result.success) throw new Error('未知类型应失败');
  });
});

describe('HumanController - buildSkillRequest', () => {
  it('target类型含aliveList', () => {
    const harness = createGame({ presetId: '9-standard' });
    const seer = harness.game.players.find(p => p.role.id === 'seer');
    const ctrl = new HumanController(seer.id, harness.game);
    const skill = ctrl.getSkill('action_seer');
    const request = ctrl.buildSkillRequest(skill, {});
    if (!request.aliveList) throw new Error('target类型应有aliveList');
  });

  it('choice类型返回extraData', () => {
    const harness = createGame({ presetId: '9-standard' });
    const witch = harness.game.players.find(p => p.role.id === 'witch');
    const ctrl = new HumanController(witch.id, harness.game);
    const skill = ctrl.getSkill('action_witch');
    const extra = { healAvailable: true };
    const request = ctrl.buildSkillRequest(skill, extra);
    if (request.healAvailable !== true) throw new Error('choice类型应传递extraData');
  });

  it('instant类型返回空对象', () => {
    const harness = createGame({ presetId: '12-hunter-idiot' });
    const player = harness.game.players[0];
    const ctrl = new HumanController(player.id, harness.game);
    const skill = ctrl.getSkill('action_sheriff_campaign');
    const request = ctrl.buildSkillRequest(skill, {});
    if (Object.keys(request).length !== 0) throw new Error('instant类型应返回空对象');
  });
});

run();