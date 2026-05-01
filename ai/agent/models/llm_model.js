/**
 * llm_model.js - LLM API 调用层
 * 配置来源：options > 环境变量（由 server.js 从 api_key.conf 加载）
 */

const { createLogger } = require('../../../utils/logger');

let backendLogger = null;
const getLogger = () => backendLogger || (backendLogger = global.backendLogger || createLogger('backend.log'));

class LLMModel {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || process.env.BASE_URL;
    this.authToken = options.authToken || process.env.AUTH_TOKEN;
    this.model = options.model || process.env.MODEL;
  }

  isAvailable() {
    return !!(this.baseUrl && this.authToken);
  }

  async call(context) {
    // 兼容直接传messages数组的情况（如message_manager.js的调用）
    if (Array.isArray(context)) {
      const messages = context;
      const response = await this._callAPI(messages, { enableThinking: false });
      return response;
    }

    this.logContext(context);

    // 无 tool 时：直接对话（分析阶段禁用思考模式，避免返回空内容）
    if (!context._tools || context._tools.length === 0) {
      const messages = context._messagesForLLM || [];
      const response = await this._callAPI(messages, { enableThinking: false });
      const message = response.choices?.[0]?.message;
      // DEBUG: 记录API响应
      if (global.DEBUG_MODE) {
        getLogger().debug(`[LLMModel] API响应: ${JSON.stringify(message)}`);
      }
      // 返回与有tools时相同的格式，让agent.js统一处理
      return { raw: message, messages };
    }

    // 有 tool 时：返回原始 LLM 响应，由 Agent 统一处理工具调用
    const messages = context._messagesForLLM || [];
    const response = await this._callAPI(messages, { tools: context._tools });
    const choice = response.choices?.[0]?.message;

    // 返回原始内容，由 Agent 解析 tool_call
    return { raw: choice, messages };
  }

  logContext(context) {
    getLogger().info(`[LLMModel] playerId=${context.self?.id} 决策上下文 (${context.phase})`);

    // DEBUG 模式下打印 LLM 消息
    if (global.DEBUG_MODE && context._messagesForLLM?.length > 0) {
      const messagesForLog = context._messagesForLLM.map(m => ({
        role: m.role,
        content: m.content,
        tool_calls: m.tool_calls
      }));
      getLogger().debug(`[LLMModel] playerId=${context.self?.id} LLM消息: ${JSON.stringify(messagesForLog, null, 2)}`);
    }
  }

  async _callAPI(messages, options = {}) {
    const body = {
      model: this.model,
      messages,
      enable_thinking: options.enableThinking !== false
    };

    if (options.tools) {
      body.tools = options.tools;
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.authToken}`
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw new Error(`API ${response.status}`);
    }

    return response.json();
  }
}

module.exports = { LLMModel };