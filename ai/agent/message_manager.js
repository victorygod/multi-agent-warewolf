const { formatMessageHistory } = require('./formatter');
const { buildSystemPrompt } = require('./prompt');
const { createLogger } = require('../../utils/logger');

let backendLogger = null;
const getLogger = () => backendLogger || (backendLogger = createLogger('backend.log'));

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

const TOKEN_THRESHOLD = 4000;
const COMPACT_THRESHOLD = 800;

class MessageManager {
  constructor(options = {}) {
    this.messages = [];
    this.lastProcessedId = 0;
    this.compressionEnabled = options.compressionEnabled !== false;
    this._currentMode = 'chat';
  }

  formatIncomingMessages(context) {
    const newMessages = context.messages.filter(m => m.id > this.lastProcessedId);
    const players = context.players || [];
    const currentPlayer = players.find(p => p.id === context.self?.id);
    const newContent = formatMessageHistory(newMessages, players, currentPlayer);
    return { newContent, newMessages };
  }

  buildLLMView(fullContent) {
    let view = JSON.parse(JSON.stringify(this.messages));
    view.push({ role: 'user', content: fullContent });
    return view;
  }

  appendTurn(msgs, newMessages) {
    for (const msg of msgs) {
      this.messages.push(msg);
    }
    const latestId = (newMessages && newMessages.length > 0)
      ? newMessages[newMessages.length - 1].id
      : this.lastProcessedId;
    this.lastProcessedId = latestId;
  }

  updateSystem(player, game, mode = 'game') {
    if (!player) return;
    if (mode === 'game' && !player.role) return;
    const systemPrompt = buildSystemPrompt(player, { game, mode });
    if (this.messages.length > 0 && this.messages[0].role === 'system') {
      this.messages[0] = { role: 'system', content: systemPrompt };
    } else {
      this.messages.unshift({ role: 'system', content: systemPrompt });
    }
    this._currentMode = mode;
  }

  async compress(llmModel, mode = 'game', context = null) {
    if (!this.compressionEnabled) return;
    try {
      const newContent = this._compactHistoryAfterSummary();
      if (!newContent) return;

      const player = context?.self;
      if (!player) return;

      const prevSummary = this._findPrevSummary();

      let text;
      if (newContent.length < COMPACT_THRESHOLD) {
        text = prevSummary ? `${prevSummary}\n\n${newContent}` : newContent;
      } else if (llmModel && llmModel.isAvailable()) {
        const prompt = this._buildCompressPrompt(mode, newContent, player, prevSummary, context);
        const result = await llmModel.call([{ role: 'user', content: prompt }], { enableThinking: false });
        text = result.choices?.[0]?.message?.content;
      } else {
        text = '[[' + this._buildCompressPrompt(mode, newContent, player, prevSummary, context) + ']]';
      }

      if (text) {
        this.messages = [
          this.messages[0],
          { role: 'user', content: `【之前压缩摘要】\n${text}` }
        ];
        getLogger().info(`[MessageManager] 压缩完成，mode=${mode}，摘要长度=${text.length}`);
      }
    } catch (err) {
      getLogger().error(`[MessageManager] 压缩历史失败：${err.message}`);
    }
  }

  appendContent(content) {
    if (!content) return;
    this.messages.push({ role: 'user', content });
  }

  resetWatermark() {
    this.lastProcessedId = 0;
  }

  _findPrevSummary() {
    if (this.messages.length > 1 &&
        this.messages[1].role === 'user' &&
        this.messages[1].content?.startsWith('【之前压缩摘要】')) {
      return this.messages[1].content.replace('【之前压缩摘要】\n', '');
    }
    return null;
  }

  _compactHistoryAfterSummary() {
    const startIdx = this.messages[1]?.content?.startsWith('【之前压缩摘要】') ? 2 : 1;
    const msgs = this.messages.slice(startIdx);
    if (msgs.length === 0) return null;

    const lines = [];
    for (const msg of msgs) {
      if (msg.role === 'user') {
        lines.push(msg.content);
      } else if (msg.role === 'assistant') {
        if (msg.tool_calls?.length > 0) continue;
        if (msg.content) lines.push(`[分析]${msg.content}`);
      } else if (msg.role === 'tool') {
        lines.push(msg.content);
      }
    }
    return lines.length > 0 ? lines.join('\n') : null;
  }

  _buildCompressPrompt(mode, newContent, player, prevSummary, context) {
    const identity = this._buildIdentity(player, mode, context);
    const prev = prevSummary ? `上次压缩摘要:\n${prevSummary}\n\n` : '';

    const templates = {
      game: `请将以下游戏进展压缩为300字以内的摘要，保留：
1. 存活人数和阵营分布
2. 已暴露的关键信息（身份、查验、守护等）
3. 可疑玩家和推理线索
4. 局势走向`,

      chat: `请将以下聊天记录压缩为300字以内的摘要，保留：
1. 各玩家的发言风格和特点
2. 玩家之间的互动关系和态度
3. 讨论的关键话题和观点
4. 任何未解决的分歧或争议`
    };

    return `${identity}

${prev}${templates[mode] || templates.game}

待压缩内容：
${newContent}`;
  }

  _buildIdentity(player, mode, context) {
    if (mode === 'game') {
      const role = player.role;
      const roleId = role?.id || role;
      const roleName = ROLE_NAMES[roleId] || roleId;
      const players = context?.players || [];
      const position = players.findIndex(p => p.id === player.id) + 1;

      let wolfTeammates = '';
      if (roleId === 'werewolf') {
        const teammates = players.filter(p => p.alive && p.id !== player.id && p.role?.id === 'werewolf');
        if (teammates.length > 0) {
          const positions = teammates.map(p => players.findIndex(gp => gp.id === p.id) + 1 + '号').join('、');
          wolfTeammates = ` 队友:${positions}`;
        }
      }

      return `你的身份: ${player.name || '未知'} ${position}号位 角色:${roleName}${wolfTeammates}`;
    }
    return `你的身份: ${player.name || '未知'}`;
  }
}

module.exports = { MessageManager, TOKEN_THRESHOLD };