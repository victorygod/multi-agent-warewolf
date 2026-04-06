/**
 * AI Agent - 简化版，JSON 响应格式
 */

const { ROLES, ROLE_NAMES, CAMPS, GAME_CONFIGS } = require('../game/roles');
const { PHASES } = require('../game/engine');

// 生成游戏规则
function getGameRules(playerCount) {
  const config = GAME_CONFIGS[playerCount];
  if (!config) {
    return `狼人杀 ${playerCount}人局`;
  }

  // 根据配置生成角色列表
  const roleParts = [];
  if (config.roles[ROLES.SEER]) roleParts.push(`${config.roles[ROLES.SEER]}预言家`);
  if (config.roles[ROLES.WITCH]) roleParts.push(`${config.roles[ROLES.WITCH]}女巫`);
  if (config.roles[ROLES.GUARD]) roleParts.push(`${config.roles[ROLES.GUARD]}守卫`);
  if (config.roles[ROLES.HUNTER]) roleParts.push(`${config.roles[ROLES.HUNTER]}猎人`);
  if (config.roles[ROLES.VILLAGER]) roleParts.push(`${config.roles[ROLES.VILLAGER]}村民`);
  if (config.roles[ROLES.WEREWOLF]) roleParts.push(`${config.roles[ROLES.WEREWOLF]}狼人`);

  return `狼人杀 ${playerCount}人局（${roleParts.join('、')}）
胜利条件：屠边（狼人杀光好人，或好人投死所有狼人）
无警长
遗言规则：白天被投死或狼人刀死可以留遗言，猎人被毒死不能开枪`;
}

// 角色描述
const ROLE_DESCRIPTIONS = {
  werewolf: '你是狼人。夜晚与同伴讨论并选择击杀目标，白天隐藏身份。',
  seer: '你是预言家。每晚可以查验一名玩家的身份（狼人/好人）。',
  witch: '你是女巫。有一瓶解药和毒药。',
  guard: '你是守卫。每晚守护一人，不能连续守护同一人。',
  hunter: '你是猎人。死亡时可以开枪带走一人。',
  villager: '你是村民。没有特殊技能。'
};

class AIAgent {
  constructor(player, game) {
    this.player = player;
    this.game = game;
    this.lastMessages = null; // 保存最后的 messages 用于调试
    this.lastUserPrompt = null; // 保存最后的 user prompt 用于调试
  }

  init(gameContext) {
    const role = ROLE_NAMES[this.player.role];
    const camp = CAMPS[this.player.role] === 'wolf' ? '狼人阵营' : '好人阵营';
    const roleDesc = ROLE_DESCRIPTIONS[this.player.role];

    // 计算位置（1-based）
    const position = this.game.players.findIndex(p => p.id === this.player.id) + 1;

    // 获取 soul
    const soul = this.player.soul || '你是一个普通的玩家。';

    // 生成游戏规则
    const gameRules = getGameRules(this.game.playerCount);

    // 狼人阵营：显示狼队友信息
    let wolfTeammates = '';
    if (CAMPS[this.player.role] === 'wolf') {
      const wolfTeammatesList = this.game.players
        .filter(p => p.id !== this.player.id && CAMPS[p.role] === 'wolf')
        .map(p => {
          const pos = this.game.players.findIndex(gp => gp.id === p.id) + 1;
          return `${pos}号：${p.name}`;
        });
      if (wolfTeammatesList.length > 0) {
        wolfTeammates = `\n- 狼队友：${wolfTeammatesList.join('、')}`;
      }
    }

    this.systemPrompt = `${gameRules}

## 你的身份
- 名字：${this.player.name}
- 位置：${position}号位
- 角色：${role}
- 阵营：${camp}${wolfTeammates}
- ${roleDesc}

## 你的性格
${soul}

## 策略
首先整理目前已知确定性的信息和怀疑的信息。
对于事实性的事件，完全相信，例如谁死了，猎人发动技能等。
对于他人的发言，需要分情况分析，不可盲目轻信。
列举几个可能的行动方向。
为每个行动方向推演这么做对己方阵营胜利有什么好处。
再分析对方阵营会得到什么线索以及可能做出的反应。
做出最能取得胜利的行动选项。（注意胜利条件是屠边的话，清理掉所有神或所有村民就是狼人胜利）
`;
  }

  // 构建 messages
  buildMessages(gameContext) {
    const { phase, messageHistory } = gameContext;

    // 格式化历史消息
    const historyText = this.formatMessageHistory(messageHistory);

    // 当前阶段提示
    const phasePrompt = this.getPhasePrompt(phase, gameContext);

    // 拼接 user 消息
    const userContent = `${historyText}${phasePrompt}`;

    // 构建 messages：system + user（历史+当前阶段）
    this.lastMessages = [
      { role: 'system', content: this.systemPrompt },
      { role: 'user', content: userContent }
    ];

    this.lastUserPrompt = userContent;

    return this.lastMessages;
  }

  // 格式化消息历史
  formatMessageHistory(messages) {
    if (!messages || messages.length === 0) return '';

    const lines = [];
    let lastPeriod = ''; // 记录上一个时期（第X夜/第X天）

    // 获取消息所属时期
    const getPeriod = (msg) => {
      if (!msg.phase) return '';
      if (msg.phase.startsWith('night')) {
        return `第${msg.dayCount}夜`;
      } else {
        return `第${msg.dayCount}天`;
      }
    };

    messages.forEach(msg => {
      // 获取当前消息的时期
      const currentPeriod = getPeriod(msg);

      // 时期变化时添加分隔线
      if (currentPeriod && currentPeriod !== lastPeriod) {
        lines.push(`\n===== ${currentPeriod} =====`);
        lastPeriod = currentPeriod;
      }

      // 消息内容
      if (msg.type === 'phase_start') {
        // 阶段分隔已在上面处理，这里不重复显示
      }
      // 死亡信息
      else if (msg.type === 'death') {
        lines.push(`【昨晚】${msg.content}`);
      }
      // 放逐信息
      else if (msg.type === 'exile') {
        // 将 <br> 转换为换行
        const content = msg.content.replace(/<br>/g, '\n');
        lines.push(`【投票】${content}`);
      }
      // 发言
      else if (msg.type === 'speech' || msg.type === 'wolf_speech') {
        const phaseLabel = this.getPhaseLabel(msg.phase);
        // 用 playerId 找位置，避免重名问题
        const playerIndex = this.game.players.findIndex(p => p.id === msg.playerId);
        const pos = playerIndex >= 0 ? playerIndex + 1 : '?';
        lines.push(`[${phaseLabel}] ${pos}号${msg.playerName}：${msg.content}`);
      }
      // 私有消息（自己的行动）
      else if (msg.type === 'vote' || msg.type === 'skill_use' || msg.type === 'skill_result') {
        lines.push(`[行动] ${msg.content}`);
      }
      // 遗言
      else if (msg.type === 'last_words') {
        // 用 playerId 找位置
        const playerIndex = this.game.players.findIndex(p => p.id === msg.playerId);
        const pos = playerIndex >= 0 ? playerIndex + 1 : '?';
        // content 已经包含"【xxx的遗言】"前缀，替换为带位置的格式
        const content = msg.content.replace(`【${msg.playerName}的遗言】`, `【${pos}号${msg.playerName}的遗言】`);
        lines.push(content);
      }
      // 猎人开枪
      else if (msg.type === 'hunter_shoot') {
        lines.push(`【猎人开枪】${msg.content}`);
      }
    });

    return lines.join('\n') + '\n\n';
  }

  // 获取阶段标签
  getPhaseLabel(phase) {
    const labels = {
      'night_werewolf_discuss': '狼人讨论',
      'night_werewolf_vote': '狼人投票',
      'day_discuss': '白天发言',
      'day_vote': '白天投票'
    };
    return labels[phase] || '';
  }

  async getAction(gameContext) {
    const { phase, alivePlayers } = gameContext;

    // 构建 messages
    this.buildMessages(gameContext);

    // API 不可用，返回随机行动
    if (!this.isApiAvailable()) {
      const action = this.getRandomAction(gameContext);
      return { ...action, _debug: this.getDebugInfo('random') };
    }

    try {
      const response = await this.callAPI();
      const action = this.parseResponse(response, phase, alivePlayers);
      return { ...action, _debug: this.getDebugInfo('llm') };
    } catch (e) {
      console.log(`[AI] ${this.player.name} API 错误：${e.message}`);
      const action = this.getRandomAction(gameContext);
      return { ...action, _debug: this.getDebugInfo('random') };
    }
  }

  // 获取调试信息
  getDebugInfo(source) {
    return {
      source,
      systemPrompt: this.systemPrompt,
      userPrompt: this.lastUserPrompt,
      messages: this.lastMessages
    };
  }

  getPhasePrompt(phase, context) {
    // 获取存活玩家列表（带位置号）
    const aliveList = context.alivePlayers.map(p => {
      const pos = this.game.players.findIndex(gp => gp.id === p.id) + 1;
      return `${pos}号: ${p.name}`;
    }).join('\n');

    const prompts = {
      [PHASES.NIGHT_WEREWOLF_DISCUSS]: '【狼人讨论】轮到你发言了，请简要发言讨论今晚击杀目标。以JSON格式返回: {"type": "speech", "content": "你说的话"}',
      [PHASES.NIGHT_WEREWOLF_VOTE]: `【狼人投票】存活玩家：\n${aliveList}\n请选择今晚要击杀的玩家，回复位置编号（纯数字，如 1）。以JSON格式返回: {"type": "vote", "target": 编号}`,
      [PHASES.NIGHT_SEER]: `【预言家】存活玩家：\n${aliveList}\n请选择要查验的玩家，回复位置编号（纯数字，如 1）。以JSON格式返回: {"type": "vote", "target": 编号}`,
      [PHASES.NIGHT_GUARD]: `【守卫】存活玩家：\n${aliveList}\n请选择要守护的玩家，回复位置编号（纯数字，如 1）。以JSON格式返回: {"type": "vote", "target": 编号}`,
      [PHASES.DAY_DISCUSS]: '【白天发言】轮到你发言了，请分析局势，简要发言。以JSON格式返回: {"type": "speech", "content": "你说的话"}',
      [PHASES.DAY_VOTE]: `【白天投票】存活玩家：\n${aliveList}\n请选择要放逐的玩家，回复位置编号（纯数字，如 1），或选择弃权。以JSON格式返回: {"type": "vote", "target": 编号} 或 {"type": "skip"} 表示弃权`,
      [PHASES.LAST_WORDS]: '【遗言】你即将死亡，请发表遗言。以JSON格式返回: {"type": "speech", "content": "你的遗言"}',
      [PHASES.HUNTER_SHOOT]: `【猎人】存活玩家：\n${aliveList}\n你死亡了，可以选择开枪带走一人，回复位置编号（纯数字，如 1）。以JSON格式返回: {"type": "vote", "target": 编号} 或 {"type": "skip"} 表示不开枪`
    };

    // 女巫特殊处理
    if (phase === PHASES.NIGHT_WITCH) {
      const killedPlayer = context.werewolfTarget;
      const killedName = killedPlayer?.name || '无人';
      const killedPos = killedPlayer ? this.game.players.findIndex(p => p.id === killedPlayer.id) + 1 : '';
      const healAvailable = context.witchPotion?.heal ? '可用' : '已用完';
      const poisonAvailable = context.witchPotion?.poison ? '可用' : '已用完';
      const healed = context.nightActions?.healed ? '（今晚已用解药）' : '';
      const poisoned = context.nightActions?.poisonTarget ? '（今晚已用毒药）' : '';
      return `【女巫】存活玩家：\n${aliveList}\n今晚 ${killedPos}号${killedName} 被狼人杀害。解药：${healAvailable}${healed}，毒药：${poisonAvailable}${poisoned}。你可以多次行动（先用解药再用毒药，或选择skip结束）。注意：毒药不能毒被刀的人。以JSON格式返回: {"type": "witch", "action": "heal/poison/skip", "target": 编号（仅poison时需要）}`;
    }

    return prompts[phase] || '请行动。以JSON格式返回。';
  }

  isApiAvailable() {
    return !!(process.env.ANTHROPIC_BASE_URL && process.env.ANTHROPIC_AUTH_TOKEN);
  }

  async callAPI() {
    const baseUrl = process.env.ANTHROPIC_BASE_URL;
    const apiKey = process.env.ANTHROPIC_AUTH_TOKEN;
    const model = process.env.ANTHROPIC_MODEL;

    // 使用已构建的 messages
    const messages = this.lastMessages;

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: messages
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API ${response.status}: ${error}`);
    }

    const data = await response.json();
    return data;
  }

  parseResponse(response, phase, alivePlayers) {
    // Chat Completions 格式
    const text = response.choices?.[0]?.message?.content || '';
    console.log(`[AI] ${this.player.name} 原始响应：${text.substring(0, 100)}`);

    try {
      // 尝试解析 JSON
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[0]);

        if (data.type === 'speech') {
          return { type: 'speech', content: data.content || '' };
        }

        if (data.type === 'vote') {
          return { type: 'vote', target: data.target };
        }

        if (data.type === 'witch') {
          return {
            type: 'witch',
            action: data.action,
            target: data.target || null
          };
        }

        if (data.type === 'skip') {
          return { type: 'skip' };
        }
      }
    } catch (e) {
      console.log(`[AI] 解析 JSON 失败：${e.message}`);
    }

    // 回退：根据阶段猜测意图
    if (phase === PHASES.NIGHT_WEREWOLF_DISCUSS || phase === PHASES.DAY_DISCUSS || phase === PHASES.LAST_WORDS) {
      return { type: 'speech', content: text.trim() || '过。' };
    }

    if (phase === PHASES.NIGHT_WITCH) {
      return { type: 'witch', action: 'skip' };
    }

    if (phase === PHASES.HUNTER_SHOOT) {
      return { type: 'skip' };
    }

    return null;
  }

  getRandomAction(gameContext) {
    const { phase, alivePlayers } = gameContext;
    const others = alivePlayers.filter(p => p.id !== this.player.id);

    if (phase === PHASES.NIGHT_WEREWOLF_DISCUSS || phase === PHASES.DAY_DISCUSS) {
      const speeches = ['过。', '我暂时没信息。', '听听其他人怎么说。', '有点复杂。', '我再想想。'];
      return {
        type: 'speech',
        content: speeches[Math.floor(Math.random() * speeches.length)]
      };
    }

    if (phase === PHASES.NIGHT_WEREWOLF_VOTE || phase === PHASES.DAY_VOTE) {
      // 白天投票有 20% 概率弃权
      if (phase === PHASES.DAY_VOTE && Math.random() < 0.2) {
        return { type: 'skip' };
      }
      const targets = phase === PHASES.NIGHT_WEREWOLF_VOTE
        ? others.filter(p => p.role !== 'werewolf')
        : others;
      if (targets.length > 0) {
        const t = targets[Math.floor(Math.random() * targets.length)];
        return { type: 'vote', target: t.name };
      }
    }

    if (phase === PHASES.NIGHT_SEER && others.length > 0) {
      const t = others[Math.floor(Math.random() * others.length)];
      return { type: 'vote', target: t.name };
    }

    if (phase === PHASES.NIGHT_WITCH) {
      return { type: 'witch', action: 'skip' };
    }

    if (phase === PHASES.NIGHT_GUARD && others.length > 0) {
      const t = others[Math.floor(Math.random() * others.length)];
      return { type: 'vote', target: t.name };
    }

    if (phase === PHASES.LAST_WORDS) {
      const speeches = ['我是好人，大家加油！', '我没什么好说的。', '我死得太冤了！', '大家一定要找出狼人。'];
      return {
        type: 'speech',
        content: speeches[Math.floor(Math.random() * speeches.length)]
      };
    }

    if (phase === PHASES.HUNTER_SHOOT) {
      // 50% 概率开枪
      if (Math.random() < 0.5 && others.length > 0) {
        const t = others[Math.floor(Math.random() * others.length)];
        return { type: 'vote', target: t.name };
      }
      return { type: 'skip' };
    }

    return null;
  }
}

module.exports = { AIAgent };