# AI 实时分析机制设计方案

## 1. 核心架构

### 1.0 调用时机总览

| 方法 | 调用时机 | 触发源 | 是否阻塞 |
|-----|---------|-------|---------|
| `analyze(msg)` | 消息到达时 | `message:added` 事件 | 否（后台异步） |
| `decide(context)` | 轮到 AI 行动时 | Phase 调用 | 是（同步等待） |

**analyze 调用场景**：
- 玩家发言结束（`speech`）
- 投票结果公布（`vote_result`）
- 死亡公告（`death_announce`）
- 技能发动（`action`）
- 警长当选（`sheriff_elected`）

**decide 调用场景**：
- 发言：`getSpeechResult()`
- 投票：`getVoteResult()`
- 技能：`useSkill()`

### 1.1 共享上下文

分析和决策共享同一份消息历史，存储在 `AIController.messages` 数组中。

**上下文结构示例**：

```
[system]  名字 + 位置 + 角色 + 规则

[user]    天亮了，2 号死亡。2 号发动遗言。
[assistant] 2 号死亡发动遗言，需要看遗言内容...

[user]    3 号发言：我是预言家...
[assistant] 3 号跳预言家，需要验证...

[user]    4 号发言：我信 3 号...
[assistant] 4 号站队 3 号...

[user]    轮到你发言了
[assistant] {"type": "speech", "content": "..."}
```

**关键点**：
- 每条 user 消息打包从上一条 assistant 消息之后的所有新消息
- 调用 API 时：动态给最后一条 user 消息添加 soul 和 post_prompt

### 1.2 关键设计

| 维度 | 设计 |
|-----|------|
| **上下文存储** | `AIController.messages[]`，初始为 `[system]` |
| **分析** | 添加 `[user: 事件，assistant: 分析结果]` 到 messages |
| **决策** | 添加 `[user: 阶段提示词，assistant: JSON]` 到 messages |
| **soul/post_prompt** | `buildMessages()` 统一注入，确保所有 Agent 看到一致的上下文 |
| **触发入口** | `AIManager` 监听 `message:added` 事件，自动触发分析 |

### 1.3 并发模型

```
┌─────────────────────────────────────────────────────────────┐
│ Server                                                      │
│  message.add() → emit('message:added')                      │
└─────────────────────────────────────────────────────────────┘
                            ↓
        ┌───────────────────┼───────────────────┐
        ↓                   ↓                   ↓
   ┌─────────┐        ┌─────────┐        ┌─────────┐
   │ AI(1)   │        │ AI(2)   │        │ AI(3)   │
   │ queue[] │        │ queue[] │        │ queue[] │
   │ 串行消费 │        │ 串行消费 │        │ 串行消费 │
   └─────────┘        └─────────┘        └─────────┘
```

- **AI 内部**：串行消费消息队列，`isProcessing` 保证同一时刻只有一个分析在运行
- **AI 之间**：异步并发，每个 AI 独立队列，互不阻塞
- **Server 和 AI**：Server 只负责广播，不等待 AI 处理完成

### 1.4 完整时序图

```
时间线：游戏开始 → 第 1 天 → 第 1 天发言 → 第 1 天投票 → 第 2 天决策

T0: 游戏开始
    messages = [{ role: 'system', ... }]

T1: 1 号发言结束
    server → message.add(speech)
    → emit('message:added')
    → AI(1).enqueueMessage(), AI(2).enqueueMessage(), ...
    → AI(1).processQueue() → analyze(speech)
    → buildMessages() → 注入 soul + 分析提示
    → LLMAgent.analyze(messages) → 调用 API
    → messages.push({ user: '1 号发言...', assistant: '...' })

T2: 2 号发言结束
    server → message.add(speech)
    → emit('message:added')
    → AI(1).enqueueMessage(), AI(2).enqueueMessage(), ...
    → AI(1).processQueue() → analyze(speech)
    → messages.push({ user: '2 号发言...', assistant: '...' })

T3: 投票结束
    server → message.add(vote_result)
    → emit('message:added')
    → AI(1).enqueueMessage(), AI(2).enqueueMessage(), ...
    → AI(1).processQueue() → analyze(vote_result)
    → messages.push({ user: '投票结果...', assistant: '...' })

T4: 轮到 3 号 AI 发言
    Phase → getSpeechResult()
    → decide(context)
    → 等待队列清空
    → buildMessages() → 注入 soul + getPhasePrompt()
    → LLMAgent.decide(messages) → 调用 API → 解析 JSON
    → messages.push({ user: '...', assistant: '{"type": "speech", ...}' })
    → 返回发言内容
```

---

## 2. 分析触发节点

### 2.1 触发时机（按消息类型）

以下消息类型触发分析（仅白天固定阶段）：

| 消息类型 | 说明 | 打包内容 |
|-----|---------|---------|
| `speech` | 玩家发言结束 | 发言内容 |
| `vote_result` | 投票结束（警长/放逐/PK） | 票型结果 |
| `death_announce` | 死亡公告 | 死讯 + 遗言 + 技能发动（如有） |
| `sheriff_elected` | 警长当选 | 警长结果 |

**注意**：`action` 类型不触发分析，因为夜晚的技能发动（预言家查验、女巫救人等）是私密消息，白天公开的技能发动（如猎人开枪）会通过 `death_announce` 触发。

### 2.2 打包逻辑

每次分析时，将**上一次 analyze/decide 输出 assistant 消息之后的所有新消息**打包成一条 user 消息。

**核心机制**：
- 维护 `lastProcessedMessageId`，记录上一条已处理消息的 ID
- 新消息到达时，从 `lastProcessedMessageId` 之后收集所有消息
- 打包成一条 user 消息内容，格式为「事件 1 + 事件 2 + ...」

**示例**：

| 场景 | 打包内容 |
|-----|---------|
| 死亡公告阶段 | 「天亮了，2 号死亡」+「2 号发动遗言」+「遗言内容」 |
| 连续发言 | 每人发言单独触发，不打包（每条发言后立刻分析） |
| 夜晚转白天 | 「天亮了」+「死讯」+「遗言」+「技能发动」打包成一条 |

**关键点**：
- 打包的是「消息内容」，不是「消息对象」
- 每条 user 消息对应一条 assistant 分析
- `lastProcessedMessageId` 在每次 analyze/decide 完成后更新，记录已处理的游戏消息 ID
- `analyze` 更新为触发分析的消息 ID
- `decide` 更新为决策时的最新消息 ID（避免下次 analyze 重复收集自己的发言）

### 2.3 夜晚特殊处理

**夜晚阶段不触发分析**，所有夜晚事件打包到白天进入时分析：

- 夜晚事件（狼人投票、守卫守护、女巫用药、预言家查验）不触发分析
- 进入白天时触发一次分析，打包昨晚全部事件（死讯、技能结果等）

### 2.4 不触发的情况

| 情况 | 原因 |
|-----|------|
| 自己发出的消息 | 自己知道内容，无需分析 |
| 私密消息（visibility: self） | 只有当事人可见 |
| 阵营消息但不同阵营 | 如狼人马仔看不到好人阵营消息 |
| 游戏结束 | 无需分析 |

---

## 3. 实现逻辑

### 3.1 数据结构

**AIController 核心属性**：

| 属性 | 说明 |
|-----|------|
| `messages[]` | 共享上下文，初始为 `[{ role: 'system', content: '...' }]` |
| `messageQueue[]` | 待分析的消息队列 |
| `isProcessing` | 是否正在处理队列 |
| `lastProcessedMessageId` | 上一条已分析消息的 ID，用于打包逻辑 |

**消息格式**：
- `role`: `'system'` | `'user'` | `'assistant'`
- `content`: 字符串
- `id`: 消息唯一 ID（用于追踪打包起点）

### 3.2 消息队列处理

**触发流程**：

1. 游戏消息添加到 `game.message`
2. 触发 `message:added` 事件
3. `AIManager` 遍历所有 AI 控制器
4. 对每个可见的 AI，调用 `enqueueMessage(msg)`

**消费逻辑（串行）**：

- 队列非空且 `isProcessing` 为 false 时，启动消费
- 从队列取出消息，调用 `analyze(msg)`
- 等待分析完成后，继续处理下一条
- 处理完毕后，`isProcessing` 设为 false

### 3.3 上下文构建：buildMessages()

**位置**：`ai/context.js`

**方法职责**：
- 接收 player、game、context、options
- 格式化历史消息（支持压缩）
- 注入 soul 到 user 消息
- 注入 post_prompt（分析提示或阶段提示）
- 返回完整的消息数组 `lastMessages`

**分析时调用**：
```
buildMessages(player, game, { type: 'analyze', packedContent })
→ 返回 [system, ...历史，{ role: 'user', content: soul + 分析提示 + 打包内容 }]
```

**决策时调用**：
```
buildMessages(player, game, context)
→ 返回 [system, ...历史，{ role: 'user', content: soul + getPhasePrompt() }]
```

### 3.4 分析入口：analyze(msg)

**位置**：`AIController`

**触发条件**：
- 消息类型需要分析（发言、投票结果、死亡公告、技能发动、警长当选）
- 消息对该 AI 可见
- 非自己发出的消息

**分析逻辑**：

1. 从 `lastProcessedMessageId` 之后开始，收集所有新消息
2. 使用 `formatMessageHistory()` 格式化成打包内容
3. 调用 `buildMessages()` 构建完整上下文（注入 soul + 分析提示）
4. 委托给对应 Agent 处理：
   - `this.llmAgent.analyze(messages)` → 调用 LLM API
   - `this.randomAgent.analyze()` → 返回随机分析
   - `this.mockAgent.analyze()` → 返回预设分析
5. 将分析结果作为 assistant 消息追加到 `this.messages`
6. 更新 `lastProcessedMessageId`

**Agent 职责**：

| Agent | analyze() 实现 |
|-------|--------------|
| `LLMAgent` | 调用 LLM API，返回分析文本 |
| `RandomAgent` | 返回随机分析文本 |
| `MockAgent` | 返回预设分析文本 |

**分析输出**：自然语言字符串，无格式要求

**分析提示词**：
> 请分析局势，站在他声称的角色视角分析是否有矛盾。分析内容仅自己可见。

### 3.5 决策入口：decide(context)

**位置**：`AIController`

**调用时机**：
- Phase 调用 `getSpeechResult()` / `getVoteResult()` / `useSkill()`

**决策流程**：

1. 等待队列清空（`isProcessing === false && messageQueue.length === 0`）
2. 调用 `buildMessages()` 构建完整上下文（注入 soul + getPhasePrompt()）
3. 委托给 Agent 处理：
   - `LLMAgent.decide(messages)` → 调用 LLM API → 解析 JSON
   - `RandomAgent.decide(context)` → 返回随机行动
   - `MockAgent.decide(context)` → 返回预设行动
4. 返回行动

**决策输出**：JSON 格式，包含行动类型和目标

---

## 4. 上下文增长示例

### 游戏开始

共享上下文 `messages` 初始化为仅包含 system 消息，队列为空。

### 第 1 天 1 号发言后（分析触发）

**存储到 messages**：
- system：名字、位置、角色、规则
- user：1 号玩家发言内容
- assistant：AI 分析结果（1 号跳预言家，报 5 号金水，需要验证后续对跳）

**调用 API 时的消息**（动态添加 soul 和 post_prompt）：
- 在 user 消息前添加 soul（角色设定）
- 在 user 消息后添加 post_prompt（提示 AI 分析发言）

### 第 1 天 2 号发言后（分析触发）

**存储到 messages**：
- 追加 user：2 号玩家发言内容（我信 1 号，我是女巫）
- 追加 assistant：AI 分析结果（2 号站队 1 号，自称女巫，需观察今晚死亡验证）

### 第 1 天投票后（分析触发）

**存储到 messages**：
- 追加 user：投票结果（放逐：1 号 vs 4 号，票型分布）
- 追加 assistant：AI 分析结果（票型显示两派对立）

### 死亡公告阶段（打包分析）

**存储到 messages**：
- 追加 user：打包内容（天亮了，2 号死亡 + 2 号发动遗言 + 遗言内容）
- 追加 assistant：AI 分析结果（2 号死亡发动遗言，遗言称自己是预言家）

### 第 2 天决策时（女巫用药）

**调用 API 时的消息**：
- 包含所有历史分析
- 最后一条 user 消息：阶段提示词（女巫阶段，今晚 5 号被杀，解药/毒药可用）
- 动态添加 soul 和 post_prompt（提示 AI 返回 JSON 行动）

---

## 5. 触发流程

### 5.1 消息添加 → 分析触发

**事件流**：

1. 游戏消息添加到 `game.message`
2. 触发 `message:added` 事件
3. `AIManager` 监听事件，遍历所有 AI 控制器
4. 对每个 AI 控制器：
   - 检查消息类型是否在分析节点列表中
   - 检查消息对该 AI 是否可见
   - 检查是否自己发出的消息
   - 全部通过则调用 `enqueueMessage(msg)`
5. AI 控制器后台异步消费队列
6. 分析完成后，追加 `[user, assistant]` 到 `controller.messages`

### 5.2 决策时读取上下文

**流程**：

1. Phase 调用 `getSpeechResult()` / `getVoteResult()` / `useSkill()`
2. AIController 等待队列清空（所有分析完成）
3. 调用 `buildMessages()` 构建完整上下文
4. 委托给 Agent：
   - `LLMAgent.decide(messages)` → 调用 API → 解析 JSON
   - `RandomAgent/MockAgent.decide(context)` → 返回行动
5. 返回行动

---

## 6. 单局游戏分析次数估算

| 阶段 | 分析节点 | 次数 |
|-----|---------|-----|
| 第 1 夜 | （不触发） | 0 |
| 第 1 天 | 死亡公告 + 8 人发言 + 投票 | ~10 |
| 第 2 夜 | （不触发） | 0 |
| 第 2 天 | 死亡公告 + 6 人发言 + 投票 | ~8 |
| 第 3 天 | 死亡公告 + 4 人发言 + 投票 | ~6 |
| ... | ... | ... |
| **合计** | | **~24-30 次分析/局** |

**对比**：
- 当前架构（无分析）：~5 次决策/局
- 新架构：~24-30 次分析 + ~5 次决策 = ~30-35 次 API 调用/局

---

## 7. 实施步骤

### Phase 1: AIController 添加消息队列
- 添加 `messageQueue[]` 和 `isProcessing`
- 添加 `lastProcessedMessageId` 用于打包逻辑

### Phase 2: 队列消费方法
- 实现 `enqueueMessage(msg)` 方法
- 实现 `processQueue()` 方法（串行消费）
- 实现 `shouldAnalyzeMessage(msg)` 方法（可见性检查）

### Phase 3: buildMessages 支持分析场景
- 扩展 `buildMessages()` 支持分析场景
- 添加分析提示词注入

### Phase 4: 实现 analyze() 方法
- 实现 `AIController.analyze(msg)` 方法
- 打包逻辑：从 `lastProcessedMessageId` 之后收集消息
- 调用 `buildMessages()` 构建上下文
- 委托给对应 Agent：`this.llmAgent.analyze()` / `this.randomAgent.analyze()` / `this.mockAgent.analyze()`

### Phase 5: 修改 decide() 等待队列清空
- 修改 `decide()` 方法
- 等待队列清空后委托给 Agent

### Phase 6: LLMAgent 实现 analyze()
- 添加 `analyze(messages)` 方法
- 调用 LLM API 返回分析文本

### Phase 7: RandomAgent 和 MockAgent 实现 analyze()
- `RandomAgent.analyze()` → 返回随机分析文本
- `MockAgent.analyze()` → 返回预设分析文本

### Phase 8: AIManager 监听 message:added
- 添加 `_onMessageAdded()` 监听
- 遍历所有 AI 控制器，调用 `enqueueMessage()`

### Phase 9: 测试验证
- 发言触发分析
- 自己发言不触发自己
- 决策使用分析历史
- 私密消息不触发分析
- 串行消费
- 决策等待队列清空

---

## 8. 测试用例

**测试 1：发言触发分析**

- 前提：1 号玩家发言结束
- 当：消息添加
- 预期：所有 AI 的 `messages` 增加 2 条（user + assistant）

**测试 2：自己发言不触发自己分析**

- 前提：1 号 AI 发言
- 当：消息添加
- 预期：1 号 AI 的 `messages` 不增加

**测试 3：决策使用分析历史**

- 前提：AI 有 3 条分析历史
- 当：AI 需要投票
- 预期：上下文包含所有分析历史

**测试 4：私密消息不触发分析**

- 前提：女巫收到查验结果（visibility: self）
- 当：消息添加
- 预期：所有 AI 的 `messages` 不增加

**测试 5：串行消费**

- 前提：AI 队列有 [A, B, C] 三条消息
- 当：启动消费
- 预期：A 分析完成后才分析 B，B 完成后才分析 C

**测试 6：决策等待队列清空**

- 前提：AI 队列有 [A]，同时需要决策
- 当：调用 decide()
- 预期：等待 A 分析完成后再决策

---

## 9. 配置项

**超时设置**：
- 分析超时：30 秒
- 决策超时：30 秒

**需要分析的消息类型**：
- `speech` - 玩家发言
- `vote_result` - 投票结果
- `death_announce` - 死亡公告
- `action` - 技能发动
- `sheriff_elected` - 警长当选

**不分析的消息**：
- `phase_start` - 阶段开始（纯标记）
- `system` - 系统消息
- `game_over` - 游戏结束
- `self` 可见的私密消息

---

## 10. Agent 支持

### 10.1 三种 Agent 同时支持

| Agent | decide() | analyze() | 使用场景 |
|------|----------|-----------|---------|
| **MockAgent** | ✅ | ✅ (预设分析内容) | 测试 |
| **LLMAgent** | ✅ | ✅ (LLM 生成) | 生产 |
| **RandomAgent** | ✅ | ✅ (随机分析) | 降级 |

**降级链**：
```
decide(): Mock → LLM → Random (兜底)
analyze(): Mock → LLM → Random (兜底)
```

### 10.2 为什么共享上下文？

| 方案 | 优点 | 缺点 |
|-----|------|------|
| 分离上下文 | 分析历史和游戏历史清晰分开 | 需要同步两份数据，压缩复杂 |
| 共享上下文 | 数据结构简单，天然一致 | 上下文可能较长 |

**选择**：共享上下文，简化实现。

### 10.2 为什么夜晚不触发分析？

1. 夜晚事件都是私密消息，AI 本来就知道
2. 夜晚事件连续发生，打包到白天分析更高效
3. 减少 API 调用次数

### 10.3 为什么用消息队列串行消费？

1. 分析 2 依赖分析 1 的结果
2. 决策依赖所有分析完成
3. 避免并发修改 `messages` 数组

### 10.4 为什么 AI 之间异步并发？

1. 每个 AI 视角不同，分析独立
2. 不阻塞其他 AI 的处理
3. Server 广播不等待

---

## 11. 潜在问题与解决

### 11.1 上下文过长

**问题**：分析轮次多了后，messages 数组可能超过 token 限制

**解决**：
- 限制每局游戏最多 30 条分析轮次
- 超出时删除最早的分析轮次（FIFO）

### 11.2 API 调用延迟

**问题**：分析是异步的，可能决策时分析还没完成

**解决**：
- 决策时等待队列清空
- 设置 30 秒超时，超时后降级到 RandomAgent

### 11.3 重复分析

**问题**：同一消息可能被多个 AI 同时分析

**解决**：
- 每个 AI 独立分析是预期行为（视角不同）
- 同一消息对同一 AI 只分析一次（队列串行消费保证）

---

## 12. 监控指标

| 指标 | 说明 | 告警阈值 |
|-----|------|---------|
| 每局分析次数 | 单局游戏触发分析的次数 | > 50 |
| 分析延迟（P99） | 从消息添加到分析完成的时间 | > 10s |
| API 调用次数/局 | 单局游戏 API 调用总次数 | > 40 |
| 上下文长度 | messages 数组长度 | > 50 条 |
| 队列积压 | 未处理的消息数量 | > 10 |

---

## 13. AI 上下文消息结构示例

`AIController.messages` 数组存储所有上下文：

```
[
  { role: 'system', content: '角色设定+规则' },
  { role: 'user', content: '打包的消息1' }, { role: 'assistant', content: '分析结果1' },
  { role: 'user', content: '打包的消息2' }, { role: 'assistant', content: '分析结果2' },
  ...
  { role: 'user', content: '决策提示词' }, { role: 'assistant', content: '行动JSON' },
]
```

### 游戏开始

```
messages = [
  { role: 'system', content: '你是3号小刚，角色：狼人，队友：6号阿明、9号小五...' }
]
```

### 第1天白天：死亡公告

**触发**：`death_announce` 消息添加

**打包内容**（从 `lastProcessedMessageId=0` 之后的所有可见消息）：
- 夜晚所有事件（预言家查验、女巫救人等私密消息对当事人可见）
- 死亡公告

**messages 变化**：
```
[
  { role: 'system', content: '...' },
  { role: 'user', content: '第1夜\n[预言家]你查验了6号阿明，TA是好人\n第1天\n[死亡]5号小红' },
  { role: 'assistant', content: '5号死亡，我是预言家验了6号金水...' }
]
```

### 第1天白天：玩家发言

**触发**：每个玩家发言后（`speech` 类型）

**打包内容**：单条发言

**messages 变化**（假设 1 号发言）：
```
[
  { role: 'system', content: '...' },
  { role: 'user', content: '第1夜...' },  // 死亡公告打包
  { role: 'assistant', content: '...' },
  { role: 'user', content: '1号小明: 我是预言家，验了5号金水' },
  { role: 'assistant', content: '1号跳预言家，验5号金水，需要观察对跳...' }
]
```

### 第1天白天：AI 自己发言（decide）

**触发**：轮到 AI 发言

**不触发 analyze**（自己发的消息被 `shouldAnalyzeMessage` 过滤）

**messages 变化**：
```
[
  { role: 'system', content: '...' },
  ...  // 之前的分析
  { role: 'user', content: '轮到你发言了' },
  { role: 'assistant', content: '{"type":"speech","content":"我是好人，站边1号"}' }
]
```

**关键**：`decide` 完成后更新 `lastProcessedMessageId`，避免下次 analyze 重复收集自己的发言。

### 第1天白天：投票结果

**触发**：`vote_result` 消息添加

**打包内容**：票型结果

**messages 变化**：
```
[
  { role: 'system', content: '...' },
  ...  // 之前的分析和决策
  { role: 'user', content: '[投票]3号小刚(1,2) 7号阿鹏(3,4)' },
  { role: 'assistant', content: '票型两极分化，1、2号投3号，3、4号投7号...' }
]
```

### 第1天白天：AI 投票（decide）

**触发**：轮到 AI 投票

**messages 变化**：
```
[
  { role: 'system', content: '...' },
  ...  // 之前的分析
  { role: 'user', content: '轮到你投票了 (可选: 3号, 7号)' },
  { role: 'assistant', content: '{"type":"vote","target":"3"}' }
]
```

### 第2天白天：死亡公告（打包多事件）

**触发**：`death_announce` 消息添加

**打包内容**（从上次 `lastProcessedMessageId` 之后）：
- 第1天晚上的所有事件
- 第2天死亡公告

**messages 变化**：
```
[
  { role: 'system', content: '...' },
  ...  // 第1天的所有分析和决策
  { role: 'user', content: '第1夜\n[守卫]你守护了2号\n第2天\n[死亡]7号阿鹏' },
  { role: 'assistant', content: '7号死亡，我昨晚守了2号...' }
]
```

### 夜晚阶段

**不触发 analyze**，但 AI 的决策仍会记录：

```
[
  { role: 'system', content: '...' },
  ...  // 白天的分析
  { role: 'user', content: '女巫行动' },  // decide
  { role: 'assistant', content: '{"action":"heal"}' }
]
```

夜晚的私密消息（如预言家查验）会在白天 `death_announce` 触发分析时打包进去。

### 上下文变化总结

| 阶段 | 触发类型 | 打包内容 | messages 变化 |
|------|---------|---------|--------------|
| 白天死亡公告 | `death_announce` | 夜晚所有事件 + 死亡公告 | +[user, assistant] |
| 玩家发言 | `speech` | 单条发言 | +[user, assistant] |
| AI 发言 | decide | 决策提示词 | +[user, assistant] |
| 投票结果 | `vote_result` | 票型 | +[user, assistant] |
| AI 投票 | decide | 决策提示词 | +[user, assistant] |
| 警长当选 | `sheriff_elected` | 当选结果 | +[user, assistant] |
| 夜晚技能 | decide | 决策提示词 | +[user, assistant] |