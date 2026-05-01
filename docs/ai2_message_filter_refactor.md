# AI2 消息过滤重构：shouldAnalyzeMessage 移入 Agent

## 目标

将消息分析判断从 Controller 层移入 Agent 层，同时将可见性判断保留在 Controller 层，实现职责分离。

## 核心思路

消息到达后经过两层过滤：

| 层 | 过滤逻辑 | 含义 |
|---|---|---|
| Controller (`onMessageAdded`) | visibility 过滤（public/self/camp/couple） | 消息对该玩家是否可见 |
| Agent (`_handleRequest`) | ANALYSIS_NODES 类型过滤 + 自身消息 | 可见消息是否需要触发分析 |

## 改动清单

### 1. `AIManager.onMessageAdded()` — 只做可见性过滤

**文件**: `ai2/controller.js` (line 223-228)

```js
// 改前
onMessageAdded(msg) {
  for (const controller of this.controllers.values()) {
    if (controller.shouldAnalyzeMessage(msg, controller.playerId)) {
      controller.enqueueMessage(msg);
    }
  }
}

// 改后
onMessageAdded(msg) {
  for (const controller of this.controllers.values()) {
    if (controller.isMessageVisible(msg)) {
      controller.enqueueMessage(msg);
    }
  }
}
```

### 2. `AIController` 新增 `isMessageVisible()` — 可见性判断

**文件**: `ai2/controller.js`

```js
isMessageVisible(msg) {
  if (msg.visibility === 'public') return true;
  if (msg.visibility === 'self') {
    return msg.playerId === this.playerId;
  }
  if (msg.visibility === 'camp') {
    const selfPlayer = this.game?.players?.find(p => p.id === this.playerId);
    const sender = this.game?.players?.find(p => p.id === msg.playerId);
    if (!selfPlayer || !sender) return false;
    const selfCamp = this.game?.config?.hooks?.getCamp(selfPlayer, this.game);
    const senderCamp = this.game?.config?.hooks?.getCamp(sender, this.game);
    return selfCamp === senderCamp;
  }
  if (msg.visibility === 'couple' || msg.visibility === 'cupidIdentity') {
    return this.game?.couples?.includes(this.playerId);
  }
  return true;
}
```

### 3. `AIController.enqueueMessage()` — request 带上 `msg` 和 `selfPlayerId`

**文件**: `ai2/controller.js` (line 167-169)

```js
// 改前
enqueueMessage(msg) {
  const context = this.buildContext({ actionType: 'analyze' });
  this.agent.enqueue({ type: 'analyze', context, callback: null });
}

// 改后
enqueueMessage(msg) {
  const context = this.buildContext({ actionType: 'analyze' });
  this.agent.enqueue({ type: 'analyze', context, callback: null, msg, selfPlayerId: this.playerId });
}
```

### 4. `Agent._handleRequest()` — analyze 前先判断

**文件**: `ai2/agent/agent.js` (line 95-103)

```js
// 改后
async _handleRequest(request) {
  const { type, context, callback } = request;
  if (type === 'decide') {
    const action = await this.answer(context, 'decide');
    callback?.(action);
  } else if (type === 'analyze') {
    if (!this.shouldAnalyzeMessage(request.msg, request.selfPlayerId)) {
      callback?.(null);
      return;
    }
    const analysis = await this.answer(context, 'analyze');
    callback?.(analysis);
  }
}
```

### 5. `Agent.shouldAnalyzeMessage()` — 去掉可见性逻辑，去掉 `game` 参数

**文件**: `ai2/agent/agent.js` (line 310-329)

```js
// 改前
shouldAnalyzeMessage(msg, selfPlayerId, game) {
  if (!ANALYSIS_NODES.includes(msg.type)) return false;
  if (msg.playerId === selfPlayerId) return false;
  if (msg.visibility === 'self') return false;
  if (msg.visibility === 'camp') {
    const selfPlayer = game?.players?.find(p => p.id === selfPlayerId);
    const sender = game?.players?.find(p => p.id === msg.playerId);
    if (!selfPlayer || !sender) return false;
    const selfCamp = game?.config?.hooks?.getCamp(selfPlayer, game);
    const senderCamp = game?.config?.hooks?.getCamp(sender, game);
    if (selfCamp !== senderCamp) return false;
  }
  if (msg.visibility === 'couple' || msg.visibility === 'cupidIdentity') {
    if (!game?.couples?.includes(selfPlayerId)) return false;
  }
  return true;
}

// 改后：只保留类型过滤 + 自身消息过滤
shouldAnalyzeMessage(msg, selfPlayerId) {
  if (!ANALYSIS_NODES.includes(msg.type)) return false;
  if (msg.playerId === selfPlayerId) return false;
  return true;
}
```

### 6. 删除 `AIController.shouldAnalyzeMessage()` 代理方法

**文件**: `ai2/controller.js` (line 156-158)

删除以下代码：

```js
shouldAnalyzeMessage(msg, selfPlayerId) {
  return this.agent.shouldAnalyzeMessage(msg, selfPlayerId, this.game);
}
```

### 7. 更新测试

- `shouldAnalyzeMessage` 测试：去掉 camp/couple/self visibility 相关用例（已移到 Controller 层），只测 ANALYSIS_NODES 和自身消息过滤
- 新增 `isMessageVisible` 测试：覆盖 public/self/camp/couple 场景
- 新增 Agent `_handleRequest` 测试：不需要分析的消息入队后跳过处理

## 改动文件汇总

| 文件 | 改动 |
|---|---|
| `ai2/controller.js` | `onMessageAdded` 改用 `isMessageVisible`；新增 `isMessageVisible` 方法；`enqueueMessage` 带 msg 和 selfPlayerId；删除 `shouldAnalyzeMessage` 代理 |
| `ai2/agent/agent.js` | `_handleRequest` 增加 analyze 前的 shouldAnalyzeMessage 判断；`shouldAnalyzeMessage` 去掉可见性逻辑和 game 参数 |
| `test/ai_integration.test.js` | 适配 `isMessageVisible` + `shouldAnalyzeMessage` 新签名 |
| `test/ai_analysis.test.js` | 同上 |