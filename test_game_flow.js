const WebSocket = require('ws');

const ws = new WebSocket('ws://localhost:3000');

ws.on('open', () => {
  console.log('连接成功');
  
  // 加入游戏
  ws.send(JSON.stringify({
    type: 'join',
    name: '测试玩家',
    presetId: '9-standard'
  }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  console.log('收到消息:', msg.type, msg.state?.phase || '');
  
  if (msg.type === 'state' && msg.state?.phase === 'waiting') {
    // 添加 AI 玩家
    console.log('添加 AI 玩家...');
    for (let i = 0; i < 8; i++) {
      ws.send(JSON.stringify({ type: 'add_ai' }));
    }
  }
  
  if (msg.type === 'action_required') {
    // 自动响应行动
    console.log('需要行动，选项:', msg.options?.length || 0);
    setTimeout(() => {
      const options = msg.options || [];
      if (options.length > 0) {
        ws.send(JSON.stringify({
          type: 'action',
          index: Math.floor(Math.random() * options.length)
        }));
      }
    }, 500);
  }
});

ws.on('error', (err) => {
  console.error('错误:', err.message);
});

setTimeout(() => {
  ws.close();
  console.log('测试结束');
  process.exit(0);
}, 45000);
