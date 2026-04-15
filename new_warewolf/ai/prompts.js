/**
 * 提示词统一管理
 */

// 特殊规则说明（每个角色都能看到）
const SPECIAL_RULES = '规则:女巫仅首夜可自救|守卫不可连守|猎人被毒不能开枪|首夜/白天死亡有遗言|情侣一方死另一方殉情';

// 角色名称
const ROLE_NAMES = {
  werewolf: '狼人',
  seer: '预言家',
  witch: '女巫',
  guard: '守卫',
  hunter: '猎人',
  villager: '村民',
  idiot: '白痴',
  cupid: '丘比特'
};

// 阵营名称
const CAMP_NAMES = {
  good: '好人阵营',
  wolf: '狼人阵营',
  third: '第三方阵营'
};

// 生成系统提示词
function buildSystemPrompt(player, game) {
  const role = player.role;
  const roleId = role.id || role;
  const roleName = ROLE_NAMES[roleId] || roleId;
  const position = game.players.findIndex(p => p.id === player.id) + 1;
  const soul = player.soul || '你是一个普通的玩家。';

  // 狼人队友信息（仅狼人可见）
  let wolfTeammates = '';
  if (role.camp === 'wolf') {
    const teammates = game.players
      .filter(p => p.id !== player.id && p.role?.camp === 'wolf')
      .map(p => {
        const pos = game.players.findIndex(gp => gp.id === p.id) + 1;
        return `${pos}号${p.name}`;
      });
    if (teammates.length > 0) {
      wolfTeammates = ` 队友:${teammates.join(',')}`;
    }
  }

  return `名字:${player.name} 位置:${position}号位 角色:${roleName}${wolfTeammates}
${soul}
${SPECIAL_RULES}`;
}

// 阶段提示词（统一要求 JSON 格式返回）
const PHASE_PROMPTS = {
  night_werewolf_discuss: () => '【狼人讨论】轮到你发言了，请与同伴讨论今晚的目标。以JSON格式返回: {"type": "speech", "content": "你说的话"}',
  night_werewolf_vote: (aliveList) => `【狼人投票】可选玩家：\n${aliveList}\n请选择今晚要击杀的玩家。以JSON格式返回: {"type": "vote", "target": 位置编号} 或 {"type": "skip"} 弃权`,
  seer: (aliveList) => `【预言家】可选玩家：\n${aliveList}\n请选择要查验的玩家。以JSON格式返回: {"type": "target", "target": 位置编号}`,
  guard: (aliveList) => `【守卫】可选玩家：\n${aliveList}\n请选择要守护的玩家。以JSON格式返回: {"type": "target", "target": 位置编号}`,
  day_discuss: () => '【白天发言】轮到你发言了，请分析局势，简要发言。以JSON格式返回: {"type": "speech", "content": "你说的话"}',
  day_vote: (aliveList, context) => {
    // 使用 allowedTargets 显示实际可选玩家（排除自己）
    const allowedTargets = context?.extraData?.allowedTargets;
    let targetList = aliveList;
    if (allowedTargets && allowedTargets.length > 0) {
      const candidates = context.game.players.filter(p => allowedTargets.includes(p.id));
      targetList = candidates.map(p => {
        const pos = context.game.players.findIndex(gp => gp.id === p.id) + 1;
        return `${pos}号: ${p.name}`;
      }).join('\n');
    }
    return `【白天投票】可选玩家：\n${targetList}\n请选择要放逐的玩家。以JSON格式返回: {"type": "vote", "target": 位置编号} 或 {"type": "skip"} 弃权`;
  },
  // 放逐后处理（PK投票等）
  post_vote: (aliveList, context) => {
    const allowedTargets = context?.extraData?.allowedTargets;
    let targetList = aliveList;
    if (allowedTargets && allowedTargets.length > 0) {
      const candidates = context.game.players.filter(p => allowedTargets.includes(p.id));
      targetList = candidates.map(p => {
        const pos = context.game.players.findIndex(gp => gp.id === p.id) + 1;
        return `${pos}号: ${p.name}`;
      }).join('\n');
    }
    return `【PK投票】可选玩家：\n${targetList}\n请选择要放逐的玩家。以JSON格式返回: {"type": "vote", "target": 位置编号} 或 {"type": "skip"} 弃权`;
  },
  last_words: () => '【遗言】你即将死亡，请发表遗言。以JSON格式返回: {"type": "speech", "content": "你的遗言"}',
  witch: (aliveList, context) => {
    // werewolfTarget 可能是玩家ID（数字）或玩家对象，需要兼容处理
    const targetId = context.werewolfTarget?.id ?? context.werewolfTarget;
    const killedPlayer = targetId ? context.game.players.find(p => p.id === targetId) : null;
    const killedName = killedPlayer?.name || '无人';
    const killedPos = killedPlayer ? context.game.players.findIndex(p => p.id === targetId) + 1 : '';
    const healAvailable = context.witchPotion?.heal ? '可用' : '已用完';
    const poisonAvailable = context.witchPotion?.poison ? '可用' : '已用完';
    return `【女巫】可选玩家：\n${aliveList}\n今晚 ${killedPos}号${killedName} 被狼人杀害。解药：${healAvailable}，毒药：${poisonAvailable}。以JSON格式返回: {"type": "heal"} 或 {"type": "poison", "target": 编号} 或 {"type": "skip"}`;
  },
  // 警长竞选相关
  campaign: () => '【警长竞选】是否参与警长竞选？以JSON格式返回: {"type": "campaign", "run": true/false}',
  withdraw: () => '【退水】是否退出警长竞选？以JSON格式返回: {"type": "withdraw", "withdraw": true/false}',
  sheriff_speech: () => '【警长竞选发言】轮到你发言了，请说明为什么应该选你当警长。以JSON格式返回: {"type": "speech", "content": "你说的话"}',
  sheriff_vote: (aliveList) => `【警长投票】候选人列表见消息历史。\n请选择要投票的候选人。以JSON格式返回: {"type": "vote", "target": 位置编号} 或 {"type": "skip"} 弃权`,
  // 技能相关
  cupid: (aliveList) => `【丘比特】可选玩家：\n${aliveList}\n请选择两名玩家连接为情侣。以JSON格式返回: {"type": "cupid", "targets": [位置编号1, 位置编号2]}`,
  shoot: (aliveList) => `【猎人开枪】可选玩家：\n${aliveList}\n你已死亡，可以选择开枪带走一名玩家。以JSON格式返回: {"type": "shoot", "target": 位置编号} 或 {"type": "skip"} 放弃开枪`,
  pass_badge: (aliveList) => `【传警徽】可选玩家：\n${aliveList}\n你是警长，已死亡。请选择将警徽传给谁。以JSON格式返回: {"type": "pass_badge", "target": 位置编号} 或 {"type": "skip"} 不传`,
  assignOrder: (aliveList, context) => {
    // 使用 allowedTargets 排除自己
    const allowedTargets = context?.extraData?.allowedTargets;
    let targetList = aliveList;
    if (allowedTargets && allowedTargets.length > 0) {
      const candidates = context.game.players.filter(p => allowedTargets.includes(p.id));
      targetList = candidates.map(p => {
        const pos = context.game.players.findIndex(gp => gp.id === p.id) + 1;
        return `${pos}号: ${p.name}`;
      }).join('\n');
    }
    return `【指定发言顺序】可选玩家：\n${targetList}\n你是警长，请指定从哪位玩家开始发言。以JSON格式返回: {"type": "assignOrder", "target": 位置编号}`;
  },
  // 选择目标
  choose_target: (aliveList) => `【选择目标】可选玩家：\n${aliveList}\n请选择目标玩家。以JSON格式返回: {"type": "target", "target": 位置编号}`
};

// 获取阶段提示词
function getPhasePrompt(phase, context) {
  const aliveList = context.alivePlayers.map(p => {
    const pos = context.game.players.findIndex(gp => gp.id === p.id) + 1;
    return `${pos}号: ${p.name}`;
  }).join('\n');

  const promptFn = PHASE_PROMPTS[phase];
  if (promptFn) {
    return promptFn(aliveList, context);
  }
  return '请行动。';
}

// AI 人物设定
const AI_PROFILES = [
  { name: '阿明', soul: '你是一个直爽的人，说话直接，不喜欢拐弯抹角。你相信直觉，做事果断。' },
  { name: '小红', soul: '你是一个细心的人，善于观察细节。你说话温和，但逻辑清晰。' },
  { name: '大刚', soul: '你是一个豪爽的人，喜欢带头说话。你比较有主见，不轻易改变想法。' },
  { name: '小丽', soul: '你是一个谨慎的人，不会轻易表态。你喜欢先观察再发言。' },
  { name: '阿华', soul: '你是一个理性的人，喜欢分析局势。你说话有条理，喜欢列举理由。' },
  { name: '小芳', soul: '你是一个敏感的人，容易察觉他人的情绪变化。你说话比较委婉。' },
  { name: '强子', soul: '你是一个冲动的人，容易激动。你说话大声，喜欢质疑别人。' },
  { name: '小娟', soul: '你是一个稳重的人，做事有分寸。你说话不多但很有分量。' },
  { name: '阿伟', soul: '你是一个聪明的人，反应快。你善于抓住别人话语中的漏洞。' },
  { name: '小燕', soul: '你是一个活泼的人，喜欢互动。你说话轻松幽默，能活跃气氛。' },
  { name: '大军', soul: '你是一个沉稳的人，不慌不忙。你说话慢但很有说服力。' },
  { name: '小玲', soul: '你是一个机灵的人，反应敏捷。你善于随机应变，说话灵活。' },
  { name: '阿鹏', soul: '你是一个正直的人，看不惯虚伪。你说话直接，敢于指出问题。' },
  { name: '小霞', soul: '你是一个温柔的人，不喜欢冲突。你说话柔和，善于调解矛盾。' },
  { name: '阿杰', soul: '你是一个深沉的人，心思缜密。你说话不多但每句都经过思考。' },
  { name: '小云', soul: '你是一个随和的人，不争不抢。你说话轻松，不喜欢压力。' }
];

let usedNames = new Set();

function resetUsedNames() {
  usedNames = new Set();
}

function getRandomProfiles(count) {
  const available = AI_PROFILES.filter(p => !usedNames.has(p.name));
  const shuffled = available.sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, count);
  selected.forEach(p => usedNames.add(p.name));
  return selected;
}

module.exports = {
  SPECIAL_RULES,
  ROLE_NAMES,
  CAMP_NAMES,
  AI_PROFILES,
  buildSystemPrompt,
  getPhasePrompt,
  getRandomProfiles,
  resetUsedNames
};