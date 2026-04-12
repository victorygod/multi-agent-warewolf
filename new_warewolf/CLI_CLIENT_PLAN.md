# CLI 客户端随机游走测试计划

## 一、项目目标

创建一个 CLI 客户端 (`cli_client.js`)，用于自动化随机游走测试狼人杀游戏，发现游戏逻辑问题。

## 二、核心设计

### 2.1 架构模式

```
┌─────────────────┐     WebSocket      ┌─────────────────┐
│   CLI Client    │ ◄───────────────► │   Game Server   │
│  (cli_client.js)│                    │   (server.js)   │
└─────────────────┘                    └─────────────────┘
```

**设计原则**：
- 单文件实现，无额外依赖
- 每次调用建立新 WebSocket 连接（类似页面刷新，服务器支持重连）
- 输出 JSON 格式状态，执行完毕即退出

### 2.2 配置参数

| 参数 | 值 | 说明 |
|-----|-----|------|
| 请求超时 | `5000ms` | 每次请求最多等待 5 秒 |
| 服务器地址 | `ws://localhost:3000` | 默认本地服务器 |

## 三、命令设计

### 3.1 基本命令

```bash
# 查询当前状态（无操作参数）
node cli_client.js --name TestBot

# 加入游戏
node cli_client.js --name TestBot --join [--players 9] [--role seer]

# 添加 AI 玩家
node cli_client.js --name TestBot --add-ai

# 重置游戏
node cli_client.js --name TestBot --reset
```

### 3.2 响应行动请求

```bash
# 基本格式
node cli_client.js --name TestBot --request-id <requestId> --action <actionType> [参数...]

# 发言/遗言
--action speak --content "我是好人"
--action last_words --content "我是预言家"

# 投票
--action vote --target 3
--action vote --abstain  # 弃权

# 竞选/退水
--action campaign --run true
--action withdraw --withdraw false

# 选择目标类（守卫、预言家、猎人、传警徽）
--action guard --target 2
--action seer --target 5
--action shoot --target 4
--action pass_badge --target 3

# 女巫
--action witch --subaction heal
--action witch --subaction poison --target 2
--action witch --subaction skip

# 丘比特
--action cupid --targets 1,3

# 警长指定发言顺序
--action assignOrder --target 2
```

### 3.3 快捷命令（无需 requestId）

```bash
# 发言
node cli_client.js --name TestBot --speak --content "我是好人"

# 投票
node cli_client.js --name TestBot --vote --target 3
node cli_client.js --name TestBot --vote --abstain

# 警长指定发言顺序
node cli_client.js --name TestBot --sheriff-order --target 2
```

### 3.4 参数说明

| 参数 | 说明 |
|-----|------|
| `--name` | 玩家名称（必填，用于标识和重连） |
| `--join` | 加入游戏标志 |
| `--players` | 游戏人数（join 时可选，默认 9） |
| `--role` | debug 模式下指定角色 |
| `--add-ai` | 添加 AI 玩家 |
| `--reset` | 重置游戏 |
| `--request-id` | 响应的行动请求 ID |
| `--action` | 行动类型 |
| `--target` | 目标玩家 ID |
| `--targets` | 多目标（丘比特用，逗号分隔） |
| `--content` | 发言内容 |
| `--run` | 是否竞选（true/false） |
| `--withdraw` | 是否退水（true/false） |
| `--subaction` | 女巫操作类型（heal/poison/skip） |
| `--abstain` | 弃权标志 |
| `--speak` | 发言操作标志 |
| `--vote` | 投票操作标志 |
| `--sheriff-order` | 警长指定发言顺序标志 |

## 四、action_required 类型分类

### 4.1 选择目标类

从 `allowedTargets` 中选一个目标。

| action | 额外数据 | 响应参数 |
|--------|---------|---------|
| `vote` | `allowedTargets` | `{ targetId }` 或 `{ targetId: null }` 弃权 |
| `guard` | `allowedTargets`, `lastGuardTarget` | `{ targetId }` |
| `seer` | `allowedTargets`, `checkedIds` | `{ targetId }` |
| `shoot` | `allowedTargets` | `{ targetId }` |
| `pass_badge` | `allowedTargets` | `{ targetId }` 或 `{ targetId: null }` 撕警徽 |

### 4.2 选择多目标类

| action | 额外数据 | 响应参数 |
|--------|---------|---------|
| `cupid` | `count: 2`, `allowedTargets` | `{ targetIds: [id1, id2] }` |

### 4.3 选择起始玩家类

| action | 额外数据 | 响应参数 |
|--------|---------|---------|
| `assignOrder` | `allowedTargets` | `{ targetId }` |

### 4.4 多选一类（女巫）

| action | 额外数据 | 响应参数 |
|--------|---------|---------|
| `witch` | `werewolfTarget`, `healAvailable`, `poisonAvailable`, `canSelfHeal`, `poisonTargets` | `{ action: 'heal'/'poison'/'skip', targetId? }` |

- `healAvailable=true` 可选 `action: 'heal'`
- `poisonAvailable=true` 可选 `action: 'poison', targetId`（从 `poisonTargets` 中选）
- 也可选 `action: 'skip'`

### 4.5 布尔选择类

| action | 额外数据 | 响应参数 |
|--------|---------|---------|
| `campaign` | 无 | `{ run: boolean }` |
| `withdraw` | 无 | `{ withdraw: boolean }` |

### 4.6 文本输入类

| action | 额外数据 | 响应参数 |
|--------|---------|---------|
| `speak` | `visibility` | `{ content }` |
| `last_words` | `visibility` | `{ content }` |

## 五、输出格式

### 5.1 判断是否需要行动

通过返回 JSON 中的 `actionRequired` 字段判断：

- **需要行动**：`actionRequired` 存在且不为 null
- **等待中**：`actionRequired` 为 null，且 `winner` 不存在
- **游戏结束**：`winner` 字段存在

### 5.2 状态响应示例

```json
{
  "status": "waiting_action",
  "phase": "day_vote",
  "dayCount": 1,
  "players": [...],
  "self": {
    "id": 1,
    "role": {"id": "seer", "name": "预言家"},
    "alive": true
  },
  "actionRequired": {
    "requestId": "1-vote-xxx",
    "action": "vote",
    "allowedTargets": [2, 3, 4, 5]
  }
}
```

### 5.3 游戏结束响应

```json
{
  "status": "game_over",
  "winner": "good",
  "gameOverInfo": {...}
}
```

### 5.4 错误响应

```json
{
  "status": "error",
  "error": "连接超时"
}
```

## 六、实现逻辑

### 6.1 主流程

1. 解析命令行参数
2. 建立 WebSocket 连接
3. 发送 `join` 消息（带 name）
4. 等待 `state` 消息，缓存最新状态
5. 如果有操作参数，发送对应消息
6. 等待操作后的状态更新
7. 输出 JSON 格式的当前状态
8. 关闭连接并退出

### 6.2 消息发送逻辑

根据参数类型决定发送的消息：

| 参数组合 | 消息类型 | 内容 |
|---------|---------|------|
| `--add-ai` | `add_ai` | `{}` |
| `--reset` | `reset` | `{}` |
| `--speak --content` | `speak` | `{ content }` |
| `--vote --target` | `vote` | `{ targetId }` |
| `--vote --abstain` | `vote` | `{ targetId: null }` |
| `--sheriff-order --target` | `sheriff_order` | `{ startPlayerId }` |
| `--request-id --action` | `response` | `{ requestId, ...响应数据 }` |

### 6.3 响应数据构建

根据 `--action` 类型构建不同的响应数据：

- `speak`/`last_words` → `{ content }`
- `vote` → `{ targetId }` 或 `{ targetId: null }`
- `campaign` → `{ run: boolean }`
- `withdraw` → `{ withdraw: boolean }`
- `guard`/`seer`/`shoot`/`pass_badge`/`assignOrder` → `{ targetId }`
- `witch` → `{ action, targetId? }`
- `cupid` → `{ targetIds }`

### 6.4 超时处理

- 设置 5 秒全局超时
- 超时后输出错误 JSON 并退出（exit code 1）

## 七、实现清单

- [ ] 创建 `cli_client.js`
  - [ ] 参数解析
  - [ ] WebSocket 连接管理
  - [ ] 消息发送（join, add_ai, reset, speak, vote, sheriff_order, response）
  - [ ] 状态接收和缓存
  - [ ] JSON 输出格式化
  - [ ] 5 秒超时处理

## 八、验收标准

1. **基本功能**
   - [ ] 能成功加入游戏
   - [ ] 能添加 AI 玩家
   - [ ] 能重置游戏
   - [ ] 能正确响应所有类型的 action_required
   - [ ] 能完整运行一局游戏直到结束

2. **稳定性**
   - [ ] 5 秒超时机制正常工作
   - [ ] 网络断开能正确报错
   - [ ] 异常状态能正确退出

3. **可观测性**
   - [ ] 输出 JSON 格式正确
   - [ ] 包含完整的游戏状态信息
   - [ ] 错误信息清晰可读