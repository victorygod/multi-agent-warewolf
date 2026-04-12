# 统一技能系统改造计划

## 背景

当前代码中存在多种角色能力调用方式，导致 `roles.js` 中定义了大量死代码，且调用方式不一致：
- `callSkill` - 规范方式，但只覆盖部分技能
- `controller.xxx()` - 直接调用 controller 方法
- 直接操作 game 状态 - 最底层方式

## 调查结果

### 一、当前调用方式分类

| 调用方式 | 使用场景 | 位置 | 状态 |
|---------|---------|------|------|
| `callSkill` | 丘比特、守卫、女巫、预言家、猎人开枪、狼人自爆、警长传警徽 | phase.js | ✅ 规范 |
| `callSpeech` | 狼人讨论、竞选发言、遗言、白天讨论 | phase.js | ⚠️ 需评估 |
| `callVote` | 狼人投票、白天投票 | phase.js | ⚠️ 需评估 |
| `controller.campaign()` | 警长竞选 | phase.js:167 | ❌ 需改造 |
| `controller.withdraw()` | 警长退水 | phase.js:210 | ❌ 需改造 |
| `callSkill` (assignOrder) | 警长指定发言顺序 | phase.js | ✅ 规范 |

### 二、roles.js 技能使用情况

| 技能 | 定义位置 | 调用方式 | 状态 |
|------|---------|---------|------|
| `seer` | roles.js:30 | `callSkill` | ✅ 使用中 |
| `witch` | roles.js:73 | `callSkill` | ✅ 使用中 |
| `shoot` | roles.js:124 | `callSkill` | ✅ 使用中 |
| `cupid` | roles.js:234 | `callSkill` | ✅ 使用中 |
| `guard` | roles.js:174 | `callSkill` | ✅ 使用中 |
| `explode` | roles.js:275 | `callSkill` | ✅ 使用中 |
| `passBadge` | ATTACHMENTS.sheriff | `callSkill` | ✅ 使用中 |
| `campaign` | ATTACHMENTS.sheriff | `callSkill` | ✅ 使用中 |
| `withdraw` | ATTACHMENTS.sheriff | `callSkill` | ✅ 使用中 |
| `assignOrder` | ATTACHMENTS.sheriff | `callSkill` | ✅ 使用中 |

### 三、PlayerController 方法分布

**AIPlayerController 和 HumanPlayerController 当前实现：**
- `getSpeechResult()` - 获取发言决策
- `getVoteResult()` - 获取投票决策
- `useSkill()` - 使用技能（统一入口）
- `campaign()` - 竞选警长（AI 决策）
- `withdraw()` - 退水（AI 决策）

**已删除的死代码方法：**
- ~~`speak()`~~ - 通过 `callSpeech` 统一调用
- ~~`vote()`~~ - 通过 `callVote` 统一调用
- ~~`chooseSpeakerOrder()`~~ - 改为 `assignOrder` 技能
- ~~`shoot()`~~ - 通过 `callSkill` 调用
- ~~`passBadge()`~~ - 通过 `callSkill` 调用
- ~~`cupidLink()`~~ - 通过 `callSkill` 调用
- ~~`witchAction()`~~ - 通过 `callSkill` 调用

**问题**：`callSkill` 只使用 `useSkill()`，其他方法都是独立的，导致：
1. 代码重复（每个 controller 都要实现一遍）
2. 调用方式不一致
3. 无法统一处理超时、重连等逻辑

## 改造方案

### 目标
统一通过 `callSkill` 调用所有角色能力

### 具体措施

1. **将 campaign/withdraw/assignOrder 改造为技能调用**
   - 修改 phase.js 调用方式
   - 确保 roles.js 技能定义完整

2. **评估 speech/vote 是否纳入技能系统**
   - 可选：保持独立（因为 speech/vote 是通用行为，非角色特有）
   - 或：统一纳入（更一致，但改动大）

3. **删除死代码**
   - `werewolf` 技能
   - `wolf_team` 技能

4. **简化 PlayerController**
   - 只保留 `useSkill()` 和 `getSkillResult()`
   - 删除单独的 `campaign()`, `withdraw()` 等方法

## 实施步骤

| 步骤 | 任务 | 影响文件 | 风险 | 状态 |
|------|------|---------|------|------|
| 1 | 删除 roles.js 死代码 | roles.js | 低 | ✅ 完成 |
| 2 | 删除 campaign/withdraw/assignOrder 死代码 | roles.js | 低 | ✅ 完成 |
| 3 | 简化 PlayerController 接口 | player.js | 中 | ✅ 完成 |
| 4 | 全面测试 | test/game.test.js | - | ✅ 通过 |

## 已删除的死代码

### 1. roles.js
- `werewolf` - 狼人技能（从未被调用）
- `wolf_team` - 狼人团队技能（从未被调用）
- `campaign` - 竞选技能（通过 controller 方法实现）
- `withdraw` - 退水技能（通过 controller 方法实现）
- `assignOrder` - 指定发言顺序技能（通过 controller 方法实现）

### 2. player.js
**AIPlayerController 删除方法：**
- `speak()` - 死代码
- `vote()` - 死代码
- `chooseSpeakerOrder()` - 死代码
- `shoot()` - 死代码
- `passBadge()` - 死代码
- `cupidLink()` - 死代码

**HumanPlayerController 删除方法：**
- `chooseSpeakerOrder()` - 死代码
- `shoot()` - 死代码
- `witchAction()` - 死代码
- `cupidLink()` - 死代码
- `passBadge()` - 死代码

**PlayerController 基类简化：**
保留核心接口：
- `getSpeechResult()` - 获取发言决策
- `getVoteResult()` - 获取投票决策
- `useSkill()` - 使用技能
- `campaign()` - 竞选警长
- `withdraw()` - 退水

## 当前架构

### 技能调用（通过 callSkill）✅ 规范
- `seer` - 预言家查验
- `witch` - 女巫用药
- `shoot` - 猎人开枪
- `cupid` - 丘比特连线
- `guard` - 守卫守护
- `explode` - 狼人自爆
- `passBadge` - 警长传警徽

### Controller 方法（直接调用）✅ 已规范
| 方法 | 归属 | 状态 |
|------|------|------|
| `getSpeechResult()` | 通用行为 | ✅ 保持独立 |
| `getVoteResult()` | 通用行为 | ✅ 保持独立 |
| `campaign()` | 警长机制 | ✅ 已改为 `callSkill` |
| `withdraw()` | 警长机制 | ✅ 已改为 `callSkill` |

## 架构设计讨论

### 核心问题：什么应该走技能系统？

**走技能系统（callSkill）的场景：**
1. 角色特有能力（预言家查验、女巫用药、猎人开枪）
2. 身份绑定的行为（警长传警徽、狼人自爆）
3. 需要技能校验（canUse/validate/availablePhases）

**走 Controller 的场景：**
1. 通用行为（发言、投票）
2. 不涉及身份判定（任何人都可以发言/投票）
3. 无需技能校验

### 竞选/退水的归属争议

**现状：**
- 竞选/退水是警长机制的特有行为
- 但目前通过 `controller.campaign()` / `controller.withdraw()` 直接调用
- 没有走技能系统，无法利用 `availablePhases`、`canUse` 等机制

**两种设计思路：**

| 方案 | 优点 | 缺点 |
|------|------|------|
| **A. 保持现状**（Controller） | 简单直接，改动小 | 无法统一处理超时、重连；无法复用技能校验机制 |
| **B. 改为技能**（callSkill） | 统一架构，可复用技能系统能力 | 需要改造 phase.js 和 MockAI |

**推荐方案 B**，理由：
1. 竞选/退水本质上是警长身份的特有技能
2. 需要阶段限制（只能在 `sheriff_campaign` / `sheriff_speech`）
3. 未来可能需要扩展（如：某些角色不能竞选）

## 已完成的改造

| 任务 | 状态 | 说明 |
|------|------|------|
| 竞选改技能调用 | ✅ | 使用 `callSkill(player.id, 'campaign')` |
| 退水改技能调用 | ✅ | 使用 `callSkill(player.id, 'withdraw')` |
| 全局机制技能支持 | ✅ | `callSkill` 支持从 `ATTACHMENTS.sheriff` 获取技能 |

## 架构现状

### 全局机制技能（不绑定特定角色）
```javascript
// roles.js - ATTACHMENTS.sheriff.skills
campaign:    // 所有人可用，只在 sheriff_campaign 阶段
withdraw:    // 候选人可用，只在 sheriff_speech 阶段
assignOrder: // 警长可用，在 day_discuss 阶段
passBadge:   // 死亡警长可用，在 day_announce/post_vote 阶段
```

### 调用方式统一
```javascript
// 改造前
const response = controller?.campaign
  ? await controller.campaign()
  : await game.requestAction(player.id, 'campaign');

// 改造后
const result = await game.callSkill(player.id, 'campaign');
```

## 已完成的任务

| 任务 | 状态 | 说明 |
|------|------|------|
| 删除死代码 (`werewolf`, `wolf_team`) | ✅ | 从未被调用的技能 |
| 删除 `campaign`/`withdraw` 旧实现 | ✅ | 改为通过 `callSkill` 调用 |
| 删除 `sheriff_vote` 死代码 | ✅ | 使用 `callVote` 替代 |
| 实现 `assignOrder` 技能 | ✅ | 从 `callChooseSpeakerOrder` 改为 `callSkill(player.id, 'assignOrder')` |
| 删除 `callChooseSpeakerOrder` 方法 | ✅ | main.js 中已移除 |
| 全面测试 | ✅ | 60/60 测试通过 |

## 测试状态
✅ 所有 60 个测试通过

## 技能类型规范

| 类型 | 用途 | 示例 |
|------|------|------|
| `target` | 单目标技能 | 预言家查验、守卫守护、猎人开枪 |
| `double_target` | 双目标技能 | 丘比特连线 |
| `choice` | 选择型技能 | 女巫救/毒、竞选是/否 |
| `instant` | 即时技能 | 狼人自爆、退水 |
| `vote` | 投票技能 | 狼人投票、白天投票（可选） |
| `speech` | 发言技能 | 讨论、遗言（可选） |

## 注意事项

1. **向后兼容**：改造过程中确保测试用例通过
2. **AI 适配**：MockAI 和 AIController 都需要同步更新
3. **文档更新**：更新 CLAUDE.md 中的架构说明

## 相关文件

- `engine/roles.js` - 技能定义
- `engine/phase.js` - 阶段执行（主要改造点）
- `engine/player.js` - PlayerController
- `engine/main.js` - callSkill 实现
- `test/game.test.js` - 测试用例
