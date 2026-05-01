const { describe, it, beforeEach, run } = require('../../helpers/test-runner');
const { EventEmitter } = require('../../../engine/event');

describe('EventEmitter - on', () => {
  let emitter;

  beforeEach(() => {
    emitter = new EventEmitter();
  });

  it('registers a handler that gets called on emit', () => {
    let called = false;
    emitter.on('test', () => { called = true; });
    emitter.emit('test');
    if (!called) throw new Error('handler was not called');
  });

  it('supports multiple handlers for the same event', () => {
    const calls = [];
    emitter.on('evt', () => calls.push(1));
    emitter.on('evt', () => calls.push(2));
    emitter.emit('evt');
    if (calls.length !== 2) throw new Error(`expected 2 calls, got ${calls.length}`);
    if (calls[0] !== 1 || calls[1] !== 2) throw new Error('handlers called in wrong order');
  });
});

describe('EventEmitter - emit', () => {
  let emitter;

  beforeEach(() => {
    emitter = new EventEmitter();
  });

  it('calls all handlers and returns false when no cancel', () => {
    let count = 0;
    emitter.on('evt', () => { count++; });
    emitter.on('evt', () => { count++; });
    const result = emitter.emit('evt');
    if (count !== 2) throw new Error(`expected 2 calls, got ${count}`);
    if (result !== false) throw new Error(`expected false, got ${result}`);
  });

  it('returns true when a handler returns { cancel: true }', () => {
    emitter.on('evt', () => ({ cancel: true }));
    const result = emitter.emit('evt');
    if (result !== true) throw new Error(`expected true, got ${result}`);
  });
});

describe('EventEmitter - emit with cancel', () => {
  let emitter;

  beforeEach(() => {
    emitter = new EventEmitter();
  });

  it('stops calling subsequent handlers when one returns { cancel: true }', () => {
    let secondCalled = false;
    emitter.on('evt', () => ({ cancel: true }));
    emitter.on('evt', () => { secondCalled = true; });
    const result = emitter.emit('evt');
    if (result !== true) throw new Error(`expected true, got ${result}`);
    if (secondCalled) throw new Error('second handler should not be called after cancel');
  });

  it('only cancels from the canceling handler, earlier handlers still run', () => {
    const calls = [];
    emitter.on('evt', () => calls.push('a'));
    emitter.on('evt', () => calls.push('b'));
    emitter.on('evt', () => ({ cancel: true }));
    emitter.on('evt', () => calls.push('c'));
    emitter.emit('evt');
    if (calls.length !== 2) throw new Error(`expected 2 calls, got ${calls.length}`);
    if (calls[0] !== 'a' || calls[1] !== 'b') throw new Error('earlier handlers not called');
  });
});

describe('EventEmitter - emit with no handlers', () => {
  let emitter;

  beforeEach(() => {
    emitter = new EventEmitter();
  });

  it('returns false when emitting an event with no handlers', () => {
    const result = emitter.emit('nonexistent');
    if (result !== false) throw new Error(`expected false, got ${result}`);
  });
});

describe('EventEmitter - multiple events', () => {
  let emitter;

  beforeEach(() => {
    emitter = new EventEmitter();
  });

  it('handlers for different events do not interfere', () => {
    const calls = [];
    emitter.on('a', () => calls.push('a'));
    emitter.on('b', () => calls.push('b'));
    emitter.emit('a');
    if (calls.length !== 1 || calls[0] !== 'a') throw new Error('only handler for event a should be called');
  });

  it('cancel on one event does not affect another event', () => {
    let bCalled = false;
    emitter.on('a', () => ({ cancel: true }));
    emitter.on('b', () => { bCalled = true; });
    emitter.emit('a');
    emitter.emit('b');
    if (!bCalled) throw new Error('handler for event b should still be called');
  });
});

describe('EventEmitter - handler receives data', () => {
  let emitter;

  beforeEach(() => {
    emitter = new EventEmitter();
  });

  it('emit with data parameter passes data to handler', () => {
    let received = null;
    emitter.on('evt', (data) => { received = data; });
    emitter.emit('evt', { x: 42 });
    if (!received || received.x !== 42) throw new Error(`expected { x: 42 }, got ${JSON.stringify(received)}`);
  });

  it('each handler in the chain receives the same data', () => {
    const results = [];
    emitter.on('evt', (data) => results.push(data.val));
    emitter.on('evt', (data) => results.push(data.val + 1));
    emitter.emit('evt', { val: 10 });
    if (results[0] !== 10 || results[1] !== 11) throw new Error(`expected [10, 11], got ${JSON.stringify(results)}`);
  });
});

run();