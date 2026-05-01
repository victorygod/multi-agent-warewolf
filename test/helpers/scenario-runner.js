const { createGame } = require('./game-harness');

class Scenario {
  constructor(description, options = {}) {
    this.description = description;
    this.options = options;
    this.harness = null;
    this.steps = [];
    this.expectFns = [];
  }

  setup(fn) {
    this.steps.push({ type: 'setup', fn });
    return this;
  }

  phase(phaseId, fn) {
    this.steps.push({ type: 'phase', phaseId, fn });
    return this;
  }

  expect(fn) {
    this.expectFns.push(fn);
    return this;
  }

  async run() {
    this.harness = createGame(this.options);

    for (const step of this.steps) {
      if (step.type === 'setup') {
        await step.fn(this.harness);
      } else if (step.type === 'phase') {
        if (step.fn) await step.fn(this.harness);
        await this.harness.game.phaseManager.executePhase(step.phaseId);
      }
    }

    for (const fn of this.expectFns) {
      await fn(this.harness);
    }
  }
}

function scenario(description, options = {}) {
  return new Scenario(description, options);
}

module.exports = { scenario, Scenario };