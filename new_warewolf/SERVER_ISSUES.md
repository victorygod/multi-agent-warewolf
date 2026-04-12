# Server 问题记录

## 问题 1：断开连接时取消待处理请求

**位置**：`server.js` 第 660 行

**代码**：
```javascript
ws.on('close', () => {
  const info = clients.get(ws);
  if (info) {
    console.log(`[WS] ${info.name} 断开连接`);
    // 取消待处理的请求
    if (game) {
      game.cancelPendingRequests(info.playerId);
    }
    playerClients.delete(info.playerId);
    clients.delete(ws);
  }
});
```

**影响**：CLI 客户端每次调用都会断开连接，导致待处理的请求被取消。重连后服务器会重新发送 `actionRequired`，但之前的操作没有生效。

**场景**：
1. CLI 发送查验请求 `--action seer --target 9`
2. CLI 断开连接
3. 服务器调用 `cancelPendingRequests` 取消请求
4. CLI 重连时，服务器重新发送 `actionRequired`
5. 查验操作未生效

---

## 问题 2：getReconnectAction 缺少狼人阶段处理

**位置**：`server.js` `getReconnectAction` 函数（第 384-518 行）

**缺失阶段**：
- `night_werewolf_discuss`：狼人讨论
- `night_werewolf_vote`：狼人投票

**影响**：狼人玩家重连时，无法获取行动请求，导致游戏卡住。

**现有处理**（其他阶段）：
```javascript
case 'seer':
  if (roleId === 'seer') {
    return { action: 'seer', checkedIds, allowedTargets };
  }
case 'witch':
  if (roleId === 'witch') {
    return { action: 'witch', ... };
  }
// ... 其他角色
```

**缺失**：
```javascript
case 'night_werewolf_discuss':
  if (roleId === 'werewolf') {
    // 需要返回 speak action
  }
  break;

case 'night_werewolf_vote':
  if (roleId === 'werewolf') {
    // 需要返回 vote action
  }
  break;
```

---

## 设计分析

### 为什么断开连接时取消请求？

**设计意图**：

1. **防止游戏卡住**：如果玩家断开连接且不再回来，他的待处理请求会一直挂着（`requestAction` 有 5 分钟超时），这会阻塞游戏流程。取消请求可以让游戏立即继续。

2. **资源释放**：`_pendingRequests` 是一个 Map，存储了 Promise 的 resolve/reject 函数。如果不清理，会导致内存泄漏。

3. **重连机制**：服务器设计了重连逻辑（`handleJoin` 中检测重连玩家），通过 `getReconnectAction` 重新发送行动请求。

### 网页客户端 vs CLI 客户端

| 特性 | 网页客户端 | CLI 客户端 |
|-----|-----------|-----------|
| 连接模式 | 长连接，断开后自动重连（3秒） | 短连接，每次调用都断开 |
| 请求生命周期 | 请求期间保持连接 | 请求后立即断开 |
| 重连时机 | 意外断开后重连 | 每次调用都是"重连" |

**网页客户端的流程**：
1. 建立连接，加入游戏
2. 收到 `actionRequired`，显示 UI
3. 用户操作，发送响应
4. 等待下一个 `actionRequired`
5. 如果断开，3秒后重连，服务器通过 `getReconnectAction` 恢复

**CLI 客户端的流程**：
1. 建立连接，加入游戏（重连）
2. 收到状态，如果有 `actionRequired` 则输出
3. 用户根据 `actionRequired` 决定操作
4. 发送响应
5. **立即断开连接** ← 问题所在
6. 下次调用时重新连接

### 问题根源

**CLI 的使用模式与服务器设计不匹配**：

1. CLI 发送响应后立即断开，服务器收到响应但还没处理完，连接就断了
2. 服务器在 `close` 事件中取消了该玩家的所有待处理请求
3. 如果响应已经 resolve 了 Promise，取消操作不影响；但如果响应还没处理完，可能会导致问题

**实际测试中发现**：
- `--speak` 命令成功（因为 `handleSpeak` 是同步的，消息已添加）
- `--action seer --target` 命令失败（响应被取消）

### 解决方案

**方案 A：完善 `getReconnectAction`**（推荐）

在 `getReconnectAction` 中补充缺失的阶段处理，让重连能正确恢复。这是最小改动，且不影响现有网页客户端。

**方案 B：CLI 保持长连接**

修改 CLI 客户端，不立即断开，而是等待一段时间（如 5 秒）或等待下一个状态。这需要修改 CLI 的设计。

**方案 C：服务器不取消请求**

移除 `cancelPendingRequests` 调用，让请求自然超时。但这可能导致游戏卡住 5 分钟。

---

## 真正的问题：CLI 时序问题

经过深入分析，发现真正的问题不是 `cancelPendingRequests`，而是 **CLI 的时序问题**：

### CLI 当前流程

```javascript
// 发送操作后
sendOperation(ws, args);

// 只等待 300ms 就输出状态
setTimeout(() => {
  ws.close();
  output(currentState, actionRequired, errorMessage);  // 输出的是旧状态！
  process.exit(0);
}, 300);
```

### 服务器流程

```
1. 收到 response
2. handleResponse resolve Promise
3. executeSkill 执行（更新 seerChecks，添加消息）
4. message.add 触发 'message:added' 事件
5. broadcastState 广播新状态
6. 客户端收到新状态
```

### 问题

CLI 在步骤 5 完成前就关闭连接并输出了 `currentState`，所以看到的是旧状态。

**这解释了为什么**：
- `--speak` 成功：因为 `handleSpeak` 是同步的，消息立即添加
- `--action seer --target` 失败：因为 CLI 输出时 `executeSkill` 还没执行完

### 正确的解决方案

CLI 应该等待收到服务器广播的新状态，而不是固定等待 300ms：

```javascript
// 发送操作后，等待新的 state 消息
sendOperation(ws, args);

// 设置标志，等待新状态
let waitingForNewState = true;

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.type === 'state' && waitingForNewState) {
    waitingForNewState = false;
    currentState = msg.data;
    // 继续等待可能的 action_required
    setTimeout(() => {
      ws.close();
      output(currentState, actionRequired, errorMessage);
      process.exit(0);
    }, 100);
  }
  // ... 其他消息处理
});
```

---

## 建议修复

### 修复问题 1（CLI）：等待新状态而不是固定时间

修改 `cli_client.js`，发送操作后等待收到新的 `state` 消息，而不是固定等待 300ms。

### 修复问题 2（Server）：补充 `getReconnectAction`

在 `server.js` 的 `getReconnectAction` 函数中添加：

```javascript
case 'night_werewolf_discuss':
  // 狼人讨论阶段，检查是否轮到该玩家发言
  if (roleId === 'werewolf' && state.currentSpeakerId === playerId) {
    return { action: 'speak' };
  }
  break;

case 'night_werewolf_vote':
  // 狼人投票阶段
  if (roleId === 'werewolf') {
    const allowedTargets = (state.players || [])
      .filter(p => p.alive && p.role?.camp !== 'wolf')
      .map(p => p.id);
    return { action: 'vote', allowedTargets };
  }
  break;
```