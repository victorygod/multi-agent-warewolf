/**
 * 狼人杀游戏前端逻辑
 */

// 状态
let playerName = null;
let playerId = null;
let gameState = null;
let eventSource = null;
let displayedMessageIds = new Set(); // 已显示的消息ID
let isFirstStateUpdate = true; // 首次状态更新标志
let debugMode = false;

// DOM 元素
const elements = {
  phaseInfo: document.getElementById('phase-info'),
  dayCount: document.getElementById('day-count'),
  myRole: document.getElementById('my-role'),
  playersGrid: document.getElementById('players-grid'),
  messages: document.getElementById('messages'),
  actionPrompt: document.getElementById('action-prompt'),
  actionInput: document.getElementById('action-input'),
  speechInput: document.getElementById('speech-input'),
  sendBtn: document.getElementById('send-btn'),
  voteButtons: document.getElementById('vote-buttons'),
  skillButtons: document.getElementById('skill-buttons'),
  setupPanel: document.getElementById('setup-panel'),
  playerNameInput: document.getElementById('player-name'),
  playerCountSelect: document.getElementById('player-count'),
  readyBtn: document.getElementById('ready-btn')
};

// 角色描述
const ROLE_DESCRIPTIONS = {
  werewolf: '你是狼人。夜晚与同伴一起选择击杀目标，白天隐藏身份。',
  seer: '你是预言家。每晚可以查验一名玩家的身份。',
  witch: '你是女巫。拥有一瓶解药和一瓶毒药。',
  guard: '你是守卫。每晚可以守护一名玩家免受狼人攻击。',
  hunter: '你是猎人。死亡时可以开枪带走一名玩家。',
  villager: '你是村民。没有特殊技能，但你的投票很重要。'
};

const ROLE_NAMES = {
  werewolf: '狼人',
  seer: '预言家',
  witch: '女巫',
  guard: '守卫',
  hunter: '猎人',
  villager: '村民'
};

// 初始化
async function init() {
  console.log('初始化狼人杀游戏...');

  // 获取调试模式状态
  try {
    const debugRes = await fetch('/api/debug');
    const debugData = await debugRes.json();
    debugMode = debugData.debugMode;
    console.log('调试模式:', debugMode);
    if (debugMode) {
      showRoleSelector();
    }
  } catch (e) {
    console.error('获取调试模式失败:', e);
  }

  // 绑定事件
  elements.readyBtn.addEventListener('click', ready);
  elements.sendBtn.addEventListener('click', sendSpeech);
  elements.speechInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendSpeech();
  });

  // 连接 SSE
  connectSSE();

  // 检查 URL 是否有名字参数
  const urlParams = new URLSearchParams(window.location.search);
  const nameFromUrl = urlParams.get('name');
  if (nameFromUrl) {
    elements.playerNameInput.value = nameFromUrl;
    // 自动尝试进入游戏
    autoJoin(nameFromUrl);
  }
}

// 显示角色选择器（调试模式）
function showRoleSelector() {
  // 防止重复添加
  if (document.getElementById('player-role')) return;

  const roleSelector = document.createElement('div');
  roleSelector.className = 'form-group';
  roleSelector.innerHTML = `
    <label>选择角色（调试）：</label>
    <select id="player-role">
      <option value="">随机</option>
      <option value="werewolf">狼人</option>
      <option value="seer">预言家</option>
      <option value="witch">女巫</option>
      <option value="guard">守卫</option>
      <option value="hunter">猎人</option>
      <option value="villager">村民</option>
    </select>
  `;
  elements.aiCountInput.parentElement.after(roleSelector);
}

// 自动加入（刷新时）
async function autoJoin(name) {
  try {
    // 先获取当前游戏状态（传递玩家名字以获取角色信息）
    const stateRes = await fetch(`/api/state?name=${encodeURIComponent(name)}`);
    const state = await stateRes.json();

    // 检查是否有同名玩家
    const existingPlayer = state.players?.find(p => p.name === name && !p.isAI);

    if (existingPlayer) {
      // 找到了，直接进入游戏
      playerName = name;
      playerId = existingPlayer.id;
      gameState = state;

      // 更新 SSE 连接
      connectSSE();

      // 隐藏设置面板
      elements.setupPanel.classList.add('hidden');
      updateUI();
      console.log('自动进入游戏成功, 角色:', existingPlayer.role);
    } else {
      // 没找到玩家，显示设置面板
      if (debugMode) {
        showRoleSelector();
      }
    }
  } catch (e) {
    console.error('自动加入失败:', e);
  }
}

// 获取当前玩家（通过名字匹配）
function getMyPlayer() {
  if (!gameState || !playerName) return null;
  return gameState.players.find(p => p.name === playerName && !p.isAI);
}

// 获取玩家位置（1-based）
function getPlayerPosition(playerId) {
  if (!gameState || !gameState.players) return 0;
  const index = gameState.players.findIndex(p => p.id === playerId);
  return index + 1;
}

// 连接 SSE
function connectSSE() {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }

  console.log('连接 SSE...');
  // 传递玩家名字给服务器，以便服务器返回正确的角色信息
  const url = playerName ? `/events?name=${encodeURIComponent(playerName)}` : '/events';
  eventSource = new EventSource(url);

  eventSource.addEventListener('state_update', (e) => {
    console.log('SSE 原始数据:', e.data);
    try {
      const data = JSON.parse(e.data);
      const previousPhase = gameState ? gameState.phase : null;
      gameState = data;
      console.log('收到状态更新:', data.phase, '我的角色:', data.players?.find(p => p.name === playerName)?.role);

      // 检测游戏开始（从waiting变为其他阶段），重新获取完整状态
      if (previousPhase === 'waiting' && data.phase !== 'waiting') {
        showOpeningMessage();
        // 重新请求完整状态，确保角色信息正确
        fetchFullState();
      }

      // 首次状态更新时，清空消息区域并重新加载所有历史消息
      if (isFirstStateUpdate) {
        isFirstStateUpdate = false;
        elements.messages.innerHTML = ''; // 清空现有消息
        displayedMessageIds.clear(); // 清空已显示ID

        // 显示所有历史消息
        if (data.messages && data.messages.length > 0) {
          data.messages.forEach(msg => {
            displayedMessageIds.add(msg.id);
            displayMessage(msg);
          });
        }
      } else {
        // 后续状态更新，只显示新消息
        if (data.messages && data.messages.length > 0) {
          data.messages.forEach(msg => {
            if (!displayedMessageIds.has(msg.id)) {
              displayedMessageIds.add(msg.id);
              displayMessage(msg);
            }
          });
        }
      }

      updateUI();
    } catch (err) {
      console.error('SSE 数据解析错误:', err, e.data);
    }
  });

  eventSource.addEventListener('ai_thinking', (e) => {
    const data = JSON.parse(e.data);
    addMessage(`${data.playerName} 正在思考...`, 'ai-thinking');
  });

  eventSource.onerror = (e) => {
    console.error('SSE 连接错误:', e);
    // 延迟重连，避免频繁重连
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    setTimeout(connectSSE, 3000);
  };

  eventSource.onopen = () => {
    console.log('SSE 连接成功');
  };
}

// 显示错误提示
function showError(message) {
  // 移除已有的错误提示
  const existingError = document.querySelector('.error-toast');
  if (existingError) {
    existingError.remove();
  }

  const toast = document.createElement('div');
  toast.className = 'error-toast';
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 3000);
}

// 准备
async function ready() {
  const name = elements.playerNameInput.value.trim() || `玩家${Date.now() % 1000}`;
  const count = parseInt(elements.playerCountSelect.value);
  const roleSelect = document.getElementById('player-role');
  const playerRole = roleSelect ? roleSelect.value : null;

  try {
    const res = await fetch('/api/ready', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerName: name, playerCount: count, playerRole })
    });

    const data = await res.json();
    if (!data.success) {
      showError(data.error);
      return;
    }

    playerName = name;
    playerId = data.playerId;

    // 更新 URL
    const url = new URL(window.location);
    url.searchParams.set('name', name);
    window.history.replaceState({}, '', url);

    // 重新建立 SSE 连接
    connectSSE();

    // 更新状态
    gameState = data.state;

    // 准备后直接进入房间
    elements.setupPanel.classList.add('hidden');

    // 如果游戏开始了，显示开场白并获取完整状态
    if (data.gameStarted) {
      showOpeningMessage();
      fetchFullState();
    }

    updateUI();
  } catch (e) {
    console.error('准备失败:', e);
    showError('操作失败，请重试');
  }
}

// 添加 AI
async function addAI() {
  try {
    const res = await fetch('/api/add-ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: 1 })
    });

    const data = await res.json();
    if (data.success) {
      gameState = data.state;
      updateUI();
      // 如果游戏开始了，显示开场白并获取完整状态
      if (data.gameStarted) {
        showOpeningMessage();
        fetchFullState();
      }
    } else {
      showError(data.error);
    }
  } catch (e) {
    console.error('添加AI失败:', e);
    showError('添加AI失败，请重试');
  }
}

// 显示开场白（只在前端显示，不记录到后端）
function showOpeningMessage() {
  addPhaseDivider('游戏开始');
  addMessage('天黑请闭眼。', 'system opening');
}

// 获取完整游戏状态（确保角色信息正确）
async function fetchFullState() {
  if (!playerName) return;
  try {
    const res = await fetch(`/api/state?name=${encodeURIComponent(playerName)}`);
    const state = await res.json();
    gameState = state;
    updateUI();
    console.log('获取完整状态成功，角色:', state.players?.find(p => p.name === playerName)?.role);
  } catch (e) {
    console.error('获取状态失败:', e);
  }
}

// 发送发言
async function sendSpeech() {
  const content = elements.speechInput.value.trim();
  if (!content) return;

  const myPlayer = getMyPlayer();
  if (!myPlayer) {
    showError('请先加入游戏');
    return;
  }

  try {
    // 遗言阶段使用遗言 API
    if (gameState.phase === 'last_words') {
      await submitLastWords(content);
      elements.speechInput.value = '';
      return;
    }

    const res = await fetch('/api/speak', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: myPlayer.id, content })
    });

    const data = await res.json();
    if (data.success && data.state) {
      gameState = data.state;
      updateUI();
    } else if (!data.success) {
      showError(data.error);
    }
  } catch (e) {
    console.error('发言失败:', e);
    showError('发言失败，请重试');
  }

  elements.speechInput.value = '';
}

// 投票
async function vote(targetId) {
  const myPlayer = getMyPlayer();
  if (!myPlayer) {
    showError('请先加入游戏');
    return;
  }

  try {
    const res = await fetch('/api/vote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ voterId: myPlayer.id, targetId })
    });
    const data = await res.json();
    if (data.success && data.state) {
      gameState = data.state;
      updateUI();
    } else if (!data.success) {
      showError(data.error);
    }
  } catch (e) {
    console.error('投票失败:', e);
    showError('投票失败，请重试');
  }
}

// 预言家查验
async function seerCheck(targetId) {
  const myPlayer = getMyPlayer();
  if (!myPlayer) {
    showError('请先加入游戏');
    return;
  }

  try {
    const res = await fetch('/api/seer-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seerId: myPlayer.id, targetId })
    });
    const data = await res.json();
    if (data.success) {
      // 查验结果通过私有消息返回，不需要 alert
      if (data.state) {
        gameState = data.state;
        updateUI();
      }
    } else if (!data.success) {
      showError(data.error);
    }
  } catch (e) {
    console.error('查验失败:', e);
    showError('查验失败，请重试');
  }
}

// 女巫行动
async function witchAction(action, targetId = null) {
  const myPlayer = getMyPlayer();
  if (!myPlayer) {
    showError('请先加入游戏');
    return;
  }

  try {
    const res = await fetch('/api/witch-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ witchId: myPlayer.id, action, targetId })
    });
    const data = await res.json();
    if (data.success && data.state) {
      gameState = data.state;
      updateUI();
    } else if (!data.success) {
      showError(data.error);
    }
  } catch (e) {
    console.error('女巫行动失败:', e);
    showError('操作失败，请重试');
  }
}

// 守卫守护
async function guardProtect(targetId) {
  const myPlayer = getMyPlayer();
  if (!myPlayer) {
    showError('请先加入游戏');
    return;
  }

  try {
    const res = await fetch('/api/guard-protect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guardId: myPlayer.id, targetId })
    });
    const data = await res.json();
    if (data.success && data.state) {
      gameState = data.state;
      updateUI();
    } else if (!data.success) {
      showError(data.error);
    }
  } catch (e) {
    console.error('守护失败:', e);
    showError('守护失败，请重试');
  }
}

// 发表遗言
async function submitLastWords(content) {
  const myPlayer = getMyPlayer();
  if (!myPlayer) {
    showError('请先加入游戏');
    return;
  }

  try {
    const res = await fetch('/api/last-words', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: myPlayer.id, content })
    });
    const data = await res.json();
    if (data.success && data.state) {
      gameState = data.state;
      updateUI();
    } else if (!data.success) {
      showError(data.error);
    }
  } catch (e) {
    console.error('遗言失败:', e);
    showError('遗言失败，请重试');
  }
}

// 猎人开枪
async function hunterShoot(targetId) {
  const myPlayer = getMyPlayer();
  if (!myPlayer) {
    showError('请先加入游戏');
    return;
  }

  try {
    const res = await fetch('/api/hunter-shoot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hunterId: myPlayer.id, targetId })
    });
    const data = await res.json();
    if (data.success && data.state) {
      gameState = data.state;
      updateUI();
    } else if (!data.success) {
      showError(data.error);
    }
  } catch (e) {
    console.error('开枪失败:', e);
    showError('开枪失败，请重试');
  }
}

// 猎人不开枪
async function hunterSkip() {
  const myPlayer = getMyPlayer();
  if (!myPlayer) {
    showError('请先加入游戏');
    return;
  }

  try {
    const res = await fetch('/api/hunter-skip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hunterId: myPlayer.id })
    });
    const data = await res.json();
    if (data.success && data.state) {
      gameState = data.state;
      updateUI();
    } else if (!data.success) {
      showError(data.error);
    }
  } catch (e) {
    console.error('跳过失败:', e);
    showError('操作失败，请重试');
  }
}

// 重新开始
async function restartGame() {
  await fetch('/api/reset', { method: 'POST' });
  playerName = null;
  playerId = null;
  location.reload();
}

// 更新 UI
function updateUI() {
  if (!gameState) return;

  updateHeader();
  updatePlayers();
  updateMessages();
  updateAction();
}

// 更新头部
function updateHeader() {
  const phaseNames = {
    waiting: '等待玩家加入',
    night_werewolf_discuss: '狼人讨论中',
    night_werewolf_vote: '狼人投票中',
    night_seer: '预言家查验中',
    night_witch: '女巫行动中',
    night_guard: '守卫守护中',
    day_discuss: '白天讨论',
    day_vote: '白天投票',
    vote_result: '投票结果',
    last_words: '遗言阶段',
    hunter_shoot: '猎人开枪',
    game_over: '游戏结束'
  };

  // 显示阶段和玩家数量
  let phaseText = phaseNames[gameState.phase] || gameState.phase;
  if (gameState.phase === 'waiting') {
    const current = gameState.players ? gameState.players.length : 0;
    const total = gameState.playerCount || 9;
    phaseText = `等待玩家加入 (${current}/${total})`;
  }
  elements.phaseInfo.textContent = phaseText;

  if (gameState.dayCount > 0) {
    const isNight = gameState.phase.startsWith('night');
    elements.dayCount.textContent = `${isNight ? '第' : '第'}${gameState.dayCount}${isNight ? '夜' : '天'}`;
  } else {
    elements.dayCount.textContent = '';
  }

  // 显示角色信息
  const myPlayer = getMyPlayer();
  if (myPlayer && myPlayer.role) {
    let roleHtml = `<span class="role-badge ${myPlayer.role}">${ROLE_NAMES[myPlayer.role]}</span>`;
    // 狼人显示队友
    if (myPlayer.role === 'werewolf') {
      const teammates = gameState.players
        .filter(p => p.role === 'werewolf' && p.id !== myPlayer.id)
        .map(p => p.name);
      if (teammates.length > 0) {
        roleHtml += ` <span class="teammates">队友: ${teammates.join(', ')}</span>`;
      }
    }
    elements.myRole.innerHTML = roleHtml;
    elements.myRole.classList.remove('hidden');
  } else {
    elements.myRole.classList.add('hidden');
  }
}

// 更新玩家列表
function updatePlayers() {
  elements.playersGrid.innerHTML = '';

  // 获取当前玩家（用于判断可见性）
  const myPlayer = getMyPlayer();
  const total = gameState.playerCount || 9;
  const currentCount = gameState.players ? gameState.players.length : 0;

  // 显示已有玩家
  gameState.players.forEach((player, index) => {
    const position = index + 1;
    const card = document.createElement('div');
    card.className = 'player-card';
    if (!player.alive) card.classList.add('dead');
    if (player.id === gameState.currentSpeaker) card.classList.add('current');
    if (myPlayer && player.id === myPlayer.id) card.classList.add('self');

    // 角色显示逻辑：只显示自己的角色和狼人队友
    let roleText = '';
    if (player.role) {
      if (myPlayer && player.id === myPlayer.id) {
        // 自己的角色
        roleText = ROLE_NAMES[player.role] || '';
      } else if (myPlayer && myPlayer.role === 'werewolf' && player.role === 'werewolf') {
        // 狼人可以看到队友
        roleText = ROLE_NAMES[player.role] || '';
      }
      // 游戏结束时显示所有角色
      if (gameState.phase === 'game_over') {
        roleText = ROLE_NAMES[player.role] || '';
      }
    }

    card.innerHTML = `
      <div class="player-position">${position}号</div>
      <div class="player-name">${player.name}</div>
      <div class="player-status">${player.alive ? (player.isAI ? 'AI' : '玩家') : '已死亡'}</div>
      ${roleText ? `<div class="player-role">${roleText}</div>` : ''}
    `;

    elements.playersGrid.appendChild(card);
  });

  // 显示空位（只在等待阶段显示）
  if (gameState.phase === 'waiting') {
    for (let i = currentCount; i < total; i++) {
      const position = i + 1;
      const emptySlot = document.createElement('div');
      emptySlot.className = 'player-card empty-slot';
      emptySlot.innerHTML = `
        <div class="player-position">${position}号</div>
        <div class="player-name">空位</div>
        <div class="player-status">点击添加AI</div>
      `;
      emptySlot.addEventListener('click', addAI);
      elements.playersGrid.appendChild(emptySlot);
    }
  }
}

// 更新消息（现在消息在 SSE 处理中直接显示）
function updateMessages() {
  // 消息已在 SSE 处理中显示，这里不再处理
}

// 显示单条消息
function displayMessage(msg) {
  const { type, content, playerId, playerName, className, debugInfo } = msg;

  if (type === 'phase_start') {
    // 阶段分割线
    addPhaseDivider(content);
  } else if (type === 'speech' || type === 'wolf_speech') {
    // 发言消息，显示为"9号小明: xxxxx"，用 playerId 找位置
    const playerIndex = gameState?.players?.findIndex(p => p.id === playerId);
    const pos = playerIndex >= 0 ? playerIndex + 1 : '';
    let displayContent = `${pos}号${playerName}：${content}`;

    // 如果有调试信息就显示（不依赖 debugMode 变量）
    if (debugInfo) {
      const debugHtml = formatDebugInfo(debugInfo);
      displayContent += debugHtml;
    }

    addMessage(displayContent, className);
  } else {
    // 其他消息（系统消息、私有消息等）
    addMessage(content, className);
  }
}

// 格式化调试信息
function formatDebugInfo(debugInfo) {
  const source = debugInfo.source === 'llm' ? '🤖 LLM' : '🎲 随机';
  let html = `<br><hr style="margin: 8px 0; border-color: #444;"><details style="font-size: 12px; color: #888;"><summary>${source} 决策</summary>`;

  // 显示完整的 messages
  if (debugInfo.messages && debugInfo.messages.length > 0) {
    html += '<div style="max-height: 300px; overflow-y: auto;">';
    debugInfo.messages.forEach((msg, i) => {
      const roleColor = msg.role === 'system' ? '#f39c12' : msg.role === 'user' ? '#3498db' : '#27ae60';
      const roleLabel = msg.role === 'system' ? '系统' : msg.role === 'user' ? '用户' : 'AI';
      html += `<div style="margin: 8px 0; padding: 8px; background: #1a1a1a; border-radius: 4px; border-left: 3px solid ${roleColor};">`;
      html += `<div style="color: ${roleColor}; font-weight: bold; margin-bottom: 4px;">[${roleLabel}]</div>`;
      html += `<pre style="white-space: pre-wrap; word-break: break-all; margin: 0; font-size: 11px;">${escapeHtml(msg.content)}</pre>`;
      html += `</div>`;
    });
    html += '</div>';
  }

  html += '</details>';
  return html;
}

// HTML 转义
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 添加消息
function addMessage(content, className = '') {
  const msg = document.createElement('div');
  msg.className = `message ${className}`;
  // 支持 <br> 标签
  const formattedContent = content.replace(/\n/g, '<br>');
  msg.innerHTML = `<div class="message-content">${formattedContent}</div>`;
  elements.messages.appendChild(msg);
  elements.messages.scrollTop = elements.messages.scrollHeight;
}

// 添加阶段分割线
function addPhaseDivider(phaseText) {
  const divider = document.createElement('div');
  divider.className = 'phase-divider';
  divider.innerHTML = `<span>${phaseText}</span>`;
  elements.messages.appendChild(divider);
  elements.messages.scrollTop = elements.messages.scrollHeight;
}

// 更新操作区域
function updateAction() {
  // 重置
  elements.actionInput.classList.remove('active');
  elements.voteButtons.classList.remove('active');
  elements.skillButtons.classList.remove('active');
  elements.actionPrompt.textContent = '';
  elements.voteButtons.innerHTML = '';
  elements.skillButtons.innerHTML = '';

  // 获取当前玩家
  const myPlayer = getMyPlayer();
  console.log('updateAction - myPlayer:', myPlayer?.name, 'role:', myPlayer?.role, 'phase:', gameState?.phase);

  // 未加入游戏
  if (!myPlayer) {
    elements.actionPrompt.textContent = '请先加入游戏';
    return;
  }

  // 已死亡（遗言阶段、猎人开枪阶段、游戏结束除外）
  if (!myPlayer.alive && gameState.phase !== 'last_words' && gameState.phase !== 'hunter_shoot' && gameState.phase !== 'game_over') {
    elements.actionPrompt.textContent = '你已死亡，观战中...';
    return;
  }

  // 根据阶段显示操作
  const phase = gameState.phase;

  // 等待阶段
  if (phase === 'waiting') {
    const current = gameState.players ? gameState.players.length : 0;
    const total = gameState.playerCount || 9;
    if (current < total) {
      elements.actionPrompt.textContent = `等待更多玩家加入... (${current}/${total})，点击空位可添加AI`;
    } else {
      elements.actionPrompt.textContent = '人已齐，即将开始游戏...';
    }
    return;
  }

  // 游戏结束
  if (phase === 'game_over') {
    elements.actionPrompt.innerHTML = `<strong>${gameState.winner === 'werewolf' ? '狼人阵营获胜！' : '好人阵营获胜！'}</strong>`;
    elements.skillButtons.classList.add('active');
    const restartBtn = document.createElement('button');
    restartBtn.className = 'skill-btn';
    restartBtn.textContent = '再来一局';
    restartBtn.addEventListener('click', restartGame);
    elements.skillButtons.appendChild(restartBtn);
    return;
  }

  // 显示当前阶段提示（仅用于白天投票等通用阶段）
  const phaseTips = {
    day_vote: '白天 - 投票中',
    vote_result: '投票结果公布中'
  };

  // 轮到我发言
  if (myPlayer && gameState.currentSpeaker === myPlayer.id) {
    if (phase === 'night_werewolf_discuss' || phase === 'day_discuss') {
      elements.actionInput.classList.add('active');
      elements.actionPrompt.textContent = '轮到你发言了';
      return;
    }
  }

  // 夜间阶段
  if (phase === 'night_werewolf_discuss') {
    if (myPlayer.role === 'werewolf') {
      // 狼人讨论阶段
      if (gameState.currentSpeaker && gameState.currentSpeaker !== myPlayer.id) {
        const speaker = gameState.players.find(p => p.id === gameState.currentSpeaker);
        if (speaker) {
          const pos = getPlayerPosition(speaker.id);
          elements.actionPrompt.textContent = `等待 ${pos}号${speaker.name} 发言...`;
          return;
        }
      }
      // 轮到自己发言会在后面处理
    } else {
      // 非狼人什么都不显示
      return;
    }
  } else if (phase === 'night_werewolf_vote') {
    if (myPlayer.role === 'werewolf') {
      // 狼人投票阶段，继续往下执行显示投票按钮
    } else {
      // 非狼人什么都不显示
      return;
    }
  } else if (phase === 'night_seer') {
    if (myPlayer.role === 'seer') {
      elements.actionPrompt.textContent = '请选择要查验的玩家';
      // 继续往下执行显示查验按钮
    } else {
      // 非预言家什么都不显示
      return;
    }
  } else if (phase === 'night_witch') {
    if (myPlayer.role === 'witch') {
      // 女巫操作在后面处理
    } else {
      return;
    }
  } else if (phase === 'night_guard') {
    if (myPlayer.role === 'guard') {
      elements.actionPrompt.textContent = '请选择要守护的玩家';
      // 继续往下执行显示守护按钮
    } else {
      // 非守卫什么都不显示
      return;
    }
  }

  // 白天发言阶段：显示当前发言者
  if (phase === 'day_discuss' && gameState.currentSpeaker) {
    if (gameState.currentSpeaker === myPlayer.id) {
      elements.actionInput.classList.add('active');
      elements.actionPrompt.textContent = '轮到你发言了';
      return;
    }
    const speaker = gameState.players.find(p => p.id === gameState.currentSpeaker);
    if (speaker) {
      const pos = getPlayerPosition(speaker.id);
      elements.actionPrompt.textContent = `等待 ${pos}号${speaker.name} 发言...`;
      return;
    }
  }

  // 其他阶段显示阶段提示
  elements.actionPrompt.textContent = phaseTips[phase] || '';

  // 狼人投票阶段
  if (phase === 'night_werewolf_vote' && myPlayer.role === 'werewolf') {
    // 检查是否已投票
    if (gameState.hasVoted) {
      elements.actionPrompt.textContent = '已投票，等待其他狼人...';
      return;
    }

    elements.voteButtons.classList.add('active');
    elements.actionPrompt.textContent = '请选择今晚要击杀的目标';

    gameState.players.forEach(player => {
      if (!player.alive) return;

      const isTeammate = player.role === 'werewolf';
      const isSelf = player.id === myPlayer.id;
      const position = getPlayerPosition(player.id);

      const btn = document.createElement('button');
      btn.className = 'vote-btn';
      if (isSelf || isTeammate) {
        btn.classList.add('danger');
      }
      btn.textContent = `${position}号 ${player.name}` + (isSelf ? ' (自己)' : isTeammate ? ' (队友)' : '');
      btn.addEventListener('click', () => vote(player.id));
      elements.voteButtons.appendChild(btn);
    });
    return;
  }

  // 投票阶段
  if (phase === 'day_vote') {
    // 检查是否已投票
    if (gameState.hasVoted) {
      elements.actionPrompt.textContent = '已投票，等待其他玩家...';
      return;
    }

    elements.voteButtons.classList.add('active');
    elements.actionPrompt.textContent = '请投票放逐一名玩家（可弃权）';

    gameState.players.filter(p => p.alive && p.id !== myPlayer.id).forEach(player => {
      const position = getPlayerPosition(player.id);
      const btn = document.createElement('button');
      btn.className = 'vote-btn';
      btn.textContent = `${position}号 ${player.name}`;
      btn.addEventListener('click', () => vote(player.id));
      elements.voteButtons.appendChild(btn);
    });

    // 弃权按钮
    const abstainBtn = document.createElement('button');
    abstainBtn.className = 'vote-btn skip';
    abstainBtn.textContent = '弃权';
    abstainBtn.addEventListener('click', () => vote(null));
    elements.voteButtons.appendChild(abstainBtn);
    return;
  }

  // 预言家查验
  if (phase === 'night_seer' && myPlayer.role === 'seer') {
    elements.skillButtons.classList.add('active');

    gameState.players.filter(p => p.alive && p.id !== myPlayer.id).forEach(player => {
      const position = getPlayerPosition(player.id);
      const btn = document.createElement('button');
      btn.className = 'skill-btn';
      btn.textContent = `查验 ${position}号 ${player.name}`;
      btn.addEventListener('click', () => seerCheck(player.id));
      elements.skillButtons.appendChild(btn);
    });
    return;
  }

  // 女巫行动
  if (phase === 'night_witch' && myPlayer.role === 'witch') {
    elements.skillButtons.classList.add('active');

    const usedTonight = gameState.witchUsedTonight || { healed: false, poisoned: false };

    // 显示刀口信息和药水状态
    let promptHtml = '';
    if (gameState.werewolfTarget) {
      const isSelf = gameState.players.find(p => p.name === gameState.werewolfTarget)?.id === myPlayer.id;
      const savedMark = usedTonight.healed ? '（已救）' : '';
      promptHtml = `<strong>⚠️ 今晚【${gameState.werewolfTarget}】被狼人杀害了！${isSelf ? '（是你自己）' : ''}${savedMark}</strong><br>`;
    } else {
      promptHtml = '今晚没有人被狼人杀害。<br>';
    }

    // 显示药水状态
    const healStatus = gameState.witchPotion?.heal
      ? (usedTonight.healed ? '✅ 解药已使用（今晚）' : '✅ 解药可用')
      : '❌ 解药已用完';
    const poisonStatus = gameState.witchPotion?.poison
      ? (usedTonight.poisoned ? '✅ 毒药已使用（今晚）' : '✅ 毒药可用')
      : '❌ 毒药已用完';
    promptHtml += `<small style="color:#888">${healStatus} | ${poisonStatus}</small><br>`;

    elements.actionPrompt.innerHTML = promptHtml + '请选择：';

    // 解药按钮：有解药、有人被刀、今晚还没用解药
    if (gameState.witchPotion?.heal && gameState.werewolfTarget && !usedTonight.healed) {
      const targetPlayer = gameState.players.find(p => p.name === gameState.werewolfTarget);
      const targetPosition = targetPlayer ? getPlayerPosition(targetPlayer.id) : '';
      const healBtn = document.createElement('button');
      healBtn.className = 'skill-btn heal';
      healBtn.textContent = `💚 救 ${targetPosition}号 ${gameState.werewolfTarget}`;
      healBtn.addEventListener('click', () => witchAction('heal'));
      elements.skillButtons.appendChild(healBtn);
    }

    // 毒药按钮：有毒药、今晚还没用毒药
    if (gameState.witchPotion?.poison && !usedTonight.poisoned) {
      // 创建毒药选择区域
      const poisonSection = document.createElement('div');
      poisonSection.className = 'poison-section';
      poisonSection.innerHTML = '<span>💀 毒药：</span>';

      // 不能毒被刀的人，不能毒自己
      gameState.players.filter(p => {
        if (!p.alive || p.id === myPlayer.id) return false;
        // 不能毒被刀的人
        if (gameState.werewolfTarget && p.name === gameState.werewolfTarget) return false;
        return true;
      }).forEach(player => {
        const position = getPlayerPosition(player.id);
        const btn = document.createElement('button');
        btn.className = 'skill-btn poison';
        btn.textContent = `${position}号 ${player.name}`;
        btn.addEventListener('click', () => witchAction('poison', player.id));
        poisonSection.appendChild(btn);
      });

      elements.skillButtons.appendChild(poisonSection);
    }

    // 结束行动按钮
    const skipBtn = document.createElement('button');
    skipBtn.className = 'skill-btn skip';
    skipBtn.textContent = '结束行动';
    skipBtn.addEventListener('click', () => witchAction('skip'));
    elements.skillButtons.appendChild(skipBtn);
    return;
  }

  // 守卫守护
  if (phase === 'night_guard' && myPlayer.role === 'guard') {
    elements.skillButtons.classList.add('active');
    elements.actionPrompt.textContent = '请选择要守护的玩家';

    gameState.players.filter(p => p.alive).forEach(player => {
      const position = getPlayerPosition(player.id);
      const btn = document.createElement('button');
      btn.className = 'skill-btn';
      btn.textContent = `守护 ${position}号 ${player.name}`;
      btn.addEventListener('click', () => guardProtect(player.id));
      elements.skillButtons.appendChild(btn);
    });
    return;
  }

  // 遗言阶段
  if (phase === 'last_words') {
    // 检查是否轮到自己发表遗言
    const lastWordsPlayer = gameState.lastWordsPlayer;
    if (lastWordsPlayer && lastWordsPlayer.id === myPlayer.id) {
      elements.actionInput.classList.add('active');
      elements.actionPrompt.textContent = '请发表遗言';
    } else if (lastWordsPlayer) {
      const pos = getPlayerPosition(lastWordsPlayer.id);
      elements.actionPrompt.textContent = `等待 ${pos}号${lastWordsPlayer.name} 发表遗言...`;
    } else {
      elements.actionPrompt.textContent = '等待遗言...';
    }
    return;
  }

  // 猎人开枪阶段
  if (phase === 'hunter_shoot' && myPlayer.role === 'hunter') {
    // 检查自己是否是那个可以开枪的猎人（刚死且不是被毒死的）
    const myDeadPlayer = gameState.players.find(p => p.id === myPlayer.id);
    const canShoot = myDeadPlayer && !myDeadPlayer.alive &&
                     myDeadPlayer.deathReason &&
                     myDeadPlayer.deathReason !== 'poison';

    if (canShoot) {
      elements.skillButtons.classList.add('active');
      elements.actionPrompt.textContent = '你是猎人！请选择要带走的玩家，或选择不开枪';

      // 添加开枪按钮
      gameState.players.filter(p => p.alive).forEach(player => {
        const position = getPlayerPosition(player.id);
        const btn = document.createElement('button');
        btn.className = 'skill-btn';
        btn.textContent = `开枪带走 ${position}号 ${player.name}`;
        btn.addEventListener('click', () => hunterShoot(player.id));
        elements.skillButtons.appendChild(btn);
      });

      // 不开枪按钮
      const skipBtn = document.createElement('button');
      skipBtn.className = 'skill-btn skip';
      skipBtn.textContent = '不开枪';
      skipBtn.addEventListener('click', () => hunterSkip());
      elements.skillButtons.appendChild(skipBtn);
    } else {
      elements.actionPrompt.textContent = '等待猎人开枪...';
    }
    return;
  }
}

// 启动
init();