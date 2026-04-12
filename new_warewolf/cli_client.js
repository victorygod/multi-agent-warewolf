/**
 * 狼人杀游戏 CLI 客户端
 * 用于自动化测试，每次调用建立新连接
 * 发送操作后保持连接，等待 action_required 或游戏结束
 *
 * 交互模式：
 * 1. 查询模式：node cli_client.js --name TestBot
 *    - 连接后获取当前状态，输出后退出
 *
 * 2. 等待模式：node cli_client.js --name TestBot --wait
 *    - 连接后等待 action_required 或 game_over，输出后退出
 *
 * 3. 响应模式：node cli_client.js --name TestBot --action seer --target 9
 *    - 连接后先等待 action_required 获取最新 requestId
 *    - 用最新 requestId 发送响应
 *    - 等待下一个 action_required 或 game_over，输出后退出
 *
 * 4. 显式 requestId：node cli_client.js --name TestBot --request-id <id> --action seer --target 9
 *    - 使用指定的 requestId 发送响应
 *
 * 5. 非响应操作：node cli_client.js --name TestBot --add-ai
 *    - 连接后发送操作，等待状态更新后退出
 */

const WebSocket = require('ws');

// 默认服务器地址
const WS_URL = process.env.WS_URL || 'ws://localhost:3000';
const TIMEOUT = 5000; // 5秒超时

/**
 * 解析命令行参数
 */
function parseArgs(argv) {
  const args = {
    name: null,
    requestId: null,
    join: false,
    players: 9,
    role: null,
    addAI: false,
    action: null,
    target: null,
    targets: null,
    content: null,
    run: null,
    withdraw: null,
    subaction: null,
    abstain: false,
    speak: false,
    vote: false,
    sheriffOrder: false,
    wait: false
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--name':
        args.name = argv[++i];
        break;
      case '--request-id':
        args.requestId = argv[++i];
        break;
      case '--join':
        args.join = true;
        break;
      case '--players':
        args.players = parseInt(argv[++i], 10);
        break;
      case '--role':
        args.role = argv[++i];
        break;
      case '--add-ai':
        args.addAI = true;
        break;
      case '--action':
        args.action = argv[++i];
        break;
      case '--target':
        args.target = parseInt(argv[++i], 10);
        break;
      case '--targets':
        args.targets = argv[++i].split(',').map(id => parseInt(id, 10));
        break;
      case '--content':
        args.content = argv[++i];
        break;
      case '--run':
        args.run = argv[++i] === 'true';
        break;
      case '--withdraw':
        args.withdraw = argv[++i] === 'true';
        break;
      case '--subaction':
        args.subaction = argv[++i];
        break;
      case '--abstain':
        args.abstain = true;
        break;
      case '--speak':
        args.speak = true;
        break;
      case '--vote':
        args.vote = true;
        break;
      case '--sheriff-order':
        args.sheriffOrder = true;
        break;
      case '--wait':
        args.wait = true;
        break;
    }
  }

  return args;
}

/**
 * 构建响应数据
 */
function buildResponse(args) {
  switch (args.action) {
    case 'speak':
    case 'last_words':
      return { content: args.content || '' };

    case 'vote':
      return { targetId: args.abstain ? null : args.target };

    case 'campaign':
      return { run: args.run === true };

    case 'withdraw':
      return { withdraw: args.withdraw === true };

    case 'guard':
    case 'seer':
    case 'shoot':
    case 'pass_badge':
    case 'assignOrder':
      return { targetId: args.target };

    case 'witch':
      // heal 不需要 targetId，poison 需要
      if (args.subaction === 'heal') {
        return { action: 'heal' };
      } else if (args.subaction === 'poison') {
        return { action: 'poison', targetId: args.target };
      } else {
        return { action: 'skip' };
      }

    case 'cupid':
      return { targetIds: args.targets };

    default:
      return {};
  }
}

/**
 * 输出结果
 */
function output(state, actionRequired, error) {
  if (error) {
    console.log(JSON.stringify({ status: 'error', error }, null, 2));
    return;
  }

  const result = {
    status: state?.winner ? 'game_over' : (actionRequired ? 'waiting_action' : 'waiting'),
    ...(state || {})
  };

  if (actionRequired) {
    result.actionRequired = actionRequired;
  }

  console.log(JSON.stringify(result, null, 2));
}

/**
 * 发送操作
 * @param {WebSocket} ws - WebSocket 连接
 * @param {object} args - 命令行参数
 * @param {string|null} requestId - 用于响应模式的 requestId
 */
function sendOperation(ws, args, requestId) {
  // 添加 AI
  if (args.addAI) {
    ws.send(JSON.stringify({ type: 'add_ai' }));
    return;
  }

  // 发言
  if (args.speak && args.content) {
    ws.send(JSON.stringify({ type: 'speak', content: args.content }));
    return;
  }

  // 投票
  if (args.vote) {
    ws.send(JSON.stringify({
      type: 'vote',
      targetId: args.abstain ? null : args.target
    }));
    return;
  }

  // 警长指定发言顺序
  if (args.sheriffOrder && args.target) {
    ws.send(JSON.stringify({
      type: 'sheriff_order',
      startPlayerId: args.target
    }));
    return;
  }

  // 响应行动请求（使用传入的 requestId）
  if (requestId && args.action) {
    const response = buildResponse(args);
    ws.send(JSON.stringify({
      type: 'response',
      requestId: requestId,
      ...response
    }));
    return;
  }
}

/**
 * 主函数
 */
async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.name) {
    console.log(JSON.stringify({ status: 'error', error: '--name is required' }, null, 2));
    process.exit(1);
  }

  let currentState = null;
  let actionRequired = null;
  let errorMessage = null;
  let responseSent = false;  // 是否已发送响应
  let operationSent = false; // 是否已发送非响应类操作
  let finished = false;
  let waitingForStateUpdate = false; // 发送响应后等待状态更新

  // 输出并退出的统一函数
  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(timeoutId);
    ws.close();
    output(currentState, actionRequired, errorMessage);
    process.exit(0);
  };

  // 创建超时定时器
  const timeoutId = setTimeout(() => {
    if (!finished) {
      finished = true;
      // 超时时输出当前状态
      output(currentState, actionRequired, errorMessage || 'timeout');
      process.exit(currentState ? 0 : 1);
    }
  }, TIMEOUT);

  // 建立 WebSocket 连接
  const ws = new WebSocket(WS_URL);

  ws.on('open', () => {
    // 发送 join 消息
    const joinMsg = {
      type: 'join',
      name: args.name
    };
    if (args.join) {
      joinMsg.playerCount = args.players;
    }
    if (args.role) {
      joinMsg.debugRole = args.role;
    }
    ws.send(JSON.stringify(joinMsg));
  });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());

      switch (msg.type) {
        case 'state':
          currentState = msg.data;

          // 游戏结束，输出并退出
          if (currentState?.winner) {
            finish();
            return;
          }

          // 检查 pendingAction（如果有待处理行动）
          const pendingAction = currentState?.pendingAction;

          // 如果发送响应后收到了状态更新，检查是否有新的 pendingAction
          if (waitingForStateUpdate) {
            waitingForStateUpdate = false;
            // 如果有新的 pendingAction，继续等待；否则输出
            if (!pendingAction) {
              setTimeout(() => {
                if (!finished) {
                  finish();
                }
              }, 100);
            }
            return;
          }

          // 如果有响应操作且有待处理行动，使用 pendingAction.requestId
          if (args.action && pendingAction && !responseSent) {
            responseSent = true;
            const requestId = args.requestId || pendingAction.requestId;
            sendOperation(ws, args, requestId);
            waitingForStateUpdate = true;
            return;
          }

          // 收到 state 后，发送非响应类操作（只需要发送一次）
          if (!operationSent) {
            const hasNonResponseOperation = args.addAI || (args.speak && args.content) ||
              args.vote || (args.sheriffOrder && args.target);

            if (hasNonResponseOperation) {
              operationSent = true;
              sendOperation(ws, args, null);
              waitingForStateUpdate = true;
              return;
            }
          }

          // 如果已发送操作，收到新的 state 后直接输出
          if (operationSent && !waitingForStateUpdate) {
            finish();
            return;
          }

          // 如果没有 --wait 参数且没有 --action 且没有 pendingAction，收到 state 后直接输出
          if (!args.wait && !args.action && !pendingAction) {
            finish();
            return;
          }
          break;

        case 'error':
          errorMessage = msg.message;
          // 收到错误后立即输出
          finish();
          return;

        default:
          // 忽略其他消息类型
          break;
      }
    } catch (e) {
      console.log(JSON.stringify({ status: 'error', error: `parse error: ${e.message}` }, null, 2));
      process.exit(1);
    }
  });

  ws.on('error', (err) => {
    console.log(JSON.stringify({ status: 'error', error: `connection error: ${err.message}` }, null, 2));
    process.exit(1);
  });

  ws.on('close', () => {
    // 如果还没输出就关闭了，说明连接异常
    if (!finished) {
      finished = true;
      clearTimeout(timeoutId);
      if (currentState) {
        output(currentState, actionRequired, errorMessage);
        process.exit(0);
      } else {
        console.log(JSON.stringify({ status: 'error', error: 'connection closed before receiving state' }, null, 2));
        process.exit(1);
      }
    }
  });
}

// 启动
main().catch(err => {
  console.log(JSON.stringify({ status: 'error', error: err.message }, null, 2));
  process.exit(1);
});