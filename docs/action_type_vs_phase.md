# actionType vs phase 分析

## 两个概念

- **phase**：游戏状态机阶段，定义在 `engine/phase.js` 的 `PHASE_FLOW` 中，如 `cupid`、`guard`、`night_werewolf_vote`、`day_discuss`
- **actionType**：玩家行为类型，作为 `callSkill/callSpeech/callVote` 的第二参数传入，最终通过 `buildActionData()` 构建为 `pendingAction.action` 发送给前端

## 改造方案：actionType 统一加 `action_` 前缀

所有 actionType 字符串加 `action_` 前缀，与 phase 从值上彻底区分。

### 新旧映射表

| phase.id | 旧 actionType | 新 actionType |
|---|---|---|
| cupid | cupid | action_cupid |
| guard | guard | action_guard |
| night_werewolf_discuss | night_werewolf_discuss | action_night_werewolf_discuss |
| night_werewolf_vote | night_werewolf_vote | action_night_werewolf_vote |
| witch | witch | action_witch |
| seer | seer | action_seer |
| sheriff_campaign | **campaign** | **action_sheriff_campaign** |
| sheriff_speech | sheriff_speech | action_sheriff_speech |
| sheriff_vote | sheriff_vote | action_sheriff_vote |
| day_discuss | day_discuss | action_day_discuss |
| day_vote | day_vote | action_day_vote |
| post_vote | vote | action_post_vote |
| （无phase） | ~~speak~~ | **删除**（从未实际使用，见下方说明） |
| （无phase） | withdraw | action_withdraw |
| （无phase） | shoot | action_shoot |
| （无phase） | passBadge | action_passBadge |
| （无phase） | assignOrder | action_assignOrder |
| （无phase） | explode | action_explode |
| （无phase） | last_words | action_last_words |

### 删除 `speak` 和 `vote` 作为独立 actionType

**`speak`** 只出现在 `callSpeech` 和 `speak()` 的默认参数值中，但所有实际调用都显式传了具体的 actionType（`'day_discuss'`、`'night_werewolf_discuss'`、`'sheriff_speech'`、`'last_words'`），默认值从未被触发。删除后：
- `callSpeech` 不再需要默认值（或保留空字符串做参数校验）
- `speak()` 的默认值同理
- `buildActionData` 中 `case 'speak':` 删除
- `tools.js` 中 speech 工具的 `'speak'` alias 删除
- `prompt.js` 不需要 `action_speak` 的 prompt
- `cli_client.js` 中 `speakActions` 数组删除 `'speak'`
- `public/app.js` 中 `case 'speak':` 删除

**`vote`** 只出现在 `callVote` 的默认参数值和 PK 投票（`vote.js` line 173）中。PK 投票改为 `action_post_vote`，默认值同理删除或改为 `action_post_vote`。
- `buildActionData` 中 `case 'vote':` 合并到 `case 'action_post_vote':`
- `tools.js` 中 vote 工具的 name 改为 `action_post_vote`，不再需要 `vote` 这个独立 name

### 同时修复的 Bug

1. **sheriff_campaign vs campaign 不一致** → 统一为 `action_sheriff_campaign`
2. **vote 含义模糊**（PK投票用 `vote`，白天投票用 `day_vote`）→ PK 投票改为 `action_post_vote`
3. **test/human-player.test.js:889** — `wolf_vote` 应改为 `action_night_werewolf_vote`
4. **public/app.js:375** — `choose_speaker_order` 死代码删除，只保留 `action_assignOrder`

## 需要修改的文件清单

### 1. engine/phase.js — callSkill/callSpeech/callVote 调用处

所有第二参数加 `action_` 前缀：

| 行号 | 旧代码 | 新代码 |
|---|---|---|
| 34 | `callSkill(cupid.id, 'cupid')` | `callSkill(cupid.id, 'action_cupid')` |
| 49 | `callSkill(guard.id, 'guard', ...)` | `callSkill(guard.id, 'action_guard', ...)` |
| 60 | `callSpeech(..., 'night_werewolf_discuss', 'camp')` | `callSpeech(..., 'action_night_werewolf_discuss', 'camp')` |
| 80 | `callVote(wolf.id, 'night_werewolf_vote', ...)` | `callVote(wolf.id, 'action_night_werewolf_vote', ...)` |
| 148 | `callSkill(witch.id, 'witch', ...)` | `callSkill(witch.id, 'action_witch', ...)` |
| 161 | `callSkill(seer.id, 'seer')` | `callSkill(seer.id, 'action_seer')` |
| 176 | `callSkill(p.id, 'campaign')` | `callSkill(p.id, 'action_sheriff_campaign')` |
| 209 | `callSpeech(..., 'sheriff_speech')` | `callSpeech(..., 'action_sheriff_speech')` |
| 213 | `callSkill(p.id, 'withdraw')` | `callSkill(p.id, 'action_withdraw')` |
| 339 | `callSkill(sheriff.id, 'assignOrder')` | `callSkill(sheriff.id, 'action_assignOrder')` |
| 344 | `callSpeech(..., 'day_discuss')` | `callSpeech(..., 'action_day_discuss')` |
| 361 | `callVote(voter.id, 'day_vote', ...)` | `callVote(voter.id, 'action_day_vote', ...)` |

### 2. engine/vote.js — callVote 调用处

| 行号 | 旧代码 | 新代码 |
|---|---|---|
| 173 | `callVote(voter.id, 'vote', ...)` | `callVote(voter.id, 'action_post_vote', ...)` |
| 213 | `callVote(voter.id, 'sheriff_vote', ...)` | `callVote(voter.id, 'action_sheriff_vote', ...)` |

### 3. engine/main.js — buildActionData switch、callSpeech/callVote 默认值、speak、handleDeathAbility

| 行号 | 位置 | 旧代码 | 新代码 |
|---|---|---|---|
| 167 | switch case | `case 'guard':` | `case 'action_guard':` |
| 174 | switch case | `case 'witch':` | `case 'action_witch':` |
| 188 | switch case | `case 'seer':` | `case 'action_seer':` |
| 195 | switch case | `case 'cupid':` | `case 'action_cupid':` |
| 200-202 | switch case | `case 'vote': case 'day_vote': case 'sheriff_vote':` | `case 'action_post_vote': case 'action_day_vote': case 'action_sheriff_vote':` |
| 212 | switch case | `case 'night_werewolf_vote':` | `case 'action_night_werewolf_vote':` |
| 218 | switch case | `case 'shoot':` | `case 'action_shoot':` |
| 224 | switch case | `case 'passBadge':` | `case 'action_passBadge':` |
| 230 | switch case | `case 'assignOrder':` | `case 'action_assignOrder':` |
| 238-242 | switch case | `case 'campaign': case 'withdraw': case 'speak': case 'last_words': case 'explode':` | `case 'action_sheriff_campaign': case 'action_withdraw': case 'action_last_words': case 'action_explode':`（删除 `'speak'`） |
| 272 | callSpeech 默认值 | `actionType = 'speak'` | 删除默认值（所有调用都显式传参） |
| 314 | callVote 默认值 | `actionType = 'vote'` | 删除默认值或改为 `'action_post_vote'` |
| 372 | deadPlayerAllowedSkills | `['passBadge', 'shoot']` | `['action_passBadge', 'action_shoot']` |
| 445 | speak 默认值 | `actionType = 'speak'` | 删除默认值（所有调用都显式传参） |
| 451 | speak 判断 | `actionType === 'last_words'` | `actionType === 'action_last_words'` |
| 569 | useSkill 调用 | `useSkill('passBadge', ...)` | `useSkill('action_passBadge', ...)` |
| 607 | callSpeech 调用 | `callSpeech(player.id, 'last_words')` | `callSpeech(player.id, 'action_last_words')` |

### 4. engine/player.js — getSkill、globalMechanicSkills、默认值

| 行号 | 位置 | 旧代码 | 新代码 |
|---|---|---|---|
| 55 | globalMechanicSkills | `['campaign', 'withdraw', 'assignOrder', 'passBadge']` | `['action_sheriff_campaign', 'action_withdraw', 'action_assignOrder', 'action_passBadge']` |
| 109 | cupid 判断 | `actionType === 'cupid'` | `actionType === 'action_cupid'` |
| 241 | getSpeechResult 默认值 | `actionType = 'speak'` | 删除默认值 |
| 246 | getVoteResult 默认值 | `actionType = 'vote'` | 删除默认值或改为 `'action_post_vote'` |
| 261 | HumanController getSpeechResult | `actionType = 'speak'` | 删除默认值 |
| 267 | HumanController getVoteResult | `actionType = 'vote'` | 删除默认值或改为 `'action_post_vote'` |

**注意：** `player.role.skills` 的 key（如 `shoot`、`cupid`、`explode`、`campaign`、`withdraw`、`passBadge`、`assignOrder`）也需要改为带前缀的。见下方 engine/roles.js。

### 5. engine/roles.js — skill key、availablePhases

**skill key 改名：**

| 行号 | 旧 key | 新 key |
|---|---|---|
| 123 | `shoot:` | `action_shoot:` |
| 243 | `cupid:` | `action_cupid:` |
| 283 | `explode:` | `action_explode:` |
| 348 | `campaign:` | `action_sheriff_campaign:` |
| 359 | `withdraw:` | `action_withdraw:` |
| 375 | `assignOrder:` | `action_assignOrder:` |
| 391 | `passBadge:` | `action_passBadge:` |

**availablePhases 中的值不变**（这些是 phase ID，不是 actionType）：
- `availablePhases: ['day_announce', 'post_vote']` — 保持不变
- `availablePhases: ['sheriff_campaign']` — 保持不变
- `availablePhases: ['sheriff_speech']` — 保持不变
- `availablePhases: ['day_discuss']` — 保持不变
- `availablePhases: ['sheriff_campaign', 'sheriff_speech', 'sheriff_vote', 'day_discuss', 'day_vote']` — 保持不变

### 6. engine/config.js — ACTION_FILTERS key

| 行号 | 旧 key | 新 key |
|---|---|---|
| 135 | `guard:` | `action_guard:` |
| 143 | `witch_poison:` | `action_witch_poison:` |
| 151 | `seer:` | `action_seer:` |
| 159 | `vote:` | `action_post_vote:` |
| 166 | `night_werewolf_vote:` | `action_night_werewolf_vote:` |
| 173 | `shoot:` | `action_shoot:` |
| 180 | `passBadge:` | `action_passBadge:` |

**注意：** `witch_poison` 是唯一一个不在 callSkill 参数里直接出现的 key，它是 buildActionData 内部用的 filter key。需要确认 buildActionData 中引用处也同步修改。

### 7. ai/controller.js — context.phase 不再被覆盖

| 行号 | 修改 |
|---|---|
| 39 | `phase: state.phase` 保持不变（这是正确的 phase） |
| 50 | `action: extraData.actionType` 保持不变 |
| 58 | **删除** `context.phase = actionType;` |
| 73 | **删除** `context.phase = actionType;` |
| 120 | **删除** `context.phase = actionType;` |
| 55 | `actionType = 'speak'` → 删除默认值 |
| 68 | `actionType = 'day_vote'` → `actionType = 'action_day_vote'` |

### 8. ai/agent/tools.js — TOOL_REGISTRY name 和 aliases 全部加前缀

| 旧 name | 新 name | 旧 aliases | 新 aliases |
|---|---|---|---|
| vote | action_post_vote | `['day_vote', 'sheriff_vote', 'night_werewolf_vote', 'post_vote']` | `['action_day_vote', 'action_sheriff_vote', 'action_night_werewolf_vote']` |
| speech | action_day_discuss | `['day_discuss', 'sheriff_speech', 'last_words', 'night_werewolf_discuss', 'speak']` | `['action_sheriff_speech', 'action_last_words', 'action_night_werewolf_discuss']`（删除 `'speak'`，name 本身就是 action_day_discuss） |
| witch | action_witch | — | — |
| seer | action_seer | — | — |
| guard | action_guard | — | — |
| cupid | action_cupid | — | — |
| shoot | action_shoot | — | — |
| campaign | action_sheriff_campaign | `['sheriff_campaign']` | — (name 已经是 action_sheriff_campaign) |
| withdraw | action_withdraw | `['sheriff_withdraw']` | — |
| passBadge | action_passBadge | — | — |
| assignOrder | action_assignOrder | — | — |

每个 tool 的 `buildSchema` 返回的 `name` 字段也要同步修改。

### 9. ai/agent/prompt.js — PHASE_PROMPTS key 全部加前缀

所有 key 从旧值改为新值：

| 旧 key | 新 key |
|---|---|
| night_werewolf_discuss | action_night_werewolf_discuss |
| night_werewolf_vote | action_night_werewolf_vote |
| seer | action_seer |
| guard | action_guard |
| day_discuss | action_day_discuss |
| day_vote | action_day_vote |
| post_vote | action_post_vote |
| last_words | action_last_words |
| witch | action_witch |
| campaign | action_sheriff_campaign |
| withdraw | action_withdraw |
| sheriff_speech | action_sheriff_speech |
| sheriff_vote | action_sheriff_vote |
| cupid | action_cupid |
| shoot | action_shoot |
| passBadge | action_passBadge |
| assignOrder | action_assignOrder |

### 10. ai/agent/formatter.js — switch case 和 NIGHT_PHASES/DAY_PHASES

`NIGHT_PHASES` 和 `DAY_PHASES` 是 phase ID 数组，**不需要改**（它们用于 `msg.phase` 比较，不是 actionType）。

switch case 中的 key 是 actionType，需要加前缀：

| 行号 | 旧 | 新 |
|---|---|---|
| 103 | `case 'last_words':` | `case 'action_last_words':` |
| 323 | `case 'vote':` | `case 'action_post_vote':` |
| 329 | `case 'witch':` | `case 'action_witch':` |
| 339 | `case 'seer':` | `case 'action_seer':` |
| 342 | `case 'guard':` | `case 'action_guard':` |
| 345 | `case 'cupid':` | `case 'action_cupid':` |
| 350 | `case 'shoot':` | `case 'action_shoot':` |
| 353 | `case 'campaign':` | `case 'action_sheriff_campaign':` |
| 356 | `case 'withdraw':` | `case 'action_withdraw':` |
| 359 | `case 'passBadge':` | `case 'action_passBadge':` |
| 362 | `case 'assignOrder':` | `case 'action_assignOrder':` |

### 11. ai/agent/agent.js — getTool/getPhasePrompt 调用

`getTool(context.phase)` 现在需要改为 `getTool(context.actionType)` 或 `getTool(context.action)`（因为 context.phase 不再被覆盖）。

需要检查 agent.js 中所有使用 `context.phase` 查找工具/prompt 的地方，改为使用 `context.action`（即 actionType）。

### 12. ai/agent/models/mock_model.js — setResponse key

所有 setResponse 的 key 加前缀：

| 旧 | 新 |
|---|---|
| `'vote'` | 删除（用 `'action_post_vote'` 代替） |
| `'day_vote'` | `'action_day_vote'` |
| `'sheriff_vote'` | `'action_sheriff_vote'` |
| `'speak'` | 删除（从未实际使用） |
| `'last_words'` | `'action_last_words'` |
| `'sheriff_speech'` | `'action_sheriff_speech'` |
| `'campaign'` | `'action_sheriff_campaign'` |
| `'withdraw'` | `'action_withdraw'` |
| `'witch'` | `'action_witch'` |
| `'cupid'` | `'action_cupid'` |
| `'shoot'` | `'action_shoot'` |
| `'passBadge'` | `'action_passBadge'` |
| `'guard'` | `'action_guard'` |
| `'seer'` | `'action_seer'` |

### 13. ai/agent/models/random_model.js — switch case

所有 switch case 加前缀（`speak` 和 `vote` 作为独立 key 删除）：

| 旧 | 新 |
|---|---|
| `'day_discuss'` | `'action_day_discuss'` |
| `'sheriff_speech'` | `'action_sheriff_speech'` |
| `'last_words'` | `'action_last_words'` |
| `'day_vote'` | `'action_day_vote'` |
| `'sheriff_vote'` | `'action_sheriff_vote'` |
| `'night_werewolf_discuss'` | `'action_night_werewolf_discuss'` |
| `'night_werewolf_vote'` | `'action_night_werewolf_vote'` |
| `'seer'` | `'action_seer'` |
| `'witch'` | `'action_witch'` |
| `'guard'` | `'action_guard'` |
| `'cupid'` | `'action_cupid'` |
| `'shoot'` | `'action_shoot'` |
| `'campaign'` | `'action_sheriff_campaign'` |
| `'withdraw'` | `'action_withdraw'` |
| `'assignOrder'` | `'action_assignOrder'` |
| `'passBadge'` | `'action_passBadge'` |

### 14. public/app.js — switch case on d.action

所有 case 加前缀：

| 行号 | 旧 | 新 |
|---|---|---|
| 331 | `case 'speak':` | 删除（从未实际触发） |
| 332 | `case 'last_words':` | `case 'action_last_words':` |
| 337 | `case 'vote':` | 删除（用 `case 'action_post_vote':` 代替） |
| 338 | `case 'night_werewolf_vote':` | `case 'action_night_werewolf_vote':` |
| 339 | `case 'sheriff_vote':` | `case 'action_sheriff_vote':` |
| 341 | `d.action === 'night_werewolf_vote'` | `d.action === 'action_night_werewolf_vote'` |
| 341 | `d.action === 'sheriff_vote'` | `d.action === 'action_sheriff_vote'` |
| 348 | `case 'guard':` | `case 'action_guard':` |
| 357 | `case 'witch':` | `case 'action_witch':` |
| 363 | `case 'campaign':` | `case 'action_sheriff_campaign':` |
| 369 | `case 'withdraw':` | `case 'action_withdraw':` |
| 375 | `case 'choose_speaker_order':` | **删除**（死代码） |
| 376 | `case 'assignOrder':` | `case 'action_assignOrder':` |
| 382 | `case 'shoot':` | `case 'action_shoot':` |
| 388 | `case 'cupid':` | `case 'action_cupid':` |
| 394 | `case 'seer':` | `case 'action_seer':` |
| 405 | `case 'passBadge':` | `case 'action_passBadge':` |
| 430 | `actionType === 'night_werewolf_vote'` | `actionType === 'action_night_werewolf_vote'` |

### 15. public/app.js — state.phase 相关（不改）

以下使用 `state.phase` 的地方是 phase ID，**不需要加前缀**：
- phaseNames 映射（836-853行）
- phasePrompts 映射（1167-1182行）
- `state.phase !== 'last_words'` 等判断

但 `state.phase === 'last_words'` 需要确认——`last_words` 既不是 PHASE_FLOW 中的 phase ID，也不是 actionType，它是 `speak()` 方法中判断 messageType 用的。需要确认 getState() 中 phase 是否可能为 `last_words`。

### 16. cli_client.js — switch case on action

| 行号 | 旧 | 新 |
|---|---|---|
| 281 | `case 'speak':` | 删除（从未实际触发） |
| 282 | `case 'last_words':` | `case 'action_last_words':` |
| 283 | `case 'day_discuss':` | `case 'action_day_discuss':` |
| 284 | `case 'night_werewolf_discuss':` | `case 'action_night_werewolf_discuss':` |
| 285 | `case 'sheriff_speech':` | `case 'action_sheriff_speech':` |
| 299 | `case 'vote':` | 删除（用 `case 'action_post_vote':` 代替） |
| 300 | `case 'day_vote':` | `case 'action_day_vote':` |
| 301 | `case 'night_werewolf_vote':` | `case 'action_night_werewolf_vote':` |
| 302 | `case 'sheriff_vote':` | `case 'action_sheriff_vote':` |
| 305 | `case 'guard':` | `case 'action_guard':` |
| 308 | `case 'seer':` | `case 'action_seer':` |
| 311 | `case 'witch':` | `case 'action_witch':` |
| 314 | `case 'cupid':` | `case 'action_cupid':` |
| 317 | `case 'shoot':` | `case 'action_shoot':` |
| 320 | `case 'campaign':` | `case 'action_sheriff_campaign':` |
| 323 | `case 'withdraw':` | `case 'action_withdraw':` |
| 326 | `case 'assignOrder':` | `case 'action_assignOrder':` |
| 327 | `case 'passBadge':` | `case 'action_passBadge':` |
| 341 | `actionType === 'night_werewolf_vote'` | `actionType === 'action_night_werewolf_vote'` |
| 356 | `actionType === 'sheriff_vote'` | `actionType === 'action_sheriff_vote'` |
| 521 | `action === 'passBadge'` | `action === 'action_passBadge'` |
| 527 | `action === 'passBadge'` | `action === 'action_passBadge'` |
| 1038 | `case 'speak':` | 删除（从未实际触发） |
| 1158 | `speakActions` 数组中的字符串 | 全部加前缀，删除 `'speak'` |

### 17. test/game.test.js — setAI 调用

所有 setAI 的第二参数加前缀：

| 旧 | 新 |
|---|---|
| `'night_werewolf_vote'` | `'action_night_werewolf_vote'` |
| `'witch'` | `'action_witch'` |
| `'shoot'` | `'action_shoot'` |
| `'day_vote'` | `'action_day_vote'` |
| `'guard'` | `'action_guard'` |
| `'cupid'` | `'action_cupid'` |
| `'seer'` | `'action_seer'` |
| `'campaign'` | `'action_sheriff_campaign'` |
| `'withdraw'` | `'action_withdraw'` |
| `'sheriff_vote'` | `'action_sheriff_vote'` |
| `'passBadge'` | `'action_passBadge'` |

### 18. test/human-player.test.js — pendingAction.action 匹配

| 行号 | 旧 | 新 |
|---|---|---|
| 372 | `pendingAction?.action === 'campaign'` | `=== 'action_sheriff_campaign'` |
| 643 | `pendingAction?.action === 'assignOrder'` | `=== 'action_assignOrder'` |
| 769 | `pendingAction?.action === 'guard'` | `=== 'action_guard'` |
| 827 | `pendingAction?.action === 'guard'` | `=== 'action_guard'` |
| 884 | `pendingAction?.action === 'speak'` | `=== 'action_night_werewolf_discuss'` 或其他实际 speech actionType |
| 889 | `pendingAction?.action === 'wolf_vote'` | `=== 'action_night_werewolf_vote'`（修复 bug） |
| 1012 | `pendingAction?.action === 'passBadge'` | `=== 'action_passBadge'` |

### 19. test/ai_models.test.js — makeContext 参数

所有 `makeContext('xxx')` 中的字符串加前缀，以及 presetResponses 中的 key。

### 20. test/ai_agent.test.js — context.phase 测试数据

测试中 `phase: 'day_vote'` 等需要区分是 phase 还是 actionType。如果测试的是 AI context，应改为 `action: 'action_day_vote'`。

### 21. test/ai_integration.test.js — mockOptions presetResponses key

| 旧 | 新 |
|---|---|
| `night_werewolf_vote: 3` | `action_night_werewolf_vote: 3` |

### 22. test/tool_message_format.test.js — phase 变量

检查 `action: phase` 这类测试代码，确认 phase 值是否应为 actionType。

### 23. test/ai_context_behavior.test.js — buildContext 中 actionType

检查 `actionType: 'witch'`、`'seer'`、`'guard'` 等，加前缀。

### 24. test/preset.test.js — preset 配置中的 actionType key

| 行号 | 旧 | 新 |
|---|---|---|
| 236 | `wolf_vote: { target: 5 }` | `action_night_werewolf_vote: { target: 5 }` |

### 25. ai/agent/agent.js — context 使用修正

需要将 `context.phase`（查找工具/prompt用）改为 `context.action`（即 actionType），因为 context.phase 不再被覆盖。

具体修改点：
- `getTool(context.phase)` → `getTool(context.action)`
- `getPhasePrompt(context.phase, ...)` → `getPhasePrompt(context.action, ...)`
- `getToolsForAction(context.phase, ...)` → `getToolsForAction(context.action, ...)`

### 26. server.js — 无需修改

server.js 中 `data.action` 是从 `requestAction` 传来的，已经自动跟随 actionType 变化。

## 不需要修改的地方

以下使用的是 **phase ID**（不是 actionType），不需要加前缀：

- `engine/phase.js` 中 PHASE_FLOW 的 `id` 字段
- `engine/main.js` 中 `state.phase = currentPhaseId`
- `engine/main.js` 中 `msg.phase = phase.id`
- `engine/roles.js` 中 `availablePhases` 数组里的值
- `engine/config.js` 中与 phase 无关的配置
- `public/app.js` 中 `state.phase` 的比较和 phaseNames/phasePrompts 映射
- `public/controller.js` 中 `msg.phase` 的使用
- `cli_client.js` 中 `state.phase` 的使用
- `ai/agent/formatter.js` 中 `NIGHT_PHASES` 和 `DAY_PHASES` 数组
- `test/game.test.js` 中 `executePhase('night_werewolf_vote')` 等 phase ID 调用