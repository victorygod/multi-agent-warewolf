/**
 * WebSocket 集成测试 - 真实服务器环境
 * 启动服务器，模拟 WebSocket 客户端，覆盖 assignRoles 和人类玩家交互
 */

const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const { GameEngine } = require('../engine/main');

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 创建测试服务器
function createTestServer(port) {
  const app = express();
  const server = http.createServer(app);

  // 静态文件服务
  app.use(express.static('public'));

  // WebSocket 设置
  const { WebSocketServer } = require('ws');
  const wss = new WebSocketServer({ server });

  let game = null;
  const clients = new Map(); // ws -> { playerId, name }
  const playerClients = new Map(); // playerId -> ws

  function broadcast(type, data) {
    const msg = JSON.stringify({ type, data, timestamp: Date.now() });
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    });
  }

  function send(ws, type, data) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type, data, timestamp: Date.now() }));
    }
  }

  // 处理消息
  function handleMessage(ws, msg) {
    const client = clients.get(ws);

    switch (msg.type) {
      case 'join':
        const playerId = game ? game.players.length + 1 : 1;
        const playerName = msg.playerName || `玩家${playerId}`;

        if (!game) {
          game = new GameEngine();
          game.playerCount = 9;
        }

        game.players.push({
          id: playerId,
          name: playerName,
          alive: true,
          isAI: false,
          state: {}
        });

        clients.set(ws, { playerId, name: playerName });
        playerClients.set(playerId, ws);

        send(ws, 'player_assigned', { playerId, name: playerName });
        broadcast('player_joined', { players: game.players.map(p => ({ id: p.id, name: p.name })) });
        break;

      case 'add_ai':
        if (!game) {
          game = new GameEngine();
          game.playerCount = 9;
        }

        const aiCount = msg.count || 1;
        for (let i = 0; i < aiCount; i++) {
          const aiId = game.players.length + 1;
          game.players.push({
            id: aiId,
            name: `AI${aiId}`,
            alive: true,
            isAI: true,
            state: {}
          });
        }
        broadcast('player_joined', { players: game.players.map(p => ({ id: p.id, name: p.name })) });
        break;

      case 'start_game':
        if (!game || game.players.length < 1) {
          send(ws, 'error', { message: '玩家不足' });
          return;
        }

        // 这会调用 assignRoles，触发 shuffle
        game.assignRoles();

        // 分配角色后通知所有玩家
        game.players.forEach(p => {
          const client = playerClients.get(p.id);
          if (client) {
            send(client, 'role_assigned', { role: p.role });
          }
        });

        broadcast('game_started', { playerCount: game.players.length });

        // 启动游戏
        game.start().catch(console.error);
        break;

      case 'action_response':
        // 玩家响应 action 请求
        if (game) {
          game.handleResponse(msg.playerId, msg.requestId, msg.data);
        }
        break;
    }
  }

  wss.on('connection', (ws) => {
    console.log('[TestServer] 新连接');

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        handleMessage(ws, msg);
      } catch (e) {
        console.error('[TestServer] 消息解析错误:', e);
      }
    });

    ws.on('close', () => {
      const info = clients.get(ws);
      if (info) {
        playerClients.delete(info.playerId);
        clients.delete(ws);
      }
    });

    // 发送初始状态
    send(ws, 'connected', { message: '连接成功' });
  });

  return new Promise((resolve) => {
    server.listen(port, () => {
      console.log(`[TestServer] 启动在端口 ${port}`);
      resolve({ server, wss, getGame: () => game });
    });
  });
}

// 创建 WebSocket 客户端
function createClient(port, name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    const client = {
      ws,
      messages: [],
      playerId: null,
      role: null,

      send(msg) {
        ws.send(JSON.stringify({ ...msg, playerId: this.playerId }));
      },

      waitFor(type, timeout = 5000) {
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error(`等待 ${type} 超时`)), timeout);
          const check = () => {
            const msg = this.messages.find(m => m.type === type);
            if (msg) {
              clearTimeout(timer);
              resolve(msg);
            } else {
              setTimeout(check, 100);
            }
          };
          check();
        });
      }
    };

    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'join', playerName: name }));
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        client.messages.push(msg);
        if (msg.type === 'player_assigned') {
          client.playerId = msg.data.playerId;
        }
        if (msg.type === 'role_assigned') {
          client.role = msg.data.role;
        }
      } catch (e) {}
    });

    ws.on('error', reject);

    setTimeout(() => resolve(client), 500);
  });
}

// 测试1: assignRoles 代码路径（触发 shuffle bug）
async function test1_assignRolesShuffle() {
  console.log('\n========== 测试1: assignRoles shuffle 代码路径 ==========');

  const { server, getGame } = await createTestServer(3001);

  try {
    // 创建 9 个真实玩家
    const clients = await Promise.all(
      Array.from({ length: 9 }, (_, i) => createClient(3001, `玩家${i + 1}`))
    );

    await delay(500);

    // 开始游戏 - 这会调用 assignRoles -> shuffle
    clients[0].send({ type: 'start_game' });

    // 等待角色分配
    await Promise.all(clients.map(c => c.waitFor('role_assigned', 3000)));

    const game = getGame();
    const roles = game.players.map(p => p.role?.name);

    console.log('  分配的角色:', roles.join(', '));

    // 验证角色分配正确
    const hasWolf = roles.some(r => r === '狼人');
    const hasSeer = roles.some(r => r === '预言家');
    const hasWitch = roles.some(r => r === '女巫');

    console.log(`  ✓ 有狼人: ${hasWolf}`);
    console.log(`  ✓ 有预言家: ${hasSeer}`);
    console.log(`  ✓ 有女巫: ${hasWitch}`);

    clients.forEach(c => c.ws.close());

    const passed = hasWolf && hasSeer && hasWitch;
    console.log(`测试结果: ${passed ? '✓ 通过' : '✗ 失败'}`);
    return passed;
  } catch (e) {
    console.error('测试失败:', e.message);
    return false;
  } finally {
    server.close();
    await delay(500);
  }
}

// 测试2: 混合 AI 和人类玩家
async function test2_MixedPlayers() {
  console.log('\n========== 测试2: 混合 AI 和人类玩家 ==========');

  const { server, getGame } = await createTestServer(3002);

  try {
    // 3 个人类玩家
    const humanClients = await Promise.all([
      createClient(3002, '人类1'),
      createClient(3002, '人类2'),
      createClient(3002, '人类3')
    ]);

    await delay(300);

    // 6 个 AI 玩家
    humanClients[0].send({ type: 'add_ai', count: 6 });

    await delay(300);

    // 开始游戏
    humanClients[0].send({ type: 'start_game' });

    // 等待角色分配
    await Promise.all(humanClients.map(c => c.waitFor('role_assigned', 3000)));

    const game = getGame();
    const humanPlayers = game.players.filter(p => !p.isAI);
    const aiPlayers = game.players.filter(p => p.isAI);

    console.log(`  人类玩家: ${humanPlayers.length}`);
    console.log(`  AI 玩家: ${aiPlayers.length}`);
    console.log(`  总玩家: ${game.players.length}`);

    // 验证所有玩家都有角色
    const allHaveRoles = game.players.every(p => p.role);
    console.log(`  ✓ 所有玩家都有角色: ${allHaveRoles}`);

    humanClients.forEach(c => c.ws.close());

    const passed = allHaveRoles && humanPlayers.length === 3 && aiPlayers.length === 6;
    console.log(`测试结果: ${passed ? '✓ 通过' : '✗ 失败'}`);
    return passed;
  } catch (e) {
    console.error('测试失败:', e.message);
    return false;
  } finally {
    server.close();
    await delay(500);
  }
}

// 运行测试
async function run() {
  console.log('========================================');
  console.log('WebSocket 集成测试');
  console.log('========================================');

  const results = [];

  results.push({ name: 'assignRoles shuffle 代码路径', passed: await test1_assignRolesShuffle() });
  results.push({ name: '混合 AI 和人类玩家', passed: await test2_MixedPlayers() });

  console.log('\n========================================');
  console.log('测试结果汇总');
  console.log('========================================');
  results.forEach(r => console.log(`${r.passed ? '✓' : '✗'} ${r.name}`));

  const passed = results.filter(r => r.passed).length;
  console.log(`\n通过: ${passed}/${results.length}`);

  process.exit(passed === results.length ? 0 : 1);
}

run().catch(console.error);
