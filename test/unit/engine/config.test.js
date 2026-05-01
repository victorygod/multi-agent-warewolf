const { describe, it, run } = require('../../helpers/test-runner');
const { createGame } = require('../../helpers/game-harness');
const { HOOKS, BOARD_PRESETS, getEffectiveRules } = require('../../../engine/config');

describe('HOOKS.checkWin - 标准胜负', () => {
  it('狼人全死好人胜', () => {
    const harness = createGame({ presetId: '9-standard' });
    const { game } = harness;
    const wolves = game.players.filter(p => p.role.id === 'werewolf');
    wolves.forEach(w => w.alive = false);
    const result = HOOKS.checkWin(game);
    if (result !== 'good') throw new Error(`期望good，实际${result}`);
  });

  it('神职全死狼人胜', () => {
    const harness = createGame({ presetId: '9-standard' });
    const { game } = harness;
    const gods = game.players.filter(p => p.role.type === 'god');
    gods.forEach(g => g.alive = false);
    const result = HOOKS.checkWin(game);
    if (result !== 'wolf') throw new Error(`期望wolf，实际${result}`);
  });

  it('村民全死狼人胜', () => {
    const harness = createGame({ presetId: '9-standard' });
    const { game } = harness;
    const villagers = game.players.filter(p => p.role.type === 'villager');
    villagers.forEach(v => v.alive = false);
    const result = HOOKS.checkWin(game);
    if (result !== 'wolf') throw new Error(`期望wolf，实际${result}`);
  });

  it('游戏进行中返回null', () => {
    const harness = createGame({ presetId: '9-standard' });
    const result = HOOKS.checkWin(harness.game);
    if (result !== null) throw new Error(`期望null，实际${result}`);
  });
});

describe('HOOKS.checkWin - 丘比特第三方', () => {
  it('无人狼情侣时正常胜负', () => {
    const harness = createGame({ presetId: '12-guard-cupid' });
    const { game } = harness;
    const wolves = game.players.filter(p => p.role.id === 'werewolf');
    wolves.forEach(w => w.alive = false);
    const result = HOOKS.checkWin(game);
    if (result !== 'good') throw new Error(`期望good，实际${result}`);
  });

  it('人狼情侣存活且其他人全死第三方胜利', () => {
    const harness = createGame({ presetId: '12-guard-cupid' });
    const { game } = harness;
    const cupid = game.players.find(p => p.role.id === 'cupid');
    const wolf = game.players.find(p => p.role.id === 'werewolf');
    game.couples = [cupid.id, wolf.id];
    game.players.forEach(p => {
      if (p.id !== cupid.id && p.id !== wolf.id) p.alive = false;
    });
    const result = HOOKS.checkWin(game);
    if (result !== 'third') throw new Error(`期望third，实际${result}`);
  });

  it('人狼情侣存活但其他人还活时无胜利', () => {
    const harness = createGame({ presetId: '12-guard-cupid' });
    const { game } = harness;
    const cupid = game.players.find(p => p.role.id === 'cupid');
    const wolf = game.players.find(p => p.role.id === 'werewolf');
    game.couples = [cupid.id, wolf.id];
    const result = HOOKS.checkWin(game);
    if (result !== null) throw new Error(`期望null，实际${result}`);
  });

  it('狼人屠边但第三方未灭则狼人不胜', () => {
    const harness = createGame({ presetId: '12-guard-cupid' });
    const { game } = harness;
    const cupid = game.players.find(p => p.role.id === 'cupid');
    const wolf = game.players.find(p => p.role.id === 'werewolf');
    game.couples = [cupid.id, wolf.id];
    const villagers = game.players.filter(p => p.role.type === 'villager');
    villagers.forEach(v => v.alive = false);
    const gods = game.players.filter(p => p.role.type === 'god' && p.role.id !== 'cupid');
    gods.forEach(g => g.alive = false);
    const result = HOOKS.checkWin(game);
    if (result !== null) throw new Error(`人狼恋存活时屠边不应判狼胜，实际${result}`);
  });
});

describe('HOOKS.hasLastWords', () => {
  it('情侣死亡无遗言', () => {
    if (HOOKS.hasLastWords({}, 'couple', {}) !== false) throw new Error('情侣死亡应无遗言');
  });

  it('投票死亡有遗言', () => {
    if (HOOKS.hasLastWords({}, 'vote', {}) !== true) throw new Error('投票死亡应有遗言');
  });

  it('猎人开枪死亡有遗言', () => {
    if (HOOKS.hasLastWords({}, 'hunter', {}) !== true) throw new Error('猎人开枪死亡应有遗言');
  });

  it('第一晚死亡有遗言', () => {
    if (HOOKS.hasLastWords({}, 'wolf', { round: 1 }) !== true) throw new Error('第一晚死亡应有遗言');
  });

  it('后续夜晚死亡无遗言', () => {
    if (HOOKS.hasLastWords({}, 'wolf', { round: 2 }) !== false) throw new Error('后续夜晚死亡无遗言');
  });
});

describe('getEffectiveRules', () => {
  it('空rules返回默认深拷贝', () => {
    const rules = getEffectiveRules({});
    if (!rules.witch || !rules.hunter) throw new Error('应包含默认规则');
  });

  it('preset rules覆盖默认', () => {
    const rules = getEffectiveRules({ rules: { witch: { canSelfHeal: false } } });
    if (rules.witch.canSelfHeal !== false) throw new Error('canSelfHeal应被覆盖为false');
  });

  it('不修改原始RULES', () => {
    const originalSelfHeal = HOOKS.RULES.witch.canSelfHeal;
    getEffectiveRules({ rules: { witch: { canSelfHeal: false } } });
    if (HOOKS.RULES.witch.canSelfHeal !== originalSelfHeal) throw new Error('原始RULES被修改');
  });
});

describe('BOARD_PRESETS', () => {
  it('每个preset有必需字段', () => {
    for (const [id, preset] of Object.entries(BOARD_PRESETS)) {
      if (!preset.name) throw new Error(`${id} 缺少name`);
      if (!preset.description) throw new Error(`${id} 缺少description`);
      if (!preset.playerCount) throw new Error(`${id} 缺少playerCount`);
      if (!preset.roles || preset.roles.length !== preset.playerCount) {
        throw new Error(`${id} roles长度不等于playerCount`);
      }
    }
  });

  it('9-standard角色正确', () => {
    const p = BOARD_PRESETS['9-standard'];
    const counts = {};
    p.roles.forEach(r => counts[r] = (counts[r] || 0) + 1);
    if (counts.werewolf !== 3) throw new Error('9人局应有3狼');
    if (counts.seer !== 1) throw new Error('9人局应有1预言家');
    if (counts.witch !== 1) throw new Error('9人局应有1女巫');
    if (counts.hunter !== 1) throw new Error('9人局应有1猎人');
  });

  it('12-hunter-idiot有警长', () => {
    const p = BOARD_PRESETS['12-hunter-idiot'];
    if (!p.rules?.sheriff?.enabled) throw new Error('12人局应有警长');
  });

  it('12-guard-cupid用丘比特checkWin', () => {
    const p = BOARD_PRESETS['12-guard-cupid'];
    if (!p.checkWin) throw new Error('12人守卫丘比特局应有自定义checkWin');
  });
});

describe('HOOKS.ACTION_FILTERS', () => {
  it('action_guard过滤死者和上次守护目标', () => {
    const harness = createGame({ presetId: '12-guard-cupid' });
    const { game } = harness;
    const guard = game.players.find(p => p.role.id === 'guard');
    guard.state.lastGuardTarget = 3;
    const targets = HOOKS.ACTION_FILTERS.action_guard(game, guard);
    if (targets.includes(3)) throw new Error('不应包含上次守护目标');
    if (targets.some(id => !game.players.find(p => p.id === id)?.alive)) throw new Error('不应包含死者');
  });

  it('action_seer过滤自己和已查验', () => {
    const harness = createGame({ presetId: '9-standard' });
    const { game } = harness;
    const seer = game.players.find(p => p.role.id === 'seer');
    seer.state.seerChecks = [{ targetId: 5, round: 1 }];
    const targets = HOOKS.ACTION_FILTERS.action_seer(game, seer);
    if (targets.includes(seer.id)) throw new Error('不应包含自己');
    if (targets.includes(5)) throw new Error('不应包含已查验目标');
  });

  it('action_post_vote过滤自己不包含死者', () => {
    const harness = createGame({ presetId: '12-hunter-idiot' });
    const { game } = harness;
    const voter = game.players.find(p => p.id === 1);
    const targets = HOOKS.ACTION_FILTERS.action_post_vote(game, voter);
    if (targets.includes(voter.id)) throw new Error('不应包含自己');
    if (targets.some(id => !game.players.find(p => p.id === id)?.alive)) throw new Error('不应包含死者');
  });

  it('action_post_vote应过滤已翻牌白痴', () => {
    const harness = createGame({ presetId: '12-hunter-idiot' });
    const { game } = harness;
    const idiot = game.players.find(p => p.role.id === 'idiot');
    idiot.state.revealed = true;
    idiot.state.canVote = false;
    const voter = game.players.find(p => p.id === 1);
    const targets = HOOKS.ACTION_FILTERS.action_post_vote(game, voter);
    if (targets.includes(idiot.id)) throw new Error('已翻牌白痴(canVote=false)不应出现在投票目标中');
  });

  it('action_shoot过滤自己', () => {
    const harness = createGame({ presetId: '9-standard' });
    const { game } = harness;
    const hunter = game.players.find(p => p.role.id === 'hunter');
    const targets = HOOKS.ACTION_FILTERS.action_shoot(game, hunter);
    if (targets.includes(hunter.id)) throw new Error('不应包含自己');
  });

  it('action_passBadge过滤自己', () => {
    const harness = createGame({ presetId: '12-hunter-idiot' });
    const { game } = harness;
    const player = game.players.find(p => p.id === 1);
    const targets = HOOKS.ACTION_FILTERS.action_passBadge(game, player);
    if (targets.includes(1)) throw new Error('不应包含自己');
  });
});

describe('HOOKS.getVoteWeight', () => {
  it('警长1.5票', () => {
    const harness = createGame({ presetId: '12-hunter-idiot' });
    const { game } = harness;
    game.sheriff = 1;
    const player = game.players.find(p => p.id === 1);
    const weight = HOOKS.getVoteWeight(player, game);
    if (weight !== 1.5) throw new Error(`期望1.5，实际${weight}`);
  });

  it('非警长1票', () => {
    const harness = createGame({ presetId: '9-standard' });
    const { game } = harness;
    const player = game.players.find(p => p.id === 1);
    const weight = HOOKS.getVoteWeight(player, game);
    if (weight !== 1) throw new Error(`期望1，实际${weight}`);
  });
});

describe('HOOKS.getCamp', () => {
  it('狼人返回wolf', () => {
    const harness = createGame({ presetId: '9-standard' });
    const { game } = harness;
    const wolf = game.players.find(p => p.role.id === 'werewolf');
    if (HOOKS.getCamp(wolf, game) !== 'wolf') throw new Error('狼人应返回wolf');
  });

  it('预言家返回good', () => {
    const harness = createGame({ presetId: '9-standard' });
    const { game } = harness;
    const seer = game.players.find(p => p.role.id === 'seer');
    if (HOOKS.getCamp(seer, game) !== 'good') throw new Error('预言家应返回good');
  });
});

describe('HOOKS.checkWin - 已翻牌白痴阵营', () => {
  it('已翻牌白痴不计入神职，仅剩翻牌白痴时算屠神狼胜', () => {
    const harness = createGame({ presetId: '12-hunter-idiot' });
    const { game } = harness;
    const idiot = game.players.find(p => p.role.id === 'idiot');
    idiot.state.revealed = true;
    const otherGods = game.players.filter(p => p.role.type === 'god' && p.role.id !== 'idiot');
    otherGods.forEach(g => g.alive = false);
    const result = HOOKS.checkWin(game);
    if (result !== 'wolf') throw new Error('已翻牌白痴不算神职，其他神全灭则狼应胜');
  });

  it('未翻牌白痴计入神职，神未全灭则狼不胜', () => {
    const harness = createGame({ presetId: '12-hunter-idiot' });
    const { game } = harness;
    const otherGods = game.players.filter(p => p.role.type === 'god' && p.role.id !== 'idiot');
    otherGods.forEach(g => g.alive = false);
    const result = HOOKS.checkWin(game);
    if (result === 'wolf') throw new Error('未翻牌白痴算神职，神未全灭，狼不应胜');
  });
});

run();