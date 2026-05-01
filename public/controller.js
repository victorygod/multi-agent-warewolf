/**
 * 前端 Controller - WebSocket 版本
 * 与 AI Controller 接口对齐
 */

class Controller {
  constructor() {
    this.playerId = null;
    this.playerName = null;

    // 自己看到的消息历史
    this.messageHistory = [];

    // 自己的状态缓存
    this.cachedState = null;

    // WebSocket 连接
    this.ws = null;

    // 状态变更回调
    this.onStateChange = null;

    // 行动请求回调
    this.onActionRequired = null;
  }

  // 连接 WebSocket
  connect(name, presetId = null, debugRole = null) {
    this.playerName = name;
    this.presetId = presetId;
    this.debugRole = debugRole;
    const wsUrl = `ws://${window.location.host}`;
    this.ws = new WebSocket(wsUrl);

    // 设置前端日志的 WebSocket 实例
    if (window.setFrontendLoggerWs) {
      window.setFrontendLoggerWs(this.ws);
    }

    this.ws.onopen = () => {
      if (window.frontendLogger) {
        window.frontendLogger.debug('[WS] 连接成功');
      }
      // 发送加入消息
      this.send('join', { name, presetId, debugRole });
    };

    this.ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        this.handleMessage(msg);
      } catch (err) {
        if (window.frontendLogger) {
          window.frontendLogger.error(`[WS] 消息解析错误: ${err}`);
        }
      }
    };

    this.ws.onclose = () => {
      if (window.frontendLogger) {
        window.frontendLogger.debug('[WS] 连接关闭');
      }
      // 尝试重连
      setTimeout(() => {
        if (this.playerName) {
          this.connect(this.playerName);
        }
      }, 3000);
    };

    this.ws.onerror = (err) => {
      if (window.frontendLogger) {
        window.frontendLogger.error(`[WS] 错误: ${err}`);
      }
    };
  }

  // 处理服务器消息
  handleMessage(msg) {
    switch (msg.type) {
      case 'state':
        if (window.frontendLogger) {
          window.frontendLogger.info(`[WS] state: ${JSON.stringify(msg.data)}`);
        }
        this.cachedState = msg.data;
        if (msg.data?.self) {
          this.playerId = msg.data.self.id;
        }

        // 更新消息历史
        if (msg.data?.messages) {
          const lastId = this.messageHistory.length > 0
            ? this.messageHistory[this.messageHistory.length - 1].id
            : 0;
          msg.data.messages.forEach(m => {
            if (m.id > lastId) {
              // 检查是否已存在
              if (!this.messageHistory.some(existing => existing.id === m.id)) {
                this.messageHistory.push(m);
              }
            }
          });
        }

        // 触发回调
        if (this.onStateChange) {
          this.onStateChange(msg.data);
        }

        // 检查 pendingAction，触发行动请求回调
        if (msg.data?.pendingAction && this.onActionRequired) {
          this.onActionRequired({ data: msg.data.pendingAction });
        }
        break;

      case 'error':
        if (window.frontendLogger) {
          window.frontendLogger.error(`[WS] 服务器错误: ${msg.message}`);
        }
        if (this.onStateChange) {
          this.onStateChange({ ...this.cachedState, error: msg.message });
        }
        break;

      case 'phase_start':
        if (window.frontendLogger) {
          window.frontendLogger.debug(`[WS] 阶段开始: ${msg.phase} ${msg.phaseName || ''}`);
        }
        // phase_start 消息会通过 state.messages 同步，不需要手动添加
        if (this.onStateChange) {
          this.onStateChange(this.cachedState);
        }
        break;

      case 'phase_end':
        if (window.frontendLogger) {
          window.frontendLogger.debug(`[WS] 阶段结束: ${msg.phase}`);
        }
        break;

      case 'death_announce':
        if (window.frontendLogger) {
          window.frontendLogger.info(`[WS] 死亡公告: ${JSON.stringify(msg.deaths)}`);
        }
        if (this.onStateChange) {
          this.onStateChange(this.cachedState);
        }
        break;

      default:
        if (window.frontendLogger) {
          window.frontendLogger.warn(`[WS] 未知消息类型: ${msg.type}`);
        }
    }
  }

  // 发送消息
  send(type, data = {}) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, ...data }));
    }
  }

  // 响应行动请求
  respond(requestId, data = {}) {
    this.send('response', { requestId, ...data });
  }

  // 加入游戏
  async join(name, presetId, debugRole = null) {
    this.playerName = name;
    this.connect(name, presetId, debugRole);

    return new Promise((resolve) => {
      const checkState = () => {
        if (this.cachedState) {
          resolve({
            success: true,
            playerId: this.playerId,
            state: this.cachedState,
            gameStarted: this.cachedState.phase !== 'waiting'
          });
        } else {
          setTimeout(checkState, 100);
        }
      };
      checkState();
    });
  }

  // 获取当前状态（接口对齐）
  getState() {
    return this.cachedState;
  }

  // 获取消息历史
  getMessageHistory() {
    return this.messageHistory;
  }

  // 发言（接口对齐）
  async speak(content) {
    if (!this.playerId) return { error: '未加入游戏' };
    this.send('speak', { content });
    return { success: true };
  }

  // 投票（接口对齐）
  async vote(targetId) {
    if (!this.playerId) return { error: '未加入游戏' };
    this.send('vote', { targetId });
    return { success: true };
  }

  // 弃权（接口对齐）
  abstain() {
    return this.vote(null);
  }

  // 使用技能（接口对齐）
  async useSkill(data) {
    if (!this.playerId) return { error: '未加入游戏' };
    this.send('skill', data);
    return { success: true };
  }

  // 使用全局能力（接口对齐）
  async useGlobalAbility(abilityId, data) {
    if (!this.playerId) return { error: '未加入游戏' };
    // 暂不支持
    return { error: '暂不支持' };
  }

  // 警长指定发言起始位置
  async setSheriffOrder(startPlayerId) {
    if (!this.playerId) return { error: '未加入游戏' };
    this.send('sheriff_order', { startPlayerId });
    return { success: true };
  }

  // 添加 AI
  async addAI() {
    this.send('add_ai');
    return { success: true };
  }

  // 重置游戏
  async reset() {
    this.send('reset');
    this.playerId = null;
    this.playerName = null;
    this.messageHistory = [];
    this.cachedState = null;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    return { success: true };
  }

  // 获取玩家位置（ID = 位置编号）
  getPlayerPosition(playerId) {
    return playerId;
  }

  // 获取当前玩家
  getMyPlayer() {
    if (!this.cachedState?.players || !this.playerName) return null;
    return this.cachedState.players.find(p => p.name === this.playerName && !p.isAI);
  }
}

// 单例
const controller = new Controller();

// 浏览器环境导出
if (typeof window !== 'undefined') {
  window.controller = controller;
}