/**
 * 前端 Controller - 与 AI Controller 接口对齐
 * 维护自己看到的消息历史、状态，通过 API 与 server 交互
 */

class Controller {
  constructor() {
    this.playerId = null;
    this.playerName = null;

    // 自己看到的消息历史
    this.messageHistory = [];

    // 自己的状态缓存
    this.cachedState = null;

    // SSE 连接
    this.eventSource = null;

    // 状态变更回调
    this.onStateChange = null;
  }

  // 连接 SSE
  connectSSE() {
    if (this.eventSource) {
      this.eventSource.close();
    }

    const url = this.playerName ? `/events?name=${encodeURIComponent(this.playerName)}` : '/events';
    this.eventSource = new EventSource(url);

    this.eventSource.addEventListener('state_update', (e) => {
      try {
        console.log('[SSE] 收到状态更新');
        const data = JSON.parse(e.data);
        this.cachedState = data;

        // 更新消息历史
        if (data.messages) {
          const lastId = this.messageHistory.length > 0
            ? this.messageHistory[this.messageHistory.length - 1].id
            : 0;
          data.messages.forEach(msg => {
            if (msg.id > lastId) {
              this.messageHistory.push(msg);
            }
          });
        }

        // 触发回调
        if (this.onStateChange) {
          this.onStateChange(data);
        }
      } catch (err) {
        console.error('SSE 数据解析错误:', err, e.data);
      }
    });

    this.eventSource.addEventListener('ai_thinking', (e) => {
      try {
        const data = JSON.parse(e.data);
        console.log('[SSE] AI 思考中:', data.playerName);
        // 可以在这里显示 AI 思考提示
        if (this.onStateChange) {
          // 添加思考消息到界面
          const thinkingMsg = { type: 'ai_thinking', playerName: data.playerName };
          this.messageHistory.push(thinkingMsg);
          this.onStateChange(this.cachedState);
        }
      } catch (err) {
        console.error('SSE AI思考数据解析错误:', err);
      }
    });

    this.eventSource.onerror = () => {
      if (this.eventSource) {
        this.eventSource.close();
        this.eventSource = null;
      }
      setTimeout(() => this.connectSSE(), 3000);
    };
  }

  // 加入游戏
  async join(name, playerCount) {
    this.playerName = name;

    try {
      const res = await fetch('/api/ready', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerName: name, playerCount })
      });

      const data = await res.json();
      if (!data.success) {
        return { error: data.error };
      }

      this.playerId = data.playerId;
      this.cachedState = data.state;

      // 更新消息历史
      if (data.state?.messages) {
        this.messageHistory = data.state.messages;
      }

      this.connectSSE();

      return { success: true, gameStarted: data.gameStarted };
    } catch (e) {
      return { error: e.message };
    }
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

    try {
      const res = await fetch('/api/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId: this.playerId, content })
      });

      const data = await res.json();
      if (data.success && data.state) {
        this.cachedState = data.state;
      }
      return data;
    } catch (e) {
      return { error: e.message };
    }
  }

  // 投票（接口对齐）
  async vote(targetId) {
    if (!this.playerId) return { error: '未加入游戏' };

    try {
      const res = await fetch('/api/vote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voterId: this.playerId, targetId })
      });

      const data = await res.json();
      if (data.success && data.state) {
        this.cachedState = data.state;
      }
      return data;
    } catch (e) {
      return { error: e.message };
    }
  }

  // 弃权（接口对齐）
  abstain() {
    return this.vote(null);
  }

  // 使用技能（接口对齐）
  async useSkill(data) {
    if (!this.playerId) return { error: '未加入游戏' };

    try {
      const res = await fetch('/api/skill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId: this.playerId, ...data })
      });

      const result = await res.json();
      if (result.success && result.state) {
        this.cachedState = result.state;
      }
      return result;
    } catch (e) {
      return { error: e.message };
    }
  }

  // 使用全局能力（接口对齐）
  async useGlobalAbility(abilityId, data) {
    if (!this.playerId) return { error: '未加入游戏' };

    try {
      const res = await fetch('/api/ability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId: this.playerId, abilityId, ...data })
      });

      return res.json();
    } catch (e) {
      return { error: e.message };
    }
  }

  // 添加 AI
  async addAI() {
    try {
      const res = await fetch('/api/add-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: 1 })
      });

      const data = await res.json();
      if (data.success && data.state) {
        this.cachedState = data.state;
      }
      return data;
    } catch (e) {
      return { error: e.message };
    }
  }

  // 重置游戏
  async reset() {
    try {
      await fetch('/api/reset', { method: 'POST' });
      this.playerId = null;
      this.playerName = null;
      this.messageHistory = [];
      this.cachedState = null;
      if (this.eventSource) {
        this.eventSource.close();
        this.eventSource = null;
      }
      return { success: true };
    } catch (e) {
      return { error: e.message };
    }
  }

  // 获取玩家位置（1-based）
  getPlayerPosition(playerId) {
    if (!this.cachedState?.players) return 0;
    return this.cachedState.players.findIndex(p => p.id === playerId) + 1;
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