# 狼人杀游戏 LLM 复盘与策略迭代系统设计

## 一、需求概述

在游戏结束后，利用 LLM 对每个 AI 角色进行复盘分析，并根据游戏表现更新策略文档。

### 核心需求
1. 新增「复盘阶段」，在游戏结束后自动触发
2. 针对每个 LLM 角色构建复盘提示词（非压缩内容）
3. 包含完整游戏结算信息（身份、死因、获胜阵营等）
4. 复盘提示词要求 LLM 分析角色攻略的改进点
5. 将分析结果追加到对应角色的策略文档末尾
6. 所有 LLM 角色并行执行复盘
7. 前端需等待所有复盘完成后才能点击「再开一局」

---

## 二、整体架构

### 2.1 流程图

```
游戏结束 (game_over)
    │
    ▼
┌─────────────────────────┐
│   新增复盘阶段 (review)   │
└─────────────────────────┘
    │
    ▼
┌─────────────────────────┐
│  遍历所有 LLM 角色玩家    │
└─────────────────────────┘
    │
    ├─────────────────────┐
    ▼                     ▼
┌──────────┐        ┌──────────┐
│ 角色1    │        │ 角色2    │  (并行执行)
│ 复盘     │        │ 复盘     │
└──────────┘        └──────────┘
    │                     │
    └──────────┬──────────┘
               ▼
┌─────────────────────────┐
│  等待所有复盘完成        │
└─────────────────────────┘
               │
               ▼
┌─────────────────────────┐
│  通知前端：可开启新游戏   │
└─────────────────────────┘
```

### 2.2 文件结构

```
ai/
├── strategy/              # 现有策略文档目录
│   ├── 9-standard/
│   ├── 12-hunter-idiot/
│   └── 12-guard-cupid/
│
新增文件：
├── agents/
│   └── review.js          # 新增：复盘 Agent
│
新增/修改文件：
engine/
├── phase.js               # 修改：新增复盘阶段
├── review.js              # 新增：复盘逻辑
│
server.js                  # 修改：处理复盘完成事件
public/
├── app.js                 # 修改：等待复盘完成才能开新局
```

---

## 三、详细设计

### 3.1 游戏结算信息结构

游戏结束后，需要生成完整的结算信息，用于复盘提示词：

```javascript
// gameOverInfo 结构
{
  winner: 'good' | 'wolf' | 'third',  // 获胜阵营
  winnerText: '好人阵营' | '狼人阵营' | '第三方阵营',
  dayCount: 3,                         // 游戏天数
  players: [
    {
      id: 1,
      name: '玩家1',
      display: '1号位 玩家1',
      role: { id: 'seer', name: '预言家', camp: 'good' },
      alive: false,
      deathDay: 2,                     // 第几天死亡
      deathReason: '被狼人击杀' | '被放逐' | '被毒杀' | '殉情',
      isCouple: false,                 // 是否为情侣
      isSheriff: false                 // 是否为警长
    },
    // ... 其他玩家
  ],
  couples: [                           // 情侣信息（如果有丘比特）
    { player1: 1, player2: 3 }
  ]
}
```

### 3.2 复盘提示词结构

复盘提示词使用 `buildMessages` 的结构，但**不使用压缩**，阶段提示词替换为复盘提示词。

#### 消息结构（与 buildMessages 一致）

```javascript
{
  systemPrompt,    // 系统提示词（角色信息、规则、攻略）
  historyText,     // 消息历史（formatMessageHistory格式化，不使用压缩）
  phasePrompt,     // 替换为复盘提示词
  lastMessages: [
    { role: 'system', content: `${systemPrompt}\n\n${historyText}` },
    { role: 'user', content: phasePrompt }  // 这里是复盘提示词
  ]
}
```

#### 复盘提示词内容

```
## 游戏结果
- 获胜阵营：狼人阵营
- 游戏天数：4天

## 你的死亡信息
- 存活状态：死亡
- 死亡时机：第2天
- 死亡原因：被放逐

## 游戏结算信息
| 位置 | 玩家 | 角色 | 阵营 | 存活 | 死亡原因 |
|------|------|------|------|------|----------|
| 1号 | 玩家1 | 预言家 | 好人 | 否 | 被放逐 |
...

## 复盘要求
请根据本局游戏的具体情况，提炼一条100字以内的策略补丁，追加到角色攻略文档末尾。

要求：
1. 简洁：一句话说清楚，只有一句话
2. 与攻略风格一致：参考现有策略文档的简洁条目式风格
3. 实用：针对本局具体问题给出可操作的建议

请以JSON格式返回：
```json
{
  "type": "review",
  "content": "你的策略补丁（100字以内，一句话）"
}
```

示例：
- 预言家: "被悍跳时先分析对跳者发言逻辑再决定是否退水"
- 女巫: "首夜自救后，第二夜优先救预言家确保信息源存活"
- 狼人: "人狼恋情况下引导队友刀好人而非刀情侣"
```

#### 关键点

1. **使用 formatMessageHistory**：不经过压缩，直接格式化完整消息历史
2. **systemPrompt 包含攻略**：通过 `buildSystemPrompt` 加载当前的角色攻略文档
3. **游戏结算信息**：通过 `game.getGameOverInfo()` 获取完整结算信息
4. **复盘提示词作为 phasePrompt**：替换原有的阶段提示词

### 3.3 复盘阶段定义 (engine/phase.js)

在 `PHASE_FLOW` 中新增复盘阶段：

```javascript
// engine/phase.js

{
  id: 'review',
  name: '复盘分析',
  condition: (game) => game.winner != null,  // 游戏已结束
  execute: async (game) => {
    // 触发复盘逻辑
    await game.runReview();
  }
}
```

### 3.4 复盘逻辑 (engine/review.js)

```javascript
// engine/review.js

const { createLogger } = require('../utils/logger');
const { loadStrategyGuide, saveStrategyGuide } = require('../ai/prompts');
const fs = require('fs');
const path = require('path');

let reviewLogger = null;
function getLogger() {
  if (!reviewLogger) {
    reviewLogger = createLogger('review.log');
  }
  return reviewLogger;
}

/**
 * 执行复盘
 * @param {GameEngine} game - 游戏引擎实例
 * @returns {Promise<void>}
 */
async function runReview(game) {
  getLogger().info('开始执行游戏复盘...');

  // 获取游戏结算信息
  const gameOverInfo = game.getGameOverInfo();

  // 获取所有 LLM 角色玩家
  const llmPlayers = game.players.filter(p =>
    p.isAI && p.controller?.llmAgent
  );

  getLogger().info(`共 ${llmPlayers.length} 个 LLM 角色需要复盘`);

  // 并行执行所有复盘
  const reviewPromises = llmPlayers.map(player =>
    reviewPlayer(player, game, gameOverInfo)
  );

  // 等待所有复盘完成
  const results = await Promise.all(reviewPromises);

  // 统计复盘结果
  const successCount = results.filter(r => r.success).length;
  getLogger().info(`复盘完成：成功 ${successCount}/${results.length}`);

  // 通知前端复盘完成
  game.emit('review:complete', { successCount, total: results.length });

  return results;
}

/**
 * 对单个角色执行复盘
 */
async function reviewPlayer(player, game, gameOverInfo) {
  const playerId = player.id;
  const roleId = player.role.id;
  const presetId = game.presetId;

  getLogger().info(`开始复盘：${player.name} (${roleId})`);

  try {
    // 构建复盘提示词
    const prompt = buildReviewPrompt(player, game, gameOverInfo);

    // 调用 LLM 获取复盘结果（传入 lastMessages 结构）
    const llmAgent = player.controller.llmAgent;
    const response = await llmAgent.callReviewAPI(prompt);  // prompt 包含 { systemPrompt, historyText, lastMessages }

    // 解析 LLM 响应
    const result = parseReviewResponse(response);

    if (result.success) {
      // 将策略补丁追加到策略文档
      await appendToStrategyGuide(presetId, roleId, result.content);
      getLogger().info(`复盘成功：${player.name}，已更新策略文档: ${result.content}`);
    }

    return { playerId, roleId, ...result };
  } catch (error) {
    getLogger().error(`复盘失败：${player.name}, ${error.message}`);
    return { playerId, roleId, success: false, error: error.message };
  }
}

/**
 * 构建复盘提示词
 * 使用 buildMessages 的结构，但不使用压缩，阶段提示词替换为复盘提示词
 */
function buildReviewPrompt(player, game, gameOverInfo) {
  // 导入 buildMessages
  const { buildMessages, formatMessageHistory } = require('../ai/context');

  // 构建决策上下文（与正常游戏决策相同，但 phase 设为 'review'）
  const context = {
    phase: 'review',
    players: game.players,
    alivePlayers: game.players.filter(p => p.alive),
    messages: game.message.getAllMessages(),  // 完整消息历史，不压缩
    self: player,
    dayCount: game.dayCount,
    werewolfTarget: game.werewolfTarget,
    witchPotion: {
      heal: player.state?.witchHeal > 0,
      poison: player.state?.witchPoison > 0
    }
  };

  // 使用 buildMessages 构建上下文（不使用压缩）
  const { systemPrompt, historyText, lastMessages } = buildMessages(player, game, context, {
    useCompression: false  // 关键：不使用压缩，使用完整消息历史
  });

  // 获取玩家结算信息
  const playerInfo = gameOverInfo.players.find(p => p.id === player.id);

  // 构建复盘阶段提示词
  const reviewPrompt = `## 游戏结果
- 获胜阵营：${gameOverInfo.winnerText}
- 游戏天数：${gameOverInfo.dayCount}天

## 你的死亡信息
- 存活状态：${playerInfo.alive ? '存活' : '死亡'}
- 死亡时机：${playerInfo.alive ? '存活' : '第' + playerInfo.deathDay + '天'}
- 死亡原因：${playerInfo.deathReason || '无'}

## 游戏结算信息
${formatGameOverInfo(gameOverInfo)}

## 复盘要求
请根据本局游戏的具体情况，提炼一条100字以内的策略补丁，追加到角色攻略文档末尾。

要求：
1. 简洁：一句话说清楚，只有一句话
2. 与攻略风格一致：参考现有策略文档的简洁条目式风格
3. 实用：针对本局具体问题给出可操作的建议

请以JSON格式返回：
```json
{
  "type": "review",
  "content": "你的策略补丁（100字以内，一句话）"
}
```

示例：
- 预言家: "被悍跳时先分析对跳者发言逻辑再决定是否退水，避免过早暴露身份"
- 女巫: "首夜自救后，第二夜优先救预言家而非自己，确保信息源存活"
- 狼人: "人狼恋情况下引导队友刀好人而非刀情侣，保护第三方胜利条件"
`;

  // 替换 lastMessages 中的 user 消息为复盘提示词
  const reviewLastMessages = [
    { role: 'system', content: `${systemPrompt}\n\n${historyText}` },
    { role: 'user', content: reviewPrompt }
  ];

  return {
    systemPrompt,
    historyText,
    phasePrompt: reviewPrompt,
    lastMessages: reviewLastMessages
  };
}

/**
 * 格式化游戏结算信息
 */
function formatGameOverInfo(gameOverInfo) {
  const lines = ['| 位置 | 玩家 | 角色 | 阵营 | 存活 | 死亡原因 |'];
  lines.push('|------|------|------|------|------|----------|');

  for (const p of gameOverInfo.players) {
    const pos = gameOverInfo.players.findIndex(gp => gp.id === p.id) + 1;
    const camp = p.role.camp === 'good' ? '好人' : p.role.camp === 'wolf' ? '狼人' : '第三方';
    lines.push(`| ${pos}号 | ${p.name} | ${p.role.name} | ${camp} | ${p.alive ? '是' : '否'} | ${p.deathReason || '-'} |`);
  }

  return lines.join('\n');
}

/**
 * 解析复盘响应
 * 期望格式: { "type": "review", "content": "策略补丁内容" }
 */
function parseReviewResponse(response) {
  try {
    // 尝试提取 JSON
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { success: false, error: '无法解析响应' };
    }

    const result = JSON.parse(jsonMatch[0]);

    // 验证格式
    if (result.type !== 'review' || !result.content) {
      return { success: false, error: '格式错误，需要 type=review 和 content 字段' };
    }

    return {
      success: true,
      content: result.content
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * 追加策略补丁到策略文档
 * 格式：直接在文档末尾加分割线，然后是一句话
 */
async function appendToStrategyGuide(presetId, roleId, patchContent) {
  if (!patchContent) return;

  const strategyPath = path.join(__dirname, '..', 'ai', 'strategy', presetId, `${roleId}.md`);

  if (!fs.existsSync(strategyPath)) {
    getLogger().warn(`策略文档不存在：${strategyPath}`);
    return;
  }

  // 读取现有内容
  let fileContent = fs.readFileSync(strategyPath, 'utf-8');

  // 添加策略补丁（简洁格式：分割线 + 一句话）
  const newSection = `\n\n---\n\n${patchContent}`;

  fileContent += newSection;

  // 写回文件
  fs.writeFileSync(strategyPath, fileContent, 'utf-8');
}

module.exports = { runReview };
```

### 3.5 修改 GameEngine (engine/main.js)

在 GameEngine 中添加复盘方法：

```javascript
// engine/main.js

// 添加 import
const { runReview } = require('./review');

// 在 GameEngine 类中添加方法
class GameEngine {
  // ... 现有方法 ...

  /**
   * 执行游戏复盘
   */
  async runReview() {
    // 使用事件循环，避免阻塞
    setImmediate(async () => {
      try {
        await runReview(this);
      } catch (error) {
        getLogger().error(`复盘执行失败: ${error.message}`);
      }
    });
  }
}
```

### 3.6 修改 PhaseManager (engine/phase.js)

在游戏结束后触发复盘阶段：

```javascript
// engine/phase.js

// 修改 _checkGameEnd 方法
_checkGameEnd() {
  const winner = this.game.config.hooks.checkWin(this.game);
  if (winner) {
    this.game.winner = winner;
    getLogger().info(`游戏结束，胜者: ${winner}`);
    this.game.gameOverInfo = this.game.getGameOverInfo();
    this.currentPhase = { id: 'game_over', name: '游戏结束' };
    this.game.message.add({
      type: 'game_over',
      content: `游戏结束，${winner === 'good' ? '好人阵营' : winner === 'wolf' ? '狼人阵营' : '第三方阵营'}获胜`,
      winner: winner,
      gameOverInfo: this.game.gameOverInfo,
      visibility: 'public'
    });

    // 清除所有待处理请求
    this.game.cancelAllPendingRequests();

    // 触发复盘阶段
    this.game.runReview();

    this.running = false;
    return true;
  }
  return false;
}
```

### 3.7 修改 LLMAgent (ai/agents/llm.js)

添加复盘 API 调用方法：

```javascript
// ai/agents/llm.js

class LLMAgent {
  // ... 现有方法 ...

  /**
   * 调用复盘 API
   * @param {Object} reviewData - 复盘数据，包含 lastMessages
   * @returns {Promise<string>} LLM 响应
   */
  async callReviewAPI(reviewData) {
    const { lastMessages } = reviewData;
    const apiConfig = this.getApiConfig();
    if (!apiConfig) {
      throw new Error('API 配置不可用');
    }

    // 使用 buildMessages 返回的 lastMessages 结构
    const response = await fetch(`${apiConfig.base_url}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiConfig.auth_token}`
      },
      body: JSON.stringify({
        model: apiConfig.model,
        messages: lastMessages,  // 直接使用 buildMessages 返回的消息数组
        temperature: 0.7
      })
    });

    if (!response.ok) {
      throw new Error(`API 调用失败: ${response.status}`);
    }

    const data = await response.json();
    return data.choices[0]?.message?.content || '';
  }
}
```

### 3.8 前端修改 (public/app.js)

前端需要等待复盘完成后才能开启新游戏：

```javascript
// public/app.js

// 修改游戏结束处理
function handleGameOver(data) {
  // 显示游戏结束界面
  showGameOverUI(data);

  // 显示"复盘中"状态
  showReviewStatus('复盘中，请稍候...');

  // 禁用"再开一局"按钮
  disableNewGameButton();
}

// 处理复盘完成事件
function handleReviewComplete(data) {
  showReviewStatus(`复盘完成！共分析 ${data.successCount}/${data.total} 个角色`);

  // 启用"再开一局"按钮
  enableNewGameButton();
}

// WebSocket 消息处理
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);

  switch (msg.type) {
    case 'game_over':
      handleGameOver(msg.data);
      break;

    case 'review_status':
      showReviewStatus(msg.data.message);
      break;

    case 'review_complete':
      handleReviewComplete(msg.data);
      break;

    // ... 其他消息处理
  }
};
```

### 3.9 服务器修改 (server.js)

服务器需要处理复盘完成事件并通知前端：

```javascript
// server.js

// 在游戏消息监听中添加复盘完成处理
game.on('review:complete', (data) => {
  // 广播复盘完成消息
  broadcast({ type: 'review_complete', data });
});
```

---

## 四、策略文档更新机制

### 4.1 更新格式

复盘建议直接追加到策略文档末尾，格式简洁：

```markdown
---

被悍跳时先分析对跳者发言逻辑再决定是否退水
```

追加后策略文档变成：
```markdown
## 策略要点
1. 首夜验人优先级：...

---

被悍跳时先分析对跳者发言逻辑再决定是否退水
```



## 八、注意事项

1. **非压缩内容**: 复盘时必须使用非压缩的完整消息历史，确保 LLM 获取全部信息
2. **并行执行**: 所有 LLM 角色的复盘应并行执行，减少等待时间
3. **前端阻塞**: 「再开一局」按钮必须等待所有复盘完成后才能点击
4. **日志记录**: 所有复盘操作都需要记录日志，便于调试