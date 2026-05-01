/**
 * 游戏常量定义 - 统一管理所有枚举值
 *
 * 设计原则：
 * 1. PHASE_*: 游戏阶段 ID（phase.js 的 PHASE_FLOW 使用）
 * 2. ACTION_*: 行动类型（callSkill/callVote/callSpeech 的第二参数）
 * 3. MSG_*: 消息类型（MessageManager.add 的 type 字段）
 * 4. VISIBILITY_*: 消息可见性
 */

// ==================== 游戏阶段 ID ====================
/**
 * 夜晚阶段
 */
const PHASE = {
  // 阶段进入
  NIGHT_ENTER: 'night_enter',
  DAY_ENTER: 'day_enter',
  GAME_OVER: 'game_over',

  // 夜晚阶段
  CUPID: 'cupid',
  GUARD: 'guard',
  NIGHT_WEREWOLF_DISCUSS: 'night_werewolf_discuss',
  NIGHT_WEREWOLF_VOTE: 'night_werewolf_vote',
  WITCH: 'witch',
  SEER: 'seer',

  // 白天阶段
  SHERIFF_CAMPAIGN: 'sheriff_campaign',
  SHERIFF_SPEECH: 'sheriff_speech',
  SHERIFF_VOTE: 'sheriff_vote',
  DAY_ANNOUNCE: 'day_announce',
  DAY_DISCUSS: 'day_discuss',
  DAY_VOTE: 'day_vote',
  POST_VOTE: 'post_vote'
};

// ==================== 行动类型 ====================
/**
 * 行动类型 - 统一加 action_ 前缀，与 phase 区分
 *
 * 命名规则：
 * - 技能类：action_<role> 如 action_guard, action_seer
 * - 投票类：action_<time>_<type> 如 action_day_vote, action_night_werewolf_vote
 * - 发言类：action_<time>_<type> 如 action_day_discuss, action_last_words
 */
const ACTION = {
  // 夜晚行动
  GUARD: 'action_guard',
  WITCH: 'action_witch',
  WITCH_POISON: 'action_witch_poison',
  SEER: 'action_seer',
  CUPID: 'action_cupid',
  NIGHT_WEREWOLF_DISCUSS: 'action_night_werewolf_discuss',
  NIGHT_WEREWOLF_VOTE: 'action_night_werewolf_vote',

  // 白天行动
  DAY_DISCUSS: 'action_day_discuss',
  DAY_VOTE: 'action_day_vote',
  POST_VOTE: 'action_post_vote',
  LAST_WORDS: 'action_last_words',

  // 警长相关
  SHERIFF_CAMPAIGN: 'action_sheriff_campaign',
  SHERIFF_SPEECH: 'action_sheriff_speech',
  SHERIFF_VOTE: 'action_sheriff_vote',
  WITHDRAW: 'action_withdraw',
  ASSIGN_ORDER: 'action_assignOrder',
  PASS_BADGE: 'action_passBadge',

  // 技能行动
  SHOOT: 'action_shoot',
  EXPLODE: 'action_explode'
};

// ==================== 消息类型 ====================
const MSG = {
  PHASE_START: 'phase_start',
  SPEECH: 'speech',
  VOTE: 'vote',
  ACTION: 'action',
  SYSTEM: 'system',
  DEATH_ANNOUNCE: 'death_announce',
  WOLF_VOTE_RESULT: 'wolf_vote_result',
  SHERIFF_CANDIDATES: 'sheriff_candidates',
  GAME_OVER: 'game_over',
  ACTION_REQUIRED: 'action_required'
};

// ==================== 消息可见性 ====================
const VISIBILITY = {
  PUBLIC: 'public',
  SELF: 'self',
  CAMP: 'camp',
  COUPLE: 'couple',
  COUPLE_IDENTITY: 'coupleIdentity',
  CUPID_IDENTITY: 'cupidIdentity'
};

// ==================== 阵营类型 ====================
const CAMP = {
  GOOD: 'good',
  WOLF: 'wolf',
  THIRD: 'third'
};

// ==================== 角色类型 ====================
const ROLE_TYPE = {
  GOD: 'god',
  VILLAGER: 'villager',
  WEREWOLF: 'werewolf'
};

// ==================== 死亡原因 ====================
const DEATH_REASON = {
  WEREWOLF: 'wolf',
  POISON: 'poison',
  VOTE: 'vote',
  HUNTER: 'hunter',
  CONFLICT: 'conflict',  // 同守同救
  COUPLE: 'couple'  // 殉情
};

// ==================== 消息模板 ====================
// 注意：模板中不包含 {self}，消费端根据 playerId 和当前玩家ID自行判断是否添加 "(你)"
const MSG_TEMPLATE = {
  // 玩家发言
  SPEECH: '[发言|{player}]{content}',
  WOLF_SPEECH: '[狼人讨论|{player}]{content}',
  LAST_WORDS: '[遗言|{player}]{content}',
  SHERIFF_SPEECH: '[警长竞选发言|{player}]{content}',

  // 死亡与投票
  NIGHT_DEATH: '[系统]昨夜{玩家列表}死亡',
  DAY_VOTE: '[系统]放逐投票：{票型}',
  VOTE_TIE: '[系统]平票PK：{平票玩家}',
  VOTE_ANNOUNCE: '[系统]{player}被放逐',
  HUNTER_SHOOT: '[系统]{player}开枪带走了{target}',
  HUNTER_PASS: '[系统]{player}放弃开枪',

  // 技能结果
  SEER_CHECK: '[系统|私密]{player}查验{target}={result}',
  GUARD_PROTECT: '[系统|私密]{player}守护了{target}',
  WITCH_HEAL: '[系统|私密]{player}救了{target}',
  WITCH_POISON: '[系统|私密]{player}毒杀了{target}',
  CUPID_LINK_SELF: '[系统|私密]{player}连接了{t1}和{t2}为情侣',
  CUPLE_NOTIFY: '[系统|私密]{player}是你的情侣',
  IDIOT_REVEAL: '[系统]{player}翻牌为白痴',

  // 阶段与系统
  PHASE_DAY: '[系统]第{round}天',
  PHASE_NIGHT: '[系统]第{round}夜',
  SHERIFF_CANDIDATES: '[系统|警长竞选发言]警上：{警上列表} 警下：{警下列表}',
  SHERIFF_ELECTED: '[系统]{player}当选警长',
  WITHDRAW: '[系统]{player}退水',
  PEACEFUL_NIGHT: '[系统]昨夜平安夜',
  GAME_OVER: '[系统]游戏结束：{结果}',

  // 特殊事件
  WEREWOLF_EXPLODE: '[系统]{player}自爆',
  SHERIFF_ASSIGN_ORDER: '[系统]警长指定从{player}开始发言',
  SHERIFF_PASS_BADGE: '[系统]警长传警徽给{player}',
  SHERIFF_BADGE_LOST: '[系统]警徽流失',
  SHERIFF_DEAD: '[系统]警长死亡，警徽流失',
  NO_SHERIFF_CANDIDATE: '[系统]无人竞选警长',
  WOLF_VOTE_RESULT: '[系统|私密]狼刀票型：{票型}',
  WOLF_VOTE_EMPTY: '[系统|私密]狼人空刀'
};

// ==================== 导出所有常量 ====================
module.exports = {
  PHASE,
  ACTION,
  MSG,
  VISIBILITY,
  CAMP,
  ROLE_TYPE,
  DEATH_REASON,
  MSG_TEMPLATE
};