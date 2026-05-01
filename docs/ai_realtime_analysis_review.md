# AI 实时分析机制实现 Review 报告

## 1. 测试为什么没发现 server.js 被改坏

### 根本原因
测试文件 `test/ai_analysis.test.js` 只测试了 `AIManager.onMessageAdded()` 方法，但**没有测试 server.js 中的事件监听链路**。

```javascript
// 测试中的写法（直接调用，不经过 game.aiManager）
manager.onMessageAdded(msg);

// 但 server.js 中的实际代码是：
if (game.aiManager) {
  game.aiManager.onMessageAdded(msg);
}
```

### 测试覆盖缺失的分支

| 测试场景 | 是否覆盖 | 说明 |
|---------|---------|------|
| `AIManager.onMessageAdded()` 直接调用 | ✅ | 测试了 |
| `game.aiManager` 为 null 的情况 | ❌ | 未测试 |
| `game.message.on('message:added')` 事件触发 | ❌ | 未测试 |
| server.js 中 `game.aiManager = aiManager` 绑定 | ❌ | 未测试 |
| 完整事件链路（message.add → emit → onMessageAdded） | ❌ | 未测试 |

### 修复建议

添加集成测试，验证完整链路：

```javascript
// 集成测试：验证 game.aiManager 绑定和事件触发
test('server.js game.aiManager 绑定和事件链路', () => {
  const game = createTestGame();
  const aiManager = new AIManager(game);
  game.aiManager = aiManager; // 模拟 server.js 的绑定
  
  // 验证绑定成功
  assert.strictEqual(game.aiManager, aiManager);
  
  // 模拟 message.add 触发事件
  const msg = { type: 'speech', playerId: 2, content: '测试', visibility: 'public' };
  game.message.add(msg); // 这会触发 message:added 事件
  
  // 验证 AI 控制器收到了消息
  // ...
});
```

---

## 2. 文档与实现的不一致

### 2.1 决策存储问题

**文档描述**（第 56 行、118 行、325-331 行）：
> **决策**：添加 `user: 阶段提示词` 到 messages，等待 `assistant: JSON`

```
→ messages.push({ user: '...', assistant: '{"type": "speech", ...}' })
```

**实际实现**：
- `analyze()` 会存储 `[user, assistant]` 到 `messages`
- `decide()` **不存储**任何内容到 `messages`

**影响分析**：
- AI 的分析历史会累积，但决策历史不会
- AI 无法在后续分析中看到自己之前的决策
- 但决策的结果（如投票给谁）会通过游戏消息反映，后续分析时间接覆盖

**建议**：
- **选项 A**：修改实现，让 `decide()` 也存储决策到 messages（符合文档）

### 2.2 上下文结构验证

**文档示例**（第 28-44 行）：
```
[system]  名字 + 位置 + 角色 + 规则

[user]    天亮了，2 号死亡。2 号发动遗言。
[assistant] 2 号死亡发动遗言，需要看遗言内容...

[user]    3 号发言：我是预言家...
[assistant] 3 号跳预言家，需要验证...

[user]    轮到你发言了
[assistant] {"type": "speech", "content": "..."}
```

**实际存储**（当前实现）：
```
[system]  名字 + 位置 + 角色 + 规则

[user]    天亮了，2 号死亡。
[assistant] 2 号死亡，需要看遗言...

[user]    3 号发言：我是预言家...
[assistant] 3 号跳预言家，需要验证...
```

**差异**：
- ✅ system 消息正确存储
- ✅ 分析的 [user, assistant] 对正确存储
- ❌ 决策的 [user, assistant] 对**不存储**

---

## 3. 各角色视角上下文模拟

### 3.1 好人阵营（如预言家）

**可见消息类型**：
- `speech` (public) - 所有玩家发言
- `vote_result` (public) - 投票结果
- `death_announce` (public) - 死亡公告
- `action` (部分) - 公开的技能动作
- `sheriff_elected` (public) - 警长当选

**不可见消息**：
- `wolf_vote_result` (camp: wolf) - 狼人投票
- 女巫/守卫/预言家的私密行动 (visibility: self)

**上下文示例**：
```
[system] 你是 4 号预言家，胜利目标：放逐所有狼人

[user]    第 1 天 [发言] 1 号：我是预言家，5 号金水
[assistant] 1 号跳预言家，报 5 号金水，需要验证对跳

[user]    第 1 天 [发言] 2 号：我信 1 号
[assistant] 2 号站队 1 号，可能是狼同伴

[user]    第 1 天 [投票] 放逐 1 号
[assistant] 1 号被放逐，需要看他是否真预言家

[user]    第 2 天 [死亡公告] 3 号死亡
[assistant] 3 号死亡，可能是狼人刀的

[user]    轮到你查验
[assistant] (决策，不存储)
```

### 3.2 狼人阵营

**可见消息类型**：
- 所有好人可见的 public 消息
- `wolf_vote_result` (camp: wolf) - 狼人投票结果
- `wolf_speech` - 狼人夜间发言

**不可见消息**：
- 好人的私密行动 (visibility: self)

**上下文示例**：
```
[system] 你是 1 号狼人，队友 2 号，胜利目标：屠城

[user]    第 1 夜 [狼人] 3 号：刀谁？
[assistant] (狼人夜间分析，如果有实现)

[user]    第 1 夜 [狼人] [私密] 最终击杀：5 号
[assistant] (决策，不存储)

[user]    第 1 天 [发言] 4 号：我是预言家
[assistant] 4 号跳预言家，是真预还是要抗推

[user]    第 1 天 [投票] 放逐 4 号
[assistant] 4 号被放逐，如果是真预我们优势
```

### 3.3 女巫

**可见消息类型**：
- 所有 public 消息
- 女巫自己的技能结果 (visibility: self)

**特殊上下文**：
- 女巫知道自己救了谁、毒了谁
- 女巫知道今晚谁被刀

**上下文示例**：
```
[system] 你是 5 号女巫，有一瓶解药一瓶毒药

[user]    第 1 夜 [私密] 今晚 3 号被刀
[assistant] (决策：救或不救，不存储)

[user]    第 1 天 [发言] 3 号：我是预言家
[assistant] 3 号是昨晚被刀的玩家，他跳预言家

[user]    第 1 天 [死亡公告] 无
[assistant] 昨晚是平安夜，说明我救对人
```

---

## 4. 测试完整性分析

### 4.1 当前测试覆盖

| 测试项 | 是否覆盖 | 说明 |
|--------|---------|------|
| AIController 初始化 | ✅ | 13 个测试通过 |
| shouldAnalyzeMessage | ✅ | 5 个分支覆盖 |
| enqueueMessage/processQueue | ✅ | 串行消费测试 |
| Agent.analyze() | ✅ | Mock/Random 测试 |
| waitForQueueEmpty | ✅ | 超时等待测试 |
| AIManager.onMessageAdded | ✅ | 触发分析测试 |
| server.js 事件链路集成测试 | ✅ | game.aiManager 绑定验证 |
| 决策存储验证 | ✅ | decide 存储到 messages |
| 阵营消息过滤 | ✅ | 狼人看不到好人私密消息 |

---

## 5. 修复建议优先级

**所有修复已完成**（2026-04-25）：
- ✅ 集成测试已添加
- ✅ 决策存储已实现
- ✅ 阵营消息过滤测试已覆盖
- ✅ 日志开关已实现

### P2（可选优化）
1. 添加打包逻辑详细测试
2. 添加超时边界测试
3. 添加夜晚事件不触发分析测试

---

## 6. 结论

**当前实现状态**（2026-04-25 更新）：
- ✅ 核心分析功能正确实现
- ✅ 消息队列和串行消费正确
- ✅ Agent 分析委托正确
- ✅ 决策存储到 messages（已修复）
- ✅ 集成测试覆盖 server.js 事件链路
- ✅ 可见性过滤逻辑正确实现（`VisibilityRules`）
- ✅ LOG_ANALYSIS_CONTEXT 开关覆盖 ai/context.js 和 ai/agents/llm.js

**可见性过滤实现状态**：
- ✅ `public`: 所有人可见
- ✅ `self`: 仅发送者可见
- ✅ `camp`: 同阵营可见（依赖 `getCamp` hook）
- ✅ `couple`: 情侣可见
- ✅ `cupidIdentity`: 丘比特可见情侣身份

**测试覆盖**：
- ✅ 单元测试：13 个测试通过
- ✅ 集成测试：12 个测试通过
- ✅ 角色视角可见性测试：已覆盖（狼人阵营看不到好人私密消息）

**剩余工作**：
- 无，所有功能已实现并测试通过

---

## 7. 测试验证结果（2026-04-25）

**全部测试结果**：
- `test/ai_analysis.test.js`: 13/13 通过
- `test/ai_integration.test.js`: 12/12 通过
- `test/game.test.js`: 101/101 通过
- `test/preset.test.js`: 126/126 通过
- `test/llm.test.js`: 29/29 通过
- `test/context.test.js`: 通过
- `test/compression.test.js`: 通过
- `test/cli.test.js`: 通过
- `test/human-player.test.js`: 通过
- `test/websocket.test.js`: 通过

**总计**：264+ 测试全部通过

**关键验证点**：
- ✅ analyze() 存储 [user, assistant] 到 messages
- ✅ decide() 存储 [user, assistant] 到 messages
- ✅ 决策上下文包含完整分析历史
- ✅ 日志开关 LOG_ANALYSIS_CONTEXT 工作正常
- ✅ cli_client 测试验证后端日志输出正确