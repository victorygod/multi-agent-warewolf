# Agent 上下文构建设计

## 核心设计思想

Agent 的消息管理通过 **MessageManager** 统一封装，对外暴露简洁的 API：

- **MessageManager**：拥有 `messages` 数组，负责消息收集、历史存储、压缩清理、LLMView 构建
- **Agent**：编排逻辑，调用 MessageManager 的 API，不直接操作消息数组

**设计原则：**
1. 只持久化真实对话，不持久化系统提示和失败尝试
2. LLM 看到完整迭代历史，但存档只保留成功结果
3. 压缩后立即清理：旧消息替换为摘要，不存"用了就扔"的数据
4. 先调用后存档：历史写入发生在 LLM 调用成功之后，避免失败时留下孤儿消息
5. 职责单一：MessageManager 管消息，Agent 管决策，互不越界
6. 无 isAnalyze 标志：所有行为差异由 `expectedAction`（有无 tool）推导，analyze 就是无 tool 的 decide

---

## MessageManager API

### 数据结构

```
┌─────────────────────────────────────────────────────────────┐
│                    用户输入 (context.messages)               │
└─────────────────────────────────────────────────────────────┘
                              ↓
                ┌─────────────────────────────┐
                │       MessageManager        │
                │                             │
                │  messages (有效历史)          │
                │  ├─ system                  │
                │  ├─ 【压缩摘要】              │
                │  ├─ user3                   │
                │  ├─ assistant3              │
                │  └─ ...                     │
                │                             │
                │  API:                              │
                │  ├─ formatIncomingMessages()→ 文本  │
                │  ├─ buildLLMView()          → 视图  │
                │  ├─ appendTurn()            → 写历史│
                │  ├─ compress()              → 压缩  │
                │  └─ updateSystem()          → 换系统│
                └─────────────────────────────┘
                              ↓
                ┌─────────────────────────────┐
                │         Agent               │
                │                             │
                │  1. mm.formatIncomingMessages()│
                │  2. mm.buildLLMView(...)       │
                │  3. model.call(llmView)        │
                │  4. mm.appendTurn(...)         │
                └─────────────────────────────┘
```

### 方法说明

| 方法 | 参数 | 返回值 | 说明 |
|------|------|--------|------|
| `formatIncomingMessages(context)` | 上下文（含 messages、players） | `{ newContent, newMessages }` | 过滤新消息（id > lastProcessedId）+ 格式化为文本 |
| `buildLLMView(newContent, { suffix, phasePrompt })` | 格式化后的消息 + 修饰参数 | 临时视图数组 | 深拷贝历史 + 修饰变换，用完即弃 |
| `appendTurn(msgs, newMessages)` | 消息数组 + 原始游戏消息 | 无 | 写入历史 + 更新 lastProcessedId |
| `compress()` | 无 | 无 | 压缩并替换历史 |
| `updateSystem(player, game)` | 玩家 + 游戏信息 | 无 | 替换 system 消息 |

**Agent 不直接操作 `messages` 数组，也不感知 `lastProcessedId`，所有读写都通过 MessageManager。**
**MessageManager 不知道 analyze/decide 的区别，它只接收 suffix 和 phasePrompt 参数，由 Agent 决定注入什么。**

---

## 行为推导：从 expectedAction 统一 analyze 和 decide

### 消除 isAnalyze

旧设计用 `isAnalyze` 标志位控制 4 个分支：suffix 选择、phasePrompt 追加、历史存档内容、expectedAction。

新设计用 `expectedAction` 作为唯一分支条件——`analyze` 就是无 tool 的 `decide`：

```
Agent.answer(context):
  1. { newContent, newMessages } = mm.formatIncomingMessages(context)
  2. isAnalyze = context.action === 'analyze'   // Controller 通过 action 标记
  3. expectedAction = isAnalyze ? 'content' : (getTool(context.phase) || 'content')
  4. isDecision = expectedAction !== 'content'
  5. suffix = isDecision ? soul : ANALYZE_PROMPT
  6. phasePrompt = isDecision ? getPhasePrompt(phase, context) : ''
  7. llmView = mm.buildLLMView(newContent, { suffix, phasePrompt })
  8. tools = isDecision ? getToolsForAction(phase, context) : []
  9. result = agentLoop(model, llmView, expectedAction, tools)
  10. if success:
       userMsg = { role: 'user', content: newContent + phasePrompt }
       mm.appendTurn(userMsg, assistantMsg)
  11. fallback: isDecision ? { type: 'skip' } : ''
```

**注意：** `context.action === 'analyze'` 是 Controller 传入的信号。实际执行中，analyze 请求的 `context.phase` 仍然是当前游戏阶段（如 `day_discuss`），但 `context.action` 为 `'analyze'`，Agent 据此将 expectedAction 强制设为 `'content'`（无 tool），从而走分析分支。

### 分支覆盖验证

| 调用来源 | context.action | context.phase | getTool → expectedAction | isDecision | suffix | phasePrompt | tools | 历史存档 | 失败返回 |
|----------|---------------|---------------|--------------------------|------------|--------|-------------|-------|----------|----------|
| enqueueMessage(分析) | 'analyze' | day_discuss 等 | 强制 → 'content' | false | ANALYZE_PROMPT | '' | [] | newContent | '' |
| getSpeechResult | 'day_discuss' | day_discuss | speech tool | true | soul | 有 | [speech] | newContent+phasePrompt | {skip} |
| getVoteResult | 'day_vote' | day_vote | vote tool | true | soul | 有 | [vote] | newContent+phasePrompt | {skip} |
| useSkill | 'seer' | seer | seer tool | true | soul | 有 | [seer] | newContent+phasePrompt | {skip} |

**关键洞察：** Controller 通过 `context.action='analyze'` 标记分析请求，Agent 据此将 expectedAction 强制设为 `'content'`。其余所有分支的差异由 `getTool(phase)` 推导，无需 isAnalyze 标志。

**写入时序：** user 消息和 assistant 响应通过 `appendTurn` 成对写入，不会出现"有问无答"的孤儿消息。

---

## LLMView 构建（buildLLMView）

### 修饰变换

`buildLLMView` 接收 Agent 注入的 suffix 和 phasePrompt，对深拷贝的历史追加修饰：

```
wrappedPrompt = newContent + suffix + phasePrompt
```

Agent 决定注入什么，MessageManager 只管应用：
- analyze 场景：suffix=ANALYZE_PROMPT, phasePrompt=''
- decide 场景：suffix=soul, phasePrompt=getPhasePrompt(phase, context)

**suffix 不保存到历史：**

| 方案 | 压缩结果 | 问题 |
|------|----------|------|
| suffix 保存到历史 | 摘要包含 suffix | 下次读取摘要时 suffix 被重复注入 |
| suffix 不保存（当前方案） | 摘要只包含真实对话 | 每次动态注入 suffix，干净 |

suffix 是人设/分析提示词，属于系统级提示，只在视图中存在。

---

## 迭代循环中的消息累积

### 视图 vs 历史的更新策略

| 目标 | 更新策略 | 原因 |
|------|----------|------|
| LLMView（临时视图） | 累积所有迭代，包括失败的 | LLM 需要看到之前的尝试历史，否则会重复同样的错误 |
| 历史（MessageManager） | 只通过 `appendTurn` 写入成功轮次 | 失败的多轮对话是内部实现细节，不应该被压缩或持久化 |

### 示例场景

```
LLM 第一次调用：
  → 返回了错误的 tool_call（例如：target 填了字符串而不是数字）
  → LLMView 添加 assistant + tool (error)
  → continue 继续迭代

LLM 第二次调用：
  → 看到之前的错误消息，修正后返回正确的 tool_call
  → LLMView 再添加 assistant + tool (success)
  → Agent 调用 appendTurn，历史只保存最后成功的那一对
```

**如果历史也保存失败的尝试：**
- 压缩时会把错误历史也压缩进去，浪费 token
- 压缩摘要会包含无效的对话内容
- 下次 LLM 读取压缩摘要时会被错误信息干扰

---

## 压缩与历史清理（compress）

### 压缩后立即替换

`compress` 成功后，`messages` 中的旧消息立即被替换为摘要，不存在"存了但不用"的数据：

```
假设压缩发生在第 1 天结束：

messages (压缩前):
[
  { role: 'system', content: '...' },
  { role: 'user', content: '第 1 天发言...' },
  { role: 'assistant', content: '...' },
  { role: 'user', content: '第 1 天投票...' },
  { role: 'assistant', tool_calls: [...] },
  { role: 'tool', ... }
]

压缩后，messages 立即替换为:
[
  { role: 'system', content: '...' },
  { role: 'user', content: '【之前压缩摘要】\n第 1 天：3 号狼人跳预言家...' },
]
```

**设计原因：**

| 方案 | `messages` 内容 | LLMView 构建 | 问题 |
|------|-----------------|---------------|------|
| 保留旧消息 + 元数据标记 | 完整历史 + 3 个压缩变量 | 需要 if 分支 + slice | 存了但不用，构建复杂 |
| 压缩后立即替换（当前方案） | 只有有效历史 | 直接深拷贝 + 追加修饰 | 简单，所见即所得 |

### MessageManager 内部状态

| 变量 | 含义 | 更新时机 |
|------|------|----------|
| `messages` | 有效历史数组 | appendTurn / compress / updateSystem |
| `lastProcessedId` | 已处理到的游戏消息 ID | appendTurn |

---

## 完整数据流

```
┌──────────────────────────────────────────────────────────────────────┐
│  1. MessageManager.formatIncomingMessages(context)                   │
│     context.messages (来自游戏消息队列)                                │
│     ↓                                                                │
│     过滤新消息 (id > lastProcessedId)                                 │
│     ↓                                                                │
│     formatMessageHistory → newContent                                │
│     → 返回 { newContent, newMessages }                               │
└──────────────────────────────────────────────────────────────────────┘
                                    ↓
                        ┌─────────────────────────┐
                        │  2. MessageManager       │
                        │     .buildLLMView()      │
                        │                         │
                        │  深拷贝 messages         │
                        │  + 追加 wrappedPrompt    │
                        │  → 返回临时视图          │
                        └─────────────────────────┘
                                    │
                                    ▼
                        ┌─────────────────────────┐
                        │  3. model.call()        │
                        │     ↓                   │
                        │  多轮迭代循环            │
                        │  - assistant/tool       │
                        │  - 累积到 LLMView       │
                        └─────────────────────────┘
                                    │
                                    ▼
                        ┌─────────────────────────┐
                        │  4. MessageManager       │
                        │     .appendTurn()        │
                        │                         │
                        │  成功轮次写入 messages   │
                        │  更新 lastProcessedId    │
                        └─────────────────────────┘
                                    │
                                    ▼
                        ┌─────────────────────────┐
                        │  5. MessageManager       │
                        │     .compress() (可选)   │
                        │                         │
                        │  替换 messages 为摘要    │
                        └─────────────────────────┘
```

---

## LLMView 的两个视图变换

`buildLLMView` 对有效历史施加两次"视图变换"，返回临时数组：

| 变换 | 操作 | 目的 |
|------|------|------|
| **修饰变换** | 给最后一条 user 消息追加 suffix + phasePrompt | 注入系统提示 |
| **迭代变换** | 在视图中累积 tool_call + tool_result | 支持多轮工具对话 |

**关键洞察：** 两次变换都不修改 `messages`，只在临时视图中进行。压缩变换已不需要——`messages` 压缩后已是有效历史。

---

### expectedAction 驱动的视图差异

| expectedAction | 修饰变换 | 迭代变换 | appendTurn 保存内容 |
|----------------|----------|----------|----------------------|
| `'content'`（无 tool） | suffix=ANALYZE_PROMPT, phasePrompt='' | 不应用（无 tool） | 只保存 `newContent` |
| tool 对象（有 tool） | suffix=soul, phasePrompt 有值 | 应用（有 tool） | 保存 `newContent + phasePrompt` + 成功响应 |

**analyze 不留痕：** suffix（ANALYZE_PROMPT）和 phasePrompt（空）只在视图中存在，appendTurn 保存到历史时只有 `newContent`。

**analyze 不留痕：** suffix（ANALYZE_PROMPT）和 phasePrompt（空）只在视图中存在，appendTurn 保存到历史时只有 `newContent`。

---

### 视图构建流程

```
步骤 1：复制历史
  → 深拷贝 messages 到临时数组 view

步骤 2：应用修饰变换
  → Agent 根据 expectedAction 决定 suffix 和 phasePrompt
  → 构建完整的 wrappedPrompt = newContent + suffix + phasePrompt
  → 追加到 view

步骤 3：返回视图
  → view 即为 LLMView，传给 model.call()
  → Agent 在 view 基础上继续追加 assistant/tool 消息（迭代变换）

步骤 4：成功时写入历史
  → Agent 调用 appendTurn(userMsg, assistantMsg)
  → userMsg.content = newContent + phasePrompt（phasePrompt 为空时就是 newContent）
  → 成对写入 messages + 更新 lastProcessedId
  → 失败时不调用，messages 保持不变
```

---

### 扩展方向

如果需要支持更多上下文功能，`buildLLMView` 可以轻松扩展：

| 功能 | 视图变换方式 |
|------|--------------|
| 动态插入系统提示 | 在视图中插入，不保存到历史 |
| 按阵营过滤历史 | 构建视图时过滤（历史保持完整，过滤只在视图中生效） |
| 多轮工具对话（扩展） | 在视图中累积，成功后只保存关键结果 |
| 临时上下文注入 | 如"上一轮投票结果"，只在视图中存在 |

**核心原则不变：** 历史是真实的，视图是可修饰的。

---

## 关键设计决策总结

| 决策 | 选择 | 替代方案 | 为什么选择当前方案 |
|------|------|----------|-------------------|
| 消息管理 | MessageManager 封装 | 直接在 Agent 中操作数组 | 职责单一，Agent 只管编排，MessageManager 只管消息 |
| 分支判断 | expectedAction（有无 tool） | isAnalyze 标志位 | analyze 就是无 tool 的 decide，不需要额外标志 |
| suffix 保存 | 不保存到历史 | 保存 | 避免压缩时污染摘要 |
| 失败迭代 | 不保存到历史 | 保存 | 避免持久化内部实现细节 |
| 压缩触发 | day_vote 后 | 每个阶段后 | 减少压缩频率，节省 token |
| 历史写入时序 | LLM 成功后写入 | LLM 调用前写入 | 避免失败时出现孤儿 user 消息 |
| 压缩后历史 | 立即替换为摘要 | 保留旧消息 + 元数据标记 | 所见即所得，LLMView 构建无需 if/slice 分支 |

---

## 相关文件

- `ai/agent/agent.js` - Agent 核心实现（编排逻辑）
- `ai/agent/message_manager.js` - MessageManager（历史 + LLMView + 压缩）
- `ai/agent/formatter.js` - 消息格式化
- `ai/agent/prompt.js` - 提示词构建
- `docs/history_compression.md` - 历史压缩方案
- `docs/compression_visibility.md` - 压缩可见性过滤