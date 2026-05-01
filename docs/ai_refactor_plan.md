# AI 系统重构方案

## 核心思想

**Agent 自治**：Agent 拥有自己的消息队列和处理循环

**Controller 精简**：只做信息过滤，把"必要的、完整的、已过滤的"信息传给 Agent

---

## 目标目录结构

```
ai/
├── controller.js       # 信息过滤 + 入口转发
└── agent/
    ├── agent.js        # 核心类：消息队列 + 决策 + 分析
    ├── formatter.js    # 消息→文本格式化
    ├── prompt.js       # 提示词管理
    ├── tools.js        # 工具定义
    └── models/
        ├── llm_model.js
        ├── random_model.js
        └── mock_model.js
```

---

## 一、现有代码功能梳理

### controller.js 现有功能

| 功能 | 去向 |
|------|------|
| 消息队列管理（enqueueMessage / processQueue） | 转移到 Agent |
| shouldAnalyzeMessage | 转移到 Agent |
| buildContext | 保留在 controller（调用 getVisibleMessages） |
| decide() | 转移到 Agent（替代为 answer()） |
| analyze() | 转移到 Agent（替代为 _analyzeDirect()） |
| validateAction | 转移到 Agent |
| normalizeAction | 转移到 Agent |
| formatAllowedTargets | 迁移 passBadge/assignOrder 处理到基类，删除 AIController 覆盖 |
| updateSystemMessage | 转移到 Agent |
| _initSystemMessage | 转移到 Agent |
| getMockAgent | 保留 |
| compressHistoryAfterVote 调用 | 转移到 Agent |
| ANALYSIS_NODES 常量 | 转移到 Agent |
| LOG_CONTEXT 日志开关 | 保留在 controller/agent 模块顶部 |
| AIManager | 保留 |

### Agent 现有功能（在 agents/llm.js, random.js, mock.js）

| 功能 | 去向 |
|------|------|
| LLMAgent.decide() | 转移到 Agent（工具调用模式替代，parseResponse 删除） |
| LLMAgent.normalizeTarget() | 转移到 Agent |
| LLMAgent.analyze() | 转移到 Agent |
| LLMAgent.compressHistoryAfterVote() | 转移到 Agent |
| LLMAgent.parseResponse() | 删除（工具调用模式替代） |
| LLMAgent._inferPhaseFromPrompt() | 删除（工具调用模式替代） |
| LLMAgent.isApiAvailable() | 转移到 llm_model.js |
| LLMAgent.callAPI() | 转移到 llm_model.js |
| LLMAgent 压缩状态（compressedSummary 等） | 转移到 Agent |
| RandomAgent 全部方法 | 转移到 random_model.js |
| MockAgent 全部方法 | 转移到 mock_model.js |

### 其他文件

| 功能 | 位置 | 去向 |
|------|------|------|
| formatMessageHistory | context.js | formatter.js |
| formatVoteResultSimple | context.js | formatter.js |
| formatWithCompression | prompts.js | 删除（死代码，压缩摘要改为在 _buildUserContent 中直接使用 compressedSummary） |
| NIGHT_PHASES / DAY_PHASES | context.js | formatter.js 常量 |
| buildSystemPrompt / getPhasePrompt | prompts.js | prompt.js |
| PHASE_PROMPTS（JSON 格式要求） | prompts.js | prompt.js（移除 JSON 格式要求） |
| ROLE_NAMES / DEFAULT_SOUL / CREATIVE_NAMES | prompts.js | prompt.js |
| getRandomProfiles / resetUsedNames | prompts.js | prompt.js |
| buildMessages() | context.js | 删除（已废弃） |
| PlayerController 基类方法 | engine/player.js | 不改动 |

---

## 二、新架构设计

### Controller（精简为信息过滤器）

**职责**：只做信息过滤和入口转发

```
职责：
- 入口转发：getSpeechResult / getVoteResult / useSkill → 转发给 Agent
- 构建上下文：buildContext() → 调用 getVisibleMessages() 获取已过滤的消息
- 等待队列清空：由 Agent 的 enqueue 串行消费保证，无需显式等待
- 日志输出：formatAllowedTargets()（使用基类方法，需先将 passBadge/assignOrder 处理迁移到基类）
- 获取 MockAgent：getMockAgent()
- AIManager：创建/获取 AIController
- 消息事件监听：onMessageAdded() → 触发 AI 分析

不再包含：
- 消息队列管理（转移到 Agent）
- shouldAnalyzeMessage（转移到 Agent）
- decide() / analyze()（转移到 Agent）
- validateAction（转移到 Agent）
- normalizeAction（转移到 Agent）
- updateSystemMessage / _initSystemMessage（转移到 Agent）
- formatAllowedTargets 覆盖（将 passBadge/assignOrder 处理迁移到基类后删除覆盖）
```

### Agent（自治核心）

**职责**：拥有消息队列，统一处理决策和分析

```
属性：
- requestQueue: []          # 待处理的请求队列
- isProcessing: false       # 是否正在处理队列（防并发）
- messages: []              # Agent 自己的对话历史（用于 LLM）
- lastProcessedId: 0        # 上次处理到的消息 ID（analyze 和 decide 共享）
                              analyze 完成后更新：避免 decide 重复收集
                              decide 完成后更新：避免下次 decide 重复收集
                              两者共享是正确的，因为分析过的消息不应再被决策收集
- compressedSummary: null       # 压缩后的历史摘要
- compressedAfterMessageId: 0   # 上次压缩到的消息 ID
- compressionPromise: null      # 正在进行的压缩 Promise（decide 前需 await）

- model 实例：
  - llmModel: LLMModel 实例（可选）
  - randomModel: RandomModel 实例
  - mockModel: MockModel 实例（可选）

常量：
- ANALYSIS_NODES = ['speech', 'vote_result', 'death_announce']

职责：
- 初始化/更新系统消息（从 controller 迁移）：
  - _initSystemMessage() → 构造时调用，生成初始 system 消息
  - updateSystemMessage() → 角色分配后调用，更新 system 消息
  - 内部调用 prompt.js 的 buildSystemPrompt()（后缀已内含，无需额外追加）

- 消息队列管理：
  - enqueue(request) → 加入队列
  - processQueue() → 异步顺序消费（带 isProcessing 防并发）
  - 注：无需 waitForQueueEmpty()，enqueue 的串行消费保证 decide 自然排在 analyze 之后

- 消息分析判断（从 controller 迁移）：
  - shouldAnalyzeMessage(msg) → 判断新消息是否需要分析
  - 分析时通过 lastProcessedId 从 context.messages 中找出新消息

- 统一入口：answer(context, actionType)

- 决策/分析：
  - _decideWithTool() → 工具调用模式（带降级链和重试上限）
  - _analyzeDirect() → 直接对话（分析模式）
  - _buildUserContent(context) → 构造 user 消息（含 soul 注入和新消息收集）
  - 内部调用 formatter.formatMessageHistory() 把消息转文本

- 辅助方法（从 controller 迁移）：
  - validateAction()
  - normalizeAction()
  - normalizeTarget()

- 降级链（decide 模式）：
  - MockModel → LLMModel（工具调用）→ RandomModel
  - 任一失败则降级到下一个
  - LLM 失败或返回无效 action 时，需回滚 messages（pop 掉最后一条 user 消息）
  - 工具调用重试上限 MAX_RETRIES = 3，超过则降级到 RandomModel

- 压缩历史：
  - compressHistoryAfterVote(context) → 投票后触发压缩（从 context.messages 获取消息）
  - _doCompress(context) → 实际执行压缩（内部调用 llm_model.call()，传 enableThinking: false）
  - decide() 前需 await compressionPromise

不包含：
- 不直接调用 LLM API（由 model 负责）
- 不需要 buildContext（Controller 已处理好）
- 不持有 game 引用，不直接获取消息（消息由 Controller 通过 context.messages 传入，已过滤）
- 不需要消息过滤（Controller 已通过 getVisibleMessages 处理）
```

**answer() 内部设计**：

```javascript
class Agent {
  constructor(playerId, options) {
    this.playerId = playerId;

    // 消息队列
    this.requestQueue = [];
    this.isProcessing = false;

    // 消息历史（用于 LLM）
    this.messages = [];
    this.lastProcessedId = 0;

    // 压缩状态
    this.compressedSummary = null;
    this.compressedAfterMessageId = 0;
    this.compressionPromise = null;

    // model 实例
    this.llmModel = options.useLLM ? new LLMModel(options) : null;
    this.randomModel = new RandomModel();
    this.mockModel = options.mockOptions ? new MockModel(options.mockOptions) : null;

    this._initSystemMessage();
  }

  // ========== 统一入口 ==========

  async answer(context, actionType) {
    if (actionType === 'analyze') {
      return await this._analyzeDirect(context);
    } else {
      return await this._decideWithTool(context, context.phase);
    }
  }

  // ========== 决策流程（工具调用模式） ==========

  async _decideWithTool(context, requiredAction) {
    // 1. 等待压缩完成
    if (this.compressionPromise) {
      await this.compressionPromise;
      this.compressionPromise = null;
    }

    // 2. 构造 user 消息（含 soul 注入和新消息收集），同时获取 latestId 避免重复调用
    const { content: userContent, latestId } = this._buildUserContent(context);
    this.messages.push({ role: 'user', content: userContent });

    // 3. 记录决策前的最新消息 ID（复用 _buildUserContent 的 latestId）
    // latestId 已由 _buildUserContent 返回

    // 4. 优先 MockModel
    if (this.mockModel) {
      try {
        const action = this.mockModel.call(context);
        if (this.validateAction(action, context)) {
          this.messages.push({ role: 'assistant', content: JSON.stringify(action) });
          this.lastProcessedId = latestId;
          return action;
        }
      } catch (e) {
        getLogger().error(`MockModel 决策失败: ${e.message}`);
      }
    }

    // 5. 尝试 LLM（工具调用模式，带重试上限）
    if (this.llmModel?.isAvailable()) {
      try {
        const tools = getToolsForAction(requiredAction, context);
        const MAX_RETRIES = 3;

        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
          // 发送完整对话历史（this.messages），末尾追加工具调用引导
          const apiMessages = [
            ...this.messages,
            { role: 'user', content: `请使用工具${requiredAction}做出行动` }
          ];

          const response = await this.llmModel.call(apiMessages, { tools });
          const toolCall = response.choices?.[0]?.message?.tool_calls?.[0];

          if (!toolCall) {
            // 没有调用工具，引导重试
            continue;
          }

          const args = JSON.parse(toolCall.function.arguments);

          if (this.validateAction(args, context)) {
            // 记录引导消息和工具调用结果到对话历史
            this.messages.push({ role: 'user', content: `请使用工具${requiredAction}做出行动` });
            this.messages.push({ role: 'assistant', content: JSON.stringify(args) });
            this.lastProcessedId = latestId;
            return args;
          }
          // 不合法，继续重试
        }

        // 超过重试次数，回滚 user 消息，降级
        getLogger().warn(`[Agent] 工具调用重试 ${MAX_RETRIES} 次均无效，降级到随机`);
        this.messages.pop(); // 回滚步骤2添加的 userContent
      } catch (e) {
        getLogger().error(`LLM 决策失败: ${e.message}`);
        this.messages.pop(); // 回滚步骤2添加的 userContent
      }
    }

    // 6. 降级到 RandomModel（复用已添加的 user 消息）
    const action = this.randomModel.call(context);
    this.messages.push({ role: 'assistant', content: JSON.stringify(action) });
    this.lastProcessedId = latestId;
    return action;
  }

  // ========== 分析流程（直接对话） ==========

  async _analyzeDirect(context) {
    const player = context.self;
    if (!player) return '';

    // 1. 从 context.messages 中收集新消息（已由 Controller 过滤）
    const allMessages = context.messages || [];
    const newMessages = allMessages.filter(m => m.id > this.lastProcessedId);
    if (newMessages.length === 0) return '';

    // 2. 检查是否有可分析内容
    const hasAnalyzableContent = newMessages.some(m => ANALYSIS_NODES.includes(m.type));
    if (!hasAnalyzableContent) {
      this.lastProcessedId = allMessages[allMessages.length - 1].id;
      return '';
    }

    // 3. 格式化新消息
    const packedContent = formatMessageHistory(newMessages, context.players, player);

    // 4. 构造分析提示
    const analysisPrompt = '\n\n请分析本条发言，寻找其中视野面或逻辑上的漏洞，结合局势做出分析判断，你的分析内容不会被其他人听到，不超过100字。';
    const soul = player?.soul ? `${player.soul}\n` : '';

    // 5. 追加 user 消息（不含分析提示词）
    this.messages.push({ role: 'user', content: packedContent });

    // 6. 构建调用消息：在最后一条 user 消息前注入 soul + 分析提示词
    const messagesForAPI = this.messages.map((msg, idx) => {
      if (msg.role === 'user' && idx === this.messages.length - 1) {
        return { ...msg, content: soul + msg.content + analysisPrompt };
      }
      return msg;
    });

    // 7. 降级链：LLM → Random → Mock
    let analysisResult;
    try {
      if (this.llmModel?.isAvailable()) {
        analysisResult = await this.llmModel.call(messagesForAPI);
        analysisResult = analysisResult.choices?.[0]?.message?.content || '';
      } else if (this.randomModel) {
        analysisResult = this.randomModel.analyze(messagesForAPI);
      } else if (this.mockModel) {
        analysisResult = this.mockModel.analyze(messagesForAPI);
      } else {
        this.messages.pop();
        this.lastProcessedId = allMessages[allMessages.length - 1].id;
        return '';
      }

      // 8. 追加 assistant 消息
      this.messages.push({ role: 'assistant', content: analysisResult });

      // 9. 更新 lastProcessedId
      this.lastProcessedId = allMessages[allMessages.length - 1].id;
      return analysisResult;
    } catch (e) {
      getLogger().error(`[Agent] analyze 失败: ${e.message}`);
      this.messages.pop();
      this.lastProcessedId = allMessages[allMessages.length - 1].id;
      return '';
    }
  }

  // ========== 辅助方法 ==========

  _buildUserContent(context) {
    const player = context.self;
    const soul = player?.soul ? `${player.soul}\n` : '';
    const phasePrompt = getPhasePrompt(context.phase, context);

    // 收集新消息（从 context.messages，已由 Controller 过滤）
    const allMessages = context.messages || [];
    const latestId = allMessages.length > 0 ? allMessages[allMessages.length - 1].id : this.lastProcessedId;
    let historyContent = '';
    if (this.lastProcessedId < latestId) {
      const newMessages = allMessages.filter(m => m.id > this.lastProcessedId);
      if (newMessages.length > 0) {
        historyContent = formatMessageHistory(newMessages, context.players, player);
      }
    }

    // 集成压缩摘要：如果有压缩摘要，在历史前追加
    if (this.compressedSummary) {
      const compressedPrefix = `【历史摘要】\n${this.compressedSummary}\n\n【最新动态】\n`;
      historyContent = historyContent ? compressedPrefix + historyContent : `【历史摘要】\n${this.compressedSummary}`;
    }

    const content = historyContent
      ? `${historyContent}\n\n${soul}${phasePrompt}`
      : `${soul}${phasePrompt}`;

    return { content, latestId };
  }

  _buildSystemPrompt(player, game) {
    return buildSystemPrompt(player, game);
  }

  // 构造系统消息（含固定后缀）
  // 由 Controller 调用，传入 player 和 game
  _initSystemMessage(player, game) {
    if (!player || !game) {
      this.messages.push({ role: 'system', content: '系统初始化' });
      return;
    }
    if (!player.role) {
      this.messages.push({ role: 'system', content: `你是${player.name}，等待游戏开始。` });
      return;
    }
    const systemPrompt = this._buildSystemPrompt(player, game);
    this.messages.push({ role: 'system', content: systemPrompt });
    // 后缀已内含在 buildSystemPrompt() 中，无需额外追加
  }

  // 更新系统消息（角色分配后调用，由 Controller 传入 player 和 game）
  updateSystemMessage(player, game) {
    if (!player || !player.role) return;
    if (this.messages.length > 0 && this.messages[0].role === 'system') {
      const systemPrompt = this._buildSystemPrompt(player, game);
      this.messages[0] = { role: 'system', content: systemPrompt };
    }
  }

  // ========== 消息队列 ==========

  enqueue(request) {
    this.requestQueue.push(request);
    this.processQueue();
  }

  async processQueue() {
    if (this.isProcessing) return; // 防并发
    this.isProcessing = true;
    try {
      while (this.requestQueue.length > 0) {
        const request = this.requestQueue.shift();
        await this._handleRequest(request);
      }
    } finally {
      this.isProcessing = false;
    }
  }

  async _handleRequest(request) {
    const { type, context, callback } = request;
    if (type === 'decide') {
      const action = await this.answer(context, 'decide');
      callback?.(action);
    } else if (type === 'analyze') {
      const analysis = await this.answer(context, 'analyze');
      callback?.(analysis);
    }
  }

  // ========== 标准化方法（从 controller/llm 迁移） ==========

  normalizeAction(action, actionType, extraData) {
    // 处理特定技能类型的 action 转换
    switch (actionType) {
      case 'witch':
        if (action?.type === 'heal') return { action: 'heal' };
        if (action?.type === 'poison') return { action: 'poison', targetId: action.target ? parseInt(action.target) : null };
        return { action: 'skip' };
      case 'cupid':
        if (action?.targetIds) return { targetIds: action.targetIds.map(id => parseInt(id)) };
        return { targetIds: action?.target ? [parseInt(action.target)] : [] };
      case 'campaign':
        return { run: action?.confirmed === true || action?.run === true };
      case 'withdraw':
        return { withdraw: action?.confirmed === true || action?.withdraw === true };
      case 'shoot':
      case 'passBadge':
        return { target: action?.target ? parseInt(action.target) : null };
      default:
        return { target: action?.target ? parseInt(action.target) : null };
    }
  }

  normalizeTarget(target, alivePlayers) {
    if (!target) return null;
    const num = parseInt(target);
    if (!isNaN(num) && num > 0) {
      const player = alivePlayers?.find(p => p.id === num);
      if (player && player.alive) return String(num);
    }
    return String(target);
  }

  // ========== 压缩历史 ==========

  compressHistoryAfterVote(context) {
    if (!this.llmModel?.isAvailable()) return;
    if (this.compressionPromise) return;
    this.compressionPromise = this._doCompress(context);
  }

  async _doCompress(context) {
    try {
      const messages = context.messages || [];
      const newMessages = messages.filter(m =>
        m.id > this.compressedAfterMessageId && m.type !== 'vote_result'
      );
      if (newMessages.length === 0) return;

      const player = context.self;
      const prompt = buildCompressPrompt(newMessages, player, context.players, this.compressedSummary);
      const summary = await this.llmModel.call([{ role: 'user', content: prompt }], { enableThinking: false });
      const text = summary.choices?.[0]?.message?.content || null;
      const allMessages = context.messages || [];

      if (text) {
        this.compressedSummary = text;
        this.compressedAfterMessageId = allMessages[allMessages.length - 1]?.id || 0;
      }
    } catch (err) {
      getLogger().error(`[Agent] 压缩历史失败: ${err.message}`);
    }
  }
}
```

---

## 三、详细设计

### Controller（精简后）

```javascript
class AIController extends PlayerController {
  constructor(playerId, game, options = {}) {
    super(playerId, game);
    this.agent = new Agent(playerId, options);
    // 初始化 Agent 的 system 消息（由 Controller 传入 player 和 game）
    this.agent._initSystemMessage(this.getPlayer(), this.game);
  }

  // 构建上下文（保留，调用 getVisibleMessages 获取已过滤的消息）
  buildContext(extraData = {}) {
    const state = this.getState();
    const player = this.getPlayer();

    return {
      phase: state.phase,
      players: state.players,
      alivePlayers: this.game.players.filter(p => p.alive),
      messages: this.getVisibleMessages(),
      self: state.self,
      dayCount: this.game.dayCount || 0,
      werewolfTarget: this.game.werewolfTarget,
      witchPotion: {
        heal: state.self?.witchHeal > 0,
        poison: state.self?.witchPoison > 0
      },
      action: extraData.actionType,
      extraData
    };
  }

  // 发言入口
  async getSpeechResult(visibility = 'public', actionType = 'speak') {
    const player = this.getPlayer();
    const context = this.buildContext({ actionType });
    context.phase = actionType === 'last_words' ? 'last_words' : context.phase;
    // context.action 已由 buildContext 中的 extraData.actionType 设置，无需重复

    const action = await new Promise(resolve => {
      this.agent.enqueue({ type: 'decide', context, callback: resolve });
    });

    // 发言直接从原始 action 提取 content，不经过 normalizeAction
    // （normalizeAction 的 default 分支会丢失 type 和 content）
    const content = action?.type === 'speech' ? action.content : '过。';
    getLogger().info(`[AI] ${player?.name} 发言: ${content}`);
    return { content, visibility };
  }

  // 投票入口
  async getVoteResult(actionType = 'day_vote', extraData = {}) {
    const player = this.getPlayer();
    const context = this.buildContext({ ...extraData, actionType });
    // context.action 已由 buildContext 设置

    const action = await new Promise(resolve => {
      this.agent.enqueue({ type: 'decide', context, callback: resolve });
    });

    // 先从原始 action 判断 skip 类型（normalizeAction 会丢失 type 字段）
    const isSkipping = action?.type === 'skip';

    // 对 target 相关部分做标准化（处理 MockModel 的 { targetId: N } 格式等）
    const normalized = this.agent.normalizeAction(action, actionType, extraData);

    let targetId = null;
    if (action?.type === 'vote' && normalized.target) {
      targetId = parseInt(normalized.target);
    } else if (isSkipping) {
      targetId = null;
    } else if (normalized.target) {
      targetId = parseInt(normalized.target);
    }

    if (!isSkipping && !targetId && extraData?.allowedTargets?.length > 0) {
      targetId = extraData.allowedTargets[Math.floor(Math.random() * extraData.allowedTargets.length)];
    }

    // 日志记录
    if (extraData?.allowedTargets?.length > 0) {
      const targetsStr = extraData.allowedTargets.map(id => {
        const p = this.game.players.find(x => x.id === id);
        return p ? getPlayerDisplay(this.game.players, p) : `${id}号`;
      }).join(', ');
      getLogger().info(`[AI] ${player?.name} 可选投票范围: ${targetsStr}`);
    }

    if (targetId) {
      const target = this.game.players.find(p => p.id === targetId);
      getLogger().info(`[AI] ${player?.name} 投票给 ${getPlayerDisplay(this.game.players, target)}`);
    } else {
      getLogger().info(`[AI] ${player?.name} 选择弃权`);
    }

    // 投票后触发压缩（传 context 给 Agent，Agent 从 context.messages 获取消息）
    // 只对 day_vote（白天放逐投票）触发压缩，wolf_vote（狼人夜间投票）不需要
    if (actionType === 'day_vote') {
      this.agent.compressHistoryAfterVote(context);
    }

    return { targetId };
  }

  // 技能入口
  async useSkill(actionType, extraData = {}) {
    const player = this.getPlayer();
    if (!player) return { success: false, message: '玩家不存在' };

    const skill = this.getSkill(actionType);
    if (!skill) return { success: false, message: '技能不存在' };

    const validation = this.canUseSkill(skill, extraData);
    if (!validation.ok) return { success: false, message: validation.message };

    const context = this.buildContext({ ...extraData, actionType });
    context.phase = actionType;
    // context.action 已由 buildContext 设置

    const action = await new Promise(resolve => {
      this.agent.enqueue({ type: 'decide', context, callback: resolve });
    });

    const normalized = this.agent.normalizeAction(action, actionType, extraData);

    // 日志输出（使用基类 formatAllowedTargets）
    const targetsStr = this.formatAllowedTargets(actionType, extraData);
    getLogger().info(`[AI] ${player.name} 使用技能 ${actionType}，可选: ${targetsStr} → ${JSON.stringify(normalized)}`);

    return this.executeSkill(skill, normalized, extraData);
  }

  // 获取 MockAgent 实例（返回 MockModel，接口兼容旧 MockAgent）
  getMockAgent() {
    return this.agent.mockModel;
  }

  // 更新系统消息（代理方法，传 player 和 game 给 Agent）
  updateSystemMessage() {
    this.agent.updateSystemMessage(this.getPlayer(), this.game);
  }
}
```

### formatter.js（原 context.js）

**改名**：从 context.js 改为 formatter.js，更清晰表达"格式化"职责。

**职责**：把游戏消息数组转为可阅读的文本字符串

```
常量：
- NIGHT_PHASES = ['cupid', 'guard', 'night_werewolf_discuss', 'night_werewolf_vote', 'witch', 'seer']
- DAY_PHASES = ['day_announce', 'sheriff_campaign', 'sheriff_speech', 'sheriff_vote', 'day_discuss', 'day_vote', 'post_vote']

核心函数：
- formatMessageHistory(messages, players, currentPlayer)
  → 输入：消息数组 [{id, type, content, playerId, visibility, ...}, ...]
  → 输出："第1夜 [狼人]3号:刀5号 第1天 [发言]1号小绿:我是好人 [投票]3号(1,2)"
  → 逻辑：按时间顺序遍历，夜晚→第N夜，白天→第N天，添加阶段标题

辅助函数：
- formatSpeech(msg, players) → "3号小绿:我说的话"
- formatDeath(msg, players) → "[死亡公告]3号小绿"
- formatAction(msg, players) → "[私密][预言家]3号→5号=狼人"
- formatVoteResult(msg, players) → "票型：3号小绿(2号,3号,6号) 4号a(7号)"（详细版，警长竞选用）
- formatVoteResultSimple(msg, players) → "3号(1,2,4) 7号(3)"（简洁版，放逐投票用）
- formatWolfVoteResult(msg, players) → "票型：5号(3,4) 6号(1)"
- formatSheriffCandidates(msg, players) → "上:1号,3号 下:无"

注意：formatWithCompression 不迁移，属于死代码（仅在废弃的 buildMessages() 中使用）。
压缩摘要的集成方式改为在 Agent._buildUserContent() 中直接使用 compressedSummary。
```

### prompt.js（提示词管理）

**职责**：管理所有提示词相关功能

```
常量：
- ROLE_NAMES → 角色名称映射（werewolf→狼人 等）
- DEFAULT_SOUL → 默认 AI 人设
- CREATIVE_NAMES → 随机名字池

核心函数：
- buildSystemPrompt(player, game)
  → 生成系统提示词
  → 内容：名字、位置、角色、狼人队友（如果有）、规则描述、角色攻略
  → **末尾追加固定提示**：'所有其他玩家的发言都可能在欺骗...不重复别人说的话，说你独特的见解'
  → 这样 Agent 调用时无需额外追加后缀

- getPhasePrompt(phase, context)
  → 获取阶段提示词（**重构**）
  → 移除所有 JSON 格式要求（如 "以JSON格式返回: {...}"）
  → 移除候选列表（如 "可选玩家：\n1号: 张三\n2号: 李四"），候选列表由 tools.js 的 enum 约束
  → 只保留阶段语义描述，例如：'【白天投票】请选择要放逐的玩家'、'【女巫】今晚有人被杀，请决定是否使用解药或毒药'
  → 保留此函数，用于构造 user message 的阶段描述部分

- loadStrategyGuide(presetId, roleId)
  → 从 ai/strategy/{presetId}/{roleId}.md 读取角色攻略

- buildCompressPrompt(newMessages, player, players, prevSummary)
  → 构建压缩提示词，让 LLM 生成局势摘要

- getRandomProfiles(count)
  → 随机获取 AI 人物设定（名字 + soul）

- resetUsedNames()
  → 重置名字池（新游戏时调用）
```

### tools.js（工具定义）

**新增**：利用 LLM 的 function calling 能力，定义每个 action 对应的工具

**职责**：根据 requiredAction 返回对应的工具定义（JSON Schema）

**命名风格**：统一使用 camelCase，与现有代码风格一致

```
核心函数：
- getToolsForAction(requiredAction, context)
  → 输入：actionType（如 'vote', 'speech', 'witch', 'seer'）
  → 输出：工具数组（通常只有一个工具）

- buildTool(actionType, context)
  → 动态构建工具，填入候选集 enum
  → 参数映射规则：
    - vote / sheriff_vote / wolf_vote:
        target.enum = context.extraData.allowedTargets
    - witch:
        action.enum 动态调整（heal 仅 witchPotion.heal 为 true 时加入，poison 同理）
        target 描述包含 werewolfTarget 信息
        target.enum = context.extraData.poisonTargets
    - seer:
        target.enum = 存活玩家 ID 列表（排除已查验的，从 context.self.seerChecks 获取）
    - guard:
        target.enum = 存活玩家 ID 列表（排除 lastGuardTarget）
    - cupid:
        targets.type = 'array', items.type = 'integer', 描述说明需选择两人
    - shoot / passBadge / assignOrder:
        target.enum = 存活玩家 ID 列表（排除自己）
    - campaign:
        run.type = 'boolean'
    - withdraw:
        withdraw.type = 'boolean'
    - speech:
        content.type = 'string', description = '发言内容，100字以内'

工具示例：
```javascript
// vote 工具
{
  type: 'function',
  function: {
    name: 'vote',
    description: '投票放逐一名玩家',
    parameters: {
      type: 'object',
      properties: {
        target: {
          type: 'integer',
          description: '要投票的玩家位置编号（1-based）',
          enum: [1, 2, 3, 4, 5, 6, 7, 8, 9]  // 动态填入 allowedTargets
        }
      },
      required: ['target']
    }
  }
}

// speech 工具
{
  type: 'function',
  function: {
    name: 'speech',
    description: '发表言论',
    parameters: {
      type: 'object',
      properties: {
        content: { type: 'string', description: '发言内容，100字以内' }
      },
      required: ['content']
    }
  }
}

// witch 工具
{
  type: 'function',
  function: {
    name: 'witch',
    description: '女巫使用技能',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['heal', 'poison', 'skip'],  // 动态调整
          description: '使用解药/毒药/跳过'
        },
        target: {
          type: 'integer',
          description: '毒药目标的位置编号'
        }
      },
      required: ['action']
    }
  }
}
```

需要定义的工具（camelCase 命名）：
- vote（投票）
- speech（发言）
- witch（女巫）
- seer（预言家查验）
- guard（守卫）
- cupid（丘比特连线）
- shoot（猎人开枪）
- campaign（竞选警长）
- withdraw（退水）
- passBadge（传警徽）
- assignOrder（指定发言顺序）
```

### models/ 目录

**职责**：model 层负责调用 API 或返回预设值，返回的是结构化的 action（不是原始 API 响应）

#### llm_model.js

```
职责：调用 LLM API

配置来源（优先级从高到低）：
1. 构造函数传入的 options（测试用）
2. api_key.conf 文件（生产环境）
3. 环境变量 BASE_URL / AUTH_TOKEN / MODEL（回退）

方法：
- call(messages, options)
  → 统一的 API 调用方法
  → options 可选参数：
    - tools: 工具定义数组（decide 用）
    - toolChoice: 强制使用的工具名
    - enableThinking: 是否启用思考模式（默认 true）
  → 返回 LLM 原始响应

- isAvailable()
  → 检查 API 配置是否可用
  → 返回 boolean

构造函数：
constructor(options = {}) {
  this.baseUrl = options.baseUrl || this._loadFromConfig().baseUrl || process.env.BASE_URL;
  this.authToken = options.authToken || this._loadFromConfig().authToken || process.env.AUTH_TOKEN;
  this.model = options.model || this._loadFromConfig().model || process.env.MODEL;
}

_loadFromConfig()
  → 读取 api_key.conf 文件
  → 返回 { baseUrl, authToken, model } 或 null
```

#### random_model.js

```
职责：随机返回合法的 action

方法：
- call(context)
  → 根据 context.phase 返回随机 action
  → 保证返回值在候选集内（合法）
  → 内部通过 context.phase 匹配到对应的 *Action() 方法

- analyze(messages)
  → 返回随机分析文本

- logContext(context)
  → 记录决策上下文日志

常量：
- ANALYSIS_TEMPLATES → 随机分析模板数组

随机决策逻辑：
- speechAction() → 随机发言文本
- wolfSpeechAction() → 狼人夜间讨论发言（独立模板）
- voteAction(alivePlayers, allowedTargets) → 随机投票目标
- wolfVoteAction(alivePlayers, allowedTargets) → 随机刀人目标
- seerAction(alivePlayers, seerChecks) → 随机查验（排除已查验）
- witchAction(context) → 随机使用解药/毒药/跳过
- guardAction(alivePlayers, lastGuardTarget) → 随机守护
- cupidAction(alivePlayers) → 随机连线两人
- hunterAction(alivePlayers) → 随机开枪/放弃
- campaignAction() → 50% 概率上警
- withdrawAction() → 30% 概率退水
- passBadgeAction(alivePlayers) → 随机传警徽
- assignOrderAction(alivePlayers) → 随机指定发言顺序
```

#### mock_model.js

```
职责：返回预设的 action（用于测试），没有兜底

方法：
- call(context)
  → 返回预设的 action
  → 没有预设则抛出错误
  → 内部通过 context.phase/context.action 匹配预设响应

- analyze(messages)
  → 返回预设分析内容，无预设返回空字符串

预设管理：
- setResponse(actionType, response) → 设置单个预设
- setResponses(responses) → 批量设置
- setBehaviorSequence(sequence) → 设置行为序列
- addBehavior(phase, response) → 添加到序列
- getSequenceResponse(phase, action) → 从序列匹配响应（精确匹配 + 通配符匹配）
- setStrategy(phase, fn) → 自定义策略函数
- normalizeResponse(actionType, response) → 标准化响应格式
  → 数字→投票，字符串→发言，对象补 type 等格式兼容
- setVoteTarget(targetId) → 快捷设置投票目标
- setSpeech(content) → 快捷设置发言
- setWitchAction(action, targetId) → 快捷设置女巫行动
- setCupidLinks(id1, id2) → 快捷设置丘比特连线
- setHunterShoot(targetId) → 快捷设置猎人开枪
- setPassBadge(targetId) → 快捷设置传警徽
- setGuardTarget(targetId) → 快捷设置守卫守护
- setSeerCheck(targetId) → 快捷设置预言家查验
- setSkillTarget(actionType, targetId) → 通用快捷设置技能目标
- setCampaign(shouldRun) → 快捷设置竞选
- setWithdraw(shouldWithdraw) → 快捷设置退水
- setAnalysis(content) → 设置预设分析内容
- resetSequence() → 重置序列索引
- clear() → 清空所有预设
```

---

## 四、功能对照表

确保重构后功能不缺失：

| 现有功能 | 位置 | 重构后位置 |
|----------|------|------------|
| 消息队列管理 | controller.js | agent.js requestQueue |
| shouldAnalyzeMessage | controller.js | agent.js |
| ANALYSIS_NODES | controller.js | agent.js 常量 |
| LOG_CONTEXT | controller.js | controller/agent 模块顶部 |
| buildContext | controller.js | controller.js（保留，含 messages） |
| decide() | controller.js | agent.js answer() |
| analyze() | controller.js | agent.js _analyzeDirect() |
| validateAction | controller.js | agent.js |
| normalizeAction | controller.js | agent.js |
| formatAllowedTargets | controller.js | 迁移 passBadge/assignOrder 到基类后删除覆盖 |
| updateSystemMessage | controller.js | agent.js |
| _initSystemMessage | controller.js | agent.js |
| getMockAgent | controller.js | controller.js（保留） |
| compressHistoryAfterVote | llm.js | agent.js |
| normalizeTarget | llm.js | agent.js（含实现） |
| parseResponse | llm.js | 删除（工具调用模式替代） |
| _inferPhaseFromPrompt | llm.js | 删除（工具调用模式替代） |
| isApiAvailable | llm.js | llm_model.js isAvailable() |
| callAPI | llm.js | llm_model.js call() |
| 压缩状态变量 | llm.js | agent.js |
| AIManager | controller.js | controller.js（保留） |
| formatMessageHistory | context.js | formatter.js |
| formatVoteResultSimple | context.js | formatter.js |
| formatWithCompression | prompts.js | 删除（死代码，压缩摘要改为在 _buildUserContent 中直接使用 compressedSummary） |
| NIGHT_PHASES / DAY_PHASES | context.js | formatter.js 常量 |
| buildSystemPrompt / getPhasePrompt | prompts.js | prompt.js |
| PHASE_PROMPTS（JSON 格式要求） | prompts.js | prompt.js（移除 JSON 格式要求） |
| ROLE_NAMES / DEFAULT_SOUL / CREATIVE_NAMES | prompts.js | prompt.js |
| getRandomProfiles / resetUsedNames | prompts.js | prompt.js |
| buildMessages() | context.js | 删除（已废弃） |
| 随机决策逻辑 | random.js | random_model.js |
| 预设行为逻辑 | mock.js | mock_model.js |
| LLM API 调用 | llm.js | llm_model.js |
| PlayerController 基类方法 | engine/player.js | 不改动 |

---

## 五、集成变更

### AIManager 代码更新

`shouldAnalyzeMessage` 和 `enqueueMessage` 迁移到 Agent 后，AIManager 代码需同步更新：

```javascript
class AIManager {
  // ...

  onMessageAdded(msg) {
    for (const controller of this.controllers.values()) {
      // 改为调用 agent 的方法
      if (controller.agent.shouldAnalyzeMessage(msg, controller.playerId)) {
        // 构建分析 context（包含已过滤的 messages）
        const context = controller.buildContext({ actionType: 'analyze' });
        controller.agent.enqueue({ type: 'analyze', context, callback: null });
      }
    }
  }
}
```

**注意**：analyze 请求的 context 由 Controller 的 `buildContext()` 构建（包含已过滤的 `messages`），Agent 内部通过 `context.messages` 和 `lastProcessedId` 判断哪些是新消息。

### server.js 变更点

1. **updateSystemMessage 调用路径**：
   - 旧：`controller.updateSystemMessage()`
   - 新：`controller.updateSystemMessage()` → 内部调用 `this.agent.updateSystemMessage(player, game)`
   - Agent 不持有 game 引用，由 Controller 传入 player 和 game

2. **AI 创建 options 映射**：
   - 旧：`aiManager.createAI(playerId, { agentType: 'llm' | 'random' | 'mock' })`
   - 新：`aiManager.createAI(playerId, { useLLM: true, mockOptions: null, compressionEnabled: true })`
   - 映射逻辑：`(process.env.BASE_URL && process.env.AUTH_TOKEN) ? { useLLM: true, compressionEnabled: true } : { useLLM: false }`

3. **compressionEnabled 选项**：
   - 旧：`{ agentType: 'llm', compressionEnabled: true }` 传给 AIController → LLMAgent
   - 新：`{ useLLM: true, compressionEnabled: true }` 传给 AIController → Agent → LLMModel

### 基类 formatAllowedTargets 补充

删除 AIController 的 formatAllowedTargets 覆盖前，需先将 passBadge/assignOrder 处理逻辑迁移到 PlayerController 基类：

```javascript
// engine/player.js - formatAllowedTargets() 补充
// passBadge 和 assignOrder：从存活玩家中排除自己
if (actionType === 'passBadge' || actionType === 'assignOrder') {
  const player = this.getPlayer();
  const targets = this.game.players.filter(p => p.alive && p.id !== player?.id);
  if (targets.length > 0) {
    return targets.map(p => getPlayerDisplay(this.game.players, p)).join(', ');
  }
  return '无存活玩家';
}
```

### MockModel 接口兼容性

MockModel 必须保持与 MockAgent 相同的外部接口，确保测试不中断：

1. **call(context) 签名**：与 MockAgent.decide(context) 相同，使用 context.phase/context.action 匹配预设
2. **normalizeResponse()**：保留，处理 `{ targetId: N }` → `{ type: 'vote', target: String(N) }` 等格式转换
3. **setResponse / setBehaviorSequence / setStrategy 等快捷方法**：全部保留
4. **getMockAgent() 返回 MockModel**：测试中 `setAI(aiControllers, playerId, 'vote', 5)` 仍然有效，因为 MockModel 有相同的 setResponse 方法

### 测试适配

1. **llm.test.js**：所有 `parseResponse()` 测试需删除（工具调用模式替代），改为测试 `validateAction()` 和 `tools.js`
2. **ai_integration.test.js / ai_analysis.test.js**：更新 import 路径，接口不变则逻辑不变
3. **game.test.js**：`getMockAgent()` 返回 MockModel，`setAI` helper 无需修改（MockModel 保留 setResponse 等方法）
4. **compression.test.js**：updateSystemMessage 和 compressHistoryAfterVote 调用路径更新

---

## 六、实施步骤

1. 创建 `agent/formatter.js`，迁移现有 context.js 功能
   - formatMessageHistory, formatSpeech, formatDeath, formatAction
   - formatVoteResult, formatVoteResultSimple, formatWolfVoteResult
   - formatSheriffCandidates
   - NIGHT_PHASES, DAY_PHASES 常量
2. 创建 `agent/prompt.js`，迁移现有 prompts.js 功能
   - buildSystemPrompt（末尾追加固定提示后缀）
   - getPhasePrompt（移除所有 JSON 格式要求）
   - loadStrategyGuide, buildCompressPrompt
   - getRandomProfiles, resetUsedNames
   - ROLE_NAMES, DEFAULT_SOUL, CREATIVE_NAMES
3. 创建 `agent/tools.js`，定义所有 action 对应的工具
   - camelCase 命名风格
   - buildTool() 动态填入 extraData 参数
4. 创建 `agent/models/llm_model.js`，实现 API 调用
   - call(messages, options) 统一入口
   - isAvailable() 检查 API 可用性
   - 配置来源：options > api_key.conf > 环境变量
5. 创建 `agent/models/random_model.js`，实现随机决策
   - call(), analyze(), logContext()
   - 所有 *Action() 方法
   - ANALYSIS_TEMPLATES 常量
6. 创建 `agent/models/mock_model.js`，实现预设行为
   - call(), analyze()
   - 所有预设管理方法
   - normalizeResponse(), getSequenceResponse()
7. 创建 `agent/agent.js`，实现消息队列和核心逻辑
   - 迁移 shouldAnalyzeMessage()
   - 迁移 validateAction(), normalizeAction(), normalizeTarget()
   - 迁移 updateSystemMessage(player, game), _initSystemMessage(player, game)（由 Controller 传入 player 和 game，Agent 不持有 game 引用）
   - 迁移 compressHistoryAfterVote(context), _doCompress(context)（从 context.messages 获取消息，不直接访问 game）
   - 实现 answer(), _decideWithTool(), _analyzeDirect()
   - 实现 _buildUserContent(), _buildSystemPrompt()
   - 实现消息队列：enqueue(), processQueue()
   - ANALYSIS_NODES 常量
   - 压缩状态变量
8. 简化 `controller.js`，保留 buildContext() 和入口转发
   - 迁移 passBadge/assignOrder 处理到 PlayerController 基类 formatAllowedTargets()
   - 删除 AIController 中的 formatAllowedTargets 覆盖
   - 添加 updateSystemMessage() 代理方法：`updateSystemMessage() { this.agent.updateSystemMessage(this.getPlayer(), this.game); }`
   - 更新 AIManager.onMessageAdded() 调用 agent 方法
9. 更新 `server.js` 集成代码
   - updateSystemMessage 调用路径不变（controller.updateSystemMessage()，内部代理到 agent）
   - AI 创建 options 映射：agentType → useLLM + mockOptions
   - compressionEnabled 流经 AIController → Agent
10. 删除旧文件
   - 删除 `ai/agents/` 目录（llm.js, random.js, mock.js, index.js）
   - 删除 `ai/context.js`（功能已迁移到 formatter.js）
   - 删除 `ai/prompts.js`（功能已迁移到 prompt.js）
11. 测试验证功能完整
    - 运行 `node test/*.js` 确保所有测试通过
    - 更新测试文件中的 import 路径
    - 删除 llm.test.js 中 parseResponse() 相关测试（工具调用模式替代）
    - 验证 MockAgent → MockModel 的接口兼容性
    - 验证 getMockAgent() 返回的 MockModel 与测试 helper setAI() 兼容