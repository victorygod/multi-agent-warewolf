# LLM 上下文消息结构

本文档定义发送给 LLM 的消息数组结构，用于指导后续迭代。

---

## 核心概念

**LLM 上下文** = 发送给 LLM 的 `messages` 数组

这个消息数组是 AI 决策和分析的唯一输入来源，其结构直接影响 AI 的表现。

---

## 消息数组结构

```
[
  { role: 'system', content: '...' },           // [0] 角色设定 + background
  { role: 'user', content: '...' },             // [1] 历史消息
  { role: 'assistant', content: '...' },
  { role: 'user', content: '...' },
  ...
  { role: 'user', content: 'newContent + thinking + speaking + CURRENT_TASK' }  // [最后]
]
```

---

## 3 个组成部分

| 组成部分 | role | 内容 | 进入历史 | 动态注入 |
|----------|------|------|----------|----------|
| **角色设定** | system | 你是谁 + background（身份、背景、关系、经历） | ✓ | ✗ |
| **历史消息** | user/assistant/tool | 之前发生了什么 | ✓ | ✗ |
| **当前轮次** | user | newContent + thinking + speaking + CURRENT_TASK | ✗ | ✓ |

---

## 当前轮次的 4 部分（合并为 1 条 user 消息）

```
给 LLM 看的当前轮次 = newContent + thinking + speaking（仅发言类） + CURRENT_TASK
存入历史的当前轮次 = newContent + CURRENT_TASK
```

| 组成部分 | 决策模式 | 分析模式 | 进入历史 | 说明 |
|----------|----------|----------|----------|------|
| **newContent** | ✓ | ✓ | ✓ | 格式化后的游戏消息 |
| **thinking** | ✓ | ✗ | ✗ | 怎么想（心智模型、启发式、价值观），动态注入不存历史 |
| **speaking** | 仅发言类 | ✗ | ✗ | 怎么说（说话风格、表达DNA、高频词），动态注入不存历史 |
| **CURRENT_TASK** | ✓ | ✓ | ✓ | 要做什么 |

thinking 和 speaking 不进历史的原因：它们是动态注入的，每次轮次可能不同（不同 profile、不同 action 类型），存入历史会干扰后续轮次。

---

## CURRENT_TASK 统一 ✅ 已完成

将 `ANALYZE_PROMPT` 和 `PHASE_PROMPTS` 合并为 `CURRENT_TASK`：

**注意**：可选玩家不一定等于存活玩家，由 `context.extraData.allowedTargets` 决定。

```javascript
const CURRENT_TASK = {
  // 分析
  analyze: '请分析本条发言，其可能在欺骗...不超过 100 字。',

  // 投票（可选玩家 = allowedTargets）
  day_vote:     '【白天投票】可选玩家：\n{allowedTargets}\n请选择要放逐的玩家...',
  post_vote:    '【PK投票】可选玩家：\n{allowedTargets}\n请选择要放逐的玩家...',
  sheriff_vote: '【警长投票】可选候选人：\n{allowedTargets}\n请选择要投票的候选人...',

  // 发言
  day_discuss:   '【白天发言】轮到你发言了，请调用工具简要发言，100字以内。',
  last_words:    '【遗言】你即将死亡，请调用工具发表遗言，100字以内。',
  sheriff_speech:'【警长竞选发言】轮到你发言了，请调用工具说明为什么应该选你当警长...',

  // 夜间行动
  night_werewolf_discuss: '【狼人讨论】轮到你发言了，请调用工具与同伴讨论今晚的目标...',
  night_werewolf_vote:    '【狼人投票】可选玩家：\n{aliveList}\n请选择今晚要击杀的玩家...',
  seer:  '【预言家】可选玩家：\n{aliveList}\n请选择要查验的玩家。',
  guard: '【守卫】可选玩家：\n{aliveList}\n请选择要守护的玩家。',
  witch: '【女巫】可选玩家：\n{aliveList}\n...请决定是否使用解药或毒药。',

  // 其他
  cupid:  '【丘比特】可选玩家：\n{aliveList}\n请选择两名玩家连接为情侣。',
  shoot: '【猎人开枪】可选玩家：\n{aliveList}\n...或放弃开枪。',
  passBadge:   '【传警徽】可选玩家：\n{aliveList}\n...或不传。',
  assignOrder: '【指定发言顺序】可选玩家：\n{aliveList}\n你是警长，请指定从哪位玩家开始发言。',
  sheriff_campaign: '【警长竞选】是否参与警长竞选？',
  withdraw: '【退水】是否退出警长竞选？'
};
```

---

## soul 的拆分

### 当前问题

每个 AI 角色有一个 `ai/profiles/*.md` 文件，整块作为 `soul` 字符串注入。问题：
- background（稳定信息）和 thinking/speaking（动态注入）混在一起
- 无法按场景选择性注入，所有内容都被塞进当前轮次

### 目标结构：目录 + 3 个文件

将每个 profile 从单文件改为目录，按注入位置拆为 3 个文件：

```
ai/profiles/
  kafuka/
    background.md    # 身份、背景故事、人际关系、经历 → system prompt
    thinking.md      # 心智模型、决策启发式、价值观、性格核心 → 当前轮次（决策模式）
    speaking.md      # 说话风格、表达DNA、高频词、台词 → 当前轮次（仅发言类）
  liuying/
    background.md
    thinking.md
    speaking.md
  ...
```

加载时只需读 3 个文件，无需解析：

```javascript
// 现在
{ name: '卡夫卡', soul: '整块内容...' }

// 目标
{ name: '卡夫卡', background: '...', thinking: '...', speaking: '...' }
```

### 拆为 3 部分的依据

12 个 profile 的段落共性：

| 段落 | 出现率 | 所属文件 |
|------|--------|----------|
| 基础身份/设定 | 12/12 | background.md |
| 背景故事 | 12/12 | background.md |
| 人际关系 | 12/12 | background.md |
| 经历/剧情/时间线 | 11/12 | background.md |
| 性格核心特质 | 12/12 | thinking.md |
| 心智模型/思维框架 | 12/12 | thinking.md |
| 决策启发式 | 12/12 | thinking.md |
| 价值观 | 10/12 | thinking.md |
| 说话风格/表达DNA | 12/12 | speaking.md |
| 语气模式/句式特征 | 12/12 | speaking.md |
| 高频词/禁忌词 | 12/12 | speaking.md |
| 标志性台词 | 6/12 | speaking.md |

| 部分 | 注入位置 | 进入历史 | 包含内容 | 理由 |
|------|----------|----------|----------|------|
| **background** | system | ✓ | 身份、背景、关系、经历 | 稳定信息，理解角色的基础上下文 |
| **thinking** | 当前轮次 | ✗ | 性格核心、心智模型、启发式、价值观 | 影响决策逻辑 |
| **speaking** | 当前轮次（仅发言类） | ✗ | 说话风格、表达DNA、高频词、台词 | 只影响发言输出 |

### 为什么是 3 部分而非 4 部分

人际关系和背景紧密相关（关系信息量不大，且需要背景上下文才能理解），合并进 background 更简洁。如果后续某些角色的人际关系特别长，可以考虑独立拆出，但目前 12 个 profile 的关系段都不长，无需单独拆分。

### 为什么性格核心归 thinking 而非 background

性格特征分两层："是什么样的人"（如"温柔知性"）是标签，留在 background 就够了；"怎么做出选择"（如"给空间而非给答案"）是决策逻辑，归 thinking。profile 中"性格特征"段落通常两者混杂，拆分时按内容判断：描述性标签 → background，行为倾向/决策倾向 → thinking。

### 各 profile 拆分对照

| profile | background.md | thinking.md | speaking.md |
|---------|--------------|-------------|-------------|
| 银狼 | 角色规则 | 心智模型、决策启发式、价值观 | 表达DNA |
| 流萤 | 一~三（人物设定、背景、性格标签）、七~八（人际关系、剧情） | 五~六（行为方式、核心心智模型） | 四（说话风格、表达DNA） |
| 卡夫卡 | 基础档案、背景故事、人际关系 | 性格特点（内在矛盾）、思维框架、决策启发式、价值观 | 说话风格（语言特征、隐喻系统） |
| 长夜月 | 身份、关键经历 | 核心心智模型、决策启发式、价值观 | 表达DNA、语气模式 |
| 忘归人 | 一~三（人物设定、背景、性格标签）、六~七（经历、人际关系） | 五（行为方式、心智模型、决策启发式） | 四（说话风格、句式特征、情绪表达） |
| 姬子 | 一~三（基础设定、背景、性格标签）、六~七（经历、人际关系） | 五（行为方式、心智模型、决策启发式） | 四（说话风格与表达方式） |
| 黑天鹅 | 一~三（设定、背景、性格）、六~七（经历、人际关系） | 五（行为方式）、九（心智模型）、十（决策启发式） | 四（说话风格） |
| 大丽花 | 一~四（基础身份、阵营、背景、性格特质） | 五大心智模型、行为驱动、决策启发式 | 五（说话风格与表达DNA） |
| 大黑塔 | 一~三（基础身份、性格画像）、五~六（经历、人际关系） | 四（行为方式、心智模型、决策启发式） | 三（说话风格） |
| 花火 | 一~三（核心身份、背景、性格）、六（经历） | 五（行为方式、心智模型、决策启发式） | 四（说话风格与表达DNA） |
| 三月七 | 一~三（基础信息、背景、性格）、六~七（经历、人际关系） | 五（行为方式、心智模型、决策启发式） | 四（说话风格） |
| 爻光 | 一~三（设定、背景、性格）、七~八（人际关系、剧情） | 五（行为方式、决策模式）、九（价值观） | 四（说话风格） |

---

## 完整示例

### 决策模式 - 白天投票

```javascript
[
  // ===== 1. 角色设定（含 background）=====
  {
    role: 'system',
    content: `你在参与一场狼人杀游戏，你的名字:沈暮 位置:3号位 角色:狼人 队友:5号林曜,7号赤羽
本局玩家：1号张三，2号李四，3号沈暮（你），4号王五，5号林曜，6号赵六，7号赤羽，8号钱七，9号孙八
规则:警长竞选|双死双输

【背景】
...`
  },

  // ===== 2. 历史消息 =====
  { role: 'user', content: '第1天\n[发言]\n1号张三:我是村民，过。' },
  { role: 'assistant', content: '我认为1号是好人，过。' },
  { role: 'user', content: '【白天投票】...\n请选择要放逐的玩家。' },
  { role: 'assistant', tool_calls: [...] },
  { role: 'tool', content: '你投票给了1号张三' },

  // ===== 3. 当前轮次（合并为1条）=====
  {
    role: 'user',
    content: `第2天
[警长竞选]
警上:5号林曜 警下:1号张三,2号李四,3号沈暮,4号王五,6号赵六,7号赤羽,8号钱七,9号孙八
[警长]5号林曜当选
[发言]
1号张三:我是一张村民牌...
2号李四:我觉得5号拿警徽不太对...
4号王五:我同意2号的观点...
5号林曜:（警长发言）我才是真预言家...
6号赵六:我真的是好人...
7号赤羽:6号说被守卫守了...
8号钱七:我有点晕...
9号孙八:我觉得7号说得有道理...

【行为逻辑】
你是一个冷静理性的狼人杀玩家，擅长分析发言逻辑，通过理性推理得到自己的行动。

【白天投票】可选玩家：
1号: 张三
2号: 李四
4号: 王五
5号: 林曜
6号: 赵六
7号: 赤羽
8号: 钱七
9号: 孙八
请选择要放逐的玩家，注意票型会公开。或弃权。`
  }
]
```

### 决策模式 - 白天发言（含说话方式）

```javascript
[
  // system + 历史消息同上...

  // ===== 当前轮次 =====
  {
    role: 'user',
    content: `第2天
[发言]
1号张三:...

【行为逻辑】
你是一个冷静理性的狼人杀玩家...

【说话方式】
句式偏好短句，节奏舒缓；善用隐喻和象征；语调平稳，极少起伏...

【白天发言】轮到你发言了，请分析局势，调用工具简要发言，100字以内。`
  }
]
```

### 分析模式

```javascript
[
  { role: 'system', content: '...' },
  { role: 'user', content: '第2天\n[发言]\n1号张三:我是一张村民牌...' },
  {
    role: 'user',
    content: `第2天
[发言]
1号张三:我是一张村民牌，警上退水了，警下也没有对跳，我就过了。

请分析本条发言，其可能在欺骗，也可能说漏嘴，寻找其中视野面或逻辑上的漏洞，结合局势做出分析判断。你的分析内容不会被其他人听到，不超过 100 字。`
  },
  { role: 'assistant', content: '1号说自己是村民但没有任何信息量...' }
]
```

---

## 代码位置映射

| 组成部分 | 代码位置 | 关键函数 |
|----------|----------|----------|
| 角色设定 + background | `prompt.js` | `buildSystemPrompt(player, game, background)` |
| 历史消息 | `message_manager.js` | `appendTurn()` |
| thinking | `prompt.js` | `buildCurrentTurn()` 中组装（决策模式注入） |
| speaking | `prompt.js` | `buildCurrentTurn()` 中组装（仅发言类注入） |
| CURRENT_TASK | `prompt.js` | `getCurrentTask()` |
| profile 加载 | `prompt.js` | `loadProfilesFromDir()` 返回 `{ name, background, thinking, speaking }` |
| isSpeech 判断 | `prompt.js` | `isSpeech(action)` |
| buildCurrentTurn | `prompt.js` | `buildCurrentTurn(newContent, action, context, profile)` 返回 `{ full, history }` |

### 关键区分：LLM view vs 历史存储

thinking 和 speaking 是动态注入的，每次轮次可能不同（不同 profile、不同 action 类型），所以**不能存入历史**。否则：
- 历史 thinking 会干扰后续轮次的决策
- 历史 speaking 会在非发言轮次产生冗余

```
给 LLM 看的当前轮次 = newContent + thinking + speaking + task  （full）
存入历史的当前轮次 = newContent + task                         （history）
```

因此 `buildCurrentTurn` 返回两个版本，`buildLLMView` 用 full 版本，`appendTurn` 用 history 版本。

---

## 扩展原则

| 扩展内容 | 放置位置 | 实现方式 |
|----------|----------|----------|
| 新角色设定 | system | 修改 `buildSystemPrompt()` |
| 新行为逻辑 | 当前轮次 | 修改 profile 的 `thinking.md` |
| 新说话方式 | 当前轮次 | 修改 profile 的 `speaking.md` |
| 新背景/关系 | system | 修改 profile 的 `background.md` |
| 新任务类型 | CURRENT_TASK | 在 `CURRENT_TASK` 字典中添加 |

---

## 重构计划

### 已完成 ✅

1. **CURRENT_TASK 统一** — `ANALYZE_PROMPT` + `PHASE_PROMPTS` 合并为 `CURRENT_TASK` 字典
2. **当前轮次合并为 1 条 user 消息** — `buildLLMView` 中拼接 `newContent + suffix + task`
3. **行为逻辑动态注入** — 决策模式注入当前轮次，不进历史
4. **profile 目录化** — 13 个 profile 已拆分为 `background.md` / `thinking.md` / `speaking.md`
5. **`loadProfilesFromDir()` 改为目录扫描** — 读取子目录的 3 个文件，返回 `{ name, background, thinking, speaking }`
6. **`player.soul` 全链路改为结构化对象** — 移除 `soul`，改为 `background`/`thinking`/`speaking` 三个字段
7. **`buildSystemPrompt` 增加 background 参数** — `buildSystemPrompt(player, game, background)`，background 追加到 system prompt
8. **prompt.js 收拢构建逻辑** — 新增 `buildCurrentTurn`、`isSpeech`；`buildLLMView` 简化为只接收 full 内容
9. **agent.js 简化** — 使用 `buildCurrentTurn` 替代手动拼接 suffix/task；appendTurn 使用 history 版本
10. **`DEFAULT_SOUL` → `DEFAULT_THINKING`** — 随机名字 fallback 使用 `DEFAULT_THINKING`
11. **测试更新** — 所有单元测试和集成测试通过

### 风险点

#### speaking 注入范围缩小（行为变更）✅ 已确认

重构前：所有决策（投票、验人、守人等）都会注入完整 soul（含说话风格）。
重构后：speaking 只在发言类决策注入，投票/验人等不再看到说话风格。

这是有意的行为变更——投票时不需要"怎么说"——测试已通过。

#### `appendTurn` 历史内容 ✅ 无风险

重构前存入历史时已不含 soul，重构后使用 `history` 变量（= newContent + task），一致。

#### `compress` 不受影响 ✅ 无风险

`message_manager.js` 的压缩函数从 `this.messages` 读取历史，历史中不含 thinking/speaking。

#### background 中包含"队友"等词 ✅ 已处理

部分 profile 的 background.md 包含"队友"一词（如银狼的"潜在队友"），集成测试检查"队友:"（带冒号，狼人队友格式）而非单纯"队友"字样。

---

## 相关文件

- `ai/agent/agent.js` - 消息构建入口
- `ai/agent/message_manager.js` - 消息历史管理 + buildLLMView
- `ai/agent/prompt.js` - prompt 构建统一入口
- `ai/agent/formatter.js` - 消息格式化
- `ai/profiles/{name}/` - AI 人物档案目录
- `ai/controller.js` - 上下文数据来源