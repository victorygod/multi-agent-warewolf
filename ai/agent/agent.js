const { getCurrentTask, buildCurrentTurn, isSpeech } = require('./prompt');
const { VISIBILITY, CAMP } = require('../../engine/constants');
const { getToolsForAction, getTool } = require('./tools');
const { buildToolResultMessage, formatChatMessages, buildGameOverInfo } = require('./formatter');
const { LLMModel } = require('./models/llm_model');
const { RandomModel } = require('./models/random_model');
const { MockModel } = require('./models/mock_model');
const { MessageManager, TOKEN_THRESHOLD } = require('./message_manager');
const { createLogger } = require('../../utils/logger');

const ANALYSIS_NODES = ['speech'];

let backendLogger = null;
const getLogger = () => backendLogger || (backendLogger = createLogger('backend.log'));

function estimateTokens(messages) {
  let count = 0;
  for (const msg of messages) {
    if (msg.content) count += Math.ceil(msg.content.length / 4);
    if (msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        if (tc.function?.arguments) count += Math.ceil(tc.function.arguments.length / 4);
      }
    }
  }
  return count;
}

class Agent {
  constructor(options = {}) {
    this.requestQueue = [];
    this.isProcessing = false;

    this.mm = new MessageManager({
      compressionEnabled: options.compressionEnabled !== false
    });

    this.llmModel = options.useLLM ? new LLMModel(options) : null;
    this.randomModel = new RandomModel();
    this.mockModel = options.mockOptions ? new MockModel(null, options.mockOptions) : null;

    this._models = [
      { model: this.mockModel, name: 'MockModel' },
      { model: this.llmModel, name: 'LLMModel' },
      { model: this.randomModel, name: 'RandomModel' }
    ];

    this.lastChatMessageId = 0;
  }

  get messages() {
    return this.mm.messages;
  }

  updateSystemMessage(player, game, mode = 'game') {
    this.mm.updateSystem(player, game, mode);
  }

  async enterGame(player, game, chatMessages, currentChatId) {
    this._drainQueue();
    const lastId = this.lastChatMessageId || 0;
    const deltaMessages = chatMessages.filter(m => m.id > lastId);
    if (deltaMessages.length > 0) {
      const delta = formatChatMessages(deltaMessages);
      this.mm.appendContent(delta);
    }
    this.lastChatMessageId = currentChatId;
    const context = { self: player, players: game.players || [] };
    await new Promise(resolve => {
      this.enqueue({ type: 'compress', mode: 'chat', context, callback: resolve });
    });
    this.mm.resetWatermark();
  }

  exitGame(player) {
    this._drainQueue();
    this.mm.updateSystem(player, null, 'chat');
  }

  async postGameCompress(player, game) {
    const context = { self: player, players: game?.players || [] };
    await new Promise(resolve => {
      this.enqueue({ type: 'compress', mode: 'game', context, callback: resolve });
    });
  }

  async resetForNewGame(player, game) {
    this._drainQueue();
    const context = { self: player, players: game.players || [] };
    await new Promise(resolve => {
      this.enqueue({ type: 'compress', mode: 'game', context, callback: resolve });
    });
    this.mm.updateSystem(player, game, 'game');
    this.mm.resetWatermark();
  }

  appendContent(content) {
    this.mm.appendContent(content);
  }

  appendGameOverInfo(player, game) {
    const info = buildGameOverInfo(game);
    if (info) {
      this.mm.appendContent(info);
    }
  }

  get lastProcessedId() {
    return this.mm.lastProcessedId;
  }

  destroy() {
    this._drainQueue();
    this.mm.messages = [];
  }

  enqueue(request) {
    this.requestQueue.push(request);
    this.processQueue();
  }

  async processQueue() {
    if (this.isProcessing) return;
    this.isProcessing = true;
    try {
      while (this.requestQueue.length > 0) {
        const { type, mode, context, callback } = this.requestQueue.shift();
        if (type === 'compress') {
          await this.mm.compress(this.llmModel, mode, context);
          callback?.();
        } else {
          const result = await this.answer(context);
          callback?.(result);
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }

  async answer(context) {
    if (this.shouldCompress()) {
      const mode = this.mm._currentMode === 'chat' ? 'chat' : 'game';
      await new Promise(resolve => {
        this.enqueue({ type: 'compress', mode, context, callback: resolve });
      });
    }

    const { newContent, newMessages } = this.mm.formatIncomingMessages(context);

    const expectedAction = context.action === 'analyze' ? 'content' : (getTool(context.action) || 'content');
    const isDecision = expectedAction !== 'content';

    const profile = isDecision ? { thinking: context.self?.thinking, speaking: context.self?.speaking } : null;
    const { full, history } = buildCurrentTurn(newContent, context.action, context, profile);
    const llmView = this.mm.buildLLMView(full);

    const tools = isDecision ? getToolsForAction(context.action, context) : [];

    const playerName = context.self?.name || 'unknown';
    getLogger().debug(`[Agent] ${playerName} ${isDecision ? '决策' : '分析'} messages count: ${llmView.length}, newMessages: ${newMessages.length}`);

    for (const { model, name } of this._models) {
      if (!model?.isAvailable()) continue;

      try {
        const result = await this._agentLoop(model, context, expectedAction, newContent, newMessages, llmView, tools, history);
        if (result !== null) {
          return result;
        }
      } catch (e) {
        getLogger().warn(`${name} ${isDecision ? '决策' : '分析'}失败，尝试下一模型：${e.message}`);
      }
    }

    return isDecision ? { type: 'skip' } : '';
  }

  shouldCompress() {
    const tokenCount = estimateTokens(this.mm.messages);
    return tokenCount > TOKEN_THRESHOLD;
  }

  async _agentLoop(model, context, expectedAction, newContent, newMessages, llmView, tools, history) {
    const maxIterations = 5;
    let iteration = 0;
    let lastAssistantContent = null;
    let lastToolCalls = null;
    let lastToolResult = null;

    while (iteration++ < maxIterations) {
      const result = await model.call({
        ...context,
        _messagesForLLM: llmView,
        _tools: tools
      });
      const raw = result?.raw;
      const toolCalls = raw?.tool_calls || [];
      const content = raw?.content;

      if (toolCalls.length > 0) {
        llmView.push({
          role: 'assistant',
          content: raw?.content || null,
          tool_calls: toolCalls
        });

        for (const toolCall of toolCalls) {
          const tool = getTool(toolCall.function.name);
          let execResult;
          if (!tool) {
            execResult = { success: false, error: `未找到工具: ${toolCall.function.name}` };
          } else {
            try {
              execResult = tool.execute(JSON.parse(toolCall.function.arguments), context);
            } catch (e) {
              execResult = { success: false, error: `参数格式错误: 无法解析 JSON（${e.message}）` };
            }
          }

          const toolResultContent = execResult.success
            ? buildToolResultMessage(toolCall.function.name, execResult.action || { skip: true }, context)
            : execResult.error;

          llmView.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: toolResultContent
          });

          if (expectedAction !== 'content' && toolCall.function.name === expectedAction.name) {
            if (execResult.success) {
              const action = execResult.skip ? { skip: true } : execResult.action;
              this.mm.appendTurn([
                { role: 'user', content: history },
                { role: 'assistant', content: raw?.content || null, tool_calls: [toolCall] },
                { role: 'tool', tool_call_id: toolCall.id, content: toolResultContent }
              ], newMessages);
              getLogger().info(`[Agent] ${context.self?.name || 'unknown'} 决策完成：${context.phase}`);
              return action;
            }
            lastAssistantContent = raw?.content || null;
            lastToolCalls = [toolCall];
            lastToolResult = { tool_call_id: toolCall.id, content: toolResultContent };
            getLogger().warn(`[Agent] ${context.self?.name || 'unknown'} tool 执行失败：${execResult.error}，继续重试`);
          }
        }

        continue;
      }

      if (expectedAction === 'content') {
        const userMsg = { role: 'user', content: history };
        const assistantMsg = { role: 'assistant', content: content || '' };
        this.mm.appendTurn([userMsg, assistantMsg], newMessages);
        getLogger().info(`[Agent] ${context.self?.name || 'unknown'} 完成，分析内容长度: ${content?.length || 0}`);
        if (!content) {
          getLogger().warn(`[Agent] ${context.self?.name || 'unknown'} 分析返回空内容，原始raw: ${JSON.stringify(raw)}`);
        }
        return content || '';
      }

      lastAssistantContent = content || null;
      llmView.push({ role: 'assistant', content });
      llmView.push({ role: 'user', content: '请使用工具来执行操作。' });
    }

    this._saveFailedHistory(history, lastAssistantContent, lastToolCalls, lastToolResult, newMessages);
    getLogger().error(`[Agent] ${context.self?.name || 'unknown'} agent loop 超过最大迭代次数`);
    return null;
  }

  _saveFailedHistory(history, assistantContent, toolCalls, toolResult, newMessages) {
    const msgs = [{ role: 'user', content: history }];
    if (toolCalls && toolCalls.length > 0) {
      msgs.push({ role: 'assistant', content: assistantContent, tool_calls: toolCalls });
      if (toolResult) msgs.push(toolResult);
    } else if (assistantContent !== null) {
      msgs.push({ role: 'assistant', content: assistantContent });
    }
    this.mm.appendTurn(msgs, newMessages);
  }

  shouldAnalyzeMessage(msg, selfPlayerId, game) {
    if (!ANALYSIS_NODES.includes(msg.type) || msg.playerId === selfPlayerId || msg.visibility === VISIBILITY.SELF) return false;

    const selfPlayer = game?.players?.find(p => p.id === selfPlayerId);
    if (selfPlayer && selfPlayer.alive === false) return false;
    if (game?.winner) return false;

    if (msg.visibility === VISIBILITY.CAMP) {
      const sender = game?.players?.find(p => p.id === msg.playerId);
      const getCamp = game?.config?.hooks?.getCamp;
      if (!selfPlayer || !sender || getCamp?.(selfPlayer, game) !== getCamp?.(sender, game)) return false;
    }

    if ((msg.visibility === VISIBILITY.COUPLE || msg.visibility === VISIBILITY.COUPLE_IDENTITY) && !game?.couples?.includes(selfPlayerId)) {
      return false;
    }

    return true;
  }

  _drainQueue() {
    for (const { callback } of this.requestQueue) {
      callback?.(null);
    }
    this.requestQueue = [];
    this.isProcessing = false;
  }
}

module.exports = { Agent, ANALYSIS_NODES, TOKEN_THRESHOLD };