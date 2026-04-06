/**
 * 前端 UI 渲染 - 只负责 UI，调用 controller 方法
 */

// 引入 controller（浏览器环境需要直接使用全局变量）
// <script src="controller.js"></script> 在 HTML 中引入

// 角色名称
const ROLE_NAMES = {
  werewolf: '狼人',
  seer: '预言家',
  witch: '女巫',
  guard: '守卫',
  hunter: '猎人',
  villager: '村民',
  idiot: '白痴',
  cupid: '丘比特',
  knight: '骑士',
  wolf_beauty: '狼美人'
};

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

// 初始化
function init() {
  console.log('初始化狼人杀游戏...');

  // 绑定事件
  elements.readyBtn.addEventListener('click', ready);
  elements.sendBtn.addEventListener('click', sendSpeech);
  elements.speechInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendSpeech();
  });

  // 设置状态变更回调
  controller.onStateChange = updateUI;

  // 检查 URL 是否有名字参数
  const urlParams = new URLSearchParams(window.location.search);
  const nameFromUrl = urlParams.get('name');
  if (nameFromUrl) {
    elements.playerNameInput.value = nameFromUrl;
    autoJoin(nameFromUrl);
  }
}

// 自动加入
async function autoJoin(name) {
  const result = await controller.join(name, 9);
  if (result.success) {
    elements.setupPanel.classList.add('hidden');
    updateUI();
  }
}

// 准备
async function ready() {
  const name = elements.playerNameInput.value.trim() || `玩家${Date.now() % 1000}`;
  const count = parseInt(elements.playerCountSelect.value);

  const result = await controller.join(name, count);
  if (result.error) {
    showError(result.error);
    return;
  }

  // 更新 URL
  const url = new URL(window.location);
  url.searchParams.set('name', name);
  window.history.replaceState({}, '', url);

  elements.setupPanel.classList.add('hidden');

  // 如果游戏开始了，显示开场白
  if (result.gameStarted) {
    showOpeningMessage();
  }

  updateUI();
}

// 显示开场白（只在前端显示，不记录到后端）
function showOpeningMessage() {
  addPhaseDivider('游戏开始');
  addMessage('天黑请闭眼。', 'system opening');
}

// 发送发言
async function sendSpeech() {
  const content = elements.speechInput.value.trim();
  if (!content) return;

  const myPlayer = controller.getMyPlayer();
  if (!myPlayer) {
    showError('请先加入游戏');
    return;
  }

  const result = await controller.speak(content);
  if (result.error) {
    showError(result.error);
  }

  elements.speechInput.value = '';
}

// 投票
async function vote(targetId) {
  const result = await controller.vote(targetId);
  if (result.error) {
    showError(result.error);
  }
}

// 使用技能
async function useSkill(data) {
  const result = await controller.useSkill(data);
  if (result.error) {
    showError(result.error);
  }
}

// 重新开始
async function restartGame() {
  await controller.reset();
  location.reload();
}

// 显示错误
function showError(message) {
  const existingError = document.querySelector('.error-toast');
  if (existingError) existingError.remove();

  const toast = document.createElement('div');
  toast.className = 'error-toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// 更新 UI
function updateUI() {
  const state = controller.getState();
  if (!state) {
    console.log('[UI] 无状态，跳过更新');
    return;
  }

  console.log('[UI] 更新界面，阶段:', state.phase);
  updateHeader(state);
  updatePlayers(state);
  updateMessages();
  updateAction(state);
}

// 更新头部
function updateHeader(state) {
  const phaseNames = {
    waiting: '等待玩家加入',
    cupid: '丘比特连接',
    guard: '守卫守护',
    night_werewolf_discuss: '狼人讨论中',
    night_werewolf_vote: '狼人投票中',
    witch: '女巫行动',
    seer: '预言家查验',
    night_resolve: '夜晚结算',
    sheriff_campaign: '警长竞选',
    sheriff_speech: '竞选发言',
    day_announce: '公布死讯',
    last_words: '遗言阶段',
    day_discuss: '白天讨论',
    day_vote: '白天投票',
    game_over: '游戏结束'
  };

  let phaseText = phaseNames[state.phase] || state.phase;
  if (state.phase === 'waiting') {
    const current = state.players?.length || 0;
    const total = state.playerCount || 9;
    phaseText = `等待玩家加入 (${current}/${total})`;
  }
  elements.phaseInfo.textContent = phaseText;

  if (state.dayCount > 0) {
    const isNight = ['cupid', 'guard', 'night_werewolf_discuss', 'night_werewolf_vote', 'witch', 'seer', 'night_resolve'].includes(state.phase);
    elements.dayCount.textContent = `第${state.dayCount}${isNight ? '夜' : '天'}`;
  } else {
    elements.dayCount.textContent = '';
  }

  // 显示角色信息
  const myPlayer = controller.getMyPlayer();
  if (myPlayer?.role) {
    const roleId = myPlayer.role.id || myPlayer.role;
    let roleHtml = `<span class="role-badge ${roleId}">${ROLE_NAMES[roleId] || roleId}</span>`;

    // 狼人显示队友
    if (myPlayer.role.camp === 'wolf' || myPlayer.role === 'werewolf') {
      const teammates = state.players
        .filter(p => (p.role?.camp === 'wolf' || p.role === 'werewolf') && p.id !== myPlayer.id)
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
function updatePlayers(state) {
  elements.playersGrid.innerHTML = '';

  const myPlayer = controller.getMyPlayer();
  const total = state.playerCount || 9;
  const currentCount = state.players?.length || 0;

  state.players?.forEach((player, index) => {
    const position = index + 1;
    const card = document.createElement('div');
    card.className = 'player-card';
    if (!player.alive) card.classList.add('dead');
    if (player.id === state.currentSpeaker) card.classList.add('current');
    if (myPlayer && player.id === myPlayer.id) card.classList.add('self');

    // 角色显示逻辑
    let roleText = '';
    if (player.role) {
      const roleId = player.role.id || player.role;
      if (myPlayer && player.id === myPlayer.id) {
        roleText = ROLE_NAMES[roleId] || '';
      } else if (myPlayer && (myPlayer.role.camp === 'wolf' || myPlayer.role === 'werewolf') && (player.role.camp === 'wolf' || player.role === 'werewolf')) {
        roleText = ROLE_NAMES[roleId] || '';
      }
      if (state.phase === 'game_over') {
        roleText = ROLE_NAMES[roleId] || '';
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

  // 显示空位
  if (state.phase === 'waiting') {
    for (let i = currentCount; i < total; i++) {
      const position = i + 1;
      const emptySlot = document.createElement('div');
      emptySlot.className = 'player-card empty-slot';
      emptySlot.innerHTML = `
        <div class="player-position">${position}号</div>
        <div class="player-name">空位</div>
        <div class="player-status">点击添加AI</div>
      `;
      emptySlot.addEventListener('click', () => controller.addAI());
      elements.playersGrid.appendChild(emptySlot);
    }
  }
}

// 更新消息
function updateMessages() {
  const messages = controller.getMessageHistory();
  const state = controller.getState();

  messages.forEach(msg => {
    if (!document.querySelector(`[data-msg-id="${msg.id}"]`)) {
      displayMessage(msg, state);
    }
  });
}

// 显示消息
function displayMessage(msg, state) {
  if (msg.type === 'phase_start') {
    addPhaseDivider(msg.content);
  } else if (msg.type === 'speech' || msg.type === 'wolf_speech') {
    const pos = controller.getPlayerPosition(msg.playerId);
    addMessage(`${pos}号${msg.playerName}：${msg.content}`, msg.type === 'wolf_speech' ? 'wolf-channel' : '', msg.id);
  } else if (msg.type === 'ai_thinking') {
    addMessage(`${msg.playerName} 正在思考...`, 'ai-thinking', null);
  } else {
    addMessage(msg.content, msg.className || msg.type, msg.id);
  }
}

// 添加消息
function addMessage(content, className = '', id = null) {
  const msg = document.createElement('div');
  msg.className = `message ${className}`;
  if (id) msg.dataset.msgId = id;
  msg.innerHTML = `<div class="message-content">${content.replace(/\n/g, '<br>')}</div>`;
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
function updateAction(state) {
  elements.actionInput.classList.remove('active');
  elements.voteButtons.classList.remove('active');
  elements.skillButtons.classList.remove('active');
  elements.actionPrompt.textContent = '';
  elements.voteButtons.innerHTML = '';
  elements.skillButtons.innerHTML = '';

  const myPlayer = controller.getMyPlayer();

  if (!myPlayer) {
    elements.actionPrompt.textContent = '请先加入游戏';
    return;
  }

  if (!myPlayer.alive && state.phase !== 'last_words' && state.phase !== 'game_over') {
    elements.actionPrompt.textContent = '你已死亡，观战中...';
    return;
  }

  const phase = state.phase;

  // 等待阶段
  if (phase === 'waiting') {
    const current = state.players?.length || 0;
    const total = state.playerCount || 9;
    elements.actionPrompt.textContent = current < total ? `等待玩家加入... (${current}/${total})` : '人已齐，即将开始...';
    return;
  }

  // 游戏结束
  if (phase === 'game_over') {
    elements.actionPrompt.innerHTML = `<strong>${state.winner === 'wolf' ? '狼人阵营获胜！' : '好人阵营获胜！'}</strong>`;
    elements.skillButtons.classList.add('active');
    const restartBtn = document.createElement('button');
    restartBtn.className = 'skill-btn';
    restartBtn.textContent = '再来一局';
    restartBtn.addEventListener('click', restartGame);
    elements.skillButtons.appendChild(restartBtn);
    return;
  }

  // 发言阶段
  if (['day_discuss', 'night_werewolf_discuss', 'sheriff_speech', 'last_words'].includes(phase)) {
    if (state.currentSpeaker === myPlayer.id) {
      elements.actionInput.classList.add('active');
      elements.actionPrompt.textContent = '轮到你发言了';
    } else if (state.currentSpeaker) {
      const speaker = state.players.find(p => p.id === state.currentSpeaker);
      if (speaker) {
        elements.actionPrompt.textContent = `等待 ${controller.getPlayerPosition(speaker.id)}号${speaker.name} 发言...`;
      }
    }
    return;
  }

  // 投票阶段
  if (phase === 'day_vote') {
    if (state.hasVoted) {
      elements.actionPrompt.textContent = '已投票，等待其他玩家...';
      return;
    }
    elements.voteButtons.classList.add('active');
    elements.actionPrompt.textContent = '请投票放逐一名玩家';

    state.players.filter(p => p.alive && p.id !== myPlayer.id).forEach(player => {
      const position = controller.getPlayerPosition(player.id);
      const btn = document.createElement('button');
      btn.className = 'vote-btn';
      btn.textContent = `${position}号 ${player.name}`;
      btn.addEventListener('click', () => vote(player.id));
      elements.voteButtons.appendChild(btn);
    });

    const abstainBtn = document.createElement('button');
    abstainBtn.className = 'vote-btn skip';
    abstainBtn.textContent = '弃权';
    abstainBtn.addEventListener('click', () => vote(null));
    elements.voteButtons.appendChild(abstainBtn);
    return;
  }

  // 技能阶段
  const skillPhases = ['night_werewolf_vote', 'seer', 'guard', 'witch', 'cupid'];
  if (skillPhases.includes(phase)) {
    const rolePhaseMap = { night_werewolf_vote: 'werewolf', seer: 'seer', guard: 'guard', witch: 'witch', cupid: 'cupid' };
    const requiredRole = rolePhaseMap[phase];
    if (myPlayer.role.id === requiredRole || myPlayer.role === requiredRole) {
      elements.skillButtons.classList.add('active');
      renderSkillButtons(phase, myPlayer, state);
    } else {
      elements.actionPrompt.textContent = '等待其他玩家行动...';
    }
    return;
  }

  elements.actionPrompt.textContent = '等待中...';
}

// 渲染技能按钮
function renderSkillButtons(phase, myPlayer, state) {
  const alivePlayers = state.players.filter(p => p.alive && p.id !== myPlayer.id);

  if (phase === 'night_werewolf_vote') {
    elements.actionPrompt.textContent = '请选择今晚要击杀的目标';
    state.players.forEach(player => {
      if (!player.alive) return;
      const position = controller.getPlayerPosition(player.id);
      const isTeammate = player.role?.camp === 'wolf' || player.role === 'werewolf';
      const isSelf = player.id === myPlayer.id;
      const btn = document.createElement('button');
      btn.className = 'skill-btn';
      if (isSelf || isTeammate) btn.classList.add('danger');
      btn.textContent = `${position}号 ${player.name}` + (isSelf ? ' (自己)' : isTeammate ? ' (队友)' : '');
      btn.addEventListener('click', () => useSkill({ phase: 'night_werewolf_vote', targetId: player.id }));
      elements.skillButtons.appendChild(btn);
    });
  } else if (phase === 'seer') {
    elements.actionPrompt.textContent = '请选择要查验的玩家';
    alivePlayers.forEach(player => {
      const position = controller.getPlayerPosition(player.id);
      const btn = document.createElement('button');
      btn.className = 'skill-btn';
      btn.textContent = `查验 ${position}号 ${player.name}`;
      btn.addEventListener('click', () => useSkill({ phase: 'seer', targetId: player.id }));
      elements.skillButtons.appendChild(btn);
    });
  } else if (phase === 'guard') {
    elements.actionPrompt.textContent = '请选择要守护的玩家';
    state.players.filter(p => p.alive).forEach(player => {
      const position = controller.getPlayerPosition(player.id);
      const btn = document.createElement('button');
      btn.className = 'skill-btn';
      btn.textContent = `守护 ${position}号 ${player.name}`;
      btn.addEventListener('click', () => useSkill({ phase: 'guard', targetId: player.id }));
      elements.skillButtons.appendChild(btn);
    });
  } else if (phase === 'witch') {
    const usedTonight = state.witchUsedTonight || { healed: false, poisoned: false };

    if (state.werewolfTarget) {
      const target = state.players.find(p => p.id === state.werewolfTarget);
      elements.actionPrompt.innerHTML = `<strong>今晚 ${target?.name || '某人'} 被狼人杀害！</strong>`;
    } else {
      elements.actionPrompt.textContent = '今晚没有人被狼人杀害。';
    }

    // 解药
    if (state.witchPotion?.heal && state.werewolfTarget && !usedTonight.healed) {
      const target = state.players.find(p => p.id === state.werewolfTarget);
      const healBtn = document.createElement('button');
      healBtn.className = 'skill-btn heal';
      healBtn.textContent = `💚 救 ${target?.name}`;
      healBtn.addEventListener('click', () => useSkill({ action: 'heal' }));
      elements.skillButtons.appendChild(healBtn);
    }

    // 毒药
    if (state.witchPotion?.poison && !usedTonight.poisoned) {
      const poisonSection = document.createElement('div');
      poisonSection.className = 'poison-section';
      poisonSection.innerHTML = '<span>💀 毒药：</span>';

      alivePlayers.filter(p => p.id !== state.werewolfTarget).forEach(player => {
        const position = controller.getPlayerPosition(player.id);
        const btn = document.createElement('button');
        btn.className = 'skill-btn poison';
        btn.textContent = `${position}号 ${player.name}`;
        btn.addEventListener('click', () => useSkill({ action: 'poison', targetId: player.id }));
        poisonSection.appendChild(btn);
      });
      elements.skillButtons.appendChild(poisonSection);
    }

    // 结束
    const skipBtn = document.createElement('button');
    skipBtn.className = 'skill-btn skip';
    skipBtn.textContent = '结束行动';
    skipBtn.addEventListener('click', () => useSkill({ action: 'skip' }));
    elements.skillButtons.appendChild(skipBtn);
  }
}

// 启动
init();