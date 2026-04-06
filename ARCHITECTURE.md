# 狼人杀游戏系统架构文档

## 一、项目概况

基于 Node.js 的在线狼人杀游戏，支持人类玩家和 AI 玩家混合游戏。

**技术栈**:
- 后端: Node.js + Express 4.18
- 前端: 原生 JavaScript + SSE (Server-Sent Events)
- AI: 兼容 Anthropic 接口的大语言模型 API

**目录结构**:
```
wolf/
├── server.js          # Express 服务器入口，API 路由
├── api_key.conf       # API 配置（base_url, auth_token, model）
├── game/              # 游戏核心逻辑
│   ├── engine.js      # 游戏状态机引擎（核心）
│   ├── roles.js       # 角色定义和配置
│   └── messages.js    # 消息管理系统
├── ai/                # AI 玩家逻辑
│   ├── controller.js  # AI 控制器（调度）
│   ├── agent.js       # AI Agent 实现（决策）
│   └── profiles.js    # AI 人设配置
└── public/            # 前端
    ├── index.html     # 页面结构
    ├── app.js         # 前端逻辑
    └── style.css      # 样式
```

---

## 二、游戏规则

### 2.1 角色配置

| 角色 | 英文 | 阵营 | 能力 |
|------|------|------|------|
| 狼人 | werewolf | wolf | 夜间讨论并选择击杀目标 |
| 预言家 | seer | god | 每晚查验一人身份（狼人/好人） |
| 女巫 | witch | god | 一瓶解药（救人）、一瓶毒药（杀人） |
| 守卫 | guard | god | 每晚守护一人，不能连续守护同一人 |
| 猎人 | hunter | god | 死亡时可开枪带走一人（被毒死不能开枪） |
| 村民 | villager | villager | 无特殊能力 |

### 2.2 人数配置

| 人数 | 狼人 | 预言家 | 女巫 | 守卫 | 猎人 | 村民 |
|------|------|--------|------|------|------|------|
| 9人 | 3 | 1 | 1 | 0 | 1 | 3 |
| 12人 | 4 | 1 | 1 | 1 | 1 | 4 |
| 16人 | 5 | 1 | 1 | 1 | 1 | 7 |

### 2.3 游戏阶段

```
WAITING                    # 等待玩家
NIGHT_WEREWOLF_DISCUSS     # 狼人讨论
NIGHT_WEREWOLF_VOTE        # 狼人投票
NIGHT_SEER                 # 预言家查验
NIGHT_WITCH                # 女巫行动
NIGHT_GUARD                # 守卫守护
DAY_DISCUSS                # 白天讨论
DAY_VOTE                   # 白天投票
VOTE_RESULT                # 投票结果
LAST_WORDS                 # 遗言
HUNTER_SHOOT               # 猎人开枪
GAME_OVER                  # 游戏结束
```

### 2.4 胜负判定

- **好人胜**: 所有狼人死亡
- **狼人胜**: 所有神职死亡 或 所有村民死亡

### 2.5 遗言规则

- 第一天白天被放逐可以留遗言
- 第一夜被狼人杀死可以留遗言
- 被女巫毒死不能留遗言
- 猎人被毒死不能开枪

---

## 三、系统行为链路

### 3.1 整体架构图

```
┌──────────────────────────────────────────────────────────────────┐
│                         用户界面 (public/app.js)                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │ 设置面板    │  │ 玩家列表    │  │ 消息区域    │              │
│  │ (名字/人数) │  │ (状态显示)  │  │ (发言/公告) │              │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘              │
│         │                │                │                      │
│  ┌──────┴────────────────┴────────────────┴──────┐              │
│  │              操作区域 (发言/投票/技能)         │              │
│  └───────────────────┬───────────────────────────┘              │
└──────────────────────┼──────────────────────────────────────────┘
                       │ HTTP/SSE
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│                      Express 服务器 (server.js)                  │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  API 路由 + SSE 管理                                        │ │
│  │  • POST /api/ready → game.start() → broadcast()             │ │
│  │  • POST /api/speak → game.speak() → broadcast()             │ │
│  │  • GET /events → SSE 连接管理                               │ │
│  └─────────────────────────────────────────────────────────────┘ │
│         │                        │                               │
│         ▼                        ▼                               │
│  ┌─────────────┐          ┌─────────────┐                       │
│  │ GameEngine  │◄────────►│AIController │                       │
│  │ (状态机)    │          │ (AI调度)    │                       │
│  └──────┬──────┘          └──────┬──────┘                       │
│         │                        │                               │
│         ▼                        ▼                               │
│  ┌─────────────┐          ┌─────────────┐                       │
│  │MessageManager│         │  AIAgent    │                       │
│  │ (消息管理)  │          │ (LLM决策)   │                       │
│  └─────────────┘          └─────────────┘                       │
└──────────────────────────────────────────────────────────────────┘
                                │
                                ▼ LLM API
                    ┌─────────────────────┐
                    │  大语言模型 API      │
                    │  (Anthropic兼容)    │
                    └─────────────────────┘
```

### 3.2 游戏流程图

```
WAITING
  ↓ (人数满)
NIGHT_WEREWOLF_DISCUSS → NIGHT_WEREWOLF_VOTE → NIGHT_SEER → NIGHT_WITCH → NIGHT_GUARD
  ↓ (夜晚结算)
[LAST_WORDS?] → [HUNTER_SHOOT?] → DAY_DISCUSS → DAY_VOTE → VOTE_RESULT
  ↓                                           ↓
[LAST_WORDS?] → [HUNTER_SHOOT?] → 回到夜晚   [GAME_OVER 或 进入下一轮]
```

### 3.3 完整游戏流程

```
1. 前端调用 /api/ready → 后端 game.join() + game.addAIPlayers()
2. 人齐后 game.start() → 分配角色，进入 NIGHT_WEREWOLF_DISCUSS
3. SSE 广播状态 → 前端更新 UI
4. aiController.processAITurn() → AI 开始行动
5. 狼人发言 → game.speak() → 阶段推进
6. 狼人投票 → game.vote() → 统计并决定目标
7. 预言家查验 → game.seerCheck() → 返回结果
8. 女巫行动 → game.witchAction() → 救人/毒人
9. 守卫守护 → game.guardProtect()
10. 夜晚结算 → resolveNight() → 计算死亡
11. 白天讨论 → 依次发言
12. 白天投票 → 放逐
13. 检查胜负 → 循环或结束
```

---

## 四、核心模块详解

### 4.1 游戏引擎 (game/engine.js)

**核心职责**: 游戏状态机，负责游戏规则、阶段流转和胜负判定

**核心属性**:
| 属性 | 类型 | 说明 |
|------|------|------|
| `players[]` | Array | 玩家列表 (id, name, isAI, role, alive, soul, deathReason) |
| `dayCount` | Number | 当前天数 |
| `currentSpeakerIndex` | Number | 当前发言者索引 |
| `votes{}` | Object | 投票记录 |
| `nightActions{}` | Object | 夜间行动记录 |
| `witchPotion` | Object | 女巫药水状态 {heal, poison} |
| `deadTonight[]` | Array | 今晚死亡玩家 |
| `lastGuardedId` | Number | 上回合守护目标 (守卫不能连续守护同一人) |

**关键方法**:
| 方法 | 功能 |
|------|------|
| `join(playerId, name, isAI, soul)` | 玩家加入 |
| `start(debugConfig)` | 开始游戏，分配角色 |
| `speak(playerId, content)` | 发言处理 |
| `vote(voterId, targetId)` | 投票处理 |
| `seerCheck(seerId, targetId)` | 预言家查验 |
| `witchAction(witchId, action, targetId)` | 女巫行动 |
| `guardProtect(guardId, targetId)` | 守卫守护 |
| `lastWords(playerId, content)` | 发表遗言 |
| `hunterShoot(hunterId, targetId)` | 猎人开枪 |
| `advancePhase()` | **阶段推进核心逻辑** |
| `resolveNight()` | 夜晚结算（计算死亡） |
| `checkWinCondition()` | 胜负判定 |
| `getState(forPlayerId)` | 获取游戏状态（按权限过滤） |
| `getAIContext(aiPlayerId)` | 获取 AI 上下文 |

### 4.2 消息系统 (game/messages.js)

**核心职责**: 统一管理所有消息的生成、存储和可见性控制

**消息类型**:
| 类型 | 英文 | 可见性 |
|------|------|--------|
| 普通发言 | speech | public |
| 狼人夜间发言 | wolf_speech | werewolf |
| 投票 | vote | private |
| 技能使用 | skill_use | private |
| 技能结果 | skill_result | private |
| 阶段开始 | phase_start | public |
| 死亡公告 | death | public |
| 放逐公告 | exile | public |
| 游戏结束 | game_over | public |
| 遗言 | last_words | public |

### 4.3 AI 控制器 (ai/controller.js)

**核心职责**: 调度所有 AI 玩家的行动，处理并发控制

**处理流程**:
```
processAITurn(game, broadcast)
  │
  ├─→ 发言阶段: handleSpeech() → AI 发言
  │
  ├─→ 投票阶段: handleVote() → AI 并行决策，串行提交
  │
  ├─→ 技能阶段: handleSkill() → 预言家/女巫/守卫行动
  │
  ├─→ 遗言阶段: handleLastWords() → AI 发表遗言
  │
  └─→ 猎人开枪: handleHunterShoot() → AI 决定是否开枪
```

**关键特性**:
- **并发控制**: `processing` 标志防止重复处理
- **并行请求**: 投票时 AI 并行请求 LLM，提高效率
- **降级策略**: API 不可用时使用随机决策

### 4.4 AI Agent (ai/agent.js)

**核心职责**: AI 决策核心，通过 LLM 生成行动

**决策流程**:
```
getAction(context)
  │
  ├─→ buildMessages() → 构建 system + user prompt
  │
  ├─→ callAPI() → 调用 LLM API
  │
  └─→ parseResponse() → 解析 JSON 响应
       │
       └─→ 失败时回退: getRandomAction()
```

**响应格式**:
```javascript
// 发言
{"type": "speech", "content": "发言内容"}

// 投票
{"type": "vote", "target": 3}  // 位置编号

// 女巫行动
{"type": "witch", "action": "heal/poison/skip", "target": 5}

// 弃权/跳过
{"type": "skip"}
```

### 4.5 服务器 (server.js)

**API 接口**:
| 接口 | 方法 | 功能 |
|------|------|------|
| `/api/state` | GET | 获取游戏状态 |
| `/api/join` | POST | 玩家加入 |
| `/api/ready` | POST | 一键准备 |
| `/api/start` | POST | 开始游戏 |
| `/api/speak` | POST | 发言 |
| `/api/vote` | POST | 投票 |
| `/api/seer-check` | POST | 预言家查验 |
| `/api/witch-action` | POST | 女巫行动 |
| `/api/guard-protect` | POST | 守卫守护 |
| `/api/last-words` | POST | 发表遗言 |
| `/api/hunter-shoot` | POST | 猎人开枪 |
| `/api/hunter-skip` | POST | 猎人不开枪 |
| `/api/reset` | POST | 重置游戏 |
| `/events` | GET | SSE 事件流 |

**SSE 广播机制**:
```javascript
function broadcast(event, data) {
  sseClients.forEach((client, clientId) => {
    const playerState = game.getState(client.playerId);
    client.res.write(`event: ${event}\n ${JSON.stringify(playerState)}\n\n`);
  });
}
```

---

## 五、设计模式

| 模式 | 应用场景 |
|------|----------|
| 状态机模式 | 游戏阶段通过 `advancePhase()` 严格流转 |
| 观察者模式 | SSE 实现状态广播，前端订阅更新 |
| 代理模式 | AI Agent 代理人类玩家行为 |
| 权限过滤 | `getState(playerId)` 按角色过滤可见信息 |
| 消息队列 | `MessageManager` 统一管理消息历史和可见性 |

---

## 六、关键代码路径

### 6.1 夜晚结算逻辑 (resolveNight)

```
1. 收集夜间行动:
   - 狼人击杀目标 (nightActions.werewolfKill)
   - 女巫解药使用 (nightActions.witchHeal)
   - 女巫毒药使用 (nightActions.witchPoison)
   - 守卫守护目标 (nightActions.guardProtect)

2. 计算死亡:
   - 被守护的玩家免疫狼刀
   - 女巫解药可救狼刀目标
   - 毒药必定致死
   - 同守同救: 守卫和女巫同时作用，女巫解药无效

3. 处理遗言和猎人:
   - 判断是否可以留遗言
   - 判断猎人是否可以开枪

4. 推进阶段:
   - 有遗言 → LAST_WORDS
   - 猎人可开枪 → HUNTER_SHOOT
   - 否则 → DAY_DISCUSS
```

### 6.2 阶段推进逻辑 (advancePhase)

```
当前阶段 → 下一阶段判断:

NIGHT_WEREWOLF_DISCUSS:
  - 所有狼人发言完毕 → NIGHT_WEREWOLF_VOTE

NIGHT_WEREWOLF_VOTE:
  - 所有狼人投票完毕 → 统计票数，决定击杀目标 → NIGHT_SEER

NIGHT_SEER:
  - 预言家查验完毕 → NIGHT_WITCH (有女巫) / NIGHT_GUARD (无女巫有守卫) / DAY_DISCUSS

NIGHT_WITCH:
  - 女巫行动完毕 → NIGHT_GUARD (有守卫) / DAY_DISCUSS

NIGHT_GUARD:
  - 守卫守护完毕 → resolveNight() → 计算死亡

DAY_DISCUSS:
  - 所有人发言完毕 → DAY_VOTE

DAY_VOTE:
  - 所有人投票完毕 → VOTE_RESULT

VOTE_RESULT:
  - 显示投票结果 → 检查胜负 → LAST_WORDS (被放逐者可留遗言) / HUNTER_SHOOT / 下一轮夜晚

LAST_WORDS:
  - 遗言完毕 → HUNTER_SHOOT (猎人可开枪) / 检查胜负 / 下一阶段

HUNTER_SHOOT:
  - 猎人开枪完毕 → 检查胜负 / 下一阶段
```

---

## 七、待重构关注点

1. **engine.js 过大**: 状态机逻辑、角色技能、阶段流转全部耦合在一个文件
2. **AI 调度复杂**: controller.js 处理了太多阶段判断逻辑
3. **消息可见性分散**: 消息过滤逻辑在多处重复
4. **状态过滤逻辑**: getState() 中的权限过滤逻辑复杂
5. **测试覆盖**: 缺少单元测试