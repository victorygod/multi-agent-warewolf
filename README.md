# 🐺 狼人杀游戏

一个支持 AI 玩家的在线狼人杀游戏，基于大语言模型驱动 AI 角色的发言和决策。

## 功能特性

- 🎮 **多人游戏** - 支持 9/12/16 人局
- 🤖 **AI 玩家** - AI 自动发言、投票、使用技能
- 👥 **多种角色** - 狼人、预言家、女巫、守卫、猎人、村民
- 🌐 **Web 界面** - 实时 SSE 推送，流畅的游戏体验
- 🔧 **调试模式** - 可指定玩家角色，方便测试

## 角色介绍

| 角色 | 阵营 | 技能 |
|------|------|------|
| 🐺 狼人 | 狼人阵营 | 夜间可猎杀一名玩家 |
| 🔮 预言家 | 神职阵营 | 夜间可查验一名玩家身份 |
| 🧪 女巫 | 神职阵营 | 拥有一瓶解药和一瓶毒药 |
| 🛡️ 守卫 | 神职阵营 | 夜间可守护一名玩家 |
| 🔫 猎人 | 神职阵营 | 死亡时可开枪带走一名玩家 |
| 👨‍🌾 村民 | 村民阵营 | 无特殊技能 |

## 快速开始

### 1. 克隆项目

```bash
git clone https://github.com/your-username/werewolf-game.git
cd werewolf-game
```

### 2. 安装依赖

```bash
npm install
```

### 3. 配置 API

复制配置文件模板：

```bash
cp api_key.conf.example api_key.conf
```

编辑 `api_key.conf`，填入你的 API 配置：

```json
{
  "base_url": "https://your-api-endpoint/v1",
  "auth_token": "your-api-key",
  "model": "your-model-name"
}
```

### 4. 启动服务

```bash
npm start
```

访问 http://localhost:3000 即可开始游戏。

## 项目结构

```
werewolf-game/
├── server.js          # Express 服务器入口
├── api_key.conf       # API 配置（需自行创建）
├── api_key.conf.example # 配置模板
├── package.json       # 项目依赖
├── game/
│   ├── engine.js      # 游戏引擎核心逻辑
│   ├── roles.js       # 角色定义和配置
│   └── messages.js    # 游戏消息处理
├── ai/
│   ├── controller.js  # AI 控制器
│   ├── agent.js       # AI Agent 实现
│   └── profiles.js    # AI 人设配置
└── public/
    ├── index.html     # 前端页面
    ├── style.css      # 样式文件
    └── app.js         # 前端逻辑
```

## API 接口

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/state` | GET | 获取游戏状态 |
| `/api/join` | POST | 玩家加入游戏 |
| `/api/ready` | POST | 一键准备开始 |
| `/api/start` | POST | 开始游戏 |
| `/api/speak` | POST | 发言 |
| `/api/vote` | POST | 投票 |
| `/api/seer-check` | POST | 预言家查验 |
| `/api/witch-action` | POST | 女巫使用药水 |
| `/api/guard-protect` | POST | 守卫守护 |
| `/api/hunter-shoot` | POST | 猎人开枪 |
| `/api/reset` | POST | 重置游戏 |
| `/events` | GET | SSE 事件流 |

## 开发

### 调试模式

服务器默认开启调试模式，可在游戏中指定玩家角色。生产环境设置环境变量关闭：

```bash
DEBUG_MODE=false npm start
```

## 技术栈

- **后端**: Node.js + Express
- **前端**: 原生 JavaScript + SSE
- **AI**: 大语言模型 API (兼容 Anthropic 接口)

## License

[MIT](LICENSE)