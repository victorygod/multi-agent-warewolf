# 狼人杀游戏重构设计文档

## 一、设计目标

1. **规则完全可配置**：新增机制只需改配置，不改引擎代码
2. **引擎纯驱动**：gameEngine 只负责状态管理和驱动执行，不包含业务逻辑
3. **信息平等**：AI和人类通过统一接口获取信息和执行操作
4. **简洁优雅**：不过度封装，每个模块职责单一

---

## 二、目录结构

```
new_warewolf/
├── server.js              # Express API 入口
├── engine/                # 游戏引擎核心
│   ├── main.js            # GameEngine 纯驱动器
│   ├── phase.js           # 阶段执行器
│   ├── roles.js           # 角色定义
│   ├── message.js         # 消息管理
│   ├── event.js           # 事件系统
│   └── config.js          # 游戏配置
├── ai/                    # AI 玩家
│   ├── controller.js      # AI 调度器
│   ├── agent.js           # LLM 决策
│   └── profiles.js        # AI 人设
└── public/                # 前端
    ├── index.html
    ├── style.css
    ├── app.js             # UI 渲染
    └── controller.js      # 前端业务逻辑
```

---

## 三、核心模块

### 3.1 config.js - 业务逻辑配置

**职责**：定义所有业务规则。

**包含内容**：
- 阶段流程定义
- 角色定义（技能、约束、事件监听）
- 阵营定义与胜利条件
- 规则配置项（遗言、同守同救等）
- 钩子函数

### 3.2 main.js - 纯驱动器

**职责**：状态管理、驱动执行、触发事件。

**不包含**：任何业务逻辑。

**核心流程**：
```
游戏开始 → 进入第一阶段 → 检查条件 → 获取参与者 → 等待行动 → 阶段完成 → 决定下一阶段 → 循环
```

### 3.3 phase.js - 阶段执行器

**职责**：构建阶段流程，支持动态参与者、条件分支。

### 3.4 roles.js - 角色定义

**职责**：定义角色的技能、全局能力、约束、事件监听。

### 3.5 message.js - 消息管理

**职责**：消息存储、可见性控制。

**可见性类型**：
- `public`：所有人可见
- `self`：仅自己可见
- `camp`：同阵营可见
- `couple`：情侣互相可见

### 3.6 event.js - 事件系统

**职责**：发布订阅，让角色响应游戏事件。

**事件类型**：
- `game:start` - 游戏开始
- `phase:enter/leave` - 阶段进出
- `player:death` - 玩家死亡
- `player:vote` - 玩家投票
- `action:execute` - 技能执行

---

## 四、阶段配置

### 4.1 阶段属性

| 属性 | 说明 |
|------|------|
| `id` | 阶段标识 |
| `type` | speech/vote/target/choice/campaign/resolve |
| `getActors` | 返回可行动的玩家列表（函数） |
| `getVoters` | 返回有投票权的玩家列表（函数，投票阶段用） |
| `onComplete` | 阶段结束时调用，返回下一阶段ID |
| `condition` | 是否进入该阶段（函数） |
| `beforePhase` | 进入前调用，可暂停等待 |
| `getOrder` | 返回发言顺序（函数，发言阶段用） |
| `firstNight/firstDay` | 是否仅第一夜/第一天 |

### 4.2 阶段类型说明

| 类型 | 说明 | 完成条件 |
|------|------|---------|
| `speech` | 按顺序发言 | 所有人发言完毕 |
| `vote` | 并行投票 | 所有人投票完毕 |
| `target` | 选择一个目标 | 执行完毕 |
| `choice` | 多选一（如女巫） | 执行完毕或主动结束 |
| `campaign` | 选择是否参与（如上警） | 所有人选择完毕 |
| `resolve` | 结算（如夜晚结算） | 执行完毕 |

### 4.3 条件分支

阶段完成后，`onComplete` 函数决定下一阶段：

```
onComplete 返回值：
- 阶段ID字符串 → 进入该阶段
- null → 进入配置中的下一阶段
- 'end' → 游戏结束
```

**示例：警长投票后**
```
有唯一胜者 → 'day_announce'
平票且PK轮次未满 → 'sheriff_pk_speech'
平票且PK轮次已满 → 'day_announce'（无警长）
```

---

## 五、角色配置

### 5.1 角色属性

| 属性 | 说明 |
|------|------|
| `name` | 角色名称 |
| `camp` | 默认阵营（可被动态覆盖） |
| `skills` | 技能定义（按阶段ID索引） |
| `globalAbilities` | 全局能力（可在任意阶段触发） |
| `constraints` | 约束（如不能自爆、不能自刀） |
| `events` | 事件监听器 |
| `state` | 初始状态（如女巫药水数量） |

### 5.2 技能属性

| 属性 | 说明 |
|------|------|
| `type` | speech/vote/target/choice/double_target |
| `visibility` | 消息可见性 |
| `required` | 是否必须执行 |
| `validate` | 验证函数 |
| `execute` | 执行函数 |

### 5.3 全局能力

可在任意阶段触发的技能。

| 属性 | 说明 |
|------|------|
| `id` | 能力标识 |
| `availablePhases` | 可用阶段列表 |
| `canUse` | 是否可用（函数） |
| `execute` | 执行函数，返回流程控制 |

**执行返回值**：
```
{ action: 'continue' }           → 继续当前阶段
{ action: 'jumpToPhase', phase } → 跳转到指定阶段
```

### 5.4 角色约束

| 约束 | 说明 |
|------|------|
| `canExplode` | 能否自爆 |
| `canSelfKill` | 能否自刀 |

### 5.5 事件监听

角色可注册事件监听器，响应游戏事件。

**监听器返回值**：
```
无返回值 → 正常处理
{ cancel: true } → 取消事件（如白痴免疫放逐）
```

---

## 六、事件系统

### 6.1 内置事件

| 事件 | 触发时机 | 携带数据 |
|------|---------|---------|
| `game:start` | 游戏开始 | 无 |
| `phase:enter` | 进入阶段 | phase |
| `phase:leave` | 离开阶段 | phase |
| `player:death` | 玩家死亡 | player, reason |
| `player:vote` | 玩家投票 | voter, target |
| `action:execute` | 技能执行 | player, skill, target |

### 6.2 事件处理流程

```
触发事件 → 遍历所有角色的事件监听器 → 依次执行 → 检查返回值
```

---

## 七、钩子函数

### 7.1 生命周期钩子

| 钩子 | 触发时机 |
|------|---------|
| `onGameStart` | 游戏开始 |
| `onPhaseEnter` | 进入阶段 |
| `onPhaseLeave` | 离开阶段 |
| `onCycleEnd` | 一轮循环结束（夜晚→白天→夜晚） |
| `onPlayerDeath` | 玩家死亡后 |

### 7.2 业务钩子

| 钩子 | 用途 |
|------|------|
| `checkWin` | 胜负判定 |
| `getCamp` | 动态获取玩家阵营 |
| `getVoteWeight` | 投票权重（警长1.5票） |
| `canVote` | 是否有投票权 |
| `hasLastWords` | 是否有遗言 |
| `resolveNight` | 夜晚结算 |

---

## 八、规则配置项

### 8.1 女巫规则
- `canSelfHeal`：能否自救
- `canUseBothSameNight`：同晚能否用两种药

### 8.2 守卫规则
- `allowRepeatGuard`：是否允许连续守护同一人

### 8.3 猎人规则
- `canShootIfPoisoned`：被毒死能否开枪

### 8.4 同守同救规则
- `guardHealConflict`：返回 `'death'`（死亡）或 `'alive'`（存活）

### 8.5 遗言规则
- `hasLastWords(player, reason, game)`：判断是否有遗言

### 8.6 胜利条件
- `WIN_CONDITIONS[camp](game)`：各阵营胜利判定函数

---

## 九、状态存储

### 9.1 玩家状态（player.state）

| 角色 | 状态 |
|------|------|
| 女巫 | `{ heal: 1, poison: 1 }` |
| 守卫 | `{ lastGuardTarget: null }` |
| 摄梦人 | `{ lastDreamTarget: null }` |
| 乌鸦 | `{ lastCrowTarget: null }` |
| 竞选者 | `{ isCandidate: false, withdrew: false }` |
| 白痴 | `{ revealed: false, canVote: true }` |

### 9.2 全局状态（game）

| 状态 | 说明 |
|------|------|
| `werewolfTarget` | 狼人今晚目标 |
| `guardTarget` | 守卫今晚目标 |
| `couples` | 情侣ID列表 |
| `sheriff` | 警长ID |
| `sheriffOrder` | 警长指定的发言顺序 |
| `dreamTarget` | 摄梦人今晚目标 |
| `crowTarget` | 乌鸦今晚目标 |
| `enabledGlobalAbilities` | 当前可用的全局能力 |

---

## 十、引擎核心流程

```
游戏开始
    ↓
进入第一阶段
    ↓
beforePhase 检查 → 需要等待 → 等待特定玩家操作
    ↓ 通过
condition 检查 → 不满足 → 调用 onComplete 获取下一阶段
    ↓ 满足
getActors 获取参与者
    ↓
参与者为空且非公共阶段 → 跳过
    ↓ 有参与者
等待玩家行动
    ↓
检查全局能力是否可用 → 可用 → 等待玩家使用
    ↓
玩家行动完成 → isPhaseComplete?
    ↓ 完成
调用 onComplete → 获取下一阶段
    ↓
触发 phase:leave 事件
    ↓
检查胜负 → 有胜者 → 游戏结束
    ↓ 无胜者
进入下一阶段
```

---

## 十一、前后端 Controller

### 11.1 接口对齐

AI Controller 和前端 Controller 提供相同的方法：

| 方法 | 说明 |
|------|------|
| `getState()` | 获取当前状态 |
| `speak(content)` | 发言 |
| `vote(targetId)` | 投票 |
| `abstain()` | 弃权 |
| `useSkill(data)` | 使用技能 |
| `useGlobalAbility(abilityId, data)` | 使用全局能力 |

### 11.2 AI Controller

后端直接操作 gameEngine。

### 11.3 前端 Controller

通过 API 调用后端，方法签名与 AI Controller 一致。

---

## 十二、模拟验证结果

| 模拟场景 | 复杂度 | 结果 |
|---------|--------|------|
| 标准9人局 | ⭐ | ✅ 通过 |
| 警长竞选12人 | ⭐⭐ | ✅ 通过 |
| 丘比特情侣12人 | ⭐⭐ | ✅ 通过 |
| 狼美人骑士12人 | ⭐⭐⭐ | ✅ 通过 |
| 预女猎白12人 | ⭐⭐ | ✅ 通过 |
| 18人复杂局 | ⭐⭐⭐⭐ | ✅ 通过 |

**框架能力**：
- ✅ 动态参与者/投票权
- ✅ 条件分支流程
- ✅ 全局能力
- ✅ 事件系统
- ✅ 角色约束
- ✅ 流程跳转
- ✅ 事件取消

---

## 十三、新增机制流程

### 示例：新增警长机制

1. 在 `PHASE_FLOW` 添加阶段：`sheriff_campaign` → `sheriff_speech` → `sheriff_withdraw` → `sheriff_vote` → `sheriff_pk_*`
2. 添加钩子：`getVoteWeight` 返回 1.5
3. 添加全局能力：`set_order`（指定发言顺序）
4. 添加事件监听：警长死亡时处理警徽流转

### 示例：新增角色

1. 在 `ROLES` 添加角色定义
2. 定义技能、约束、事件监听
3. 如有新阵营，添加胜利条件
4. 如有新阶段，添加到 `PHASE_FLOW`

---

## 十四、待确认

1. 是否可以开始实现？
2. 是否有其他需要补充的设计？