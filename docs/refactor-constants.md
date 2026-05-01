# 常量替换：字符串字面量 → constants.js

排除：role.id 比较、测试文件、constants.js 本身、MSG_TEMPLATE

## 需新增常量

- `PHASE.GAME_OVER: 'game_over'`（main.js:662, phase.js:509 用到）

## engine/phase.js

- `'wolf_vote_result'` ×2 → MSG.WOLF_VOTE_RESULT
- `'camp'` ×2 → VISIBILITY.CAMP
- `'sheriff_candidates'` ×1 → MSG.SHERIFF_CANDIDATES
- `'public'` ×2 → VISIBILITY.PUBLIC
- `'conflict'`/`'wolf'`/`'poison'`/`'vote'` ×4 → DEATH_REASON.*
- `'death_announce'` ×1 → MSG.DEATH_ANNOUNCE
- `'day_announce'` ×3 → PHASE.DAY_ANNOUNCE

## engine/roles.js

- `'wolf'`/`'conflict'`/`'poison'`/`'hunter'`/`'couple'`/`'vote'` ×8 → DEATH_REASON.*
- `action_assignOrder:`/`action_passBadge:` ×2 → [ACTION.*]:

## engine/vote.js

- `'public'` ×4 → VISIBILITY.PUBLIC
- `'vote'` ×1 → DEATH_REASON.VOTE
- `'death_announce'` ×1 → MSG.DEATH_ANNOUNCE
- `'action_post_vote'`/`'action_sheriff_vote'` ×2 → ACTION.*

## engine/main.js

- `skills?.action_explode` ×1 → skills?.[ACTION.EXPLODE]
- `filters?.action_*` ×7 → filters?.[ACTION.*]
- `'public'` ×2 → VISIBILITY.PUBLIC
- `'sheriff_speech'`/`'speech'` ×2 → MSG.*
- `'hunter'` ×1 → DEATH_REASON.HUNTER
- `'game_over'` ×1 → PHASE.GAME_OVER

## engine/player.js

- `['action_*']` 数组 ×1 → [ACTION.*]
- `'action_*'` 比较 ×7 → ACTION.*
- `'public'` ×2 → VISIBILITY.PUBLIC

## engine/message.js

- `'public'` ×1 → VISIBILITY.PUBLIC

## engine/config.js

- `'third'` ×1 → CAMP.THIRD
- `'couple'`/`'vote'`/`'hunter'` ×3 → DEATH_REASON.*

## ai/agent/formatter.js

- `'phase_start'` ×1 → MSG.PHASE_START
- `case 'action_*'` ×17 → case ACTION.*

## ai/agent/tools.js

- `'action_*'` 字符串 ×26 → ACTION.*

## ai/agent/prompt.js

- PHASE_PROMPTS key ×17 → [ACTION.*]:

## ai/controller.js

- `'public'` ×1 → VISIBILITY.PUBLIC
- `'action_day_vote'` ×2 → ACTION.DAY_VOTE

## ai/agent/models/random_model.js

- `'action_*'` ×16 → ACTION.*

## ai/agent/models/mock_model.js

- `'action_*'` ×17 → ACTION.*