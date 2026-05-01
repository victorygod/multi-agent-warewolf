# ServerCore 重构设计文档

## 背景

当前 `server.js` 将所有逻辑内联在闭包中，导致：
- 测试需要复制粘贴代码（`test/human-player.test.js` 中的 `createServer`）
- 无法复用 server.js 的业务逻辑
- 测试与生产代码可能不一致

## 目标

1. **server.js 保持纯净**：业务逻辑零测试代码污染
2. **接口可扩展**：通过 wrapper 外挂测试能力
3. **测试可复用**：wrapper 直接复用 ServerCore 逻辑

## 架构设计

```
┌─────────────────────────────────────────┐
│           Test Wrapper                  │
│  (test/server-wrapper.js)               │
│  - MockModel 注入                        │
│  - 强制角色分配                          │
│  - 测试断言辅助                          │
├─────────────────────────────────────────┤
│           ServerCore                    │
│  (server.js 导出)                       │
│  - 纯业务逻辑，零测试代码                 │
│  - 可覆盖的钩子方法                      │
├─────────────────────────────────────────┤
│           生产入口                       │
│  (server.js 底部)                       │
│  if (require.main === module) {         │
│    new ServerCore().start();            │
│  }                                      │
└─────────────────────────────────────────┘
```

## ServerCore 功能清单

### 核心职责

| 功能 | 说明 | 对应现有代码 |
|------|------|-------------|
| HTTP 服务 | 静态文件、API 路由 | 第50-81行 |
| WebSocket 管理 | 连接、消息路由 | 第84-479行 |
| 游戏生命周期 | 创建、开始、重置 | 第87-89行, 第222-230行 |
| 玩家管理 | 加入、重连、断开 | 第216-273行, 第457-464行 |
| AI 管理 | 创建、ID 映射更新 | 第325-425行 |
| 消息广播 | 状态同步、事件通知 | 第113-128行, 第175-179行 |

### 可覆盖钩子（供 Wrapper 使用）

| 钩子 | 触发时机 | 默认行为 | Wrapper 用途 |
|------|---------|---------|-------------|
| `createAIManager(game)` | 游戏创建时 | `new AIManager(game)` | 可返回带自定义配置的 AIManager |
| `createAI(aiManager, playerId, options)` | 添加 AI 时 | 根据环境变量选择 llm/random | 强制使用 MockModel |
| `onBeforeAssignRoles()` | 角色分配前 | 空 | 注入 debugRole 逻辑 |
| `onAfterAssignRoles()` | 角色分配后 | 更新 ID 映射 | 强制修改角色、同步外部状态 |
| `getAgentType()` | 创建 AI 时 | 读取环境变量 | 强制返回 'mock' |
| `shouldAutoStart()` | 人满时 | 返回 true | 测试时返回 false，手动控制 |

## 接口设计

### ServerCore 类

```javascript
class ServerCore {
  constructor(options = {}) {
    this.port = options.port || 3000;
    this.game = null;
    this.aiManager = null;
    this.clients = new Map();
    this.playerClients = new Map();
    this.currentPresetId = null;
  }

  // 生命周期
  async start() { }
  stop() { }
  reset() { }

  // 游戏控制
  createGame(presetId) { }
  startGame() { }
  assignRoles() { }

  // 玩家管理
  handleJoin(ws, msg) { }
  handleAddAI(ws, msg) { }
  handleResponse(ws, msg) { }
  handleDisconnect(ws) { }

  // 消息
  broadcastState() { }
  sendToPlayer(playerId, type, data) { }

  // 可覆盖钩子
  createAIManager(game) { return new AIManager(game); }
  createAI(aiManager, playerId, options) { }
  onBeforeAssignRoles() { }
  onAfterAssignRoles() { }
}
```

### TestServerWrapper 类

```javascript
class TestServerWrapper {
  constructor(port, options = {}) {
    this.core = new ServerCore({ port });
    this.mockOptions = options.mockOptions;
    this.forcedRoles = new Map(); // playerName -> roleId

    // 覆盖钩子
    this.core.createAI = this._createMockAI.bind(this);
    this.core.onAfterAssignRoles = this._applyForcedRoles.bind(this);
  }

  // 测试便捷方法
  async addHuman(name, options = {}) { }
  async addAI(count, options = {}) { }
  async startGame() { }
  async waitForPhase(phaseId, timeout) { }
  async waitForPlayerAction(playerId, actionType, timeout) { }

  // 状态查询
  getGame() { return this.core.game; }
  getPlayer(playerId) { }
  getMessages(playerId) { }

  // 控制
  setMockOptions(options) { }
  setForcedRole(playerName, roleId) { }
  setPreset(presetId) { }
}
```

## 改造步骤

### Phase 1: 提取 ServerCore（低风险）

1. 创建 `ServerCore` 类，将 server.js 逻辑移入
2. server.js 底部保留生产启动代码
3. 导出 `ServerCore`
4. 验证生产启动正常

### Phase 2: 创建 Wrapper（中风险）

1. 创建 `test/server-wrapper.js`
2. 实现 `TestServerWrapper` 类
3. 覆盖钩子实现 MockModel 注入
4. 实现测试便捷方法

### Phase 3: 迁移测试（高风险）

1. 修改 `test/human-player.test.js`
2. 使用 `TestServerWrapper` 替代 `createServer`
3. 删除 `createServer` 函数（~200行）
4. 验证所有测试通过

### Phase 4: 优化（可选）

1. 添加更多测试便捷方法
2. 提取通用的 MockOptions
3. 支持更多测试场景

## 代码变更预估

| 文件 | 变更 | 行数变化 |
|------|------|---------|
| `server.js` | 提取 ServerCore 类 | -50（去除内联） |
| `server.js` | 添加导出 | +5 |
| `test/server-wrapper.js` | 新建 | ~200 |
| `test/human-player.test.js` | 使用 wrapper | -150（删除 createServer） |

## 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| 重构引入 bug | 高 | 改造前确保测试 100% 通过，每阶段验证 |
| 性能下降 | 低 | 只是代码组织变化，无额外运行时开销 |
| 接口不稳定 | 中 | 先实现最小可用版本，稳定后再扩展 |
| 生产启动失败 | 高 | 保留 `if (require.main === module)` 逻辑 |

## 决策点

### 1. 是否保留现有测试服务器？

直接替换（推荐，代码更少）

### 2. Wrapper 覆盖方式？

组合 + 钩子覆盖（推荐，server.js 更纯净）

### 3. 是否支持多房间？

- **当前**：单游戏实例
- **未来**：如需多房间，ServerCore 需支持多 GameEngine 实例

## 下一步

1. **Review 本文档** - 确认设计符合预期
2. **Phase 1 实施** - 提取 ServerCore
3. **Review PR** - 验证生产启动正常
4. **Phase 2-3 实施** - 创建 wrapper，迁移测试

---

**文档版本**: v1.0  
**作者**: Claude  
**日期**: 2025-04-28
