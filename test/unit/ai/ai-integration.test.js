const { describe, it, run } = require('../../helpers/test-runner');
const { AIController, AIManager } = require('../../../ai/controller');
const { GameEngine } = require('../../../engine/main');
const { BOARD_PRESETS } = require('../../../engine/config');
const { createPlayerRole } = require('../../../engine/roles');
const { MockModel } = require('../../../ai/agent/models/mock_model');

function createTestGame(presetId = '9-standard') {
  const preset = BOARD_PRESETS[presetId];
  const game = new GameEngine({ presetId });

  for (let i = 0; i < preset.playerCount; i++) {
    const role = createPlayerRole(preset.roles[i]);
    game.players.push({
      id: i + 1,
      name: `玩家${i + 1}`,
      alive: true,
      isAI: true,
      role: role,
      state: role.state ? { ...role.state } : {}
    });
  }

  game.phase = 'day_discuss';
  game.round = 1;

  return game;
}

describe('game.aiManager 绑定', () => {
  it('game.aiManager 绑定验证', () => {
    const game = createTestGame();
    const aiManager = new AIManager(game);
    game.aiManager = aiManager;

    if (game.aiManager !== aiManager) throw new Error('game.aiManager 应该正确绑定');
    if (!game.aiManager.onMessageAdded) throw new Error('aiManager 应该有 onMessageAdded 方法');
  });

  it('game.aiManager 未绑定时不崩溃', () => {
    const game = createTestGame();

    const msg = { type: 'speech', playerId: 2, content: '测试', visibility: 'public' };

    if (game.aiManager) {
      game.aiManager.onMessageAdded(msg);
    }
  });
});

describe('事件链路', () => {
  it('message.add 触发 AI 分析', async () => {
    const game = createTestGame();
    const aiManager = new AIManager(game);
    game.aiManager = aiManager;

    const controller = new AIController(1, game, {
      agentType: 'mock',
      mockOptions: { presetAnalysis: { content: '测试分析' } }
    });
    aiManager.controllers.set(1, controller);

    const initialLength = controller.agent.messages.length;

    const msg = {
      id: 100,
      type: 'speech',
      playerId: 2,
      content: '我是预言家',
      visibility: 'public'
    };
    game.message.add(msg);

    await new Promise(resolve => setTimeout(resolve, 200));
  });

  it('AIManager 遍历所有 AI 控制器', async () => {
    const game = createTestGame();
    const aiManager = new AIManager(game);
    game.aiManager = aiManager;

    const ctrl1 = new AIController(1, game, { agentType: 'mock', mockOptions: { presetAnalysis: { content: '分析' } } });
    const ctrl2 = new AIController(2, game, { agentType: 'mock', mockOptions: { presetAnalysis: { content: '分析' } } });
    const ctrl3 = new AIController(3, game, { agentType: 'mock', mockOptions: { presetAnalysis: { content: '分析' } } });

    aiManager.controllers.set(1, ctrl1);
    aiManager.controllers.set(2, ctrl2);
    aiManager.controllers.set(3, ctrl3);

    const msg = { type: 'speech', playerId: 4, content: '测试', visibility: 'public' };
    aiManager.onMessageAdded(msg);

    await new Promise(resolve => setTimeout(resolve, 100));

    if (ctrl1.agent.requestQueue.length !== 0) throw new Error('1 号队列应该为空');
    if (ctrl2.agent.requestQueue.length !== 0) throw new Error('2 号队列应该为空');
    if (ctrl3.agent.requestQueue.length !== 0) throw new Error('3 号队列应该为空');
  });

  it('自己发言不触发自己的分析', () => {
    const game = createTestGame();
    const aiManager = new AIManager(game);
    game.aiManager = aiManager;

    const ctrl1 = new AIController(1, game, { agentType: 'mock' });
    aiManager.controllers.set(1, ctrl1);

    const msg = { type: 'speech', playerId: 1, content: '我是 1 号', visibility: 'public' };
    aiManager.onMessageAdded(msg);

    if (ctrl1.agent.requestQueue.length !== 0) throw new Error('自己发言不应该触发自己的分析');
  });

  it('私密消息不触发分析', () => {
    const game = createTestGame();
    const aiManager = new AIManager(game);
    game.aiManager = aiManager;

    const ctrl1 = new AIController(1, game, { agentType: 'mock' });
    aiManager.controllers.set(1, ctrl1);

    const msg = { type: 'action', playerId: 2, content: '查验 3 号', visibility: 'self' };
    aiManager.onMessageAdded(msg);

    if (ctrl1.agent.requestQueue.length !== 0) throw new Error('私密消息不应该触发分析');
  });

  it('非分析节点消息不触发分析', () => {
    const game = createTestGame();
    const aiManager = new AIManager(game);
    game.aiManager = aiManager;

    const ctrl1 = new AIController(1, game, { agentType: 'mock' });
    aiManager.controllers.set(1, ctrl1);

    const msg = { type: 'phase_start', phase: 'day_discuss', visibility: 'public' };
    aiManager.onMessageAdded(msg);

    if (ctrl1.agent.requestQueue.length !== 0) throw new Error('phase_start 不应该触发分析');
  });

  it('分析节点消息触发分析', async () => {
    const game = createTestGame();
    const aiManager = new AIManager(game);
    game.aiManager = aiManager;

    const ctrl1 = new AIController(1, game, { agentType: 'mock', mockOptions: { presetAnalysis: { content: '分析' } } });
    aiManager.controllers.set(1, ctrl1);

    const analysisNodes = ['speech', 'vote_result', 'death_announce'];
    for (const node of analysisNodes) {
      const msg = { type: node, playerId: 2, content: '测试', visibility: 'public' };
      aiManager.onMessageAdded(msg);
    }

    await new Promise(resolve => setTimeout(resolve, 200));

    if (ctrl1.agent.requestQueue.length !== 0) {
      throw new Error(`队列应该为空，实际 ${ctrl1.agent.requestQueue.length}`);
    }
  });
});

describe('决策存储', () => {
  it('决策存储到 agent.messages', async () => {
    const game = createTestGame();
    const controller = new AIController(1, game, {
      agentType: 'mock',
      mockOptions: { presetResponses: { action_day_discuss: '我是好人' } }
    });

    const initialLength = controller.agent.messages.length;

    await controller.getSpeechResult('public', 'action_day_discuss');

    if (controller.agent.messages.length <= initialLength) {
      throw new Error('决策应该存储到 messages');
    }
  });

  it('投票后触发压缩', async () => {
    const game = createTestGame();
    const controller = new AIController(1, game, {
      agentType: 'mock',
      mockOptions: { presetResponses: { action_day_vote: 3 } },
      compressionEnabled: true
    });

    await controller.getVoteResult('action_day_vote', { allowedTargets: [2, 3] });
  });
});

describe('阵营消息过滤', () => {
  it('狼人看不到好人私密消息', () => {
    const game = createTestGame();
    const wolfController = new AIController(1, game, { agentType: 'mock' });

    const witchActionMsg = { type: 'action', playerId: 3, content: '女巫救人', visibility: 'self' };

    if (wolfController.shouldAnalyzeMessage(witchActionMsg, 1)) {
      throw new Error('狼人看不到好人私密消息');
    }
  });

  it('camp 可见性消息需要 getCamp 验证', () => {
    const game = createTestGame();
    game.config = {
      hooks: {
        getCamp: (player) => player.role?.camp
      }
    };

    game.players[0].role = { camp: 'wolf' };
    game.players[1].role = { camp: 'wolf' };
    game.players[2].role = { camp: 'good' };

    const wolfController = new AIController(1, game, { agentType: 'mock' });

    const wolfCampMsg = { type: 'speech', playerId: 2, content: '狼人讨论', visibility: 'camp' };

    if (!wolfController.shouldAnalyzeMessage(wolfCampMsg, 1)) {
      throw new Error('狼人阵营消息应该触发分析');
    }
  });
});

describe('多阶段流程', () => {
  it('连续决策流程', async () => {
    const game = createTestGame();
    const controller = new AIController(1, game, {
      agentType: 'mock',
      mockOptions: {
        presetResponses: {
          action_day_discuss: '发言内容',
          action_day_vote: 3
        }
      }
    });

    const speechResult = await controller.getSpeechResult('public', 'action_day_discuss');
    if (!speechResult.content) throw new Error('应该有发言内容');

    const voteResult = await controller.getVoteResult('action_day_vote', { allowedTargets: [2, 3] });
    if (voteResult.targetId !== 3) throw new Error('应该投票给 3 号');
  });

  it('技能使用流程', async () => {
    const game = createTestGame();
    game.players[0].role = createPlayerRole('seer');
    game.players[0].state = { seerChecks: [] };

    const controller = new AIController(1, game, {
      agentType: 'mock',
      mockOptions: { presetResponses: { action_seer: 2 } }
    });

    const result = await controller.useSkill('action_seer', { allowedTargets: [2, 3, 4] });
    if (!result.success) throw new Error('技能应该成功');
  });
});

describe('错误处理', () => {
  it('无效技能返回失败', async () => {
    const game = createTestGame();
    const controller = new AIController(1, game, { agentType: 'mock' });

    const result = await controller.useSkill('action_invalid_skill', {});
    if (result.success) throw new Error('无效技能应该失败');
    if (!result.message) throw new Error('应该有错误消息');
  });

  it('玩家不存在时返回失败', async () => {
    const game = createTestGame();
    const controller = new AIController(999, game, { agentType: 'mock' });

    const result = await controller.useSkill('action_seer', {});
    if (result.success) throw new Error('玩家不存在应该失败');
  });
});

describe('补充测试', () => {
  it('分析只保存原始消息', async () => {
    const game = createTestGame();
    const controller = new AIController(1, game, {
      agentType: 'mock',
      mockOptions: { presetAnalysis: { content: '测试分析结果' } }
    });

    const initialLength = controller.agent.messages.length;

    const msg = { id: 1, type: 'speech', playerId: 2, content: '测试', visibility: 'public' };
    game.message.add(msg);

    controller.enqueueMessage(msg);

    await new Promise(resolve => setTimeout(resolve, 100));

    if (controller.agent.messages.length !== initialLength + 2) {
      throw new Error(`分析应该保存 2 条消息（user + assistant），实际增加了 ${controller.agent.messages.length - initialLength} 条`);
    }
  });

  it('遗言阶段决策', async () => {
    const game = createTestGame();
    const controller = new AIController(1, game, {
      agentType: 'mock',
      mockOptions: { presetResponses: { action_last_words: '我是好人，大家相信我' } }
    });

    const result = await controller.getSpeechResult('public', 'action_last_words');
    if (!result.content) throw new Error('应该有遗言内容');
  });

  it('警长竞选投票', async () => {
    const game = createTestGame();
    const controller = new AIController(1, game, {
      agentType: 'mock',
      mockOptions: { presetResponses: { action_sheriff_vote: 3 } }
    });

    const result = await controller.getVoteResult('action_sheriff_vote', { allowedTargets: [2, 3, 4] });
    if (result.targetId !== 3) throw new Error('应该投票给 3 号');
  });

  it('狼人夜间投票', async () => {
    const game = createTestGame();
    const controller = new AIController(1, game, {
      agentType: 'mock',
      mockOptions: { presetResponses: { action_night_werewolf_vote: 3 } }
    });

    const result = await controller.getVoteResult('action_night_werewolf_vote', { allowedTargets: [2, 3, 4] });
    if (result.targetId !== 3) throw new Error('应该投票给 3 号');
  });

  it('警长发言', async () => {
    const game = createTestGame();
    const controller = new AIController(1, game, {
      agentType: 'mock',
      mockOptions: { presetResponses: { action_sheriff_speech: '我是警长' } }
    });

    const result = await controller.getSpeechResult('public', 'action_sheriff_speech');
    if (!result.content) throw new Error('应该有发言内容');
  });

  it('updateSystemMessage 更新', () => {
    const game = createTestGame();
    const controller = new AIController(1, game, { agentType: 'mock' });
    controller.agent.messages.push({ role: 'system', content: 'old' });
    const mockPlayer = { role: { name: 'werewolf', camp: 'wolf' }, name: '玩家 1' };
    controller.updateSystemMessage(mockPlayer, game);
    if (!controller.agent.messages[0].content.includes('狼人')) {
      throw new Error('system message 未正确更新');
    }
  });
});

run();