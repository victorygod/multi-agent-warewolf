/**
 * 事件系统 - 发布订阅模式
 */

class EventEmitter {
  constructor() {
    this.listeners = new Map();
  }

  // 订阅事件
  on(event, handler) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(handler);
  }

  // 取消订阅
  off(event, handler) {
    if (!this.listeners.has(event)) return;
    const handlers = this.listeners.get(event);
    const idx = handlers.indexOf(handler);
    if (idx > -1) handlers.splice(idx, 1);
  }

  // 触发事件，返回是否被取消
  emit(event, data) {
    if (!this.listeners.has(event)) return false;
    for (const handler of this.listeners.get(event)) {
      const result = handler(data);
      if (result?.cancel) return true; // 事件被取消
    }
    return false;
  }

  // 一次性订阅
  once(event, handler) {
    const wrapper = (data) => {
      this.off(event, wrapper);
      return handler(data);
    };
    this.on(event, wrapper);
  }
}

module.exports = { EventEmitter };