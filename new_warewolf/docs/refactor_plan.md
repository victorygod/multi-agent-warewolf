# 狼人杀项目重构计划：高内聚低耦合

## 一、现状分析（2026/04/12 更新）

### 1.1 当前架构

```
server.js (WebSocket + 业务逻辑)
    ↓ 调用
engine/main.js (GameEngine 核心)
    ↓ 调用
engine/phase.js (阶段流程)
    ↓ 调用
engine/config.js (规则配置)
engine/roles.js (角色定义)
```

### 1.2 当前问题（已简化）

| 问题 | 位置 | 说明 |
|------|------|------|
| **行动数据构建** | server.js:370-484 `buildActionData` | 115行，构建 action required 的数据 |
| **玩家加入逻辑** | server.js:194-265 | 可抽取为 engine 工厂方法 |

> ✅ `getReconnectAction` 已删除，重连逻辑已简化

### 1.3 可配置化程度

**已实现配置化：**
- ✅ 角色定义 (`engine/roles.js`)
- ✅ 阵营配置 (`engine/config.js: CAMPS`)
- ✅ 胜利条件 (`engine/config.js: WIN_CONDITIONS`)
- ✅ 规则开关 (`engine/config.js: RULES`)
- ✅ 阶段流程 (`engine/phase.js: PHASE_FLOW`)
- ✅ Hooks 扩展点 (`engine/config.js: HOOKS`)

**待配置化：**
- ⏳ 行动请求的 allowedTargets 计算 → `buildActionData`

---

## 二、重构目标

### 2.1 高内聚

- **GameEngine** 负责所有游戏状态和规则
- **PhaseManager** 负责流程控制
- **Server** 只负责 WebSocket 通信

### 2.2 低耦合

- Server 不包含任何游戏业务逻辑
- 前端只需调用 engine 暴露的 API
- 新增角色/阶段/规则只需修改配置

### 2.3 可扩展性

- 行动目标过滤 → 配置化
- 新角色技能 → roles.js + config.js

---

## 三、重构计划（精简版）

### 阶段一：配置化 buildActionData（核心）

**目标：** 将 `allowedTargets` 计算规则移入 config.js，删除 server.js 中的业务逻辑

**当前问题代码：**
```javascript
// server.js:380-391 - 守卫目标过滤硬编码
case 'guard': {
  const lastGuardTarget = self?.lastGuardTarget;
  const allowedTargets = (state.players || [])
    .filter(p => p && p.id !== playerId && p.alive && p.id !== lastGuardTarget)
    .map(p => p.id);
  return { ...baseData, lastGuardTarget, allowedTargets };
}
```

**改进方案：**

```javascript
// engine/config.js
const ACTION_FILTERS = {
  guard: (game, player) => {
    const lastTarget = player.state?.lastGuardTarget;
    return game.players
      .filter(p => p.id !== player.id && p.alive && p.id !== lastTarget)
      .map(p => p.id);
  },
  witch: (game, player, extraData) => {
    // 毒人目标：排除自己、狼人刀的目标、死亡玩家
    const werewolfTarget = extraData?.werewolfTarget;
    return game.players
      .filter(p => p.id !== player.id && p.id !== werewolfTarget && p.alive)
      .map(p => p.id);
  },
  vote: (game, player) => {
    // 白天投票：排除自己
    return game.players.filter(p => p.alive && p.id !== player.id).map(p => p.id);
  },
  wolf_vote: (game, player) => {
    // 狼人投票：所有存活玩家
    return game.players.filter(p => p.alive).map(p => p.id);
  },
  shoot: (game, player) => {
    // 猎人射击：排除自己
    return game.players.filter(p => p.alive && p.id !== player.id).map(p => p.id);
  },
  pass_badge: (game, player) => {
    // 警长传徽：排除自己、死亡玩家
    return game.players.filter(p => p.id !== player.id && p.alive).map(p => p.id);
  }
};
```

**engine/main.js 新增方法：**

```javascript
class GameEngine {
  // 构建行动请求的完整数据（替代 server.js 的 buildActionData）
  buildActionData(playerId, actionType, extraData = {}) {
    const player = this.players.find(p => p.id === playerId);
    const filter = this.config.hooks.ACTION_FILTERS?.[actionType];

    const baseData = {
      requestId: `${playerId}-${actionType}-${Date.now()}`,
      action: actionType
    };

    if (!filter) return baseData;

    const allowedTargets = filter(this, player, extraData);
    return { ...baseData, allowedTargets };
  }
}
```

**server.js 改动：**
- 删除 115 行 `buildActionData` 函数
- 改为调用 `game.buildActionData()`

---

### 阶段二：抽取玩家工厂方法

**目标：** 将玩家创建逻辑移入 engine

**当前代码：**
```javascript
// server.js:250-258
game.players.push({
  id: playerId,
  name,
  alive: true,
  isAI: false,
  role: null,
  state: {},
  debugRole: debugRole
});
```

**改进方案：**

```javascript
// engine/main.js
class GameEngine {
  addPlayer(name, options = {}) {
    const player = {
      id: this.players.length + 1,
      name,
      alive: true,
      isAI: options.isAI || false,
      role: null,
      state: {},
      debugRole: options.debugRole
    };
    this.players.push(player);
    return player;
  }
}
```

---

### 阶段三：配置化扩展验证

**目标：** 新增角色/规则时无需修改 engine 代码

**验证配置化能力：**

```javascript
// 新增"隐狼"角色示例
// 1. roles.js
const roles = {
  hidden_wolf: {
    id: 'hidden_wolf',
    name: '隐狼',
    camp: 'good', // 表面好人
    type: 'wolf', // 实际狼人
    skills: { ... }
  }
};

// 2. config.js - 阵营判断钩子
const HOOKS = {
  getCamp: (player, game) => {
    if (player.role.id === 'hidden_wolf') {
      return game.couples?.includes(player.id) ? 'third' : 'wolf';
    }
    return player.role.camp;
  }
};
```

---

## 四、预期效果

### 4.1 架构对比

| 维度 | 重构前 | 重构后 |
|------|--------|--------|
| server.js 行数 | ~520 行 | ~350 行 |
| 业务逻辑位置 | server + engine | engine 统一 |
| 目标过滤规则 | server 硬编码 | config.ACTION_FILTERS |
| 新增角色改动点 | 多处 | config + roles |

### 4.2 扩展性验证

| 场景 | 改动位置 |
|------|----------|
| 新增"隐狼"角色 | roles.js + config.js |
| 修改守卫规则 | config.js ACTION_FILTERS |
| 新增夜晚阶段 | phase.js PHASE_FLOW |

---

## 五、实施顺序

```
Phase 1: 配置化 ACTION_FILTERS（核心，1小时）
    ↓
Phase 2: 抽取玩家工厂方法（30分钟）
    ↓
Phase 3: 验证配置化扩展能力
```

**预计工作量：** 1.5-2 小时

---

## 六、风险与回退

| 风险 | 缓解措施 |
|------|----------|
| 目标过滤规则变更影响前端 | 保持 API 兼容 |
| 配置化后调试困难 | 保留 console.log |
| 测试覆盖不足 | 复用现有 60 个测试用例 |

---

*文档版本：v1.1*
*更新时间：2026/04/12*