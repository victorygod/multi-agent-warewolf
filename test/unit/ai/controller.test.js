const { describe, it, run } = require('../../helpers/test-runner');

describe('AIController - 模块导入', () => {
  it('AIController和AIManager可导入', () => {
    const { AIController, AIManager } = require('../../../ai/controller');
    if (!AIController || !AIManager) throw new Error('应可导入');
  });
});

describe('AIManager - 基础功能', () => {
  it('创建AIManager', () => {
    const { AIManager } = require('../../../ai/controller');
    const manager = new AIManager();
    if (!manager) throw new Error('应能创建AIManager');
  });

  it('get不存在的玩家返回undefined', () => {
    const { AIManager } = require('../../../ai/controller');
    const manager = new AIManager();
    if (manager.get(999) !== undefined) throw new Error('应返回undefined');
  });
});

run();