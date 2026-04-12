# 重构计划：统一 PlayerController 接口

> **状态：已完成 ✅**
>
> 重构已于 2026-04 完成，所有核心功能已实现并通过测试。

## 一、当前问题

### 1. 两套并行的控制器
- `engine/player.js`: `AIPlayerController` (随机决策) + `HumanPlayerController` (WebSocket)
- `ai/controller.js`: `AIController` (LLM Agent 决策)

### 2. 接口不一致
- `AIController` 有 `speak()`, `vote()`, `useSkill()` + `getSpeechResult()`, `getVoteResult()`
- `HumanPlayerController` 只有 `getSpeechResult()`, `getVoteResult()`, `useSkill()`
- `AIPlayerController` 在 `useSkill()` 内部直接执行技能，`HumanPlayerController` 先请求再执行

### 3. 状态/消息管理分散
- `AIController` 自己维护 `messageHistory` 和 `cachedState`
- `HumanPlayerController` 每次通过 `requestAction` 获取
- 消息历史应该统一从 `MessageManager.getVisibleTo()` 获取

### 4. 职责混乱
- `engine/main.js` 的 `callSpeech/callVote/callSkill` 既调用 controller 又执行技能
- 技能执行逻辑散落在 controller 和 engine 两处

---

## 二、目标架构

```
┌─────────────────────────────────────────────────────────────┐
│                    PlayerController (基类)                   │
│  - playerId, game                                           │
│  - getState() → game.getState(playerId)                     │
│  - getVisibleMessages() → game.message.getVisibleTo()       │
│  - getSkill(actionType) → 从 role.skills 或 ATTACHMENTS     │
│  - canUseSkill(skill, extraData) → 验证技能可用性            │
│  - executeSkill(skill, action, extraData) → 执行技能        │
├─────────────────────────────────────────────────────────────┤
│  抽象方法（子类实现）:                                        │
│  - getSpeechResult(visibility, actionType) → {content}      │
│  - getVoteResult(extraData) → {targetId}                    │
│  - useSkill(actionType, extraData) → {success, ...}         │
└─────────────────────────────────────────────────────────────┘
                              │
          ┌───────────────────┴───────────────────┐
          ▼                                       ▼
┌─────────────────────────┐         ┌─────────────────────────┐
│   HumanController       │         │     AIController        │
├─────────────────────────┤         ├─────────────────────────┤
│ 决策来源: WebSocket 响应 │         │ 决策来源: Agent         │
│                         │         │                         │
│ getSpeechResult():      │         │ getSpeechResult():      │
│   requestAction()       │         │   decide() → Agent      │
│   → 等待人类输入         │         │   → LLM 或 Random       │
│                         │         │                         │
│ useSkill():             │         │ useSkill():             │
│   requestAction()       │         │   decide() → Agent      │
│   → executeSkill()      │         │   → executeSkill()      │
└─────────────────────────┘         └─────────────────────────┘
```

**关键点**：`executeSkill()` 提取到基类，HumanController 和 AIController 共用。

---

## 三、Agent 策略层设计

```
┌─────────────────────────────────────────────────────────────┐
│                      Agent (策略接口)                        │
│  decide(context) → { type, content?, target? }              │
└─────────────────────────────────────────────────────────────┘
                              │
          ┌───────────────────┴───────────────────┐
          ▼                                       ▼
┌─────────────────────────┐         ┌─────────────────────────┐
│     RandomAgent         │         │     LLMAgent            │
├─────────────────────────┤         ├─────────────────────────┤
│ 随机决策                 │         │ LLM 决策                │
│ - 发言：随机预设语句      │         │ - 调用 LLM API          │
│ - 投票：随机存活玩家      │         │ - 解析返回 action       │
│ - 技能：随机目标          │         │ - 基于上下文推理        │
└─────────────────────────┘         └─────────────────────────┘
```

### Agent 接口

**输入 context**：
```
{
  phase: 'day_discuss',      // 当前阶段
  players: [...],            // 所有玩家状态
  alivePlayers: [...],       // 存活玩家
  messages: [...],           // 可见消息历史
  self: { role, state, ... }, // 自己的私有信息
  dayCount: 2,               // 天数
  werewolfTarget: 3,         // 狼人目标（仅狼人/女巫可见）
  extraData: {...}           // 额外数据（如投票限制）
}
```

**输出 action**：
```
{
  type: 'speech' | 'vote' | 'target' | 'heal' | 'poison' | 'skip' | ...,
  content: '我是好人',        // speech 类型
  target: '3',               // vote/target 类型
  targetIds: [1, 2],         // 多目标（丘比特）
  confirmed: true            // instant 类型（竞选/退水）
}
```

### 降级机制

LLMAgent 失败时在 AIController 层面降级到 RandomAgent：

```
AIController.decide(context):
  if (llmAgent 存在):
    try:
      action = await llmAgent.decide(context)
      if (validateAction(action)):
        return action
    catch:
      log "LLM 决策失败，降级到 RandomAgent"
  
  return await randomAgent.decide(context)
```

降级触发条件：
1. LLM API 调用失败（网络错误、超时）
2. 返回格式解析失败
3. 返回的 action 无效（目标不存在、不合法）

### RandomAgent 决策逻辑

根据 phase 返回对应 action：

| phase | 返回 |
|-------|------|
| day_discuss, sheriff_speech | `{ type: 'speech', content: 随机预设语句 }` |
| day_vote, sheriff_vote | `{ type: 'vote', target: 随机存活玩家 }` |
| werewolf | `{ type: 'target', target: 随机非己存活玩家 }` |
| seer | `{ type: 'target', target: 随机未查验玩家 }` |
| witch | `{ type: 'heal' | 'poison' | 'skip' }` 根据情况决定 |
| guard | `{ type: 'target', target: 随机非上次守护玩家 }` |
| sheriff_campaign | `{ type: 'campaign', confirmed: 50%概率 }` |
| 其他 | `{ type: 'skip' }` |

**注意**：RandomAgent 不做技能验证，由 Controller 层负责。

### LLMAgent 决策逻辑

```
LLMAgent.decide(context):
  if (client 未初始化):
    initClient(context)  // 构建 system prompt
  
  userMessage = buildUserMessage(context)
  response = await callLLM(userMessage)
  return parseAction(response)
```

**TODO**：`buildUserMessage()` 需要控制 token 消耗，后续重点设计。

---

## 四、PlayerController 基类设计

### 公共方法

```
getState():
  return game.getState(playerId)

getVisibleMessages():
  player = game.players.find(playerId)
  return game.message.getVisibleTo(player, game)

getSkill(actionType):
  skill = player.role.skills[actionType]
  if (!skill):
    skill = ATTACHMENTS.sheriff.skills[actionType]  // 全局机制技能
  return skill

canUseSkill(skill, extraData):
  // 检查阶段限制
  if (skill.availablePhases && !包含当前阶段):
    return { ok: false, message: '当前阶段不可用' }
  
  // 检查 canUse 条件
  if (skill.canUse && !skill.canUse(player, game, extraData)):
    return { ok: false, message: '当前无法使用' }
  
  return { ok: true }
```

### executeSkill（核心，提取到基类）

根据技能类型执行不同逻辑：

| skill.type | 处理逻辑 |
|------------|----------|
| `target` | 验证目标 → `skill.execute(target, player, game)` |
| `double_target` | 验证两个目标 → `skill.execute(targets, player, game)` |
| `choice` | 直接执行 → `skill.execute(choice, player, game)` |
| `instant` | 直接执行 → `skill.execute(null, player, game)` |

**注意**：`executeSkill` 接收已解析的 action，不负责决策。

### 抽象方法（子类实现）

```
HumanController:
  getSpeechResult(): await requestAction() → 返回人类输入
  getVoteResult(): await requestAction() → 返回人类选择
  useSkill(): await requestAction() → executeSkill()

AIController:
  getSpeechResult(): decide() → 返回 Agent 决策
  getVoteResult(): decide() → 返回 Agent 决策
  useSkill(): decide() → executeSkill()
```

---

## 五、重构步骤

### 步骤 1：创建 Agent 策略层

新建 `ai/agents/random.js`：
- 实现 `RandomAgent` 类，提供 `decide(context)` 方法
- 根据阶段返回随机决策

重构 `ai/agents/llm.js`（基于现有 `ai/agent.js`）：
- 实现 `LLMAgent` 类，提供 `decide(context)` 方法
- 保留现有 prompt 构建和 API 调用逻辑

### 步骤 2：重构 PlayerController 基类

修改 `engine/player.js`：
- 定义 `PlayerController` 基类
- 实现公共方法：`getState()`, `getVisibleMessages()`, `getSkill()`, `canUseSkill()`, `executeSkill()`
- 定义抽象方法：`getSpeechResult()`, `getVoteResult()`, `useSkill()`

### 步骤 3：实现 HumanController

修改 `engine/player.js`：
- 继承 `PlayerController`
- `getSpeechResult()` 调用 `requestAction` 等待人类输入
- `getVoteResult()` 调用 `requestAction` 等待人类选择
- `useSkill()` 调用 `requestAction` 获取决策后调用 `executeSkill()`

### 步骤 4：实现 AIController

修改 `ai/controller.js`：
- 继承 `PlayerController`
- 持有 `randomAgent` 和可选的 `llmAgent`
- 实现 `decide()` 方法，包含降级逻辑
- 移除 `messageHistory` 和 `cachedState`，改用基类方法

### 步骤 5：简化 engine/main.js

- `callSpeech()` 只调用 `controller.getSpeechResult()` 然后 `game.speak()`
- `callVote()` 只调用 `controller.getVoteResult()` 然后 `game.vote()`
- `callSkill()` 只调用 `controller.useSkill()`
- 移除现有的技能执行逻辑（已在 controller 内完成）

### 步骤 6：更新 server.js

- 创建 AI 时指定 agent 类型：`new AIController(playerId, game, { agentType: 'llm' })`
- `getPlayerController` 返回正确的 controller 实例

### 步骤 7：更新测试

- 保持现有 `MockAI` 不变（作为 Controller 层 mock）
- 后续可添加 `MockAgent`（作为 Agent 层 mock）用于测试 Controller 逻辑

---

## 六、文件变更清单

| 文件 | 变更 |
|------|------|
| `ai/agents/random.js` | 新建 RandomAgent |
| `ai/agents/llm.js` | 重构 LLMAgent（基于现有 ai/agent.js） |
| `engine/player.js` | 重构为 PlayerController 基类 + HumanController |
| `ai/controller.js` | 继承 PlayerController，注入 Agent 策略 |
| `engine/main.js` | 简化 callSpeech/callVote/callSkill |
| `server.js` | 更新 AI 创建逻辑 |
| `test/game.test.js` | 保持不变 |

---

## 七、接口对齐总结

| 操作 | HumanController | AIController |
|------|-----------------|--------------|
| 获取状态 | `getState()` | `getState()` (同一方法) |
| 获取消息 | `getVisibleMessages()` | `getVisibleMessages()` (同一方法) |
| 发言决策 | WebSocket 等待响应 | Agent.decide() |
| 投票决策 | WebSocket 等待响应 | Agent.decide() |
| 技能使用 | WebSocket 等待 → executeSkill() | Agent.decide() → executeSkill() |

**核心对齐点**：
1. 两者都通过 `game.getState(playerId)` 获取状态
2. 两者都通过 `game.message.getVisibleTo()` 获取消息
3. 两者返回相同格式的决策结果
4. `executeSkill()` 提取到基类，共用技能执行逻辑
5. AI 决策策略可插拔（RandomAgent / LLMAgent）
6. LLMAgent 失败时自动降级到 RandomAgent

**职责分离**：
- Agent 层：只负责决策，返回 action
- Controller 层：统一接口、技能验证、技能执行、状态获取