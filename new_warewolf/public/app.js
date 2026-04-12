/**
 * 前端 UI 渲染 - WebSocket 版本
 */

// 角色名称
const ROLE_NAMES = {
  werewolf: '狼人',
  seer: '预言家',
  witch: '女巫',
  guard: '守卫',
  hunter: '猎人',
  villager: '村民',
  idiot: '白痴',
  cupid: '丘比特'
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

// 当前行动请求
let currentAction = null;

// 初始化
function init() {
  console.log('初始化狼人杀游戏...');

  elements.readyBtn.addEventListener('click', ready);
  elements.sendBtn.addEventListener('click', sendSpeech);
  elements.speechInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendSpeech();
  });

  // 设置状态变更回调
  controller.onStateChange = updateUI;

  // 设置行动请求回调
  controller.onActionRequired = handleActionRequired;

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

  // 获取 Debug 模式选择的角色
  const debugRoleSelect = document.getElementById('debug-role-select');
  const debugRole = debugRoleSelect ? debugRoleSelect.value : null;

  const result = await controller.join(name, count, debugRole || null);
  if (result.error) {
    showError(result.error);
    return;
  }

  // 更新 URL
  const url = new URL(window.location);
  url.searchParams.set('name', name);
  window.history.replaceState({}, '', url);

  elements.setupPanel.classList.add('hidden');

  if (result.gameStarted) {
    showOpeningMessage();
  }

  updateUI();
}

// 显示开场白
function showOpeningMessage() {
  addPhaseDivider('游戏开始');
  addMessage('天黑请闭眼。', 'system opening');
}

// 处理行动请求
function handleActionRequired(msg) {
  currentAction = msg;
  const d = msg.data;  // 实际数据在 msg.data 里
  console.log('[UI] 行动请求:', d.action, d.requestId);

  // 根据行动类型显示不同的 UI
  const state = controller.getState();
  const myPlayer = controller.getMyPlayer();

  if (!myPlayer) return;

  // 清空之前的按钮
  elements.voteButtons.innerHTML = '';
  elements.skillButtons.innerHTML = '';

  switch (d.action) {
    case 'speak':
    case 'last_words':
      elements.actionInput.classList.add('active');
      elements.actionPrompt.textContent = '轮到你发言了';
      break;

    case 'vote':
    case 'wolf_vote':
    case 'sheriff_vote':
      elements.voteButtons.classList.add('active');
      elements.actionPrompt.textContent = d.action === 'wolf_vote' ? '请选择刀人目标' : (d.action === 'sheriff_vote' ? '请投票选警长' : '请投票');
      renderVoteButtons(state, myPlayer, d.allowedTargets, d.action);
      break;

    case 'choose_target':
      elements.skillButtons.classList.add('active');
      elements.actionPrompt.textContent = d.count > 1 ? `请选择 ${d.count} 个目标` : '请选择目标';
      // 守卫不能连守同一人
      const disabledIds = d.lastGuardTarget ? [d.lastGuardTarget] : [];
      renderTargetButtons(state, myPlayer, d.count, { disabledIds });
      break;

    case 'guard':
      elements.skillButtons.classList.add('active');
      elements.actionPrompt.textContent = '请选择守护目标';
      // 守卫不能连守同一人，传入上一晚的目标
      const guardDisabledIds = d.lastGuardTarget ? [d.lastGuardTarget] : [];
      renderTargetButtons(state, myPlayer, 1, { disabledIds: guardDisabledIds });
      break;

    case 'witch':
      elements.skillButtons.classList.add('active');
      elements.actionPrompt.textContent = '女巫行动';
      renderWitchButtons(state, myPlayer, d);
      break;

    case 'campaign':
      elements.skillButtons.classList.add('active');
      elements.actionPrompt.textContent = '是否竞选警长？';
      renderCampaignButtons();
      break;

    case 'withdraw':
      elements.skillButtons.classList.add('active');
      elements.actionPrompt.textContent = '是否退水？';
      renderWithdrawButtons();
      break;

    case 'choose_speaker_order':
    case 'assignOrder':
      elements.skillButtons.classList.add('active');
      elements.actionPrompt.textContent = '请指定发言顺序';
      renderSpeakerOrderUI(state);
      break;

    case 'shoot':
      elements.skillButtons.classList.add('active');
      elements.actionPrompt.textContent = '猎人请选择开枪目标';
      renderTargetButtons(state, myPlayer, 1);
      break;

    case 'cupid':
      elements.skillButtons.classList.add('active');
      elements.actionPrompt.textContent = '请选择连接为情侣的两名玩家';
      renderTargetButtons(state, myPlayer, 2);
      break;

    case 'seer':
      elements.skillButtons.classList.add('active');
      elements.actionPrompt.textContent = '请选择查验目标';
      // 从 state 计算 allowedTargets：排除自己、已查验的、死亡的
      const checkedIds = (state.self?.seerChecks || []).map(c => c.targetId);
      const allowedTargets = state.players
        .filter(p => p.id !== myPlayer.id && p.alive && !checkedIds.includes(p.id))
        .map(p => p.id);
      renderTargetButtons(state, myPlayer, 1, { allowedTargets });
      break;

    case 'passBadge':
    case 'pass_badge':
      elements.skillButtons.classList.add('active');
      elements.actionPrompt.textContent = '警长请选择传警徽对象（或选择不传）';
      // 使用后端传来的 allowedTargets
      const passBadgeTargets = d.allowedTargets
        ? state.players.filter(p => d.allowedTargets.includes(p.id))
        : state.players.filter(p => p.alive && p.id !== myPlayer.id);
      renderPassBadgeButtons(passBadgeTargets);
      break;

    default:
      console.log('[UI] 未知行动类型:', d.action);
  }
}

// 渲染投票按钮
function renderVoteButtons(state, myPlayer, allowedTargets, actionType) {
  // 如果限制了投票目标，只显示允许的目标
  const candidates = allowedTargets
    ? state.players.filter(p => p.alive && allowedTargets.includes(p.id))
    : state.players.filter(p => p.alive && p.id !== myPlayer.id);

  // 判断是否是狼人投票，以及自己是不是狼人
  const isWolfVote = actionType === 'wolf_vote';
  // 优先从 state.self 获取，如果没有则从 players 数组中查找
  let myCamp = state.self?.role?.camp;
  if (!myCamp && myPlayer?.id) {
    const me = state.players.find(p => p.id === myPlayer.id);
    myCamp = me?.role?.camp;
  }
  const isWolf = myCamp === 'wolf';

  candidates.forEach(player => {
    const pos = controller.getPlayerPosition(player.id);
    const btn = document.createElement('button');
    btn.className = 'vote-btn';

    // 狼人投票时，如果是狼人队友显示红色
    const isTeammate = player.role?.camp === 'wolf';
    if (isWolfVote && isWolf && isTeammate) {
      btn.classList.add('wolf-target');
      btn.title = '狼人队友';
    }

    btn.textContent = `${pos}号 ${player.name}`;
    btn.addEventListener('click', () => {
      controller.respond(currentAction.data.requestId, { targetId: player.id });
      clearActionUI();
    });
    elements.voteButtons.appendChild(btn);
  });

  // 弃权按钮
  const abstainBtn = document.createElement('button');
  abstainBtn.className = 'vote-btn skip';
  abstainBtn.textContent = '弃权';
  abstainBtn.addEventListener('click', () => {
    controller.respond(currentAction.data.requestId, { targetId: null });
    clearActionUI();
  });
  elements.voteButtons.appendChild(abstainBtn);
}

// 渲染目标选择按钮
function renderTargetButtons(state, myPlayer, count = 1, extraData = {}) {
  const selected = [];
  const allowedTargets = extraData.allowedTargets;  // 后端指定的可选目标
  const disabledIds = extraData.disabledIds || [];

  // 如果有 allowedTargets，只显示这些玩家；否则显示所有其他存活玩家
  let candidates;
  if (allowedTargets && allowedTargets.length > 0) {
    candidates = state.players.filter(p => allowedTargets.includes(p.id));
  } else {
    candidates = state.players.filter(p => p.alive && p.id !== myPlayer.id);
  }

  candidates.forEach(player => {
    const pos = controller.getPlayerPosition(player.id);
    const btn = document.createElement('button');
    btn.className = 'skill-btn';
    btn.textContent = `${pos}号 ${player.name}`;

    // 需要禁用的选项（如已查验）
    if (disabledIds.includes(player.id)) {
      btn.disabled = true;
      btn.classList.add('disabled');
      btn.title = '不能选择该玩家';
    }

    btn.addEventListener('click', () => {
      if (btn.disabled) return;

      btn.classList.toggle('selected');

      if (btn.classList.contains('selected')) {
        selected.push(player.id);
      } else {
        const idx = selected.indexOf(player.id);
        if (idx >= 0) selected.splice(idx, 1);
      }

      // 如果只选一个，直接响应
      if (count === 1 && selected.length === 1) {
        controller.respond(currentAction.data.requestId, { targetId: selected[0] });
        clearActionUI();
      }
    });
    elements.skillButtons.appendChild(btn);
  });

  // 多选确认按钮
  if (count > 1) {
    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'skill-btn';
    confirmBtn.textContent = `确认选择 (${selected.length}/${count})`;
    confirmBtn.addEventListener('click', () => {
      if (selected.length === count) {
        controller.respond(currentAction.data.requestId, { targetIds: selected });
        clearActionUI();
      } else {
        showError(`请选择 ${count} 个目标`);
      }
    });
    elements.skillButtons.appendChild(confirmBtn);
  }

  // 单选时添加弃权按钮（如预言家查验）
  if (count === 1) {
    const skipBtn = document.createElement('button');
    skipBtn.className = 'skill-btn skip';
    skipBtn.textContent = '跳过';
    skipBtn.addEventListener('click', () => {
      controller.respond(currentAction.data.requestId, { targetId: null });
      clearActionUI();
    });
    elements.skillButtons.appendChild(skipBtn);
  }
}

// 渲染警长传警徽按钮
function renderPassBadgeButtons(alivePlayers) {
  // 添加传警徽按钮
  alivePlayers.forEach(player => {
    const pos = controller.getPlayerPosition(player.id);
    const btn = document.createElement('button');
    btn.className = 'skill-btn';
    btn.textContent = `传警徽给 ${pos}号 ${player.name}`;
    btn.addEventListener('click', () => {
      controller.respond(currentAction.data.requestId, { targetId: player.id });
      clearActionUI();
    });
    elements.skillButtons.appendChild(btn);
  });

  // 不传警徽按钮
  const noPassBtn = document.createElement('button');
  noPassBtn.className = 'skill-btn skip';
  noPassBtn.textContent = '不传警徽';
  noPassBtn.addEventListener('click', () => {
    controller.respond(currentAction.data.requestId, { targetId: null });
    clearActionUI();
  });
  elements.skillButtons.appendChild(noPassBtn);
}

// 渲染女巫按钮
function renderWitchButtons(state, myPlayer, d) {
  // 显示被杀者
  if (d.werewolfTarget) {
    const target = state.players.find(p => p.id === d.werewolfTarget);
    const myId = myPlayer?.id;
    const isSelfTargeted = d.werewolfTarget === myId;

    // 检查是否可以自救（第一夜不能自救）
    const canSelfHeal = d.canSelfHeal !== false;

    if (isSelfTargeted && !canSelfHeal) {
      elements.actionPrompt.innerHTML = `<strong>今晚 ${target?.name || '某人'} 被狼人杀害！（首夜不能自救）</strong>`;
    } else {
      elements.actionPrompt.innerHTML = `<strong>今晚 ${target?.name || '某人'} 被狼人杀害！</strong>`;
    }
  } else {
    elements.actionPrompt.textContent = '今晚没有人被狼人杀害。';
  }

  // 解药
  if (d.healAvailable && d.werewolfTarget) {
    const target = state.players.find(p => p.id === d.werewolfTarget);
    const myId = myPlayer?.id;
    const isSelfTargeted = d.werewolfTarget === myId;
    const canSelfHeal = d.canSelfHeal !== false;

    // 首夜不能自救
    if (isSelfTargeted && !canSelfHeal) {
      // 不显示自救按钮
    } else {
      const healBtn = document.createElement('button');
      healBtn.className = 'skill-btn heal';
      healBtn.textContent = `💚 救 ${target?.name}`;
      healBtn.addEventListener('click', () => {
        controller.respond(currentAction.data.requestId, { action: 'heal' });
        clearActionUI();
      });
      elements.skillButtons.appendChild(healBtn);
    }
  }

  // 毒药
  if (d.poisonAvailable) {
    const poisonSection = document.createElement('div');
    poisonSection.className = 'poison-section';
    poisonSection.innerHTML = '<span>💀 毒药：</span>';

    state.players.filter(p => p.alive && p.id !== myPlayer.id && p.id !== d.werewolfTarget).forEach(player => {
      const pos = controller.getPlayerPosition(player.id);
      const btn = document.createElement('button');
      btn.className = 'skill-btn poison';
      btn.textContent = `${pos}号 ${player.name}`;
      btn.addEventListener('click', () => {
        controller.respond(currentAction.data.requestId, { action: 'poison', targetId: player.id });
        clearActionUI();
      });
      poisonSection.appendChild(btn);
    });
    elements.skillButtons.appendChild(poisonSection);
  }

  // 跳过
  const skipBtn = document.createElement('button');
  skipBtn.className = 'skill-btn skip';
  skipBtn.textContent = '结束行动';
  skipBtn.addEventListener('click', () => {
    controller.respond(currentAction.data.requestId, { action: 'skip' });
    clearActionUI();
  });
  elements.skillButtons.appendChild(skipBtn);
}

// 渲染竞选按钮
function renderCampaignButtons() {
  const yesBtn = document.createElement('button');
  yesBtn.className = 'skill-btn';
  yesBtn.textContent = '竞选';
  yesBtn.addEventListener('click', () => {
    controller.respond(currentAction.data.requestId, { run: true });
    clearActionUI();
  });
  elements.skillButtons.appendChild(yesBtn);

  const noBtn = document.createElement('button');
  noBtn.className = 'skill-btn skip';
  noBtn.textContent = '不竞选';
  noBtn.addEventListener('click', () => {
    controller.respond(currentAction.data.requestId, { run: false });
    clearActionUI();
  });
  elements.skillButtons.appendChild(noBtn);
}

// 渲染退水按钮
function renderWithdrawButtons() {
  const yesBtn = document.createElement('button');
  yesBtn.className = 'skill-btn';
  yesBtn.textContent = '退水';
  yesBtn.addEventListener('click', () => {
    controller.respond(currentAction.data.requestId, { withdraw: true });
    clearActionUI();
  });
  elements.skillButtons.appendChild(yesBtn);

  const noBtn = document.createElement('button');
  noBtn.className = 'skill-btn skip';
  noBtn.textContent = '继续竞选';
  noBtn.addEventListener('click', () => {
    controller.respond(currentAction.data.requestId, { withdraw: false });
    clearActionUI();
  });
  elements.skillButtons.appendChild(noBtn);
}

// 渲染发言起始位置选择 UI
function renderSpeakerOrderUI(state) {
  // 获取当前玩家（警长）
  const myPlayer = state.players.find(p => p.id === controller.playerId);
  // 警长不能选择自己作为发言起始位置（警长最后发言）
  const alivePlayers = state.players.filter(p => p.alive && p.id !== myPlayer.id);

  if (alivePlayers.length === 0) {
    elements.actionPrompt.textContent = '没有其他存活玩家可以选择';
    return;
  }

  alivePlayers.forEach(player => {
    const pos = controller.getPlayerPosition(player.id);
    const btn = document.createElement('button');
    btn.className = 'skill-btn';
    btn.textContent = `${pos}号 ${player.name}`;
    btn.addEventListener('click', () => {
      // 清除之前的选中状态
      elements.skillButtons.querySelectorAll('button').forEach(b => {
        b.classList.remove('selected');
      });
      // 选中当前
      btn.classList.add('selected');
      // 发送选择（assignOrder是target类型技能，需要targetId）
      controller.respond(currentAction.data.requestId, { targetId: player.id });
      clearActionUI();
    });
    elements.skillButtons.appendChild(btn);
  });
}

// 清除行动 UI
function clearActionUI() {
  currentAction = null;
  elements.actionInput.classList.remove('active');
  elements.voteButtons.classList.remove('active');
  elements.skillButtons.classList.remove('active');
  elements.voteButtons.innerHTML = '';
  elements.skillButtons.innerHTML = '';
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

  // 如果有行动请求，用 respond
  if (currentAction) {
    controller.respond(currentAction.data.requestId, { content });
    clearActionUI();
  } else {
    // 否则用 speak
    await controller.speak(content);
  }

  elements.speechInput.value = '';
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
function updateUI(state) {
  if (!state) {
    state = controller.getState();
  }
  if (!state) return;

  // Debug 模式：显示/隐藏角色选择
  const debugRoleGroup = document.getElementById('debug-role-group');
  if (debugRoleGroup) {
    if (state.debugMode) {
      debugRoleGroup.classList.remove('hidden');
    } else {
      debugRoleGroup.classList.add('hidden');
    }
  }

  updateHeader(state);
  updatePlayers(state);
  updateMessages();

  // 如果没有行动请求，更新默认操作区
  if (!currentAction) {
    updateDefaultAction(state);
  }
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
    sheriff_vote: '警长投票',
    day_announce: '公布死讯',
    last_words: '遗言阶段',
    day_discuss: '白天讨论',
    day_vote: '白天投票',
    post_vote: '放逐后处理',
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

  const myPlayer = controller.getMyPlayer();
  if (myPlayer?.role) {
    const roleId = myPlayer.role.id || myPlayer.role;
    let roleHtml = `<span class="role-badge ${roleId}">${ROLE_NAMES[roleId] || roleId}</span>`;

    // 显示情侣信息
    if (state.self?.isCouple && state.self?.couplePartner) {
      const partnerPos = controller.getPlayerPosition(state.self.couplePartner);
      roleHtml += ` <span class="couple-info">情侣: ${partnerPos}号</span>`;
    }

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

    // 显示警长标记
    const isSheriff = player.isSheriff || state.sheriff === player.id;

    // 显示情侣标记
    const isCouple = player.isCouple;

    // 显示翻牌状态（猎人/白痴）
    const revealed = player.revealed;

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

    let statusText = player.alive ? (player.isAI ? 'AI' : '玩家') : '已死亡';
    if (isSheriff) statusText += ' 🏅';
    if (isCouple) statusText += ' 💕';
    if (revealed) statusText += ' 📢';

    // 警徽显示
    const sheriffBadge = isSheriff ? '<div class="sheriff-badge">🔱</div>' : '';

    card.innerHTML = `
      ${sheriffBadge}
      <div class="player-position">${position}号</div>
      <div class="player-name">${player.name}</div>
      <div class="player-status">${statusText}</div>
      ${roleText ? `<div class="player-role">${roleText}</div>` : ''}
    `;

    elements.playersGrid.appendChild(card);
  });

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
    addPhaseDivider(msg.phaseName || msg.content || msg.phase, msg.id);
  } else if (msg.type === 'speech' || msg.type === 'wolf_speech' || msg.type === 'last_words') {
    const pos = controller.getPlayerPosition(msg.playerId);
    const prefix = msg.type === 'last_words' ? '【遗言】' : '';
    const className = msg.type === 'wolf_speech' ? 'wolf-channel' : (msg.type === 'last_words' ? 'last-words' : '');
    addMessage(`${prefix}${pos}号${msg.playerName}：${msg.content}`, className, msg.id);
  } else if ((msg.type === 'vote_result' || msg.type === 'wolf_vote_result') && msg.voteDetails) {
    // 显示投票结果详情（公开投票或狼人内部投票）
    const isWolfVote = msg.type === 'wolf_vote_result';
    let content = '<div class="vote-result">';
    content += `<div class="vote-title">${isWolfVote ? '🔪 狼人刀人投票' : '投票结果'}</div>`;
    // 显示最终结果（狼人刀谁）
    if (isWolfVote && msg.content) {
      content += `<div class="vote-final">${msg.content}</div>`;
    }
    content += '<div class="vote-details">';
    msg.voteDetails.forEach(v => {
      content += `<div>${v.voter} → ${v.target}</div>`;
    });
    content += '</div>';
    if (msg.voteCounts) {
      content += '<div class="vote-counts">';
      for (const [playerId, count] of Object.entries(msg.voteCounts)) {
        const pos = controller.getPlayerPosition(Number(playerId));
        const player = state?.players?.find(p => p.id === Number(playerId));
        content += `<div>${pos}号${player?.name || ''}: ${count}票</div>`;
      }
      content += '</div>';
    }
    content += '</div>';
    addMessage(content, isWolfVote ? 'wolf-vote-result' : 'vote-result', msg.id);
  } else if (msg.type === 'vote_tie') {
    addMessage(msg.content, 'vote-tie', msg.id);
  } else if (msg.type === 'sheriff_candidates') {
    addMessage(msg.content, 'sheriff-candidates', msg.id);
  } else if (msg.type === 'sheriff_elected') {
    addMessage(msg.content, 'sheriff-elected', msg.id);
  } else if (msg.type === 'death_announce' && msg.deaths) {
    console.log('[Death] msg:', msg);
    // 显示死亡消息
    let content = '<div class="death-announce">';
    msg.deaths.forEach(d => {
      const pos = controller.getPlayerPosition(d.id);
      let reasonText = '';
      switch (d.reason) {
        case 'wolf':
          reasonText = '被狼人击杀';
          break;
        case 'poison':
          reasonText = '被毒杀';
          break;
        case 'conflict':
          reasonText = '同守同救';
          break;
        case 'vote':
          reasonText = '被放逐';
          break;
        case 'hunter':
          reasonText = '被猎人带走';
          break;
        case 'couple':
          reasonText = '殉情';
          break;
        default:
          reasonText = '死亡';
      }
      content += `<div>${pos}号${d.name} ${reasonText}</div>`;
    });
    content += '</div>';
    addMessage(content, 'system death', msg.id);
  } else if (msg.type === 'action' || msg.type === 'system') {
    // 私有消息（visibility: 'self'）显示给玩家自己
    if (msg.visibility === 'self') {
      addMessage(`[私密] ${msg.content}`, 'private', msg.id);
    } else {
      addMessage(msg.content, msg.className || msg.type, msg.id);
    }
  } else {
    addMessage(msg.content, msg.className || msg.type, msg.id);
  }
}

// 添加消息
function addMessage(content, className = '', id = null) {
  // 如果有id，检查是否已存在（防止重复添加）
  if (id && document.querySelector(`[data-msg-id="${id}"]`)) {
    return;
  }
  const msg = document.createElement('div');
  msg.className = `message ${className}`;
  if (id) msg.dataset.msgId = id;
  msg.innerHTML = `<div class="message-content">${content.replace(/\n/g, '<br>')}</div>`;
  elements.messages.appendChild(msg);
  elements.messages.scrollTop = elements.messages.scrollHeight;
}

// 添加阶段分割线
function addPhaseDivider(phaseText, msgId = null) {
  // 检查是否已存在
  if (msgId && document.querySelector(`[data-msg-id="${msgId}"]`)) {
    return;
  }
  const divider = document.createElement('div');
  divider.className = 'phase-divider';
  if (msgId) divider.dataset.msgId = msgId;
  divider.innerHTML = `<span>${phaseText}</span>`;
  elements.messages.appendChild(divider);
  elements.messages.scrollTop = elements.messages.scrollHeight;
}

// 更新默认操作区（没有行动请求时）
function updateDefaultAction(state) {
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

  if (!myPlayer.alive && state.phase !== 'last_words' && state.phase !== 'game_over' && state.phase !== 'post_vote') {
    elements.actionPrompt.textContent = '你已死亡，观战中...';
    return;
  }

  if (state.phase === 'waiting') {
    const current = state.players?.length || 0;
    const total = state.playerCount || 9;
    elements.actionPrompt.textContent = current < total ? `等待玩家加入... (${current}/${total})` : '人已齐，即将开始...';
    return;
  }

  if (state.phase === 'game_over') {
    let winnerText = '';
    switch (state.winner) {
      case 'wolf':
        winnerText = '狼人阵营获胜！';
        break;
      case 'good':
        winnerText = '好人阵营获胜！';
        break;
      case 'third':
        winnerText = '第三方（情侣）获胜！';
        break;
      default:
        winnerText = '游戏结束';
    }

    // 显示获胜信息和所有玩家身份
    let gameOverHtml = `<div class="game-over"><strong>${winnerText}</strong>`;
    gameOverHtml += '<div class="all-roles">';
    if (state.gameOverInfo && state.gameOverInfo.players) {
      state.gameOverInfo.players.forEach(p => {
        const display = p.display || `${p.id}号${p.name}`;
        const roleName = p.role ? ROLE_NAMES[p.role.id] || p.role.id : '未知';
        const deathInfo = p.alive ? '存活' : (p.deathReason ? `死亡(${p.deathReason})` : '死亡');
        const sheriffMark = p.isSheriff ? ' 🏅警长' : '';
        gameOverHtml += `<div>${display}: ${roleName} - ${deathInfo}${sheriffMark}</div>`;
      });
    }
    gameOverHtml += '</div></div>';

    elements.actionPrompt.innerHTML = gameOverHtml;
    elements.skillButtons.classList.add('active');
    const restartBtn = document.createElement('button');
    restartBtn.className = 'skill-btn';
    restartBtn.textContent = '再来一局';
    restartBtn.addEventListener('click', async () => {
      await controller.reset();
      location.reload();
    });
    elements.skillButtons.appendChild(restartBtn);
    return;
  }

  // 显示当前阶段提示
  const phasePrompts = {
    cupid: '丘比特正在选择情侣...',
    guard: '守卫正在守护...',
    night_werewolf_discuss: '狼人正在讨论...',
    night_werewolf_vote: '狼人正在投票...',
    witch: '女巫正在行动...',
    seer: '预言家正在查验...',
    night_resolve: '夜晚结算中...',
    sheriff_campaign: '警长竞选中...',
    sheriff_speech: '竞选发言中...',
    sheriff_vote: '警长投票中...',
    day_announce: '天亮了！',
    last_words: '遗言阶段...',
    day_discuss: '白天讨论中...',
    day_vote: '投票中...',
    post_vote: '放逐后处理中...'
  };

  if (phasePrompts[state.phase]) {
    elements.actionPrompt.textContent = phasePrompts[state.phase];
  } else {
    elements.actionPrompt.textContent = '等待中...';
  }
}

// 启动
init();