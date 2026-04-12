# 日志系统构建计划

## 目标

日志统一输出到 `logs/` 目录，分为三个文件：
- `backend.log` - 后端日志
- `agent.log` - Agent 日志
- `frontend.log` - 前端日志

每次服务器启动时清空日志目录。

## 日志库选择

### 自建方案（不使用第三方库）

我们自己的实现，特点：
- 轻量简单，无外部依赖
- 每行日志包含：时间戳、级别、文件路径:行号、消息

### 日志格式

```
{timestamp} [{level}] {filePath}:{line} {message}
```

示例：
```
1712937600000 [INFO] engine/phase.js:167 进入阶段: night_werewolf_discuss
1712937600050 [INFO] server.js:130 请求 1号玩家 行动: vote
1712937600100 [INFO] ai/controller.js:145 1号玩家 投票给 5号玩家
```


## 各日志文件详细规范

### 1. backend.log - 后端日志

**记录内容**：
- 阶段开始/结束：`进入阶段: {phaseId}`, `阶段完成: {phaseId}`
- 玩家操作请求：`请求 {位置号}玩家 行动: {actionType}`
- 玩家操作响应：`{位置号}玩家 行动结果: {result}`
- 游戏状态变化：`游戏开始`, `玩家死亡: {位置号}`, `警长当选: {位置号}`
- 服务器事件：`新连接`, `断开连接`, `收到消息: {type}`

**不记录**：
- 详细的游戏状态数据
- 调试性质的中间变量
- AI/Agent 的内部决策过程

**格式示例**：
```
1712937600000 [INFO] engine/phase.js:167 进入阶段: night_werewolf_discuss
1712937600050 [INFO] server.js:130 请求 1号玩家 行动: vote
1712937600100 [INFO] engine/main.js:245 1号玩家 投票给 5号玩家
1712937600150 [INFO] engine/phase.js:312 阶段完成: night_werewolf_discuss
```

### 2. agent.log - Agent 日志

**记录内容**：
- 被调用时的上下文（可见的玩家、阶段、已有信息）
- 自己做出的决策（action）
- 决策依据（关键推理）

**格式示例**：
```
1712937600050 [AGENT] ai/controller.js:118 1号玩家(狼人) 被请求行动: vote
1712937600051 [AGENT] ai/controller.js:119   上下文: 阶段=day_vote, 存活玩家=9人
1712937600052 [AGENT] ai/agents/random.js:45 决策: { type: 'vote', target: '5' }
```

### 3. frontend.log - 前端日志

**记录内容**：
- 收到的后端消息
- 发送给后端的消息
- 用户交互
- 界面状态变化

**格式示例**：
```
1712937600000 [WS] public/controller.js:100 收到: phase_start
1712937600100 [WS] public/controller.js:115 发送: action_response
1712937600500 [UI] public/app.js:230 收到行动请求: vote
```

> 注：前端日志通过 WebSocket 发送到后端，由后端写入 `frontend.log`

## 实现步骤

### Step 1: 创建日志模块

创建 `utils/logger.js`：
```javascript
const fs = require('fs');
const path = require('path');

// logs 目录路径
const LOGS_DIR = path.join(__dirname, '..', 'logs');

// 确保 logs 目录存在
function ensureLogsDir() {
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }
}

// 清空日志目录
function clearLogs() {
  ensureLogsDir();
  fs.readdirSync(LOGS_DIR).forEach(file => {
    if (file.endsWith('.log')) {
      fs.unlinkSync(path.join(LOGS_DIR, file));
    }
  });
}

// 创建日志实例
function createLogger(filename) {
  ensureLogsDir();
  const filepath = path.join(LOGS_DIR, filename);
  return {
    info: (msg) => writeLog(filepath, 'INFO', msg),
    warn: (msg) => writeLog(filepath, 'WARN', msg),
    error: (msg) => writeLog(filepath, 'ERROR', msg),
    debug: (msg) => writeLog(filepath, 'DEBUG', msg)
  };
}

// 写入日志（带文件路径和行号）
function writeLog(filepath, level, msg) {
  // 获取调用者的文件路径和行号
  const stack = new Error().stack;
  const callerLine = stack.split('\n')[3]; // 第0行是Error, 1是writeLog, 2是caller, 3是实际调用者
  const match = callerLine.match(/at\s+(.*):(\d+):\d+/);
  const caller = match ? `${match[1]}:${match[2]}` : 'unknown';

  const timestamp = Date.now();
  const line = `${timestamp} [${level}] ${caller} ${msg}\n`;

  fs.appendFileSync(filepath, line);

  // ERROR 同时输出到 console
  if (level === 'ERROR') {
    console.error(`[${level}] ${caller} ${msg}`);
  }
}

module.exports = { createLogger, clearLogs };
```

**使用方式**：
```javascript
const logger = createLogger('backend.log');
logger.info('进入阶段: night_werewolf_discuss');

// 输出: 1712937600000 [INFO] engine/phase.js:167 进入阶段: night_werewolf_discuss
```

**实现原理**：
- 通过 `new Error().stack` 获取调用栈
- 解析栈信息提取文件名和行号
- 每条日志自动附带调用位置

### Step 3: 初始化日志（服务器启动时）

在 server.js 启动时：
```javascript
const { createLogger, clearLogs } = require('./utils/logger');

// 每次启动清空日志
clearLogs();

// 创建日志实例
const backendLogger = createLogger('backend.log');
const agentLogger = createLogger('agent.log');
```

### Step 4: 替换后端 console.log

需要修改的文件：
- `server.js` - 服务器日志
- `engine/phase.js` - 阶段日志
- `engine/main.js` - 引擎日志

### Step 5: 替换 Agent 日志

需要修改的文件：
- `ai/controller.js` - AI 控制器
- `ai/agents/random.js` - 随机 Agent
- `ai/agents/llm.js` - LLM Agent
- `ai/agents/mock.js` - Mock Agent

### Step 6: 前端日志

前端无法直接写文件到本地，需要曲线救国：

**方案 A：通过 WebSocket 发送给后端写入（推荐）**

1. 前端定义日志函数，发送到后端
```javascript
// public/logger.js
const frontendLogger = {
  log: (level, msg) => {
    // 发送到后端
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'frontend_log',
        data: { level, message: msg, time: Date.now() }
      }));
    }
    // 同时输出到 console（开发调试用）
    console.log(`[FRONTEND] ${msg}`);
  },
  info: (msg) => frontendLogger.log('INFO', msg),
  warn: (msg) => frontendLogger.log('WARN', msg),
  error: (msg) => frontendLogger.log('ERROR', msg)
};
```

2. 后端接收并写入文件
```javascript
// server.js
ws.on('message', (data) => {
  const msg = JSON.parse(data);
  if (msg.type === 'frontend_log') {
    frontendLogger.write(msg.data.level, msg.data.message);
  }
});
```

### Step 3: 替换后端 console.log

需要修改的文件：
- `server.js` - 服务器日志
- `engine/phase.js` - 阶段日志
- `engine/main.js` - 引擎日志

### Step 4: 替换 Agent 日志

需要修改的文件：
- `ai/controller.js` - AI 控制器
- `ai/agents/random.js` - 随机 Agent
- `ai/agents/llm.js` - LLM Agent
- `ai/agents/mock.js` - Mock Agent

### Step 5: 前端日志

在 `public/controller.js` 和 `public/app.js` 中：
- 替换 console.log 为自定义日志函数
- 通过 WebSocket 发送日志到后端（或直接写入 localStorage 后导出）

## 文件清单

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `utils/logger.js` | 新建 | 日志模块 |
| `server.js` | 修改 | 替换 console.log，使用 logger |
| `engine/phase.js` | 修改 | 阶段日志 |
| `engine/main.js` | 修改 | 引擎日志 |
| `ai/controller.js` | 修改 | Agent 调用日志 |
| `ai/agents/random.js` | 修改 | 随机决策日志 |
| `ai/agents/llm.js` | 修改 | LLM 决策日志 |
| `public/controller.js` | 修改 | 前端 WebSocket 日志 |
| `public/app.js` | 修改 | 前端 UI 日志 |

## 优先级

1. **高优先级**：后端阶段日志、Agent 决策日志 - 用于调试游戏流程
2. **中优先级**：服务器事件日志、前端消息日志 - 用于调试通信
3. **低优先级**：UI 交互日志 - 可后续添加