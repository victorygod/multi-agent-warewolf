# 工具调用错误处理分析

## 一、agent.js 层（工具调用前）

| # | 场景 | 当前 error_message |
|---|------|-------------------|
| 1 | 工具名不存在 | `未找到工具: ${toolCall.function.name}` |
| 2 | arguments JSON 解析失败 | `e.message`（如 `Unexpected token...`） |

## 二、tools.js 层 - validateTarget 通用校验

| # | 场景 | 当前 error_message |
|---|------|-------------------|
| 3 | target 不是数字 | `目标无效，请输入数字编号` |
| 4 | target 玩家已死/不存在 | `${targetId}号玩家已死亡或不存在` |
| 5 | target 不在可选范围 | `${targetId}号不在可选范围内，可选：[...]` |

## 三、各工具 execute() 特有校验

### action_witch

| # | 场景 | 当前 error_message |
|---|------|-------------------|
| 6 | heal 但解药已用完 | `解药已用完` |
| 7 | poison 但毒药已用完 | `毒药已用完` |
| 8 | poison 未指定 target | `使用毒药必须指定目标` |
| 9 | action 值非法 | `无效的女巫操作，可选：heal, poison, skip` |

### action_cupid

| # | 场景 | 当前 error_message |
|---|------|-------------------|
| 10 | targets 数量不是2 | `必须选择两名玩家` |
| 11 | 选了同一个人 | `不能选择同一名玩家` |
| 12 | 目标玩家不存在 | `${tid}号玩家不存在` |

## 四、当前缺失的校验（静默当弃权处理了）

| # | 场景 | 现状 | 应返回的 error_message |
|---|------|------|------------------------|
| 13 | 缺少必填参数（如 action_witch 没有 action） | 被当成弃权 | `缺少必填参数: action` |
| 14 | 参数名错误（如传 `{"vote": 3}` 而非 `{"target": 3}`） | `input.target` 为 undefined → 当弃权 | `参数名错误，未知参数: vote，期望: target` |
| 15 | action_day_discuss 的 content 是非字符串（如数字） | `typeof content !== 'string'` → 当弃权 | `参数类型错误: content 应为字符串` |
| 16 | action_sheriff_campaign 的 run 是非布尔值 | falsy 当弃权，truthy 当 true | `参数类型错误: run 应为布尔值` |
| 17 | action_withdraw 的 withdraw 是非布尔值 | falsy 当弃权，truthy 当 true | `参数类型错误: withdraw 应为布尔值` |
| 18 | action_cupid 的 targets 不是数组 | `!Array.isArray(targets)` → 当弃权 | `参数类型错误: targets 应为包含2个整数的数组` |
| 19 | action_cupid 的 targets 元素不是数字 | parseInt 后 NaN → 走到 find 返回 false | `${tid}号玩家不是合法选项` |

## 五、alias 去掉后的工具名映射

去掉 alias 机制，每个 action 名对应独立工具，用工厂函数共享 execute 逻辑：

| 原 alias 名 | 新独立工具名 | 共享逻辑 |
|-------------|-------------|---------|
| `action_day_vote` | `action_day_vote` | vote 逻辑 |
| `action_sheriff_vote` | `action_sheriff_vote` | vote 逻辑 |
| `action_night_werewolf_vote` | `action_night_werewolf_vote` | vote 逻辑 |
| `action_sheriff_speech` | `action_sheriff_speech` | discuss 逻辑 |
| `action_last_words` | `action_last_words` | discuss 逻辑 |
| `action_night_werewolf_discuss` | `action_night_werewolf_discuss` | discuss 逻辑 |

`action_post_vote` 和 `action_day_discuss` 保留为工具名，但不再作为 alias 的"主名"，引擎中用到的 `context.action` 值就是工具名本身。

## 六、agent.js 中 JSON parse 错误优化

当前直接返回 `e.message`（如 `Unexpected token...`），应改为更明确的提示：

```
参数格式错误: 无法解析 JSON（${e.message}）
```

## 七、待实施改动

1. 去掉 alias 机制，拆成独立工具（用工厂函数共享 execute）
2. 补齐 #13-#19 的参数校验
3. agent.js 中 JSON parse 错误给更明确的 message