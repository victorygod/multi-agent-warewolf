# 统一消息模板方案

## 背景

当前三端（cli、LLM、前端）各自维护消息格式化逻辑：

| 端 | 文件 | 问题 |
|----|------|------|
| cli | `cli_client.js` | 业务逻辑耦合在 UI 渲染中 |
| LLM | `ai/agent/formatter.js` | 只给 AI 用，其他两端无法复用 |
| 前端 | `public/app.js` | 业务逻辑耦合在 UI 渲染中 |

此外，消息内容模板散落在各处以硬编码形式存在：
- `engine/roles.js` - 技能消息模板
- `engine/phase.js` - 阶段消息模板
- `engine/vote.js` - 投票消息模板

**问题**：
1. 同一消息类型在三端显示不一致
2. 消息模板分散，难以统一修改
3. 格式化逻辑重复开发

---

## 前缀体系设计

### 核心原则

1. **所有标签放在一个 `[]` 里，用 `|` 分割**
2. **`系统` = 事实性消息** - 非玩家产生的内容
3. **`私密` = 可见性标记** - 需要隐藏的消息
4. **玩家发言带位置** - `[发言|3号张三]内容`
5. **简洁优先** - 能省略的标签就省略

### 标签分类

| 标签 | 含义 | 使用场景 |
|------|------|----------|
| `系统` | 事实性消息，非玩家发言 | 所有系统生成的消息 |
| `私密` | 只给特定人看 | 技能结果、情侣通知等 |
| `狼人讨论` | 狼人阵营可见 | 狼人讨论、狼刀 |
| `发言` | 发言阶段 | 白天发言 |
| `遗言` | 遗言阶段 | 死亡后的发言 |
| `警长竞选发言` | 警长竞选阶段 | 警长竞选 |
| `投票` | 投票阶段 | 投票相关 |

### 格式示例

```
[系统]昨夜4号xx，6号yy死亡
[系统]放逐投票：5号aa(1,3,7)，8号飞飞(2,4,5,6)
[系统|私密]2号小李查验5号=狼人
[系统|私密]10号小A连接了4号xx和6号yy为情侣
[系统|私密]4号xx是你的情侣
[发言|3号张三]我觉得5号像狼
[遗言|2号李四]我是预言家...
[狼人讨论|3号李四]刀5号
[警长竞选发言|5号林曜]我才是真预言家...
```

---

## 方案设计

### 1. 消息模板集中管理

在 `engine/constants.js` 新增 `MSG_TEMPLATE`：

```javascript
const MSG_TEMPLATE = {
  // 发言类
  SPEECH: '{pos}号{name}: {content}',
  WOLF_SPEECH: '[狼人]{pos}号{name}: {content}',
  LAST_WORDS: '[遗言]{pos}号{name}: {content}',
  SHERIFF_SPEECH: '[警长竞选]{pos}号{name}: {content}',

  // 投票类
  VOTE_RESULT: '[投票]{票型}',
  WOLF_VOTE_RESULT: '[私密][狼人]狼刀票型：{票型}',
  VOTE_TIE: 'pk:{平票玩家}',
  SHERIFF_VOTE: '[警长投票]{票型}',

  // 死亡类
  DEATH_ANNOUNCE: '[死亡公告]{玩家列表}',
  LAST_WORDS_DEATH: '[遗言]{pos}号{name}: {content}',

  // 系统类
  SYSTEM_COUPLE: '[私密][情侣]你的伴侣:{pos}号{name}',
  SYSTEM_WEREWOLF_TARGET: '[私密][狼人]击杀:{pos}号{name}',
  SYSTEM_SHERIFF_ELECTED: '[警长]{pos}号{name}当选',
  SYSTEM_WITHDRAW: '退水:{pos}号{name}',
  SYSTEM_PEACEFUL_NIGHT: '[平安夜]',
  SYSTEM_GAME_OVER: '[游戏结束]{内容}',

  // 技能类
  SEER_CHECK: '[私密][预言家]{pos}号{name}:{target}={结果}',
  GUARD_PROTECT: '[私密][守卫]{pos}号{name}:守护{target}',
  WITCH_HEAL: '[私密][女巫]{pos}号{name}:救{target}',
  WITCH_POISON: '[私密][女巫]{pos}号{name}:毒{target}',
  CUPID_LINK: '[私密][丘比特]{pos}号{name}:{target1}↔{target2}',
  HUNTER_SHOOT: '[猎人]{pos}号{name}:枪杀{target}',
  HUNTER_PASS: '[猎人]{pos}号{name}:放弃开枪',

  // 阶段类
  PHASE_START: '第{round}天',
  PHASE_NIGHT: '第{round}夜',
  PHASE_SHERIFF: '[警长竞选]',
  PHASE_DISCUSS: '[发言]',
  PHASE_VOTE: '[投票]'
};
```

### 2. 消息构建 API

新增 `engine/message_template.js`：

```javascript
const { MSG_TEMPLATE } = require('./constants');

function buildMessage(templateKey, params) {
  let template = MSG_TEMPLATE[templateKey];
  if (!template) return '';

  // 替换占位符
  for (const [key, value] of Object.entries(params)) {
    template = template.replace(`{${key}}`, value);
  }
  return template;
}

// 示例
buildMessage('SPEECH', { pos: 1, name: '张三', content: '我是村民' })
// → '1号张三:我是村民'
```

### 3. Engine 消息统一格式

所有 `game.message.add()` 产生消息时，直接使用带格式的 `content`：

```javascript
// roles.js - 预言家查验
game.message.add({
  type: MSG.ACTION,
  content: buildMessage('SEER_CHECK', {
    pos: player.position,
    name: player.name,
    target: target.position,
    result: isWolf ? '狼人' : '好人'
  }),
  visibility: VISIBILITY.SELF,  // 只给自己看
  playerId: player.id,
  metadata: { targetId: target.id, result: isWolf ? 'wolf' : 'good' }
});
```

### 4. 三端消费方式

#### cli - 直接使用

```javascript
// cli_client.js - 直接显示 msg.content，无需拼接
case MSG.SPEECH:
  msgLine = `  ${msg.content}`;  // 已经是 [发言|1号张三]内容
  break;
```

#### LLM - 只需过滤可见性

```javascript
// formatter.js - 大幅简化，只做可见性过滤
function formatMessageHistory(messages, players, currentPlayer) {
  const lines = [];
  for (const msg of messages) {
    // 根据 visibility 过滤可见消息
    if (!isVisible(msg, currentPlayer)) continue;
    lines.push(msg.content);  // 直接使用，已格式化
  }
  return lines.join('\n');
}
```

#### 前端 - 需要适配样式

前端需要从 `msg.content` 中解析标签来应用不同样式：

```javascript
// public/app.js - 从 content 解析标签
function displayMessage(msg, state) {
  // 从 content 中提取标签，如 [发言|1号张三]
  const tagMatch = msg.content.match(/^\[([^\]]+)\]/);
  const tags = tagMatch ? tagMatch[1].split('|') : [];

  // 根据标签应用样式
  let className = msg.type;
  if (tags.includes('狼人讨论')) className = 'wolf-channel';
  else if (tags.includes('遗言')) className = 'last-words';
  else if (tags.includes('私密')) className = 'private';

  // 投票结果和死亡公告仍需解析结构化数据
  if (msg.voteDetails) {
    // 渲染投票详情 HTML...
  } else if (msg.deaths) {
    // 渲染死亡 HTML...
  } else {
    addMessage(msg.content, className, msg.id);
  }
}
```

---

## 迁移步骤

### Phase 1: 定义模板

1. 在 `engine/constants.js` 添加 `MSG_TEMPLATE`
2. 新建 `engine/message_template.js` 提供 `buildMessage()` 函数

### Phase 2: 修改 Engine

1. 修改 `engine/roles.js` - 所有技能消息改用 `buildMessage()`
2. 修改 `engine/phase.js` - 阶段消息改用模板
3. 修改 `engine/vote.js` - 投票消息改用模板

### Phase 3: 简化 cli

- 移除发言类的拼接逻辑（`{pos}号 {name}:`），直接使用 `msg.content`
- 移除 system 消息的 "系统:" 前缀

### Phase 4: 简化 LLM

- `formatter.js` 大幅简化，移除 formatSpeech、formatVoteResult、formatDeath 等函数
- 只保留可见性过滤逻辑，直接使用 `msg.content`

### Phase 5: 适配前端

- `public/app.js` 需要从 `msg.content` 中解析标签来应用样式
- 投票结果和死亡公告仍需解析结构化数据（voteDetails、deaths）
- 其他消息类型可直接显示 `msg.content`

---

## 消息模板清单

### 玩家发言

| 模板 Key | 格式 | 示例 |
|----------|------|------|
| SPEECH | `[发言|{pos}号{name}({self})]{content}` | `[发言|1号张三]我是村民` |
| WOLF_SPEECH | `[狼人讨论|{pos}号{name}({self})]{content}` | `[狼人讨论|3号李四]刀5号` |
| LAST_WORDS | `[遗言|{pos}号{name}({self})]{content}` | `[遗言|2号王五]我是预言家...` |
| SHERIFF_SPEECH | `[警长竞选发言|{pos}号{name}({self})]{content}` | `[警长竞选发言|1号张三]我才是真预言家...` |

### 死亡与投票

| 模板 Key | 格式 | 示例 |
|----------|------|------|
| NIGHT_DEATH | `[系统]昨夜{玩家列表}死亡` | `[系统]昨夜4号xx，6号yy死亡` |
| DAY_VOTE | `[系统]放逐投票：{票型}` | `[系统]放逐投票：5号aa(1,3,7)，8号飞飞(2,4,5,6)` |
| VOTE_TIE | `[系统]平票PK：{平票玩家}` | `[系统]平票PK：2号aa，5号bb` |
| VOTE_ANNOUNCE | `[系统]{pos}号{name}被放逐` | `[系统]8号飞飞被放逐` |
| HUNTER_SHOOT | `[系统]{pos}号{name}开枪带走了{target}` | `[系统]5号小周开枪带走了2号xx` |
| HUNTER_PASS | `[系统]{pos}号{name}放弃开枪` | `[系统]5号小周放弃开枪` |

### 技能结果

| 模板 Key | 格式 | 示例 |
|----------|------|------|
| SEER_CHECK | `[系统\|私密]{pos}号{name}({self})查验{target}={结果}` | `[系统\|私密]2号小李查验5号=狼人` |
| GUARD_PROTECT | `[系统\|私密]{pos}号{name}({self})守护了{target}` | `[系统\|私密]4号小王守护了2号xx` |
| WITCH_HEAL | `[系统\|私密]{pos}号{name}({self})救了{target}` | `[系统\|私密]6号小孙救了5号yy` |
| WITCH_POISON | `[系统\|私密]{pos}号{name}({self})毒杀了{target}` | `[系统\|私密]6号小孙毒杀了3号zz` |
| CUPID_LINK_SELF | `[系统\|私密]{pos}号{name}({self})连接了{t1}和{t2}为情侣` | `[系统\|私密]10号小A连接了4号xx和6号yy为情侣` |
| CUPLE_NOTIFY | `[系统\|私密]{pos}号{name}是你的情侣` | `[系统\|私密]4号xx是你的情侣` |
| IDIOT_REVEAL | `[系统]{pos}号{name}翻牌为白痴` | `[系统]5号林曜翻牌为白痴` |

### 阶段与系统

| 模板 Key | 格式 | 示例 |
|----------|------|------|
| PHASE_DAY | `[系统]第{round}天` | `[系统]第2天` |
| PHASE_NIGHT | `[系统]第{round}夜` | `[系统]第2夜` |
| SHERIFF_CANDIDATES | `[系统\|警长竞选发言]警上：{警上列表} 警下：{警下列表}` | `[系统\|警长竞选发言]警上：3号xx，5号yy 警下：1号aa，2号bb` |
| SHERIFF_ELECTED | `[系统]{pos}号{name}当选警长` | `[系统]5号林曜当选警长` |
| WITHDRAW | `[系统]{pos}号{name}退水` | `[系统]3号李四退水` |
| PEACEFUL_NIGHT | `[系统]昨夜平安夜` | `[系统]昨夜平安夜` |
| GAME_OVER | `[系统]游戏结束：{结果}` | `[系统]游戏结束：狼人获胜` |


### 特殊事件

| 模板 Key | 格式 | 示例 |
|----------|------|------|
| WEREWOLF_EXPLODE | `[系统]{pos}号{name}自爆` | `[系统]3号李四自爆` |
| SHERIFF_ASSIGN_ORDER | `[系统]警长指定从{pos}号{name}开始发言` | `[系统]警长指定从5号林曜开始发言` |
| SHERIFF_PASS_BADGE | `[系统]警长传警徽给{pos}号{name}` | `[系统]警长传警徽给2号xx` |
| SHERIFF_BADGE_LOST | `[系统]警徽流失` | `[系统]警徽流失` |
| SHERIFF_DEAD | `[系统]警长死亡，警徽流失` | `[系统]警长死亡，警徽流失` |
| NO_SHERIFF_CANDIDATE | `[系统]无人竞选警长` | `[系统]无人竞选警长` |---

## 文件变更清单

| 文件 | 变更 |
|------|------|
| `engine/constants.js` | 新增 `MSG_TEMPLATE` |
| `engine/message_template.js` | 新增 `buildMessage()` 函数 |
| `engine/roles.js` | 所有消息改用 `buildMessage()` |
| `engine/phase.js` | 所有消息改用 `buildMessage()` |
| `engine/vote.js` | 所有消息改用 `buildMessage()` |
| `cli_client.js` | 简化消息渲染，直接使用 `msg.content` |
| `ai/agent/formatter.js` | 大幅简化，只做过滤 |
| `public/app.js` | 简化消息渲染，直接使用 `msg.content` |

---

## 注意事项（坑）

### 1. 需要保留的 metadata

消息的 `content` 格式化后，以下结构化数据仍需保留，不能删除：

| 消息类型 | 保留的 metadata | 用途 |
|----------|-----------------|------|
| 投票结果 | `voteDetails`, `voteCounts` | 前端渲染投票详情 HTML |
| 死亡公告 | `deaths` | 前端渲染死亡列表 HTML |
| 警长竞选 | `onStage`, `offStage` | 前端解析候选人列表 |
| 预言家查验 | `targetId`, `result` | 游戏逻辑判断 |
| 阶段开始 | `phase`, `phaseName`, `round` | 前端显示阶段分隔 |

### 2. visibility 可见性处理

| visibility | 说明 | 处理方式 |
|------------|------|----------|
| `SELF` | 只有自己 | 只给自己看 |
| `CAMP` | 同阵营 | 狼人队内可见 |
| `COUPLE` | 情侣 | 情侣可见 |
| `PUBLIC` | 所有人可见 | 直接显示 |

LLM 的 formatter 需要根据当前玩家角色过滤可见消息。

### 3. 消息类型统一

当前代码中消息类型混用字符串和常量，需要统一使用 `MSG.*` 常量：

```javascript
// 统一使用常量
game.message.add({
  type: MSG.SYSTEM,        // 而非 'system'
  content: '...',
  visibility: VISIBILITY.PUBLIC
});
```

### 4. cli 时间戳问题

当前 cli 代码会给 system 消息加 "系统:" 前缀和时间戳，新格式已有标签，需要移除重复。

### 5. 前端样式适配

前端需要从 `msg.content` 中解析标签来应用样式：

| 标签 | 样式 class |
|------|-----------|
| `狼人讨论` | `wolf-channel` |
| `遗言` | `last-words` |
| `私密` | `private` |
| `系统` | `system` |

解析方式：
```javascript
const tagMatch = msg.content.match(/^\[([^\]]+)\]/);
const tags = tagMatch ? tagMatch[1].split('|') : [];
```

---

## 相关文档

- `docs/llm_context_structure.md` - LLM 上下文消息结构设计
- `docs/agent_context_design.md` - Agent 上下文构建设计