# 单元测试框架设计计划

## 核心理念

**1. 只Mock边界，不Mock逻辑**

被测系统内部的状态转换、分支判定、事件传播就是测试目标，Mock它们等于跳过测试。只Mock外部不可控的边界：LLM调用（用MockModel）、WebSocket（用server-harness）。游戏状态直接构造，PhaseManager直接调用，EventEmitter真实触发。

**2. 每一层用自己的引擎，不越界**

单元层用game-harness直接构造状态调方法，引擎集成层用game-harness + PhaseManager驱动多阶段，全栈集成层用server-harness走真实WebSocket。下层不依赖上层能力，上层不替下层做本该由它验证的事。

**3. 测试与生产完全隔离**

测试日志写test-logs/，不污染logs/。测试运行时重定向engine层logger。MockAI替代真实LLM，确定性结果可重复。测试创建的游戏实例与生产服务器无关。

**4. 超时即Bug，最小等待**

MockAI响应极快（<10ms），测试中出现超时说明逻辑卡死或死循环，应该查bug而不是调大timeout。等待状态变化用waitFor主动检测，不用delay盲等。单元测试timeout 1-2s，引擎集成3-5s，全栈集成5-10s。

## 一、现有测试覆盖情况

### 按模块覆盖

| 模块 | 测试文件 | 用例数 | 覆盖评估 |
|------|----------|--------|----------|
| GameEngine / PhaseManager / 胜负判定 | game.test.js | ~102 | 高 — 角色能力、死亡链、胜负条件基本覆盖 |
| VoteManager | game.test.js (内嵌) | ~8 | 中 — 平票PK、警长选举部分覆盖，边界场景不足 |
| AIController / AIManager | ai_controller.test.js | ~12 | 中 — 决策、消息分析覆盖，错误路径未测 |
| Agent (消息队列) | ai_agent.test.js | ~8 | 低 — 队列串行、MockModel基础，异常恢复未测 |
| Formatter | ai_formatter.test.js + context.test.js | ~40 | 高 — 阶段合并、消息格式覆盖较全 |
| Tools | ai_tools.test.js | ~16 | 中 — 各action基本覆盖，狼人讨论/投票工具缺失 |
| Models | ai_models.test.js | ~12 | 中 — MockModel/RandomModel基础覆盖 |
| AI上下文(多Agent) | ai_context_behavior.test.js | ~30 | 高 — 系统提示、阶段提示、可见性覆盖好 |
| 消息压缩 | message_manager.test.js | ~12 | 中 — 核心逻辑覆盖，多轮压缩和LLM真实压缩未测 |
| Preset | preset.test.js | ~20 | 高 — 板子结构、规则合并、规则效果覆盖 |
| 集成(WebSocket) | integration.test.js + integration.ai-context.test.js | ~26 | 中 — 基础流程验证，不测胜负/重连/并发 |
| CLI | cli.test.js | 7 | 低 — 逻辑内联，未引用源文件 |

### 未覆盖的关键分支

**engine/main.js:**
- `explode()` 的5个guard clause只测了正常路径，各失败条件未独立测试
- `callVote()` 的while重试循环（无效投票重试、超时弃权）
- `callSkill()` 死亡玩家只能passBadge/shoot的分支
- `requestAction()` 超时逻辑
- `handleDeath()` 白痴免疫取消死亡后的完整流程
- `processDeathChain()` 链式死亡（猎人开枪→情侣殉情→再开枪）
- `assignRoles()` debugRole冲突场景

**engine/phase.js:**
- `night_werewolf_vote` 平票且`unanimousVote`规则下不达成一致的null target分支
- `day_announce` 同守同救(conflict death)分支
- 中断(explode)在非day_announce阶段触发时先执行day_announce的分支
- 女巫自救规则(`canSelfHeal`)的第二晚分支
- `sheriff_vote` 竞选0人/1人/全参选的边界

**engine/vote.js:**
- `_resolveBanishPK()` 白痴翻牌后过滤、0有效候选人、PK再平票
- `resolveElection()` 全部退选→无警长、PK再平票→无警长
- 警长1.5票权重在平票时的精确计算

**engine/player.js:**
- `executeSkill()` 各type的错误分支（无效target、重复target）
- `executeDoubleTargetSkill()` 丘比特选自己的场景
- `useSkill()` 阶段不匹配时拒绝执行

**engine/config.js:**
- `createCupidCheckWin()` 人狼情侣第三方胜利的完整分支
- `ACTION_FILTERS` 各过滤函数的边界条件

**AI层:**
- Agent._agentLoop LLM返回多tool_calls的处理（仅1个测试）
- 消息压缩触发阈值、多轮压缩
- LLM调用失败/超时的错误恢复
- analyze模式与decide模式的消息格式差异

## 二、框架设计

### 2.1 测试分层

```
┌──────────────────────────────────────────────────────────────┐
│  全栈集成 (WebSocket)  ← server-harness                       │
│  真实HTTP/WS服务器，人类客户端模拟，走完整链路                    │
│  适合：人类操作流程、消息推送格式、ServerCore编排、多人类并发     │
├──────────────────────────────────────────────────────────────┤
│  引擎集成 (GameEngine+PhaseManager)  ← game-harness           │
│  直接构造引擎，MockAI驱动，不走WebSocket                       │
│  适合：角色能力组合、死亡链、胜负判定、多轮流程                  │
├──────────────────────────────────────────────────────────────┤
│  单元测试 (Per-Module)  ← game-harness                        │
│  构造指定状态，直接调方法，跳过PhaseManager                     │
│  适合：单个分支、投票决议、过滤函数、格式化、工具执行            │
└──────────────────────────────────────────────────────────────┘
```

**三层分工：**
- **单元层**：测分支，快，1-2ms一个用例。直接构造状态调方法。
- **引擎集成层**：测流程，10-100ms一个用例。game-harness + PhaseManager 驱动多阶段。
- **全栈集成层**：测交互，100-500ms一个用例。server-harness 走真实 WebSocket。

**server-harness 的定位**：全栈集成测试引擎，从 `test/server-wrapper.js` 迁入 `test/helpers/server-harness.js`。覆盖 ServerCore→WebSocket→GameEngine→AI 全链路，这是 game-harness 做不到的。它的"超时即Bug"原则、autoRespond模式、AI调用观测接口（getAICallHistory/getAICallsByPhase/getAILastMessages）都是经过验证的好设计。

**两个测试引擎的对照：**

| | game-harness | server-harness |
|---|---|---|
| 服务层 | 单元 + 引擎集成 | 全栈集成 |
| 启动成本 | 纯对象构造，<1ms | HTTP+WS服务器，100-300ms |
| 人类玩家 | HumanController直接resolve | WebSocket客户端模拟 |
| AI控制 | AIManager + MockModel | hook注入替换createAI |
| 状态观测 | 直接读game对象 | 通过WS消息推断 + AI观测接口 |
| 适用场景 | 分支覆盖、流程验证 | 人类交互、消息格式、并发 |

**game-harness 吸收 server-harness 的经验**：
- AI可观测性：提供类似的调用记录查询，直接从 AIController/Agent 取，不需要走 WebSocket
- autoRespond：HumanController 支持自动响应 pendingAction，不走 WS，直接 resolve requestAction 的 Promise
- 名字稳定标识：assignRoles 会重排ID，提供 getPlayerByName 便捷方法

### 2.2 测试目录结构

```
test/
├── unit/                    # 新增：纯单元测试
│   ├── engine/
│   │   ├── main.test.js     # GameEngine 各方法独立测试
│   │   ├── phase.test.js    # PhaseManager 各阶段独立测试
│   │   ├── vote.test.js     # VoteManager 全分支覆盖
│   │   ├── player.test.js   # PlayerController 各skill type
│   │   ├── roles.test.js    # 每个角色的skill/event独立测试
│   │   ├── config.test.js   # checkWin、ACTION_FILTERS、RULES
│   │   ├── utils.test.js    # shuffle、发言顺序
│   │   └── event.test.js    # EventEmitter on/emit/cancel
│   └── ai/
│       ├── agent.test.js    # Agent队列、_agentLoop、错误恢复
│       ├── controller.test.js # AIController/AIManager
│       ├── formatter.test.js # 格式化函数
│       ├── tools.test.js    # 所有tool execute函数
│       ├── models.test.js   # MockModel/RandomModel
│       ├── message_manager.test.js # 压缩逻辑
│       └── prompt.test.js   # buildSystemPrompt、getPhasePrompt
├── integration/             # 全栈集成测试，使用 server-wrapper
│   ├── websocket.test.js    # 人类操作流程、消息格式（现有integration.test.js）
│   ├── ai-context-e2e.test.js # AI上下文端到端（现有integration.ai-context.test.js）
│   └── multi-human.test.js  # 多人类并发、重连等（新增）
└── helpers/                 # 测试引擎与共享工具
    ├── test-runner.js       # 测试执行器（describe/it、过滤、汇总）
    ├── test-logger.js       # 测试专用日志（隔离后端日志）
    ├── game-harness.js      # 引擎层测试引擎（单元+引擎集成共用）
    ├── server-harness.js    # 全栈集成测试引擎（从test/server-wrapper.js迁入重构）
    ├── mock-model.js        # MockAgent/MockModel扩展工厂
    ├── scenario-runner.js   # 场景驱动的测试执行器
    └── assertions.js        # 自定义断言（死亡、角色、阶段等）

# 现有文件迁移：
# test/server-wrapper.js     → test/helpers/server-harness.js（重构为集成测试引擎）
# test/game.test.js          → 逐步迁移到 unit/engine/
```

### 2.3 核心工具设计

#### game-harness.js — 引擎层测试引擎

```伪代码
createGame(options):
  - presetId: 指定板子，默认9-standard
  - roles: 手动指定角色分配（跳过shuffle）
  - rules: 覆盖规则
  - players: 自定义玩家列表
  返回 { game, setAI, setHuman, getController, getPlayerByName }

createGameAtPhase(phaseId, setup):
  - 先创建游戏，快进到指定阶段
  - setup函数可在各阶段注入特定状态
  返回 { game, phaseManager, ... }

setAI(playerId, decisions):
  - 为指定玩家设置AI + MockModel
  - decisions: { action_seer: {target:3}, ... }
  - 支持决策序列：{ action_seer: [{target:3}, {target:5}] }（按轮次）
  返回 mockModel（可后续修改决策）

setHuman(playerId, autoRespond):
  - 为指定玩家设置HumanController
  - autoRespond: 自动响应pendingAction，不走WebSocket
  - 直接resolve requestAction的Promise

getAICallHistory(playerId):
  - 从AIController/Agent取调用记录（借鉴TestServerWrapper的观测接口）
getAICallsByPhase(playerId, phase):
  - 按阶段过滤调用记录
getAILastMessages(playerId):
  - 取最后一次调用的messagesForLLM
```

#### scenario-runner.js — 场景驱动测试

```伪代码
scenario(description, game)
  .setup(fn)           // 初始状态设置
  .phase('night', fn)  // 执行夜晚阶段，fn中可设置AI决策
  .phase('day', fn)    // 执行白天阶段
  .expect(fn)          // 断言游戏状态
  .run()               // 执行并验证

// 示例
scenario('猎人被毒不能开枪', game)
  .setup(g => { 设置女巫有毒药, 设置狼人目标为猎人 })
  .phase('night')
  .expect(g => {
    assert(猎人.canShoot === false)
    assert(猎人.alive === false)
  })
```

#### assertions.js — 游戏领域断言

```伪代码
assertPlayerAlive(game, playerId)
assertPlayerDead(game, playerId, reason?)
assertWinner(game, camp)
assertCouple(game, id1, id2)
assertSheriff(game, playerId)
assertPhase(phaseManager, phaseId)
assertRevealed(game, playerId)  // 白痴翻牌
assertPotionState(game, heal, poison)  // 女巫药水
```

#### test-runner.js — 测试执行器

现有问题：每个测试文件自己管 `console.log` + `process.exit(1)`，没有统一执行、过滤和汇总。

```伪代码
核心API：
  describe(name, fn)        // 声明测试套件
  it(name, fn)              // 声明单个用例
  run()                     // 执行并输出汇总

执行方式：
  node test/unit/engine/vote.test.js                    # 单文件
  node test/helpers/test-runner.js test/unit/            # 目录下全部
  node test/helpers/test-runner.js test/unit/engine/     # 子目录
  node test/helpers/test-runner.js --grep "平票"         # 按名称过滤

  # npm scripts（在 package.json 中配置）
  npm test                    # 全部测试
  npm run test:unit           # test/unit/ 下全部
  npm run test:integration    # test/integration/ 下全部
  npm run test:engine         # test/unit/engine/ 下全部

过滤机制：
  --grep <pattern>    只运行名称匹配的用例（支持正则）
  --file <path>       只运行指定文件
  --dir <path>        运行目录下所有 .test.js
  --layer <unit|integration>  按层级运行

汇总输出：
  ─────────────────────────────
  通过: 45  失败: 2  跳过: 0
  耗时: 1.2s
  ─────────────────────────────
  FAIL unit/engine/vote.test.js
    ✗ 平票PK白痴翻牌后过滤  (期望0有效候选人, 实际1)
    ✗ 警长1.5票平票精确计算  (期望1.5, 实际1)
  ─────────────────────────────

用例注册：每个 .test.js 文件顶层调用 describe/it 注册用例，
不立即执行。由 test-runner 统一收集后按过滤条件执行。
```

#### test-logger.js — 测试专用日志

现有问题：后端日志写在 `logs/` 目录，测试日志也混在里面；测试时 engine 层的 logger 输出干扰测试结果阅读。

```伪代码
原则：测试日志与后端日志完全隔离

目录：
  logs/              ← 后端日志（不动）
  test-logs/         ← 测试日志（新增）
    unit/
    integration/
    test-run.log     ← 本次运行汇总日志

实现：
  createTestLogger(testFilePath):
    - 根据 testFilePath 自动生成日志路径
    - test/unit/engine/vote.test.js → test-logs/unit/engine/vote.log
    - test/integration/websocket.test.js → test-logs/integration/websocket.log
    - 返回与 utils/logger.js 相同接口 { info, warn, error, debug }

  全局日志重定向：
    测试运行时，将 engine 层的 createLogger 重定向到 test-logs/
    避免测试产生的引擎日志写入 logs/ 污染后端日志

  日志级别：
    测试日志默认 INFO+（DEBUG 需显式开启）
    失败用例的日志自动提升到 ERROR 级别

  清理策略：
    每次测试运行开始时清空 test-logs/
    不影响 logs/ 目录
```

### 2.4 Mock策略 — 模拟真实环境

**原则：只Mock外部边界，不Mock内部依赖**

| 层次 | Mock方式 | 原因 |
|------|----------|------|
| LLM调用 | MockModel（已有）+ 扩展 | AI决策需要确定性，真实LLM不可控 |
| WebSocket | 仅全栈集成层用server-harness | 单元/引擎集成层不需要 |
| 时间/定时器 | 不Mock | 测试中无定时器依赖 |
| 游戏状态 | 直接构造，不Mock | 真实状态转换是测试目标 |
| PhaseManager | 单元测试直接调用executePhase | 跳过不相关阶段，聚焦目标阶段 |

**MockModel扩展：**
- 支持按阶段设置决策序列（第1夜投A，第2夜投B）
- 支持条件决策（如果自己是女巫且有人被刀则救）
- 支持决策失败模拟（抛异常、超时、返回无效数据）

### 2.5 分支覆盖策略

对每个模块，按以下方法确保分支覆盖：

1. **列出所有分支** — 从源码提取if/else/switch/catch
2. **每个分支写一个测试** — 用描述性名称标注分支条件
3. **组合分支测试** — 多个条件同时触发的场景（如猎人被刀+是警长+情侣）
4. **反向测试** — 确保不应进入的分支不会进入

优先级排序：
- P0: 影响游戏结果的分支（死亡链、胜负判定、投票决议）
- P1: 影响AI行为的分支（上下文构建、消息可见性、工具执行）
- P2: 边界和异常分支（超时、无效输入、状态不一致）

## 三、实施步骤

1. **创建测试基础设施** ✅ — helpers目录、test-runner、test-logger、game-harness、scenario-runner、assertions
2. **engine/unit/ 核心模块** ✅ — 11个文件(含integration-branches.test.js、preset-flow.test.js、game-flow.test.js)，292用例
3. **unit/ai/ 模块** ✅ — 14个文件，325用例
4. **集成测试迁移** ✅ — server-harness.js已创建，websocket.test.js和ai-context-e2e.test.js已迁移到test/integration/
5. **补充引擎集成分支** ✅ — integration-branches.test.js覆盖同守同救、女巫自救、毒杀守卫、多夜死亡、猎人冲突死亡、狼人自爆销毁警徽等
6. **旧测试迁移** ✅ — context-behavior(23)、context(28)、context-format(3)、ai-integration(22)、message-manager-compress(17)、agent-loop(7)、preset-flow(23)、game-flow(11)、cli(7)、websocket-extended(13)全部完成
7. **补充全栈集成** — 待补充：胜负条件E2E、多人类玩家E2E、重连E2E

每完成一个模块，用 `node test/unit/engine/xxx.test.js` 验证通过。

### 当前测试统计

| 目录 | 文件数 | 用例数 | 说明 |
|------|--------|--------|------|
| unit/engine/ | 11 | 292 | 新增preset-flow.test.js(23)、game-flow.test.js(11) |
| unit/ai/ | 14 | 325 | 新增context-behavior.test.js(23)、context.test.js(28)、context-format.test.js(3)、ai-integration.test.js(22)、message-manager-compress.test.js(17)、agent-loop.test.js(7) |
| unit/ | 1 | 7 | cli.test.js |
| integration/ | 3 | ~28 | websocket-extended.test.js(13)、ai-context-e2e.test.js(6) |
| **总计** | **29** | ~652 | |

### 行为一致性发现

1. **day_announce不验证canSelfHeal**：`day_announce`阶段只看`healTarget`是否设置，不验证女巫是否有权自救。canSelfHeal限制由witch阶段在构建actionData时执行。直接设置`healTarget`可绕过此限制。
2. **config.test.js情侣ID格式**：`createCupidCheckWin`期望`game.couples`为ID数组`[id1, id2]`，旧测试可能传的是player对象数组，需统一为ID格式。

## 四、已知Bug与修复状态

### Bug 1: ACTION_FILTERS.action_post_vote 未过滤已翻牌白痴 ✅ 已修复

**位置**: `engine/config.js` ACTION_FILTERS[ACTION.POST_VOTE]

**修复**: filter 条件增加 `p.state?.canVote !== false`，已翻牌白痴不出现在投票目标列表中。

### Bug 2: 胜负判定未排除已翻牌白痴的阵营归属 ✅ 已修复

**位置**: `engine/config.js` createStandardCheckWin / createCupidCheckWin

**修复**: 增加 `isRevealedIdiot` 辅助函数，统计 gods 时排除 `state.revealed === true` 的白痴。

### Bug 3: 狼人在第三方存活时不能通过屠边获胜（仅守丘局）

**位置**: `engine/config.js` createCupidCheckWin

**当前行为**: 已正确实现——`aliveByCamp.third === 0` 才判定狼人胜利。

**备注**: 此条非bug，仅记录规则：即使神职全灭或村民全灭，只要第三方（人狼恋情侣+丘比特）还有人活着，狼人不胜利。标准局无第三方，不受影响。

## 五、待补充测试（P2优先级）

以下分支和场景在现有测试中尚未覆盖，按模块列出。

### engine/main.js
- `callVote()` while重试循环：无效投票重试、超时弃权
- `requestAction()` 超时逻辑
- `handleDeath()` 白痴免疫取消死亡后的完整流程（翻牌后发言、投票权丢失）
- `processDeathChain()` 链式死亡（猎人开枪→情侣殉情→再开枪）
- `explode()` 各guard clause失败条件独立测试

### engine/phase.js
- `night_werewolf_vote` 平票且`unanimousVote`规则下不达成一致的null target分支
- `day_announce` 同守同救(conflict death)完整流程
- 中断(explode)在非day_announce阶段触发时先执行day_announce的分支
- 女巫自救规则(`canSelfHeal`)第二晚的完整阶段流程（非直接设healTarget）
- `sheriff_vote` 竞选0人/1人/全参选的边界

### engine/vote.js
- `_resolveBanishPK()` 白痴翻牌后过滤、0有效候选人、PK再平票
- `resolveElection()` 全部退选→无警长、PK再平票→无警长
- 警长1.5票权重在平票时的精确计算

### engine/player.js
- `executeDoubleTargetSkill()` 丘比特选自己的场景
- `useSkill()` 阶段不匹配时拒绝执行

### engine/config.js
- `createCupidCheckWin()` 丘比特自身死亡的第三方胜利判定
- `ACTION_FILTERS` 各过滤函数更多边界（空玩家列表、全部死亡等）

### AI层
- Agent._agentLoop LLM返回多tool_calls的处理
- 消息压缩触发阈值、多轮压缩
- LLM调用失败/超时的错误恢复
- analyze模式与decide模式的消息格式差异

### 全栈集成
- 胜负条件E2E（好人胜、狼人胜、第三方胜）
- 多人类玩家并发操作E2E
- 重连E2E

## 六、package.json scripts

```json
{
  "scripts": {
    "test": "node test/helpers/test-runner.js",
    "test:unit": "node test/helpers/test-runner.js --dir test/unit",
    "test:integration": "node test/helpers/test-runner.js --dir test/integration",
    "test:engine": "node test/helpers/test-runner.js --dir test/unit/engine",
    "test:ai": "node test/helpers/test-runner.js --dir test/unit/ai"
  }
}
```