/**
 * 上下文构造模块
 * 为 AI Agent 提供统一的上下文格式化功能
 *
 * 格式规范见 docs/prompt_format.md
 */

const { buildSystemPrompt, getPhasePrompt } = require('./prompts');

// 夜晚阶段
const NIGHT_PHASES = ['cupid', 'guard', 'night_werewolf_discuss', 'night_werewolf_vote', 'witch', 'seer', 'hunter_night'];

// 白天阶段
const DAY_PHASES = ['day_announce', 'sheriff_campaign', 'sheriff_speech', 'sheriff_vote', 'day_discuss', 'day_vote', 'post_vote'];

/**
 * 格式化消息历史
 * 按照 prompt_format.md 规范输出
 *
 * 核心逻辑：
 * 1. 阶段合并：夜晚 → 第N夜，白天 → 第N天
 * 2. 子阶段标题：[狼人]、[警长竞选]、[发言] 等
 * 3. 结构化数据优先：metadata、deaths、voteDetails 等
 *
 * @param {Array} messages - 消息列表
 * @param {Array} players - 玩家列表（用于获取位置）
 * @returns {string} 格式化后的消息历史
 */
function formatMessageHistory(messages, players, currentPlayer = null) {
  if (!messages || messages.length === 0) return '';

  // 判断当前玩家是否是狼人
  const isWolf = currentPlayer && currentPlayer.role && currentPlayer.role.camp === 'wolf';

  const lines = [];
  let nightCount = 0;
  let dayCount = 0;
  let currentSection = null;  // 'night' | 'day'
  let inWolfSection = false;
  let inSheriffSection = false;
  let inSpeechSection = false;
  let lastPhase = null;

  for (const msg of messages) {
    // 1. 处理阶段开始
    if (msg.type === 'phase_start') {
      const phase = msg.phase;

      // 夜晚阶段
      if (NIGHT_PHASES.includes(phase)) {
        if (currentSection !== 'night') {
          nightCount++;
          lines.push(`第${nightCount}夜`);
          currentSection = 'night';
          inWolfSection = false;
        }

        // 狼人阶段需要子标题（只有狼人玩家才显示）
        if (phase === 'night_werewolf_discuss' && isWolf && !inWolfSection) {
          lines.push('[狼人]');
          inWolfSection = true;
        }
        // 其他夜晚阶段不输出标题
        lastPhase = phase;
        continue;
      }

      // 白天阶段
      if (DAY_PHASES.includes(phase)) {
        if (currentSection !== 'day') {
          dayCount++;
          lines.push(`第${dayCount}天`);
          currentSection = 'day';
          inWolfSection = false;
          inSheriffSection = false;
          inSpeechSection = false;
        }

        // 警长竞选子标题
        if ((phase === 'sheriff_campaign' || phase === 'sheriff_speech' || phase === 'sheriff_vote') && !inSheriffSection) {
          lines.push('[警长竞选]');
          inSheriffSection = true;
        }

        // 白天发言子标题
        if (phase === 'day_discuss' && !inSpeechSection) {
          lines.push('[发言]');
          inSpeechSection = true;
        }

        lastPhase = phase;
        continue;
      }

      // 其他阶段（如 hunter_night 等）不输出
      lastPhase = phase;
      continue;
    }

    // 2. 根据消息类型格式化
    switch (msg.type) {
      case 'wolf_speech':
        // 狼人发言：如果是狼人玩家，需要添加 [狼人] 子标题
        if (isWolf && !inWolfSection) {
          lines.push('[狼人]');
          inWolfSection = true;
        }
        lines.push(formatSpeech(msg, players));
        break;

      case 'wolf_vote_result':
        // 狼人投票结果
        lines.push(formatWolfVoteResult(msg, players));
        break;

      case 'speech':
        // 普通发言（警长竞选发言也在 [警长竞选] 下）
        lines.push(formatSpeech(msg, players));
        break;

      case 'last_words':
        // 遗言
        lines.push(`[遗言]${formatSpeech(msg, players)}`);
        break;

      case 'action':
        // 技能动作
        lines.push(formatAction(msg, players));
        break;

      case 'death_announce':
        // 死亡公告
        lines.push(formatDeath(msg, players));
        break;

      case 'vote_result':
        // 投票结果
        if (inSheriffSection) {
          // 警长竞选投票
          lines.push(formatVoteResult(msg, players));
        } else {
          // 放逐投票
          lines.push(`[投票]${formatVoteResultSimple(msg, players)}`);
        }
        break;

      case 'vote_tie':
        // 平票
        lines.push(`pk:${msg.content.replace('平票：', '')}`);
        break;

      case 'sheriff_candidates':
        // 警长竞选候选人
        lines.push(formatSheriffCandidates(msg, players));
        break;

      case 'sheriff_elected':
        // 警长当选
        lines.push(`[警长]${msg.content.replace(' 当选警长', '').replace('（PK当选）', '')}当选`);
        break;

      case 'system':
        // 系统消息 - 情侣信息
        if (msg.content.includes('情侣') || msg.content.includes('是情侣')) {
          const match = msg.content.match(/(\d+)号.*和.*(\d+)号/);
          if (match) {
            lines.push(`[情侣]你的伴侣:${match[1]}号`);
          } else {
            lines.push(`[情侣]${msg.content}`);
          }
        } else if (msg.content.includes('退水')) {
          // 退水消息 - 简化格式
          const match = msg.content.match(/(\d+)号(\S+)/);
          if (match) {
            lines.push(`退水:${match[1]}号${match[2]}`);
          } else {
            lines.push(`退水:${msg.content}`);
          }
        } else if (msg.content.includes('平安夜')) {
          // 平安夜
          lines.push(`[平安夜]`);
        } else {
          lines.push(`[系统]${msg.content}`);
        }
        break;

      case 'game_over':
        // 游戏结束
        lines.push(`[游戏结束]${msg.content}`);
        break;

      default:
        // 其他有内容的消息
        if (msg.content) {
          lines.push(`[${msg.type}]${msg.content}`);
        }
    }
  }

  return lines.join('\n');
}

/**
 * 格式化发言
 * 输出：3号Claude:我说的话
 */
function formatSpeech(msg, players) {
  const pos = getPlayerPosition(msg.playerId, players);
  const name = msg.playerName || '未知';
  return `${pos}号${name}:${msg.content}`;
}

/**
 * 格式化死亡公告
 * 优先使用 deaths 数组
 */
function formatDeath(msg, players) {
  // 优先用 deaths 数组
  if (msg.deaths?.length > 0) {
    const names = msg.deaths.map(d => {
      const pos = getPlayerPosition(d.id, players);
      return `${pos}号${d.name}`;
    }).join('、');
    return `[死亡公告]${names}`;
  }

  // 兜底：移除 " 死亡"、" 被猎人射杀" 后缀
  let content = msg.content || '';
  content = content.replace(' 死亡', '').replace(' 被猎人射杀', '');
  return `[死亡公告]${content}`;
}

/**
 * 格式化技能动作
 * 优先使用 metadata
 */
function formatAction(msg, players) {
  const meta = msg.metadata;
  const content = msg.content || '';

  // 获取执行者信息
  const actorPos = getPlayerPosition(msg.playerId, players);
  const actor = players.find(p => p.id === msg.playerId || String(p.id) === String(msg.playerId));
  const actorName = actor?.name || '';

  // 预言家查验 - 优先用 metadata
  if (meta?.targetId !== undefined && meta?.result) {
    const target = players.find(p => p.id === meta.targetId || String(p.id) === String(meta.targetId));
    const pos = getPlayerPosition(meta.targetId, players);
    const name = target?.name || '';
    const result = meta.result === 'wolf' ? '狼人' : '好人';
    return `[预言家]${actorPos}号${actorName}:${pos}号${name}=${result}`;
  }

  // 守卫守护
  if (content.includes('守护')) {
    const match = content.match(/守护了?\s*(\d+)号(\S+)/);
    if (match) {
      return `[守卫]${actorPos}号${actorName}:守护${match[1]}号${match[2]}`;
    }
  }

  // 女巫救人
  if (content.includes('解药') || content.includes('救了')) {
    const match = content.match(/救了?\s*(\d+)号(\S+)/);
    if (match) {
      return `[女巫]${actorPos}号${actorName}:救${match[1]}号${match[2]}`;
    }
  }

  // 女巫毒人
  if (content.includes('毒杀') || content.includes('毒了')) {
    const match = content.match(/毒杀了?\s*(\d+)号(\S+)/);
    if (match) {
      return `[女巫]${actorPos}号${actorName}:毒${match[1]}号${match[2]}`;
    }
  }

  // 猎人开枪
  if (content.includes('开枪') && content.includes('带走')) {
    const match = content.match(/(\d+)号(\S+)\s+开枪带走了?\s*(\d+)号(\S+)/);
    if (match) {
      return `[猎人]${match[1]}号${match[2]}:枪杀${match[3]}号${match[4]}`;
    }
  }

  // 猎人放弃开枪
  if (content.includes('放弃开枪')) {
    const match = content.match(/(\d+)号(\S+)/);
    if (match) {
      return `[猎人]${match[1]}号${match[2]}:放弃开枪`;
    }
  }

  // 丘比特连线
  if (content.includes('连接') && content.includes('情侣')) {
    const match = content.match(/连接了\s*(\d+)号.*和.*(\d+)号/);
    if (match) {
      return `[丘比特]${actorPos}号${actorName}:${match[1]}号↔${match[2]}号`;
    }
  }

  // 兜底
  return `[技能]${content}`;
}

/**
 * 格式化狼人投票结果
 * 使用 voteDetails 结构化数据
 */
function formatWolfVoteResult(msg, players) {
  const lines = [];

  // 票型 - voteDetails 是数组 [{voter, target}, ...]
  if (msg.voteDetails?.length > 0) {
    // 按 target 分组
    const byTarget = {};
    for (const v of msg.voteDetails) {
      const target = v.target;
      if (!byTarget[target]) byTarget[target] = [];
      byTarget[target].push(v.voter);
    }
    const parts = Object.entries(byTarget).map(([target, voters]) => {
      return `${target}（${voters.join('、')}）`;
    });
    lines.push(`票型：${parts.join('；')}`);
  }

  // 最终击杀
  if (msg.content) {
    const match = msg.content.match(/击杀\s*(\d+)号(\S+)/);
    if (match) {
      lines.push(`最终击杀：${match[1]}号${match[2]}`);
    }
  }

  return lines.join('\n');
}

/**
 * 格式化投票结果（详细版，用于警长竞选）
 * 输出：票型：1号小绿(2号,3号,6号) 4号a(7号)
 */
function formatVoteResult(msg, players) {
  // voteDetails 是数组 [{voter, target}, ...]
  if (msg.voteDetails?.length > 0) {
    const byTarget = {};
    for (const v of msg.voteDetails) {
      const target = v.target;
      if (!byTarget[target]) byTarget[target] = [];
      byTarget[target].push(v.voter);
    }
    const parts = Object.entries(byTarget).map(([target, voters]) => {
      return `${target}(${voters.join(',')})`;
    });
    return `票型：${parts.join(' ')}`;
  }

  // 兜底
  return `票型：${msg.content || ''}`;
}

/**
 * 格式化投票结果（简洁版，用于放逐投票）
 * 输出：3号Claude(1,2,4) 7号阿鹏(3)
 */
function formatVoteResultSimple(msg, players) {
  // voteDetails 是数组 [{voter, target}, ...]
  if (msg.voteDetails?.length > 0) {
    const byTarget = {};
    for (const v of msg.voteDetails) {
      const target = v.target;
      if (!byTarget[target]) byTarget[target] = [];
      // 提取投票者位置号
      const voterPos = v.voter.match(/(\d+)号/);
      if (voterPos) {
        byTarget[target].push(voterPos[1]);
      }
    }
    const parts = Object.entries(byTarget).map(([target, voters]) => {
      return `${target}(${voters.join(',')})`;
    });
    return parts.join(' ');
  }

  // 兜底
  return msg.content || '';
}

/**
 * 格式化警长竞选候选人
 * 优先使用 metadata
 */
function formatSheriffCandidates(msg, players) {
  // 优先用 metadata
  if (msg.metadata) {
    const onStage = msg.metadata.onStage?.map(p => {
      const pos = getPlayerPosition(p.id, players);
      return `${pos}号${p.name}`;
    }).join(',') || '无';
    const offStage = msg.metadata.offStage?.map(p => {
      const pos = getPlayerPosition(p.id, players);
      return `${pos}号${p.name}`;
    }).join(',') || '无';
    return `上:${onStage} 下:${offStage}`;
  }

  // 兜底：文本解析
  const content = msg.content || '';
  const upMatch = content.match(/警上[：:]\s*([^|]+)/);
  const downMatch = content.match(/警下[：:]\s*(.+)/);

  const parts = [];
  if (upMatch) parts.push(`警上:${upMatch[1].trim()}`);
  if (downMatch) parts.push(`警下:${downMatch[1].trim()}`);

  return parts.join(' ');
}

/**
 * 获取玩家位置（1-based）
 */
function getPlayerPosition(playerId, players) {
  if (!players || playerId === undefined || playerId === null) return '?';
  const index = players.findIndex(p => p.id === playerId || String(p.id) === String(playerId));
  return index >= 0 ? index + 1 : '?';
}

/**
 * 构建完整上下文
 * @param {Object} player - 当前玩家
 * @param {Object} game - 游戏实例
 * @param {Object} context - 决策上下文
 * @returns {Object} { systemPrompt, historyText, phasePrompt, fullText }
 */
function buildFullContext(player, game, context) {
  // 系统提示词
  const systemPrompt = buildSystemPrompt(player, game);

  // 消息历史
  const historyText = formatMessageHistory(context.messages, game.players, player);

  // 阶段提示词
  const promptContext = {
    game: game,
    alivePlayers: context.alivePlayers,
    werewolfTarget: context.werewolfTarget,
    witchPotion: {
      heal: context.self?.witchHeal > 0,
      poison: context.self?.witchPoison > 0
    }
  };
  const phasePrompt = getPhasePrompt(context.phase, promptContext);

  // 完整文本
  const fullText = `${systemPrompt}\n\n${historyText}\n\n${phasePrompt}`;

  return {
    systemPrompt,
    historyText,
    phasePrompt,
    fullText
  };
}

module.exports = {
  formatMessageHistory,
  buildFullContext,
  formatSpeech,
  formatDeath,
  formatAction,
  formatWolfVoteResult,
  formatVoteResult,
  formatSheriffCandidates,
  getPlayerPosition
};