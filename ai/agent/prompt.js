/**
 * prompt.js - 提示词管理
 * 从 ai/prompts.js 迁移，移除 JSON 格式要求
 */

const fs = require('fs');
const path = require('path');

const { CAMP, ACTION } = require('../../engine/constants');

const SYSTEM_MESSAGE_SUFFIX = '不重复别人说的话，说你独特的见解。提到他人时务必采用名字，若你认识对方可根据对方性格做判断或调侃。使用中文说话';


// 分析提示词（用于 AI 分析他人发言，不保留在历史中）

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

function loadStrategyGuide(presetId, roleId) {
  if (!presetId || !roleId) return '';
  const strategyPath = path.join(__dirname, '..', 'strategy', presetId, `${roleId}.md`);
  try {
    if (fs.existsSync(strategyPath)) return fs.readFileSync(strategyPath, 'utf-8');
  } catch (err) { /* ignore */ }
  return '';
}

function buildSystemPrompt(player, game, background) {
  const role = player.role;
  const roleId = role.id || role;
  const roleName = ROLE_NAMES[roleId] || roleId;
  const position = (game.players || []).findIndex(p => p.id === player.id) + 1;

  let wolfTeammates = '';
  if (role.camp === CAMP.WOLF) {
    const teammates = (game.players || [])
      .filter(p => p.id !== player.id && p.role?.camp === CAMP.WOLF)
      .map(p => {
        const pos = (game.players || []).findIndex(gp => gp.id === p.id) + 1;
        return `${pos}号${p.name}`;
      });
    if (teammates.length > 0) wolfTeammates = ` 队友:${teammates.join(',')}`;
  }

  const ruleDescs = game.preset?.ruleDescriptions || [];
  const rulesText = ruleDescs.length > 0 ? '规则:' + ruleDescs.join('|') : '';

  const presetId = game.presetId || game.preset?.name?.replace('人', '-') || '';
  const strategyGuide = loadStrategyGuide(presetId, roleId);

  const strategySection = strategyGuide ? `\n\n【角色攻略】\n${strategyGuide}\n` : '';

  const playersList = (game.players || []).map((p, i) => {
    const suffix = p.id === player.id ? '（你）' : '';
    return `${i + 1}号:${p.name}${suffix}`;
  }).join('，');

  const backgroundSection = background ? `\n\n【背景】\n${background}` : '';

  return `你在参与一场狼人杀游戏，你的名字:${player.name} 位置:${position}号位 角色:${roleName}${wolfTeammates}
本局玩家：${playersList}
【特殊规则】
${rulesText}
【参考策略】
${strategySection}
${backgroundSection}
${SYSTEM_MESSAGE_SUFFIX}`;
}


// 阶段提示词（无 JSON 格式要求，候选列表保留文本方便 LLM 理解）
const CURRENT_TASK = {
  analyze: () => '请分析本条发言，其可能在欺骗，也可能说漏嘴，寻找其中视野面或逻辑上的漏洞，结合局势做出分析判断。你的分析内容不会被其他人听到，不超过 100 字。',
  [ACTION.NIGHT_WEREWOLF_DISCUSS]: () => '【狼人讨论】轮到你发言了，请调用 action_night_werewolf_discuss 工具与同伴讨论今晚的目标，100字以内。',
  [ACTION.NIGHT_WEREWOLF_VOTE]: (aliveList) => `【狼人投票】可选玩家：\n${aliveList}\n请调用 action_night_werewolf_vote 工具选择今晚要击杀的玩家，或弃权。`,
  [ACTION.SEER]: (aliveList) => `【预言家】可选玩家：\n${aliveList}\n请调用 action_seer 工具选择要查验的玩家。`,
  [ACTION.GUARD]: (aliveList) => `【守卫】可选玩家：\n${aliveList}\n请调用 action_guard 工具选择要守护的玩家。`,
  [ACTION.DAY_DISCUSS]: () => '【白天发言】轮到你发言了，请分析局势，调用 action_day_discuss 工具简要发言，注意避免信息泄露，提到他人时务必采用名字，可调侃，100字以内。',
  [ACTION.DAY_VOTE]: (aliveList, context) => {
    const allowedTargets = context?.extraData?.allowedTargets;
    let targetList = aliveList;
    if (allowedTargets && allowedTargets.length > 0) {
      const candidates = context.players.filter(p => allowedTargets.includes(p.id));
      targetList = candidates.map(p => {
        const pos = context.players.findIndex(gp => gp.id === p.id) + 1;
        return `${pos}号: ${p.name}`;
      }).join('\n');
    }
    return `【白天投票】可选玩家：\n${targetList}\n请调用 action_day_vote 工具选择要放逐的玩家，注意票型会公开。或弃权。`;
  },
  [ACTION.POST_VOTE]: (aliveList, context) => {
    const allowedTargets = context?.extraData?.allowedTargets;
    let targetList = aliveList;
    if (allowedTargets && allowedTargets.length > 0) {
      const candidates = context.players.filter(p => allowedTargets.includes(p.id));
      targetList = candidates.map(p => {
        const pos = context.players.findIndex(gp => gp.id === p.id) + 1;
        return `${pos}号: ${p.name}`;
      }).join('\n');
    }
    return `【PK投票】可选玩家：\n${targetList}\n请调用 action_post_vote 工具选择要放逐的玩家，注意票型会公开。或弃权。`;
  },
  [ACTION.LAST_WORDS]: () => '【遗言】你即将死亡，请调用 action_last_words 工具发表遗言，100字以内。',
  [ACTION.WITCH]: (aliveList, context) => {
    const players = context.players || [];
    const targetId = context.werewolfTarget?.id ?? context.werewolfTarget;
    const killedPlayer = targetId ? players.find(p => p.id === targetId) : null;
    const killedName = killedPlayer?.name || '无人';
    const killedPos = killedPlayer ? players.findIndex(p => p.id === targetId) + 1 : '';
    const healAvailable = context.witchPotion?.heal ? '可用' : '已用完';
    const poisonAvailable = context.witchPotion?.poison ? '可用' : '已用完';
    return `【女巫】可选玩家：\n${aliveList}\n今晚 ${killedPos}号${killedName} 被狼人杀害。解药：${healAvailable}，毒药：${poisonAvailable}。请调用 action_witch 工具决定是否使用解药或毒药。`;
  },
  [ACTION.SHERIFF_CAMPAIGN]: () => '【警长竞选】是否参与警长竞选？请调用 action_sheriff_campaign 工具。',
  [ACTION.WITHDRAW]: () => '【退水】是否退出警长竞选？请调用 action_withdraw 工具。',
  [ACTION.SHERIFF_SPEECH]: () => '【警长竞选发言】轮到你发言了，请调用 action_sheriff_speech 工具说明为什么应该选你当警长，100字以内。',
  [ACTION.SHERIFF_VOTE]: (aliveList, context) => {
    const allowedTargets = context?.extraData?.allowedTargets;
    let targetList = aliveList;
    if (allowedTargets && allowedTargets.length > 0) {
      const candidates = context.players.filter(p => allowedTargets.includes(p.id));
      targetList = candidates.map(p => {
        const pos = context.players.findIndex(gp => gp.id === p.id) + 1;
        return `${pos}号: ${p.name}`;
      }).join('\n');
    }
    return `【警长投票】可选候选人：\n${targetList}\n请调用 action_sheriff_vote 工具选择要投票的候选人，注意票型会公开。或弃权。`;
  },
  [ACTION.CUPID]: (aliveList) => `【丘比特】可选玩家：\n${aliveList}\n请调用 action_cupid 工具选择两名玩家连接为情侣。`,
  [ACTION.SHOOT]: (aliveList) => `【猎人开枪】可选玩家：\n${aliveList}\n你已死亡，请调用 action_shoot 工具选择开枪带走一名玩家，或放弃开枪。`,
  [ACTION.PASS_BADGE]: (aliveList) => `【传警徽】可选玩家：\n${aliveList}\n你是警长，已死亡。请调用 action_passBadge 工具选择将警徽传给谁，或不传。`,
  [ACTION.ASSIGN_ORDER]: (aliveList, context) => {
    const allowedTargets = context?.extraData?.allowedTargets;
    let targetList = aliveList;
    if (allowedTargets && allowedTargets.length > 0) {
      const candidates = context.players.filter(p => allowedTargets.includes(p.id));
      targetList = candidates.map(p => {
        const pos = context.players.findIndex(gp => gp.id === p.id) + 1;
        return `${pos}号: ${p.name}`;
      }).join('\n');
    }
    return `【指定发言顺序】可选玩家：\n${targetList}\n你是警长，请调用 action_assignOrder 工具指定从哪位玩家开始发言。`;
  }
};

function getCurrentTask(action, context) {
  const players = context.players || [];
  const alivePlayers = context.alivePlayers || [];
  const aliveList = alivePlayers.map(p => {
    const pos = players.findIndex(gp => gp.id === p.id) + 1;
    return `${pos}号: ${p.name}`;
  }).join('\n');

  const taskFn = CURRENT_TASK[action];
  if (taskFn) return taskFn(aliveList, context);
  return '请行动。';
}

function isSpeech(action) {
  return [ACTION.DAY_DISCUSS, ACTION.LAST_WORDS, ACTION.SHERIFF_SPEECH, ACTION.NIGHT_WEREWOLF_DISCUSS].includes(action);
}

function buildCurrentTurn(newContent, action, context, profile) {
  const task = getCurrentTask(action, context);
  const fullParts = [newContent];
  if (profile?.thinking) fullParts.push(`【行为逻辑】\n${profile.thinking}`);
  if (isSpeech(action) && profile?.speaking) fullParts.push(`【说话方式】\n${profile.speaking}`);
  fullParts.push(task);
  const historyParts = [newContent, task];
  return { full: fullParts.join('\n\n'), history: historyParts.join('\n\n') };
}

// AI 人物设定
function loadProfilesFromDir(dir) {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory());
  return entries.map(d => {
    const dirPath = path.join(dir, d.name);
    const profileData = JSON.parse(fs.readFileSync(path.join(dirPath, 'profile.json'), 'utf-8'));
    const background = fs.readFileSync(path.join(dirPath, 'background.md'), 'utf-8');
    const thinking = fs.readFileSync(path.join(dirPath, 'thinking.md'), 'utf-8');
    const speaking = fs.readFileSync(path.join(dirPath, 'speaking.md'), 'utf-8');
    return {
      name: profileData.name,
      background,
      thinking,
      speaking,
      englishName: profileData.englishName,
      faction: profileData.faction,
      path: profileData.path,
      element: profileData.element
    };
  });
}

const DEFAULT_THINKING = '你是一个优秀的狼人杀玩家，对其他人说的话保持专业的批判性思考，通过理性推理得到自己的行动。';

const CREATIVE_NAMES = [
  '沈暮', '苏铭', '叶涟', '洛川', '秦霜', '宁曦', '萧衍', '慕白',
  '江辞', '顾渊', '陆沉', '唐晚', '宋瓷', '周衍', '吴钩', '齐曜',
  '程昱', '谢云', '钟离', '方乾', '林曜', '秦夜', '白泽', '赤羽',
  '佐藤葵', '朴俊', '金恩', '本田翼', '中岛雪', '崔然', '藤堂静',
  '金智秀', '山田风', '李承欢', '渡边月', '福山润', '小林秀',
  '朴涩琪', '尹瑞', '姜暮', '安室', '野原', '斋藤树',
  'Luna', 'Caspian', 'Elowen', 'Kael', 'Seraphina', 'Dorian',
  'Lyra', 'Orion', 'Astrid', 'Caelum', 'Isolde', 'Ronan',
  'Evangeline', 'Magnus', 'Celestine', 'Zephyr', 'Thessaly',
  'Arwen', 'Percival', 'Gwendolyn', 'Aldric', 'Rosalind', 'Finley',
  '艾瑟兰', '奥瑞利安', '席芙', '塔里昂', '弥赛亚', '艾隆索',
  '赛尔温', '莫瑞甘', '沃克', '艾希亚', '德鲁伊', '凯兰崔尔',
  '尤瑟', '梅林', '亚瑟', '潘多拉', '该隐', '莉莉丝'
];

// 从 ai/profiles/ 目录加载（兼容旧路径）
const AI_PROFILES = loadProfilesFromDir(path.join(__dirname, '..', 'profiles'));

let usedNames = new Set();

function resetUsedNames() {
  usedNames = new Set();
}

function getRandomProfiles(count) {
  const fileProfiles = AI_PROFILES.filter(p => !usedNames.has(p.name));
  const shuffledFile = fileProfiles.sort(() => Math.random() - 0.5);

  if (shuffledFile.length >= count) {
    const selected = shuffledFile.slice(0, count);
    selected.forEach(p => usedNames.add(p.name));
    return selected;
  }

  const loadedNames = new Set(AI_PROFILES.map(p => p.name));
  const availableRandomNames = CREATIVE_NAMES.filter(n => !loadedNames.has(n) && !usedNames.has(n));
  const shuffledRandom = availableRandomNames.sort(() => Math.random() - 0.5);
  const randomProfiles = shuffledRandom.map(name => ({ name, background: '', thinking: DEFAULT_THINKING, speaking: '' }));

  const selected = [...shuffledFile, ...randomProfiles].slice(0, count);
  selected.forEach(p => usedNames.add(p.name));
  return selected;
}

module.exports = {
  buildSystemPrompt,
  getCurrentTask,
  buildCurrentTurn,
  isSpeech,
  getRandomProfiles,
  resetUsedNames,
  ROLE_NAMES,
  DEFAULT_THINKING,
  CREATIVE_NAMES
};