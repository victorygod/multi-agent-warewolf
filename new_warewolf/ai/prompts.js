/**
 * 提示词统一管理
 */

// 角色描述
const ROLE_DESCRIPTIONS = {
  werewolf: '你是狼人。夜晚与同伴讨论并选择击杀目标，白天隐藏身份。',
  seer: '你是预言家。每晚可以查验一名玩家的身份（狼人/好人）。',
  witch: '你是女巫。有一瓶解药和毒药。',
  guard: '你是守卫。每晚守护一人，不能连续守护同一人。',
  hunter: '你是猎人。死亡时可以开枪带走一人。',
  villager: '你是村民。没有特殊技能。',
  idiot: '你是白痴。被投票出局时可以翻牌免疫。',
  cupid: '你是丘比特。第一夜可以连接两名玩家为情侣。',
  knight: '你是骑士。白天可以决斗一名玩家。',
  wolf_beauty: '你是狼美人。可以魅惑一名玩家，你死时TA也死。'
};

// 角色名称
const ROLE_NAMES = {
  werewolf: '狼人',
  seer: '预言家',
  witch: '女巫',
  guard: '守卫',
  hunter: '猎人',
  villager: '村民',
  idiot: '白痴',
  cupid: '丘比特',
  knight: '骑士',
  wolf_beauty: '狼美人'
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
  const camp = role.camp === 'wolf' ? '狼人阵营' : '好人阵营';
  const roleDesc = ROLE_DESCRIPTIONS[roleId] || '';
  const position = game.players.findIndex(p => p.id === player.id) + 1;
  const soul = player.soul || '你是一个普通的玩家。';

  // 狼人队友信息
  let wolfTeammates = '';
  if (role.camp === 'wolf') {
    const teammates = game.players
      .filter(p => p.id !== player.id && p.role?.camp === 'wolf')
      .map(p => {
        const pos = game.players.findIndex(gp => gp.id === p.id) + 1;
        return `${pos}号：${p.name}`;
      });
    if (teammates.length > 0) {
      wolfTeammates = `\n- 狼队友：${teammates.join('、')}`;
    }
  }

  return `狼人杀游戏
## 你的身份
- 名字：${player.name}
- 位置：${position}号位
- 角色：${roleName}
- 阵营：${camp}${wolfTeammates}
- ${roleDesc}

## 你的性格
${soul}

## 策略
首先整理目前已知确定性的信息和怀疑的信息。
对于事实性的事件，完全相信。
对于他人的发言，需要分情况分析，不可盲目轻信。
做出最能取得胜利的行动选项。
`;
}

// 阶段提示词
const PHASE_PROMPTS = {
  night_werewolf_discuss: () => '【狼人讨论】轮到你发言了，请与同伴讨论今晚的目标。以JSON格式返回: {"type": "speech", "content": "你说的话"}',
  night_werewolf_vote: (aliveList) => `【狼人投票】存活玩家：\n${aliveList}\n请选择今晚要击杀的玩家，回复位置编号（纯数字）。`,
  seer: (aliveList) => `【预言家】存活玩家：\n${aliveList}\n请选择要查验的玩家，回复位置编号（纯数字）。`,
  guard: (aliveList) => `【守卫】存活玩家：\n${aliveList}\n请选择要守护的玩家，回复位置编号（纯数字）。`,
  day_discuss: () => '【白天发言】轮到你发言了，请分析局势，简要发言。以JSON格式返回: {"type": "speech", "content": "你说的话"}',
  day_vote: (aliveList) => `【白天投票】存活玩家：\n${aliveList}\n请选择要放逐的玩家，回复位置编号，或选择弃权。`,
  last_words: () => '【遗言】你即将死亡，请发表遗言。以JSON格式返回: {"type": "speech", "content": "你的遗言"}',
  witch: (aliveList, context) => {
    const killedPlayer = context.werewolfTarget;
    const killedName = killedPlayer?.name || '无人';
    const killedPos = killedPlayer ? context.game.players.findIndex(p => p.id === killedPlayer.id) + 1 : '';
    const healAvailable = context.witchPotion?.heal ? '可用' : '已用完';
    const poisonAvailable = context.witchPotion?.poison ? '可用' : '已用完';
    return `【女巫】存活玩家：\n${aliveList}\n今晚 ${killedPos}号${killedName} 被狼人杀害。解药：${healAvailable}，毒药：${poisonAvailable}。以JSON格式返回: {"type": "witch", "action": "heal/poison/skip", "target": 编号}`;
  }
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

module.exports = {
  ROLE_DESCRIPTIONS,
  ROLE_NAMES,
  CAMP_NAMES,
  buildSystemPrompt,
  getPhasePrompt
};