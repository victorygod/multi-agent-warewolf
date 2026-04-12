# pendingAction 设计文档

## 一、目标

将 `pendingAction` 信息直接包含在 `getState()` 返回值中，前端只需监听 `state` 一种消息即可获取完整的游戏状态和待处理行动。

---

## 二、方案

### 2.1 修改 `_pendingRequests` 存储结构

```javascript
// engine/main.js
this._pendingRequests.set(requestId, {
  resolve,
  timeout,
  playerId,
  actionType,
  data  // ✅ 新增
});
```

### 2.2 修改 `getState` 增加 `pendingAction`

```javascript
// engine/main.js - getState() 返回值增加 pendingAction 字段
{
  phase: 'guard',
  players: [...],
  self: { ... },
  pendingAction: {           // ✅ 新增
    requestId: '1-guard-xxx',
    action: 'guard',
    lastGuardTarget: 3,
    allowedTargets: [2, 4, 5]
  }
  // 或 null（无待处理行动时）
}
```

### 2.3 server.js 简化

删除单独的 `action_required` 消息发送，只发送包含 `pendingAction` 的 `state`。

---

## 三、项目影响分析

### 3.1 需要改动的文件

| 文件 | 改动内容 |
|------|----------|
| `engine/main.js` | 1. `_pendingRequests` 存储 `data`<br>2. `getState` 增加 `pendingAction` |
| `server.js` | 删除 `action_required` 单独发送 |
| `public/controller.js` | 改为从 `state.pendingAction` 触发 `onActionRequired` |
| `cli_client.js` | 改为从 `state.pendingAction` 获取 requestId |
| `test/human-player.test.js` | 更新测试用例，检查 `state.pendingAction` |

> **注意**：public/app.js 无需改动，因为 controller.js 会以 `{ data: pendingAction }` 格式触发回调，保持了原有结构。

### 3.2 不需要改动的文件

| 文件 | 原因 |
|------|------|
| `ai/controller.js` | AI 通过 `extraData` 获取信息，绕过 WebSocket |
| `ai/agents/random.js` | 通过 `context.extraData` 获取 `allowedTargets` |
| `ai/agents/llm.js` | 通过 `context.extraData` 获取信息 |
| `engine/player.js` | 不涉及 WebSocket 消息 |
| `test/game.test.js` | 不依赖 WebSocket 消息 |
| `SERVER_ISSUES.md` | 设计文档，非代码 |
| `CLI_CLIENT_PLAN.md` | 设计文档，非代码 |

### 3.3 特殊说明

**broadcastState 行为**：
- 第 97-110 行的 `broadcastState()` 函数会遍历所有客户端
- 为每个客户端调用 `game.getState(info.playerId)`
- 改造后，每个客户端会收到包含自己 `pendingAction` 的 state
- 无需修改，行为自动正确

**getStateWithDebug 行为**：
- 第 113-120 行的 `getStateWithDebug` 函数调用 `game.getState(playerId)`
- 改造后，返回值自动包含 `pendingAction`
- 无需修改，行为自动正确

**getState 无参数行为**：
- 第 429 行调用 `game.getState()` 无参数时，playerId 为 undefined
- 当前行为：player 为 undefined，不设置 self
- 改造后：pendingAction 也为 null（因为找不到匹配的请求）
- 这是预期行为，无需修改

---

## 四、各文件改动详情

### 4.1 engine/main.js

**改动 1**：存储 data（约第 333 行）
```javascript
// 当前
this._pendingRequests.set(requestId, { resolve, timeout, playerId, actionType });

// 改为
this._pendingRequests.set(requestId, { resolve, timeout, playerId, actionType, data });
```

**改动 2**：getState 增加 pendingAction（约第 624 行，return 之前）
```javascript
// 在 return state; 之前添加
let pendingAction = null;
for (const [requestId, pending] of this._pendingRequests) {
  if (pending.playerId === playerId) {
    const actionData = this.buildActionData(playerId, pending.actionType, pending.data || {});
    pendingAction = { requestId, ...actionData };
    break;
  }
}
return { ...state, pendingAction };
```

### 4.2 server.js

**需要删除的代码**：
- 第 137-150 行：`player:action` 事件监听器中的 `action_required` 发送逻辑
- 第 233-249 行：重连时的单独 `action_required` 发送逻辑

**保留的代码**：
- 第 97-110 行：`broadcastState()` 广播逻辑（会自动包含 pendingAction）
- 第 142-144 行：发送 state 给玩家（已包含 pendingAction）

**注意**：`getStateWithDebug` 函数（第 113-120 行）也需要更新，调用 `game.getState(playerId)` 以包含 pendingAction。

### 4.3 public/controller.js

**当前代码位置**：第 107 行

```javascript
// 改动后：state 消息同时处理 pendingAction
case 'state':
  this.cachedState = msg.data;
  if (this.onStateChange) {
    this.onStateChange(this.cachedState);
  }
  // 检查 pendingAction，触发 onActionRequired 回调
  if (this.cachedState.pendingAction && this.onActionRequired) {
    this.onActionRequired({ data: this.cachedState.pendingAction });
  }
  break;

// 删除 action_required case（第 107-111 行）
```

### 4.4 public/app.js

**当前代码位置**：第 109 行

**重要发现**：public/app.js 中大量使用 `currentAction.data.requestId`。

由于 controller.js 会以 `{ data: this.cachedState.pendingAction }` 格式触发回调：
```javascript
if (this.cachedState.pendingAction && this.onActionRequired) {
  this.onActionRequired({ data: this.cachedState.pendingAction });
}
```

因此 `currentAction.data.requestId` 仍然有效，**public/app.js 无需修改**！

```javascript
// 无需改动，handleActionRequired 仍然接收 { data: { requestId, action, ... } }
function handleActionRequired(msg) {
  const d = msg.data;  // 仍然有效
}
```

### 4.5 cli_client.js

**需要修改的逻辑**：
- 第 344 行：`action_required` case 改为从 `state.pendingAction` 获取
- 第 303-309 行：等待逻辑改为检查 `state.pendingAction`

### 4.6 test/human-player.test.js

**影响范围**：约 30+ 处引用需要更新
- 检查 `action_required` 消息 → 改为检查 `state.pendingAction`
- 位置：第 141, 175, 206, 208, 215, 304, 305, 345, 346, 350, 358, 394, 435, 495, 496, 497, 526, 534, 541, 579, 580, 581, 620, 684, 746, 804, 861, 866, 931, 989, 1036 行

---

## 五、边界情况

| 情况 | 预期行为 |
|------|----------|
| 无待处理请求 | `pendingAction: null` |
| 请求超时 | `_pendingRequests` 删除，`pendingAction` 自动为 null |
| 多个请求 | 取第一个 |
| 玩家已死亡 | `_pendingRequests` 中请求应被取消 |

---

## 六、验证要点

1. **刷新网页后**：能正确显示待处理行动（解决原有问题）
2. **正常游戏流程**：每个行动只收到一条 `state` 消息
3. **重连**：无需额外逻辑，`state` 自动包含
4. **测试通过**：所有测试用例正常通过

---

## 五、实施顺序

```
Step 1: engine/main.js
Step 2: server.js
Step 3: public/controller.js
Step 4: cli_client.js
Step 5: test/human-player.test.js
Step 6: 测试验证
```

> **注意**：public/app.js 无需改动，已从实施顺序中移除。

---

*文档版本：v2.0*
*更新时间：2026/04/12*