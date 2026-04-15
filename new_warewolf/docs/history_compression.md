# 历史消息压缩方案（修订版）

## 核心思路

**压缩逻辑内聚到 LLMAgent 内部**，不改动游戏核心流程（GameEngine、MessageManager、PhaseManager）。

- 每个 LLMAgent 独立维护自己的压缩状态
- 默认开启压缩，可配置关闭
- 压缩时机：day_vote 结束后（不含 PK 投票），增量压缩

## 增量压缩逻辑

```
第1天 day_vote 结束：
  原始消息: [1, 2, 3, ..., 50]（第1天投票前）
  压缩输入: 消息 1-50
  压缩输出: compressedSummary_1
  存储: compressedSummary = compressedSummary_1, compressedAfterMessageId = 50

第2天 day_vote 结束：
  原始消息: [1, 2, 3, ..., 50, 51, 52, ..., 100]（第2天投票前）
  压缩输入: compressedSummary_1 + 消息 51-100（上次压缩点之后的所有新消息）
  压缩输出: compressedSummary_2
  存储: compressedSummary = compressedSummary_2, compressedAfterMessageId = 100

第3天 day_vote 结束：
  原始消息: [1, 2, ..., 100, 101, 102, ..., 150]
  压缩输入: compressedSummary_2 + 消息 101-150
  压缩输出: compressedSummary_3
  存储: compressedSummary = compressedSummary_3, compressedAfterMessageId = 150
  ...
```

**关键点**：
- 每次压缩的输入 = 上一次的压缩摘要 + 新增消息（从 `compressedAfterMessageId + 1` 到当前投票前）
- 输出是新的压缩摘要，**不是追加**，而是**重新压缩**
- `compressedAfterMessageId` 始终指向最新压缩点

## 系统架构

```
决策流程:
AIController.decide()
  → LLMAgent.decide()
    → buildMessages()
      → formatMessageHistory(context.messages, ...)
        → [检测到已压缩，用 compressedSummary + 新消息]

压缩触发:
day_vote 阶段结束 → 遍历所有 LLMAgent → 异步执行增量压缩
```

## 实现方案

### 1. LLMAgent 扩展

**修改文件**：`ai/agents/llm.js`

```javascript
const { buildSystemPrompt, getPhasePrompt, ROLE_NAMES } = require('../prompts');
const { formatMessageHistory } = require('../context');
const { createLogger } = require('../../utils/logger');

// 创建日志实例（延迟初始化，只使用backend.log）
let backendLogger = null;
function getLogger() {
  if (!backendLogger) {
    backendLogger = global.backendLogger || createLogger('backend.log');
  }
  return backendLogger;
}

class LLMAgent {
  constructor(playerId, game, options = {}) {
    this.playerId = playerId;
    this.game = game;
    this.systemPrompt = '';
    this.lastMessages = null;

    // 压缩配置
    this.compressionEnabled = options.compressionEnabled !== false; // 默认开启
    this.compressedSummary = null;      // 当前压缩摘要
    this.compressedAfterMessageId = 0; // 压缩点之后的消息ID
  }

  /**
   * 增量压缩历史消息
   * 在 day_vote 结束后调用，压缩从上次压缩点到当前投票前的消息
   * @param {Array} messages - 完整消息列表
   */
  async compressHistory(messages) {
    if (!this.compressionEnabled) return;
    if (!this.isApiAvailable()) return;

    // 找出需要压缩的新消息（从上次压缩点到当前投票前）
    const newMessages = messages.filter(m =>
      m.id > this.compressedAfterMessageId &&
      m.type !== 'vote_result' // 排除投票结果，投票结果后面单独处理
    );

    // 如果没有新消息需要压缩，直接返回
    if (newMessages.length === 0) return;

    // 构建压缩提示词：上次摘要 + 新增消息
    const prompt = this.buildCompressPrompt(newMessages);

    // 调用 LLM 压缩
    const summary = await this.callCompressAPI(prompt);

    if (summary) {
      // 更新压缩摘要（是重新压缩，不是追加）
      this.compressedSummary = summary;
      // 更新压缩点：当前所有消息的最后一条ID
      this.compressedAfterMessageId = messages[messages.length - 1]?.id || 0;
    }
  }

  /**
   * 构建压缩提示词
   * @param {Array} newMessages - 新增的消息（上次压缩点之后到当前）
   */
  buildCompressPrompt(newMessages) {
    // 获取角色信息（参考 buildSystemPrompt）
    const player = this.game.players.find(p => p.id === this.playerId);
    const roleId = player?.role?.id || player?.role;
    const roleName = ROLE_NAMES[roleId] || roleId;
    const position = this.game.getPosition(this.playerId);

    // 狼人队友信息
    let wolfTeammates = '';
    if (roleId === 'werewolf') {
      const teammates = this.game.players.filter(p =>
        p.alive && p.id !== this.playerId && p.role?.id === 'werewolf'
      );
      if (teammates.length > 0) {
        const positions = teammates.map(p => this.game.getPosition(p.id) + '号').join('、');
        wolfTeammates = `\n你的队友: ${positions}`;
      }
    }

    // 格式化新增消息
    const newMessagesText = formatMessageHistory(newMessages, this.game.players, player);

    // 系统提示词去掉 soul 的部分
    const identityInfo = `名字:${player?.name || '未知'} 位置:${position}号位 角色:${roleName}${wolfTeammates}`;

    return `你是狼人杀游戏分析师。请将以下游戏历史压缩为300字以内的局势摘要。

## 你的身份
${identityInfo}
规则:女巫仅首夜可自救|守卫不可连守|猎人被毒不能开枪|首夜/白天死亡有遗言|情侣一方死另一方殉情

## 上次压缩摘要
${this.compressedSummary || '（无）'}

## 新增消息（从上次压缩点到当前）
${newMessagesText}

## 要求
1. 结合上次摘要和新增消息，生成新的精简摘要
2. 保留关键信息：死亡、身份暴露、关键投票
3. 省略冗余发言
4. 突出对局势判断有价值的信息
5. 控制在300字以内
6. 记录对每个角色的分析印象`;
  }

  /**
   * 调用压缩专用 API（复用现有 API）
   */
  async callCompressAPI(prompt) {
    const baseUrl = process.env.BASE_URL;
    const apiKey = process.env.AUTH_TOKEN;
    const model = process.env.MODEL;

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: 'system', content: '你是一个简洁的狼人杀游戏分析师，擅长压缩信息' },
          { role: 'user', content: prompt }
        ]
      })
    });

    if (!response.ok) return null;

    const data = await response.json();
    return data.choices?.[0]?.message?.content || null;
  }

  /**
   * 构建消息（支持压缩）
   */
  buildMessages(context) {
    // 检查是否需要使用压缩
    const useCompression = this.compressionEnabled &&
                           this.compressedSummary &&
                           context.messages?.length > 0;

    let historyText;
    if (useCompression) {
      // 分离：已压缩的消息（用摘要）+ 新消息（完整格式）
      const newMsgs = context.messages.filter(m => m.id > this.compressedAfterMessageId);

      historyText = this.formatWithCompression(newMsgs);
    } else {
      historyText = formatMessageHistory(context.messages, this.game.players);
    }

    const phasePrompt = getPhasePrompt(context.phase, context);
    const userContent = `${historyText}\n\n${phasePrompt}`;

    this.lastMessages = [
      { role: 'system', content: this.systemPrompt },
      { role: 'user', content: userContent }
    ];
  }

  /**
   * 使用压缩历史构建消息
   */
  formatWithCompression(newMsgs) {
    const lines = ['【历史摘要】', this.compressedSummary];

    if (newMsgs.length > 0) {
      lines.push('', '【最新动态】');
      lines.push(formatMessageHistory(newMsgs, this.game.players));
    }

    return lines.join('\n');
  }
}
```

### 2. AIController 扩展

**修改文件**：`ai/controller.js`

```javascript
class AIController extends PlayerController {
  constructor(playerId, game, options = {}) {
    super(playerId, game);

    // 创建 Agent（传递压缩配置）
    this.randomAgent = new RandomAgent(playerId, game);
    this.llmAgent = options.agentType === 'llm'
      ? new LLMAgent(playerId, game, { compressionEnabled: options.compressionEnabled })
      : null;
    this.mockAgent = options.agentType === 'mock'
      ? new MockAgent(playerId, game, options.mockOptions)
      : null;
  }

  // ...

  /**
   * 触发所有 LLM Agent 压缩历史
   * 在 day_vote 结束后调用
   */
  compressAllHistory(messages) {
    if (!this.llmAgent) return;

    // 异步执行，不阻塞
    this.llmAgent.compressHistory(messages).catch(err => {
      getLogger().error(`压缩历史失败: ${err.message}`);
    });
  }
}
```

### 3. 阶段流程集成

**修改文件**：`engine/phase.js`

```javascript
// 白天投票
{
  id: 'day_vote',
  name: '白天投票',
  execute: async (game) => {
    const voters = game.players.filter(p => p.alive);

    const getAllowedTargets = (playerId) => game.players
      .filter(p => p.alive && p.id !== playerId && !(p.role.id === 'idiot' && p.state?.revealed))
      .map(p => p.id);

    // 并行让所有存活玩家投票
    await Promise.all(voters.map(voter => game.callVote(voter.id, 'vote', { allowedTargets: getAllowedTargets(voter.id) })));

    // 投票结束后（不含 PK），触发所有 AI 压缩历史
    game.triggerHistoryCompression();
  }
}
```

### 4. GameEngine 扩展

**修改文件**：`engine/main.js`

```javascript
class GameEngine {
  // ...

  /**
   * 触发历史消息压缩
   * 在 day_vote 结束后调用
   */
  triggerHistoryCompression() {
    const messages = this.message.messages;

    // 遍历所有 AI 控制器，触发压缩
    for (const controller of this.aiManager.controllers.values()) {
      if (controller.llmAgent) {
        controller.llmAgent.compressHistory(messages);
      }
    }
  }
}
```

## 数据流

```
day_vote 结束（不含 PK）
    ↓
game.triggerHistoryCompression()
    ↓
遍历所有 AIController
    ↓
每个 LLMAgent.compressHistory(messages)
    ↓
找出新增消息: messages.filter(id > compressedAfterMessageId)
    ↓
构建提示词: [上次摘要] + [新增消息]
    ↓
调用 LLM 压缩（异步）
    ↓
更新: compressedSummary = 新摘要, compressedAfterMessageId = 最新消息ID
    ↓
后续决策时：
    ↓
LLMAgent.buildMessages()
    ↓
检测到已压缩 → formatWithCompression()
    ↓
返回: [compressedSummary] + [id > compressedAfterMessageId 的新消息]
```

## 压缩提示词示例

```
你是狼人杀游戏分析师。请将以下游戏历史压缩为200字以内的局势摘要。

## 你的身份
位置: 7号
角色: 村民

## 上次压缩摘要
【局势】D2，存活6人(3民2狼1神)。死亡:5预言(刀)、3狼(毒)。
【身份】4号狼(未跳)。
【投票】D1警长1号当选。

## 新增消息（从上次压缩点到当前）
第2天
[发言]
1号张三:我觉得4号很可疑...
2号李四:我预言家，查验6号好人...
...

[投票]票型：4号(1,2,3) 6号(5,7,8) 平票 PK
4号在 PK 中被投出局

## 要求
1. 结合上次摘要和新增消息，生成新的精简摘要
2. 保留关键信息
3. 省略冗余发言
4. 控制在200字以内
```

## 预期输出示例

```
【历史摘要】
【局势】D3，存活4人(1民1狼2神)。死亡:5预言(刀)、3狼(毒)、4狼(毒)、2民(投)。
【身份】6号女巫(已跳，毒杀4号)，9号狼(未跳)。
【投票】D1警长1号当选；D3投出2号村民(平票 PK 出局)。
【分析】狼人剩9号，好人优势。9号发言"我是好人"无信息，6号女巫可信。

【最新动态】
第3天
[发言]
7号小芳:我觉得9号...
...
```

## 实现步骤

1. **修改 `ai/agents/llm.js`**
   - 构造函数增加 `options` 参数，支持 `compressionEnabled`
   - 添加 `compressHistory()` 方法（增量压缩）
   - 添加 `buildCompressPrompt()` 方法
   - 修改 `buildMessages()` 支持压缩
   - 添加 `formatWithCompression()` 方法

2. **修改 `ai/controller.js`**
   - 构造函数传递压缩配置到 LLMAgent
   - 添加 `compressAllHistory()` 方法

3. **修改 `engine/main.js`**
   - 添加 `triggerHistoryCompression()` 方法

4. **修改 `engine/phase.js`**
   - 在 `day_vote` 阶段结束后调用 `game.triggerHistoryCompression()`

5. **测试验证**
   - 单元测试：压缩逻辑
   - 集成测试：完整游戏流程
   - 性能测试：Token 消耗对比

## 注意事项

1. **异步不阻塞**：压缩在后台执行，不影响游戏流程

2. **降级策略**：如果 LLM 不可用或压缩失败，`compressHistory()` 会 catch 异常并忽略，不影响游戏

3. **只压缩一次**：`compressedSummary` 存在则跳过？不对，每次 day_vote 结束都应该增量压缩更新

4. **可见性差异**：当前方案是统一压缩所有消息，每个 AI 看到的是一样的压缩结果。实际上不同阵营看到的历史不同（狼人知道队友），可选优化是为不同阵营分别压缩

5. **PK 投票处理**：当前方案在 day_vote 结束后就压缩，不包含 PK 投票。如果有 PK，PK 投票会在下一次压缩时包含进去

## 后续优化

1. **按阵营压缩**：狼人和好人分别压缩（因为看到的历史不同）

2. **压缩质量评估**：监控压缩后的信息完整性

3. **自适应压缩**：根据游戏阶段动态调整压缩频率