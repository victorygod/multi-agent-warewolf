/**
 * AI Agent - LLM 决策
 * 从 Controller 获取上下文，使用统一的提示词
 */

const { buildSystemPrompt, getPhasePrompt } = require('./prompts');

class AIAgent {
  constructor(playerId, game) {
    this.playerId = playerId;
    this.game = game;
    this.systemPrompt = '';
    this.lastMessages = null;
  }

  // 初始化，构建系统提示词
  init(context) {
    const player = this.game.players.find(p => p.id === this.playerId);
    this.systemPrompt = buildSystemPrompt(player, this.game);
  }

  // 获取行动
  async getAction(context) {
    this.buildMessages(context);

    const player = this.game.players.find(p => p.id === this.playerId);
    console.log(`[AI Agent] ${player?.name} 获取行动, 阶段: ${context.phase}`);

    if (!this.isApiAvailable()) {
      console.log(`[AI Agent] ${player?.name} API 不可用，使用随机决策`);
      const action = this.getRandomAction(context);
      console.log(`[AI Agent] ${player?.name} 随机决策:`, action);
      return action;
    }

    try {
      const response = await this.callAPI();
      return this.parseResponse(response, context.phase, context.alivePlayers);
    } catch (e) {
      console.log(`[AI Agent] ${player?.name} API 错误：${e.message}`);
      return this.getRandomAction(context);
    }
  }

  // 构建 messages
  buildMessages(context) {
    const historyText = this.formatMessageHistory(context.messageHistory);
    const phasePrompt = getPhasePrompt(context.phase, context);
    const userContent = `${historyText}${phasePrompt}`;

    this.lastMessages = [
      { role: 'system', content: this.systemPrompt },
      { role: 'user', content: userContent }
    ];
  }

  // 格式化消息历史
  formatMessageHistory(messages) {
    if (!messages || messages.length === 0) return '';

    const lines = [];
    messages.forEach(msg => {
      if (msg.type === 'phase_start') {
        lines.push(`\n===== ${msg.content} =====`);
      } else if (msg.type === 'speech' || msg.type === 'wolf_speech') {
        const playerIndex = this.game.players.findIndex(p => p.id === msg.playerId);
        const pos = playerIndex >= 0 ? playerIndex + 1 : '?';
        lines.push(`[发言] ${pos}号${msg.playerName}：${msg.content}`);
      } else if (msg.type === 'death') {
        lines.push(`【死亡】${msg.content}`);
      } else if (msg.type === 'vote') {
        lines.push(`【投票】${msg.content}`);
      } else if (msg.type === 'skill_result') {
        lines.push(`【技能】${msg.content}`);
      }
    });

    return lines.join('\n') + '\n\n';
  }

  // 检查 API 是否可用
  isApiAvailable() {
    return !!(process.env.ANTHROPIC_BASE_URL && process.env.ANTHROPIC_AUTH_TOKEN);
  }

  // 调用 API
  async callAPI() {
    const baseUrl = process.env.ANTHROPIC_BASE_URL;
    const apiKey = process.env.ANTHROPIC_AUTH_TOKEN;
    const model = process.env.ANTHROPIC_MODEL;

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: this.lastMessages
      })
    });

    if (!response.ok) {
      throw new Error(`API ${response.status}`);
    }

    return response.json();
  }

  // 解析响应
  parseResponse(response, phase, alivePlayers) {
    const text = response.choices?.[0]?.message?.content || '';
    console.log(`[AI] ${this.playerId} 响应：${text.substring(0, 100)}`);

    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[0]);
        if (data.type === 'speech') return { type: 'speech', content: data.content || '' };
        if (data.type === 'vote') return { type: 'vote', target: data.target };
        if (data.type === 'witch') return { type: 'witch', action: data.action, target: data.target };
        if (data.type === 'skip') return { type: 'skip' };
      }
    } catch (e) {
      // 解析失败，回退
    }

    // 回退
    if (['day_discuss', 'night_werewolf_discuss', 'last_words'].includes(phase)) {
      return { type: 'speech', content: text.trim() || '过。' };
    }
    if (phase === 'witch') return { type: 'witch', action: 'skip' };
    return { type: 'skip' };
  }

  // 随机行动
  getRandomAction(context) {
    const { phase, alivePlayers } = context;
    const player = this.game.players.find(p => p.id === this.playerId);
    const others = alivePlayers.filter(p => p.id !== this.playerId);

    if (['day_discuss', 'night_werewolf_discuss', 'last_words'].includes(phase)) {
      const speeches = ['过。', '我暂时没信息。', '听听其他人怎么说。'];
      return { type: 'speech', content: speeches[Math.floor(Math.random() * speeches.length)] };
    }

    if (phase === 'day_vote') {
      if (Math.random() < 0.2) return { type: 'skip' };
      if (others.length > 0) {
        const t = others[Math.floor(Math.random() * others.length)];
        const pos = this.game.players.findIndex(p => p.id === t.id) + 1;
        return { type: 'vote', target: pos };
      }
    }

    if (phase === 'night_werewolf_vote') {
      const nonWolves = others.filter(p => p.role?.camp !== 'wolf');
      if (nonWolves.length > 0) {
        const t = nonWolves[Math.floor(Math.random() * nonWolves.length)];
        const pos = this.game.players.findIndex(p => p.id === t.id) + 1;
        return { type: 'vote', target: pos };
      }
    }

    if (phase === 'seer' || phase === 'guard') {
      if (others.length > 0) {
        const t = others[Math.floor(Math.random() * others.length)];
        const pos = this.game.players.findIndex(p => p.id === t.id) + 1;
        return { type: 'vote', target: pos };
      }
    }

    if (phase === 'witch') {
      return { type: 'witch', action: 'skip' };
    }

    return { type: 'skip' };
  }
}

module.exports = { AIAgent };