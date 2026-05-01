const { GameEngine } = require('../../engine/main');
const { PhaseManager } = require('../../engine/phase');
const { AIManager } = require('../../ai/controller');
const { HumanController } = require('../../engine/player');
const { createPlayerRole } = require('../../engine/roles');
const { BOARD_PRESETS, getEffectiveRules } = require('../../engine/config');

const DEFAULT_AI_PRESETS = {
  presetResponses: {
    action_day_discuss: { content: '过。' },
    action_last_words: { content: '过。' },
    action_sheriff_speech: { content: '过。' },
    action_night_werewolf_discuss: { content: '过。' },
    action_witch: { action: 'skip' },
    action_sheriff_campaign: { run: false },
    action_withdraw: { withdraw: false },
    action_explode: { confirmed: false },
    action_assignOrder: { startPlayerId: 1 }
  },
  customStrategies: {
    action_night_werewolf_vote: (ctx) => {
      const t = ctx.extraData?.allowedTargets || ctx.alivePlayers?.map(p => p.id) || [1];
      return { target: t[0] };
    },
    action_day_vote: (ctx) => {
      const t = ctx.extraData?.allowedTargets || ctx.alivePlayers?.map(p => p.id) || [1];
      return { target: t[0] };
    },
    action_post_vote: (ctx) => {
      const t = ctx.extraData?.allowedTargets || ctx.alivePlayers?.map(p => p.id) || [1];
      return { target: t[0] };
    },
    action_sheriff_vote: (ctx) => {
      const t = ctx.extraData?.allowedTargets || ctx.alivePlayers?.map(p => p.id) || [1];
      return { target: t[0] };
    },
    action_seer: (ctx) => {
      const t = ctx.extraData?.allowedTargets || ctx.alivePlayers?.filter(p => p.id !== ctx.self?.id).map(p => p.id) || [1];
      return { target: t[0] };
    },
    action_guard: (ctx) => {
      const t = ctx.extraData?.allowedTargets || ctx.alivePlayers?.map(p => p.id) || [1];
      return { target: t[0] };
    },
    action_shoot: (ctx) => {
      const t = ctx.extraData?.allowedTargets || ctx.alivePlayers?.filter(p => p.id !== ctx.self?.id).map(p => p.id) || [];
      return t.length > 0 ? { target: t[0], use: true } : { use: false };
    },
    action_cupid: (ctx) => {
      const t = ctx.alivePlayers?.filter(p => p.id !== ctx.self?.id).map(p => p.id) || [1, 2];
      return { targets: t.slice(0, 2) };
    },
    action_passBadge: (ctx) => {
      const t = ctx.alivePlayers?.filter(p => p.id !== ctx.self?.id).map(p => p.id) || [];
      return t.length > 0 ? { targetId: t[0] } : { targetId: null };
    }
  }
};

function createGame(options = {}) {
  const presetId = options.presetId || '9-standard';
  const preset = BOARD_PRESETS[presetId];
  if (!preset) throw new Error(`未知的板子: ${presetId}`);

  const game = new GameEngine({ presetId, ...options });
  const roles = options.roles || preset.roles;

  if (options.rules) {
    game.effectiveRules = getEffectiveRules({ rules: options.rules });
  }

  for (let i = 0; i < roles.length; i++) {
    const role = createPlayerRole(roles[i]);
    const name = options.playerNames ? options.playerNames[i] : `玩家${i + 1}`;
    game.players.push({
      id: i + 1,
      name,
      alive: true,
      isAI: true,
      role,
      state: role.state ? { ...role.state } : {}
    });
  }

  const aiManager = new AIManager(game);
  const mockModels = {};
  const humanControllers = {};

  game.players.forEach(p => {
    if (p.isAI) {
      const controller = aiManager.createAI(p.id, {
        agentType: 'mock',
        mockOptions: DEFAULT_AI_PRESETS
      });
      mockModels[p.id] = controller.agent.mockModel;
    }
  });

  game.aiManager = aiManager;
  game.getAIController = (id) => aiManager.get(id);
  game.phaseManager = new PhaseManager(game);

  return {
    game,
    aiManager,
    mockModels,
    humanControllers,
    setAI: (playerId, decisions) => _setAI(mockModels, playerId, decisions),
    setHuman: (playerId, autoRespond) => _setHuman(game, aiManager, mockModels, humanControllers, playerId, autoRespond),
    getController: (playerId) => _getController(game, aiManager, humanControllers, playerId),
    getPlayerByName: (name) => game.players.find(p => p.name === name),
    getPlayerByRole: (roleId) => game.players.find(p => p.role?.id === roleId),
    getAICallHistory: (playerId) => _getAICallHistory(aiManager, playerId),
    getAICallsByPhase: (playerId, phase) => _getAICallsByPhase(aiManager, playerId, phase),
    getAILastMessages: (playerId) => _getAILastMessages(aiManager, playerId)
  };
}

function _setAI(mockModels, playerId, decisions) {
  const mock = mockModels[playerId];
  if (!mock) throw new Error(`未找到玩家 ${playerId} 的MockModel`);
  for (const [actionType, response] of Object.entries(decisions)) {
    if (Array.isArray(response)) {
      mock.setBehaviorSequence(response.map(r => ({
        phase: actionType,
        response: r,
        wildcard: false
      })));
    } else {
      mock.setResponse(actionType, response);
    }
  }
  return mock;
}

function _setHuman(game, aiManager, mockModels, humanControllers, playerId, autoRespond = {}) {
  const player = game.players.find(p => p.id === playerId);
  if (!player) throw new Error(`未找到玩家 ${playerId}`);

  player.isAI = false;

  const aiController = aiManager.get(playerId);
  if (aiController) {
    aiManager.controllers.delete(playerId);
    delete mockModels[playerId];
  }

  const human = new HumanController(playerId, game);
  humanControllers[playerId] = human;

  if (Object.keys(autoRespond).length > 0) {
    const origRequestAction = game.requestAction.bind(game);
    game.requestAction = function(pid, actionType, data) {
      if (pid === playerId) {
        const response = _resolveAutoRespond(autoRespond, actionType, data, game, playerId);
        if (response !== undefined) {
          return Promise.resolve(response);
        }
      }
      return origRequestAction(pid, actionType, data);
    };
  }

  return human;
}

function _resolveAutoRespond(autoRespond, actionType, data, game, playerId) {
  if (autoRespond[actionType] !== undefined) {
    return autoRespond[actionType];
  }

  const voteActions = ['action_day_vote', 'action_post_vote', 'action_night_werewolf_vote', 'action_sheriff_vote'];
  if (voteActions.includes(actionType) && autoRespond.vote !== undefined) {
    const allowedTargets = data?.allowedTargets;
    if (autoRespond.vote === null) return { targetId: null };
    if (typeof autoRespond.vote === 'number') return { targetId: autoRespond.vote };
    if (allowedTargets?.length > 0) return { targetId: allowedTargets[0] };
    return { targetId: autoRespond.vote };
  }

  const speakActions = ['action_day_discuss', 'action_night_werewolf_discuss', 'action_sheriff_speech', 'action_last_words'];
  if (speakActions.includes(actionType) && autoRespond.speak !== undefined) {
    return { content: autoRespond.speak };
  }

  return undefined;
}

function _getController(game, aiManager, humanControllers, playerId) {
  if (humanControllers[playerId]) return humanControllers[playerId];
  return aiManager.get(playerId);
}

function _getAICallHistory(aiManager, playerId) {
  const controller = aiManager.get(playerId);
  return controller?.agent?.mockModel?.getCallHistory() || [];
}

function _getAICallsByPhase(aiManager, playerId, phase) {
  const controller = aiManager.get(playerId);
  return controller?.agent?.mockModel?.getCallsByPhase(phase) || [];
}

function _getAILastMessages(aiManager, playerId) {
  const history = _getAICallHistory(aiManager, playerId);
  return history.length > 0 ? history[history.length - 1].messagesForLLM : null;
}

async function createGameAtPhase(phaseId, setup) {
  const harness = createGame(setup?.options || {});
  const { game } = harness;

  if (setup?.beforeStart) {
    await setup.beforeStart(harness);
  }

  if (setup?.phaseSetup) {
    for (const [phase, fn] of Object.entries(setup.phaseSetup)) {
      await game.phaseManager.executePhase(phase);
      if (fn) await fn(harness);
    }
  }

  return harness;
}

module.exports = { createGame, createGameAtPhase, DEFAULT_AI_PRESETS };