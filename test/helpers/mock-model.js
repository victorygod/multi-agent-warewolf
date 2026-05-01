const { MockModel } = require('../../ai/agent/models/mock_model');

function createMockModel(playerId, options = {}) {
  return new MockModel(playerId, options);
}

function withSequence(actions) {
  return actions.map(({ phase, response }) => ({ phase, response }));
}

function withFailingAction(actionType, errorMessage) {
  return {
    customStrategies: {
      [actionType]: () => { throw new Error(errorMessage || '模拟失败'); }
    }
  };
}

function withTimeoutAction(actionType) {
  return {
    customStrategies: {
      [actionType]: () => new Promise(() => {})
    }
  };
}

function withInvalidResponse(actionType, invalidData) {
  return {
    customStrategies: {
      [actionType]: () => invalidData || { invalid: true }
    }
  };
}

function withConditionalDecision(actionType, conditionFn) {
  return {
    customStrategies: {
      [actionType]: (context) => conditionFn(context)
    }
  };
}

module.exports = {
  createMockModel,
  withSequence,
  withFailingAction,
  withTimeoutAction,
  withInvalidResponse,
  withConditionalDecision
};