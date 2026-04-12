/**
 * Agent 策略层导出
 */

const { RandomAgent } = require('./random');
const { LLMAgent } = require('./llm');
const { MockAgent, createMockAgentFactory, createVotingStrategy, createSpeechStrategy, createSkillStrategy } = require('./mock');

module.exports = {
  RandomAgent,
  LLMAgent,
  MockAgent,
  createMockAgentFactory,
  createVotingStrategy,
  createSpeechStrategy,
  createSkillStrategy
};