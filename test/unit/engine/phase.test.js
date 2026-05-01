const { describe, it, run } = require('../../helpers/test-runner');
const { createGame } = require('../../helpers/game-harness');
const { PHASE_FLOW } = require('../../../engine/phase');
const { PHASE } = require('../../../engine/constants');

describe('PHASE_FLOW 结构', () => {
  it('包含所有必要阶段', () => {
    const ids = PHASE_FLOW.map(p => p.id);
    const required = [
      PHASE.CUPID, PHASE.GUARD, PHASE.NIGHT_WEREWOLF_DISCUSS,
      PHASE.NIGHT_WEREWOLF_VOTE, PHASE.WITCH, PHASE.SEER,
      PHASE.SHERIFF_CAMPAIGN, PHASE.SHERIFF_SPEECH, PHASE.SHERIFF_VOTE,
      PHASE.DAY_ANNOUNCE, PHASE.DAY_DISCUSS, PHASE.DAY_VOTE, PHASE.POST_VOTE
    ];
    for (const r of required) {
      if (!ids.includes(r)) throw new Error(`缺少阶段: ${r}`);
    }
  });

  it('丘比特只在第一夜且丘比特存活时执行', () => {
    const cupidPhase = PHASE_FLOW.find(p => p.id === PHASE.CUPID);
    const harness = createGame({ presetId: '9-standard' });
    if (cupidPhase.condition(harness.game)) throw new Error('9人局没有丘比特，condition应为false');
    const harness2 = createGame({ presetId: '12-guard-cupid' });
    if (!cupidPhase.condition(harness2.game)) throw new Error('12人守卫丘比特局第一夜condition应为true');
    harness2.game.round = 2;
    if (cupidPhase.condition(harness2.game)) throw new Error('第二夜丘比特不应执行');
  });

  it('守卫只在守卫存活时执行', () => {
    const guardPhase = PHASE_FLOW.find(p => p.id === PHASE.GUARD);
    const harness = createGame({ presetId: '9-standard' });
    if (guardPhase.condition(harness.game)) throw new Error('9人局没有守卫');
    const harness2 = createGame({ presetId: '12-guard-cupid' });
    if (!guardPhase.condition(harness2.game)) throw new Error('12人局有守卫，应为true');
    const guard = harness2.game.players.find(p => p.role.id === 'guard');
    guard.alive = false;
    if (guardPhase.condition(harness2.game)) throw new Error('守卫死亡后不应执行');
  });

  it('狼人讨论只在狼人存活时执行', () => {
    const wolfPhase = PHASE_FLOW.find(p => p.id === PHASE.NIGHT_WEREWOLF_DISCUSS);
    const harness = createGame({ presetId: '9-standard' });
    if (!wolfPhase.condition(harness.game)) throw new Error('9人局有狼人');
    const wolves = harness.game.players.filter(p => p.role.id === 'werewolf');
    wolves.forEach(w => w.alive = false);
    if (wolfPhase.condition(harness.game)) throw new Error('狼人全死不应执行');
  });

  it('警长竞选只在第一轮且启用时执行', () => {
    const campaignPhase = PHASE_FLOW.find(p => p.id === PHASE.SHERIFF_CAMPAIGN);
    const harness = createGame({ presetId: '9-standard' });
    if (campaignPhase.condition(harness.game)) throw new Error('9人局没有警长');
    const harness2 = createGame({ presetId: '12-hunter-idiot' });
    if (!campaignPhase.condition(harness2.game)) throw new Error('12人局有警长，第一轮应执行');
    harness2.game.round = 2;
    if (campaignPhase.condition(harness2.game)) throw new Error('第二轮不应执行警长竞选');
  });

  it('无条件阶段始终执行', () => {
    const alwaysPhases = [PHASE.NIGHT_WEREWOLF_VOTE, PHASE.DAY_ANNOUNCE, PHASE.DAY_DISCUSS, PHASE.DAY_VOTE, PHASE.POST_VOTE];
    for (const phaseId of alwaysPhases) {
      const phase = PHASE_FLOW.find(p => p.id === phaseId);
      if (phase.condition) throw new Error(`${phaseId} 不应有condition`);
    }
  });
});

describe('PhaseManager - executePhase', () => {
  it('executePhase可以单独执行指定阶段', async () => {
    const harness = createGame({ presetId: '9-standard' });
    const { game } = harness;
    game.round = 1;
    await game.phaseManager.executePhase('night_werewolf_vote');
    if (game.phaseManager.getCurrentPhase()?.id !== 'night_werewolf_vote') {
      throw new Error('阶段未正确设置');
    }
  });
});

run();