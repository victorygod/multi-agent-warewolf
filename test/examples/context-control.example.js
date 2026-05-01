/**
 * MockModel 上下文控制示例
 *
 * 展示如何：
 * 1. 使用占位符替代长文本（soul、攻略）
 * 2. 精准控制每轮 AI 看到什么上下文
 * 3. 为不同 AI 设置不同行为
 * 4. 验证 AI 实际看到的 messagesForLLM（使用 server-harness 新方法）
 *
 * 关键 API：
 * - server.getAIMockModel(playerId)      - 获取 AI 的 MockModel
 * - server.getAICallHistory(playerId)    - 获取调用历史
 * - server.getAICallsByPhase(playerId, phase) - 获取特定阶段调用
 * - server.getAILastMessages(playerId)    - 获取最后一次 messagesForLLM
 */

const { ServerHarness } = require('../helpers/server-harness');

// 示例1: 使用占位符简化 AI 上下文
async function example1_PlaceholderContext() {
  console.log('\n========== 示例1: 使用占位符简化上下文 ==========');

  // 创建自定义 MockOptions，使用占位符替代长文本
  const mockOptionsWithPlaceholders = {
    presetResponses: {
      'action_day_discuss': { content: '过。' }
    },
    customStrategies: {
      // 在 customStrategy 中可以查看和修改 context
      'action_day_vote': (context) => {
        // context 包含：
        // - phase: 当前阶段
        // - action: 当前 action
        // - self: 玩家自身信息（含 role, state, soul 等）
        // - players: 所有玩家信息
        // - alivePlayers: 存活玩家
        // - extraData: 额外数据（如 allowedTargets）
        // - _messagesForLLM: 发送给 LLM 的完整消息列表

        // 打印简化后的上下文（占位符替代长文本）
        const simplifiedContext = {
          phase: context.phase,
          action: context.action,
          self: context.self ? {
            id: context.self.id,
            name: context.self.name,
            role: context.self.role?.id,
            // 使用占位符替代长 soul 文本
            soul: `soul_${context.self.name}`
          } : null,
          // 使用占位符替代长攻略文本
          strategy: `strategy_standard_${context.self?.role?.id || 'unknown'}`,
          allowedTargets: context.extraData?.allowedTargets,
          alivePlayerCount: context.alivePlayers?.length
        };

        console.log('  AI 看到的简化上下文:', JSON.stringify(simplifiedContext, null, 2));

        // 返回投票目标
        const targets = context.extraData?.allowedTargets || context.alivePlayers?.map(p => p.id) || [1];
        return { target: targets[0] };
      }
    }
  };

  const server = new ServerHarness(4001);
  await server.start();

  const human = await server.addHuman('人类玩家');
  await server.addAI(8, { mockOptions: mockOptionsWithPlaceholders });
  server.startGame();

  await human.waitFor('role_assigned', 3000);

  // 等待一段时间让游戏进行到投票阶段
  await new Promise(r => setTimeout(r, 5000));

  console.log(`  人类玩家角色: ${human.role?.name}`);

  human.ws.close();
  server.stop();
}

// 示例2: 精准控制每轮 AI 行为
async function example2_RoundByRoundControl() {
  console.log('\n========== 示例2: 逐轮精准控制 AI 行为 ==========');

  // 使用 behaviorSequence 精确控制每轮行为
  const roundByRoundMockOptions = {
    presetResponses: {
      'action_sheriff_campaign': { run: false },
      'action_withdraw': { withdraw: false }
    },
    customStrategies: {
      // 第一天投票：投给 2 号
      'action_day_vote': (context) => {
        const round = context.self?.state?.round || 1;
        const target = round === 1 ? 2 : 3; // 第一天投 2 号，之后投 3 号
        console.log(`  第 ${round} 天投票: 投给 ${target} 号`);
        return { target };
      },
      // 狼人首夜刀 1 号，第二晚刀 2 号
      'action_night_werewolf_vote': (context) => {
        const night = context.self?.state?.night || 1;
        const target = night === 1 ? 1 : 2;
        console.log(`  第 ${night} 晚狼人投票: 刀 ${target} 号`);
        return { target };
      }
    }
  };

  const server = new ServerHarness(4002);
  await server.start();

  const human = await server.addHuman('人类玩家');
  await server.addAI(8, { mockOptions: roundByRoundMockOptions });
  server.startGame();

  await human.waitFor('role_assigned', 3000);
  console.log(`  人类玩家角色: ${human.role?.name}`);

  // 等待多轮游戏
  await new Promise(r => setTimeout(r, 15000));

  human.ws.close();
  server.stop();
}

// 示例3: 为不同 AI 设置不同行为
async function example3_DifferentAIBehaviors() {
  console.log('\n========== 示例3: 不同 AI 不同行为 ==========');

  const server = new ServerHarness(4003);
  await server.start();

  const human = await server.addHuman('人类玩家');

  // 狼人 AI：积极刀人
  const wolfMockOptions = {
    customStrategies: {
      'action_night_werewolf_vote': () => ({ target: 1 }),
      'action_day_vote': () => ({ target: 2 })
    }
  };

  // 神职 AI：保护队友
  const godMockOptions = {
    customStrategies: {
      'action_guard': () => ({ target: 3 }),
      'action_seer': (ctx) => ({ target: ctx.alivePlayers?.find(p => p.id !== ctx.self?.id)?.id || 1 })
    }
  };

  // 平民 AI：随机投票
  const villagerMockOptions = {
    customStrategies: {
      'action_day_vote': (ctx) => {
        const targets = ctx.alivePlayers?.filter(p => p.id !== ctx.self?.id).map(p => p.id) || [1];
        return { target: targets[Math.floor(Math.random() * targets.length)] };
      }
    }
  };

  // 添加不同类型的 AI（实际游戏中角色由 assignRoles 分配，这里仅示例）
  await server.addAI(3, { mockOptions: wolfMockOptions });
  await server.addAI(3, { mockOptions: godMockOptions });
  await server.addAI(2, { mockOptions: villagerMockOptions });

  server.startGame();

  await human.waitFor('role_assigned', 3000);
  console.log(`  人类玩家角色: ${human.role?.name}`);

  await new Promise(r => setTimeout(r, 8000));

  human.ws.close();
  server.stop();
}

// 示例4: 验证 AI 实际看到的上下文（使用 server-wrapper 新方法）
async function example4_VerifyAIContext() {
  console.log('\n========== 示例4: 验证 AI 实际看到的上下文 ==========');

  const { ServerHarness } = require('../helpers/server-harness');
  const server = new ServerHarness(4004);
  await server.start();

  const human = await server.addHuman('人类玩家');
  await server.addAI(8);
  server.startGame();

  await human.waitFor('role_assigned', 3000);
  console.log(`  人类玩家角色: ${human.role?.name}`);

  // 等待游戏进行
  await new Promise(r => setTimeout(r, 10000));

  // 获取游戏中的 AI 玩家
  const game = server.getGame();
  const aiPlayer = game.players.find(p => p.isAI);

  if (aiPlayer) {
    console.log(`\n  检查 AI 玩家: ${aiPlayer.name} (${aiPlayer.role?.name})`);

    // 1. 获取调用历史
    const callHistory = server.getAICallHistory(aiPlayer.id);
    console.log(`  调用次数: ${callHistory.length}`);

    // 2. 获取特定阶段的调用
    const wolfCalls = server.getAICallsByPhase(aiPlayer.id, 'night_werewolf_vote');
    console.log(`  狼人投票阶段调用: ${wolfCalls.length}`);

    // 3. 获取最后一次 messagesForLLM
    const lastMessages = server.getAILastMessages(aiPlayer.id);
    if (lastMessages) {
      console.log(`  最后一次消息数: ${lastMessages.length}`);

      // 分析消息结构
      const systemMsg = lastMessages.find(m => m.role === 'system');
      const userMsgs = lastMessages.filter(m => m.role === 'user');

      if (systemMsg) {
        // 使用占位符简化输出
        const simplified = systemMsg.content
          .replace(/你是一个优秀的狼人杀玩家[^。]*/g, 'soul_placeholder')
          .replace(/所有其他玩家[^。]*/g, 'suffix_placeholder');
        console.log(`  System 消息(简化): ${simplified.substring(0, 100)}...`);
      }

      if (userMsgs.length > 0) {
        const lastUser = userMsgs[userMsgs.length - 1];
        console.log(`  最后 User 消息: ${lastUser.content.substring(0, 80)}...`);
      }
    }

    // 4. 验证狼人看到队友信息
    if (aiPlayer.role?.camp === 'wolf') {
      const calls = server.getAICallHistory(aiPlayer.id);
      let hasTeammates = false;
      for (const call of calls) {
        if (call.messagesForLLM) {
          const sys = call.messagesForLLM.find(m => m.role === 'system');
          if (sys?.content.includes('队友')) {
            hasTeammates = true;
            const teammateInfo = sys.content.match(/队友[^\n]*/)?.[0];
            console.log(`  ✓ 狼人看到队友: ${teammateInfo}`);
            break;
          }
        }
      }
      if (!hasTeammates) {
        console.log(`  ✗ 狼人未看到队友信息`);
      }
    }
  }

  human.ws.close();
  server.stop();
}

// 运行示例
async function run() {
  console.log('========================================');
  console.log('MockModel 上下文控制示例');
  console.log('========================================');

  await example1_PlaceholderContext();
  await example2_RoundByRoundControl();
  await example3_DifferentAIBehaviors();
  await example4_VerifyAIContext();

  console.log('\n========================================');
  console.log('示例完成');
  console.log('========================================');
}

run().catch(console.error);
