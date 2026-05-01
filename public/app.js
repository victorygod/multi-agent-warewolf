/**
 * 前端 UI 渲染 - WebSocket 版本
 */

// 常量定义（与后端 constants.js 保持一致）
const ACTION = {
  GUARD: 'action_guard',
  WITCH: 'action_witch',
  SEER: 'action_seer',
  CUPID: 'action_cupid',
  SHOOT: 'action_shoot',
  PASS_BADGE: 'action_passBadge',
  ASSIGN_ORDER: 'action_assignOrder',
  SHERIFF_CAMPAIGN: 'action_sheriff_campaign',
  WITHDRAW: 'action_withdraw',
  LAST_WORDS: 'action_last_words',
  EXPLODE: 'action_explode',
  DAY_DISCUSS: 'action_day_discuss',
  NIGHT_WEREWOLF_DISCUSS: 'action_night_werewolf_discuss',
  SHERIFF_SPEECH: 'action_sheriff_speech',
  SHERIFF_VOTE: 'action_sheriff_vote',
  DAY_VOTE: 'action_day_vote',
  POST_VOTE: 'action_post_vote',
  NIGHT_WEREWOLF_VOTE: 'action_night_werewolf_vote'
};

const CAMP = {
  GOOD: 'good',
  WOLF: 'wolf',
  THIRD: 'third'
};

const VISIBILITY = {
  PUBLIC: 'public',
  SELF: 'self',
  CAMP: 'camp',
  COUPLE: 'couple',
  COUPLE_IDENTITY: 'coupleIdentity',
  CUPID_IDENTITY: 'cupidIdentity'
};

const MSG = {
  PHASE_START: 'phase_start',
  SPEECH: 'speech',
  VOTE: 'vote',
  ACTION: 'action',
  SYSTEM: 'system',
  DEATH_ANNOUNCE: 'death_announce',
  WOLF_VOTE_RESULT: 'wolf_vote_result',
  SHERIFF_CANDIDATES: 'sheriff_candidates',
  GAME_OVER: 'game_over',
  ACTION_REQUIRED: 'action_required'
};

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
  presetList: document.getElementById('preset-list'),
  presetLocked: document.getElementById('preset-locked'),
  presetLockedName: document.getElementById('preset-locked-name'),
  readyBtn: document.getElementById('ready-btn'),
  presetPanel: document.getElementById('preset-panel'),
  presetPanelName: document.getElementById('preset-panel-name'),
  presetPanelRoles: document.getElementById('preset-panel-roles'),
  presetPanelRules: document.getElementById('preset-panel-rules')
};

// 当前行动请求
let currentAction = null;

// 板子列表
let presets = {};
let selectedPresetId = null;
let presetPanelOpen = false;
let lockedPresetId = null; // 当前被锁定的板子ID（第一个玩家选的）

// 服务器配置（从API获取）
let SERVER_DEBUG_MODE = false;

// 初始化
async function init() {
  if (window.frontendLogger) {
    window.frontendLogger.debug('初始化狼人杀游戏...');
  }

  elements.readyBtn.addEventListener('click', ready);
  elements.sendBtn.addEventListener('click', sendSpeech);
  elements.speechInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendSpeech();
  });

  // 头部点击展开板子信息
  document.getElementById('header').addEventListener('click', togglePresetPanel);

  // 点击面板外区域关闭面板
  document.addEventListener('click', (e) => {
    if (presetPanelOpen && !document.getElementById('header').contains(e.target) && !elements.presetPanel.contains(e.target)) {
      presetPanelOpen = false;
      elements.presetPanel.classList.remove('visible');
      elements.presetPanel.classList.add('hidden');
    }
  });

  // 设置状态变更回调
  controller.onStateChange = updateUI;

  // 设置行动请求回调
  controller.onActionRequired = handleActionRequired;

  // 加载板子列表
  await loadPresets();

  // 初始化 UI（确保 debug-role-group 等组件初始状态正确）
  updateUI();

  // 在登录页面时轮询板子锁定状态（每2秒检查一次，加入游戏后停止）
  window._presetPollTimer = setInterval(async () => {
    if (elements.setupPanel.classList.contains('hidden')) {
      clearInterval(window._presetPollTimer);
      return;
    }
    try {
      const res = await fetch('/api/presets');
      const data = await res.json();
      const newLockedId = data.currentPresetId || null;
      if (newLockedId !== lockedPresetId) {
        lockedPresetId = newLockedId;
        if (lockedPresetId) {
          selectedPresetId = lockedPresetId;
          renderPresetList(lockedPresetId);
          updateDebugRoleSelect(presets[lockedPresetId]?.roles);
        }
      }
    } catch (e) { /* ignore */ }
  }, 2000);

  // 检查 URL 是否有名字参数
  const urlParams = new URLSearchParams(window.location.search);
  const nameFromUrl = urlParams.get('name');
  if (nameFromUrl) {
    elements.playerNameInput.value = nameFromUrl;
    autoJoin(nameFromUrl);
  }
}

// 加载板子列表
async function loadPresets() {
  try {
    const res = await fetch('/api/presets');
    const data = await res.json();
    SERVER_DEBUG_MODE = data.debugMode || false;
    presets = data.presets || {};
    // 如果已有玩家选了板子，锁定为该板子；否则默认选中第一个
    lockedPresetId = data.currentPresetId || null;
    if (lockedPresetId) {
      selectedPresetId = lockedPresetId;
    } else {
      const firstPresetId = Object.keys(presets)[0];
      if (firstPresetId) {
        selectedPresetId = firstPresetId;
      }
    }
    renderPresetList(lockedPresetId);
    updateDebugRoleSelect(presets[selectedPresetId]?.roles);
    // 根据 debug 模式显示/隐藏 debug 组件
    const debugRoleGroup = document.getElementById('debug-role-group');
    if (debugRoleGroup && SERVER_DEBUG_MODE) {
      debugRoleGroup.classList.remove('hidden');
    }
  } catch (e) {
    if (window.frontendLogger) {
      window.frontendLogger.error('加载板子列表失败: ' + e.message);
    }
  }
}

// 渲染板子列表
function renderPresetList(lockedPresetId = null) {
  window.frontendLogger.info(`[renderPresetList] lockedPresetId=${lockedPresetId}, presets count=${Object.keys(presets).length}`);
  if (!elements.presetList) {
    window.frontendLogger.warn('[renderPresetList] elements.presetList is null');
    return;
  }
  elements.presetList.innerHTML = '';
  for (const [id, preset] of Object.entries(presets)) {
    const div = document.createElement('div');
    const isSelected = selectedPresetId === id;
    const isLocked = lockedPresetId !== null;
    const isLockedSelected = isLocked && id === lockedPresetId;

    div.className = 'preset-option' + (isSelected || isLockedSelected ? ' selected' : '');
    if (isLocked && !isLockedSelected) {
      div.classList.add('disabled');
    }
    window.frontendLogger.info(`[renderPresetList] id=${id}, isSelected=${isSelected}, isLocked=${isLocked}, isLockedSelected=${isLockedSelected}, className=${div.className}`);
    div.dataset.presetId = id;

    const roleSummary = summarizeRoles(preset.roles);
    const rulesHtml = preset.ruleDescriptions.map(r => `<div class="preset-rule">· ${r}</div>`).join('');

    div.innerHTML = `
      <div class="preset-name">${preset.name}</div>
      <div class="preset-desc">${preset.description}</div>
      <div class="preset-roles">${roleSummary}</div>
      <div class="preset-rules">${rulesHtml}</div>
    `;
    div.addEventListener('click', () => {
      if (isLocked && !isLockedSelected) return; // 锁定状态下不能选择其他板子
      selectedPresetId = id;
      renderPresetList(lockedPresetId);
      updateDebugRoleSelect(presets[id]?.roles);
    });
    elements.presetList.appendChild(div);
  }
}

// 更新 Debug 角色选择下拉框
function updateDebugRoleSelect(roles) {
  const debugRoleSelect = document.getElementById('debug-role-select');
  if (!debugRoleSelect || !roles) return;

  const uniqueRoles = [...new Set(roles)];
  let optionsHtml = '<option value="">随机</option>';
  for (const role of uniqueRoles) {
    const roleName = ROLE_NAMES[role] || role;
    optionsHtml += `<option value="${role}">${roleName}</option>`;
  }
  debugRoleSelect.innerHTML = optionsHtml;
}

// 角色概览文本
function summarizeRoles(roles) {
  const counts = {};
  const ROLE_NAMES = { werewolf: '狼人', seer: '预言家', witch: '女巫', hunter: '猎人', guard: '守卫', villager: '村民', idiot: '白痴', cupid: '丘比特' };
  for (const r of roles) {
    counts[r] = (counts[r] || 0) + 1;
  }
  return Object.entries(counts).map(([id, n]) => `${ROLE_NAMES[id] || id}${n > 1 ? n : ''}`).join(' / ');
}

// 锁定板子显示
function showPresetLocked(presetId) {
  window.frontendLogger.info(`[showPresetLocked] presetId=${presetId}, presets=${Object.keys(presets)}`);
  const preset = presets[presetId];
  if (!preset) {
    window.frontendLogger.warn(`[showPresetLocked] 找不到 preset: ${presetId}`);
    return;
  }
  // 显示板子列表但禁用非选中的选项
  if (elements.presetList) elements.presetList.classList.remove('hidden');
  if (elements.presetLocked) elements.presetLocked.classList.add('hidden');
  // 重新渲染列表，传入锁定的 presetId
  renderPresetList(presetId);
}

// 自动加入
async function autoJoin(name) {
  const urlParams = new URLSearchParams(window.location.search);
  const presetFromUrl = urlParams.get('preset') || selectedPresetId || '9-standard';
  const result = await controller.join(name, presetFromUrl);
  if (result.success) {
    elements.setupPanel.classList.add('hidden');
    updateUI();
  }
}

// 切换板子信息面板
function togglePresetPanel() {
  const state = controller.getState();
  if (!state?.preset) return;

  presetPanelOpen = !presetPanelOpen;

  if (presetPanelOpen) {
    renderPresetPanel(state.preset);
    elements.presetPanel.classList.add('visible');
    elements.presetPanel.classList.remove('hidden');
  } else {
    elements.presetPanel.classList.remove('visible');
    elements.presetPanel.classList.add('hidden');
  }
}

// 渲染板子信息面板
function renderPresetPanel(preset) {
  if (!elements.presetPanelName) return;
  const roleSummary = summarizeRoles(preset.roles);
  const rulesHtml = (preset.ruleDescriptions || []).map(r => `<div>· ${r}</div>`).join('');

  elements.presetPanelName.textContent = preset.name;
  elements.presetPanelRoles.textContent = roleSummary;
  elements.presetPanelRules.innerHTML = rulesHtml;
}

// 准备
async function ready() {
  const name = elements.playerNameInput.value.trim() || `玩家${Date.now() % 1000}`;
  const presetId = selectedPresetId || '9-standard';

  // 停止板子状态轮询
  clearInterval(window._presetPollTimer);

  // 获取 Debug 模式选择的角色
  const debugRoleSelect = document.getElementById('debug-role-select');
  const debugRole = debugRoleSelect ? debugRoleSelect.value : null;

  const result = await controller.join(name, presetId, debugRole || null);
  if (result.error) {
    showError(result.error);
    return;
  }

  // 更新 URL
  const url = new URL(window.location);
  url.searchParams.set('name', name);
  url.searchParams.set('preset', presetId);
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
  if (window.frontendLogger) {
    window.frontendLogger.debug(`[UI] 行动请求: ${d.action}, requestId: ${d.requestId}, allowedTargets: ${JSON.stringify(d.allowedTargets)}`);
  }

  // 根据行动类型显示不同的 UI
  const state = controller.getState();
  const myPlayer = controller.getMyPlayer();

  if (window.frontendLogger) {
    window.frontendLogger.debug(`[UI] myPlayer: ${myPlayer ? myPlayer.name + '(id=' + myPlayer.id + ',isAI=' + myPlayer.isAI + ')' : 'null'}, playerName: ${controller.playerName}, players: ${state?.players?.map(p => p.name + '(id=' + p.id + ',isAI=' + p.isAI + ')').join(', ')}`);
  }

  if (!myPlayer) return;

  // 清空之前的按钮
  elements.voteButtons.innerHTML = '';
  elements.skillButtons.innerHTML = '';

  switch (d.action) {
    case ACTION.LAST_WORDS:
    case ACTION.DAY_DISCUSS:
    case ACTION.NIGHT_WEREWOLF_DISCUSS:
    case ACTION.SHERIFF_SPEECH:
      elements.actionInput.classList.add('active');
      elements.actionPrompt.textContent = '轮到你发言了';
      break;

    case ACTION.DAY_VOTE:
    case ACTION.POST_VOTE:
    case ACTION.NIGHT_WEREWOLF_VOTE:
    case ACTION.SHERIFF_VOTE:
      elements.voteButtons.classList.add('active');
      elements.actionPrompt.textContent = d.action === ACTION.NIGHT_WEREWOLF_VOTE ? '请选择刀人目标' : (d.action === ACTION.SHERIFF_VOTE ? '请投票选警长' : '请投票');
      if (window.frontendLogger) {
        window.frontendLogger.debug(`[Vote] 可选目标: ${JSON.stringify(d.allowedTargets)}`);
      }
      renderVoteButtons(state, myPlayer, d.allowedTargets, d.action);
      break;

    case ACTION.GUARD:
      elements.skillButtons.classList.add('active');
      elements.actionPrompt.textContent = '请选择守护目标';
      // 守卫不能连守同一人，传入上一晚的目标
      const guardDisabledIds = d.lastGuardTarget ? [d.lastGuardTarget] : [];
      // 使用后端传来的 allowedTargets（包含自己）
      renderTargetButtons(state, myPlayer, 1, { allowedTargets: d.allowedTargets, disabledIds: guardDisabledIds });
      break;

    case ACTION.WITCH:
      elements.skillButtons.classList.add('active');
      elements.actionPrompt.textContent = '女巫行动';
      renderWitchButtons(state, myPlayer, d);
      break;

    case ACTION.SHERIFF_CAMPAIGN:
      elements.skillButtons.classList.add('active');
      elements.actionPrompt.textContent = '是否竞选警长？';
      renderCampaignButtons();
      break;

    case ACTION.WITHDRAW:
      elements.skillButtons.classList.add('active');
      elements.actionPrompt.textContent = '是否退水？';
      renderWithdrawButtons();
      break;

    case ACTION.ASSIGN_ORDER:
      elements.skillButtons.classList.add('active');
      elements.actionPrompt.textContent = '请指定发言顺序';
      renderSpeakerOrderUI(state);
      break;

    case ACTION.SHOOT:
      elements.skillButtons.classList.add('active');
      elements.actionPrompt.textContent = '猎人请选择开枪目标';
      renderTargetButtons(state, myPlayer, 1);
      break;

    case ACTION.CUPID:
      elements.skillButtons.classList.add('active');
      elements.actionPrompt.textContent = '请选择连接为情侣的两名玩家';
      renderTargetButtons(state, myPlayer, 2, { canSelectSelf: true });
      break;

    case ACTION.SEER:
      elements.skillButtons.classList.add('active');
      elements.actionPrompt.textContent = '请选择查验目标';
      // 从 state 计算 allowedTargets：排除自己、已查验的、死亡的
      const checkedIds = (state.self?.seerChecks || []).map(c => c.targetId);
      const allowedTargets = state.players
        .filter(p => p.id !== myPlayer.id && p.alive && !checkedIds.includes(p.id))
        .map(p => p.id);
      renderTargetButtons(state, myPlayer, 1, { allowedTargets });
      break;

    case ACTION.PASS_BADGE:
      elements.skillButtons.classList.add('active');
      elements.actionPrompt.textContent = '警长请选择传警徽对象（或选择不传）';
      // 使用后端传来的 allowedTargets
      const passBadgeTargets = d.allowedTargets
        ? state.players.filter(p => d.allowedTargets.includes(p.id))
        : state.players.filter(p => p.alive && p.id !== myPlayer.id);
      renderPassBadgeButtons(passBadgeTargets);
      break;

    default:
      if (window.frontendLogger) {
        window.frontendLogger.warn(`[UI] 未知行动类型: ${d.action}`);
      }
  }
}

// 渲染投票按钮
function renderVoteButtons(state, myPlayer, allowedTargets, actionType) {
  // 如果限制了投票目标，只显示允许的目标
  const candidates = allowedTargets
    ? state.players.filter(p => p.alive && allowedTargets.includes(p.id))
    : state.players.filter(p => p.alive && p.id !== myPlayer.id);

  // 判断是否是狼人投票，以及自己是不是狼人
  const isWolfVote = actionType === ACTION.NIGHT_WEREWOLF_VOTE;
  // 优先从 state.self 获取，如果没有则从 players 数组中查找
  let myCamp = state.self?.role?.camp;
  if (!myCamp && myPlayer?.id) {
    const me = state.players.find(p => p.id === myPlayer.id);
    myCamp = me?.role?.camp;
  }
  const isWolf = myCamp === CAMP.WOLF;

  candidates.forEach(player => {
    const pos = player.id;
    const btn = document.createElement('button');
    btn.className = 'vote-btn';

    // 狼人投票时，如果是狼人队友显示红色
    const isTeammate = player.role?.camp === CAMP.WOLF;
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
  const canSelectSelf = extraData.canSelectSelf;  // 是否可以选择自己（如丘比特）
  const allButtons = [];  // 保存所有按钮引用

  // 如果有 allowedTargets，只显示这些玩家；否则显示所有其他存活玩家
  let candidates;
  if (allowedTargets && allowedTargets.length > 0) {
    candidates = state.players.filter(p => allowedTargets.includes(p.id));
  } else {
    // 如果 canSelectSelf 为 true，则允许选择自己
    candidates = state.players.filter(p => p.alive && (canSelectSelf || p.id !== myPlayer.id));
  }

  candidates.forEach(player => {
    const pos = player.id;
    const btn = document.createElement('button');
    btn.className = 'skill-btn';
    btn.textContent = `${pos}号 ${player.name}`;
    btn.dataset.playerId = player.id;

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

      // 更新所有按钮状态（多选时选够禁用其他）
      updateAllButtons();

      // 如果只选一个，直接响应
      if (count === 1 && selected.length === 1) {
        controller.respond(currentAction.data.requestId, { targetId: selected[0] });
        clearActionUI();
      }
    });
    elements.skillButtons.appendChild(btn);
    allButtons.push(btn);
  });

  // 多选确认按钮
  let confirmBtn = null;
  if (count > 1) {
    confirmBtn = document.createElement('button');
    confirmBtn.className = 'skill-btn';
    confirmBtn.disabled = true;
    confirmBtn.textContent = `确认选择 (${selected.length}/${count})`;
    confirmBtn.addEventListener('click', () => {
      if (selected.length === count) {
        controller.respond(currentAction.data.requestId, { targetIds: selected });
        clearActionUI();
      }
    });
    elements.skillButtons.appendChild(confirmBtn);
  }

  // 更新所有按钮状态
  function updateAllButtons() {
    // 更新确认按钮状态
    if (confirmBtn) {
      confirmBtn.textContent = `确认选择 (${selected.length}/${count})`;
      confirmBtn.disabled = selected.length !== count;
    }

    // 多选时选够数量，禁用其他未选中的按钮
    if (count > 1) {
      allButtons.forEach(btn => {
        if (selected.length >= count) {
          if (!btn.classList.contains('selected')) {
            btn.disabled = true;
            btn.classList.add('disabled');
          }
        } else {
          // 取消选中时重新启用
          if (!disabledIds.includes(parseInt(btn.dataset.playerId))) {
            btn.disabled = false;
            btn.classList.remove('disabled');
          }
        }
      });
    }
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
    const pos = player.id;
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

    // 检查是否可以自救（仅首夜可以自救）
    const canSelfHeal = d.canSelfHeal !== false;

    const targetPos = d.werewolfTarget;
    if (isSelfTargeted && !canSelfHeal) {
      elements.actionPrompt.innerHTML = `<strong>今晚 ${targetPos}号${target?.name || '某人'} 被狼人杀害！（非首夜不能自救）</strong>`;
    } else {
      elements.actionPrompt.innerHTML = `<strong>今晚 ${targetPos}号${target?.name || '某人'} 被狼人杀害！</strong>`;
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

    // 非首夜不能自救
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
      const pos = player.id;
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
    const pos = player.id;
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
  if (!state) {
    window.frontendLogger.warn('[updateUI] state is null, return');
    return;
  }

  // 游戏结束时清除当前行动，确保能显示结算页面
  if (state.phase === 'game_over' && currentAction) {
    clearActionUI();
  }

  window.frontendLogger.info(`[updateUI] presetLocked=${state.presetLocked}, presetId=${state.presetId}, phase=${state.phase}`);

  // Debug 模式：根据板子角色更新选项（debug组件显示已在loadPresets中处理）
  if (SERVER_DEBUG_MODE && state.boardRoles) {
    updateDebugRoleSelect(state.boardRoles);
  }

  updateHeader(state);
  updatePlayers(state);
  updateMessages();

  // 如果没有行动请求，且 state 中也没有待处理的行动请求，才更新默认操作区
  // 注意：state.pendingAction 可能在 updateUI 之后才被处理（通过 onActionRequired）
  if (!currentAction && !state.pendingAction) {
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
    const total = state.playerCount || state.preset?.playerCount || 9;
    phaseText = `等待玩家加入 (${current}/${total})`;
    // 板子锁定：禁用选择器
    window.frontendLogger.info(`[updateHeader] phase=${state.phase}, presetLocked=${state.presetLocked}, presetId=${state.presetId}, players=${state.players?.length}`);
    if (state.presetLocked && state.presetId) {
      window.frontendLogger.info(`[updateHeader] 调用 showPresetLocked, presetId=${state.presetId}`);
      showPresetLocked(state.presetId);
    }
  }
  // 游戏中头部显示板子名称
  if (state.preset && state.phase !== 'waiting') {
    phaseText = state.preset.name + ' ▾ | ' + phaseText;
  }
  elements.phaseInfo.textContent = phaseText;

  if (state.dayCount > 0) {
    const isNight = ['cupid', 'guard', 'night_werewolf_discuss', 'night_werewolf_vote', 'witch', 'seer'].includes(state.phase);
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
      const partnerPos = state.self.couplePartner;
      roleHtml += ` <span class="couple-info">情侣: ${partnerPos}号</span>`;
    }

    if (myPlayer.role.camp === CAMP.WOLF || myPlayer.role.id === 'werewolf') {
      const teammates = state.players
        .filter(p => (p.role?.camp === CAMP.WOLF || p.role?.id === 'werewolf') && p.id !== myPlayer.id)
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
  const total = state.playerCount || state.preset?.playerCount || 9;
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
      } else if (myPlayer && (myPlayer.role.camp === CAMP.WOLF || myPlayer.role === 'werewolf') && (player.role.camp === CAMP.WOLF || player.role === 'werewolf')) {
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
    const pos = msg.playerId;
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
        const pos = Number(playerId);
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
    if (window.frontendLogger) {
      window.frontendLogger.info(`[Death] msg: ${JSON.stringify(msg)}`);
    }
    // 显示死亡消息（不显示死亡原因）
    let content = '<div class="death-announce">';
    msg.deaths.forEach(d => {
      const pos = d.id;
      content += `<div>${pos}号${d.name} 死亡</div>`;
    });
    content += '</div>';
    addMessage(content, 'system death', msg.id);
  } else if (msg.type === MSG.ACTION || msg.type === MSG.SYSTEM) {
    // 私有消息（visibility: 'self'）显示给玩家自己
    if (msg.visibility === VISIBILITY.SELF) {
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
  // 解析消息中的标签
  const parsedContent = window.MessageParser
    ? window.MessageParser.parseMessageContent(content)
    : content;
  const msg = document.createElement('div');
  msg.className = `message ${className}`;
  if (id) msg.dataset.msgId = id;
  msg.innerHTML = `<div class="message-content">${parsedContent.replace(/\n/g, '<br>')}</div>`;
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
    const total = state.playerCount || state.preset?.playerCount || 9;
    elements.actionPrompt.textContent = current < total ? `等待玩家加入... (${current}/${total})` : '人已齐，即将开始...';
    return;
  }

  if (state.phase === 'game_over') {
    let winnerText = '';
    switch (state.winner) {
      case CAMP.WOLF:
        winnerText = '狼人阵营获胜！';
        break;
      case CAMP.GOOD:
        winnerText = '好人阵营获胜！';
        break;
      case CAMP.THIRD:
        winnerText = '第三方（情侣）获胜！';
        break;
      default:
        winnerText = '游戏结束';
    }

    // 死亡原因映射
    const DEATH_REASONS = {
      wolf: '被狼人击杀',
      poison: '被女巫毒杀',
      conflict: '同守同救',
      vote: '被放逐',
      hunter: '被猎人带走',
      couple: '殉情'
    };

    // 显示获胜信息和所有玩家身份
    let gameOverHtml = `<div class="game-over"><strong>${winnerText}</strong>`;
    gameOverHtml += '<div class="all-roles">';
    if (state.gameOverInfo && state.gameOverInfo.players) {
      state.gameOverInfo.players.forEach((p, idx) => {
        // 使用后端传来的 display，fallback 用索引计算位置
        const display = p.display || `${idx + 1}号${p.name}`;
        const roleName = p.role ? ROLE_NAMES[p.role.id] || p.role.id : '未知';
        const deathInfo = p.alive ? '存活' : (p.deathReason ? `死亡(${DEATH_REASONS[p.deathReason] || p.deathReason})` : '死亡');
        const sheriffMark = p.isSheriff ? ' 🏅警长' : '';
        const coupleMark = p.isCouple ? ' 💕情侣' : '';
        gameOverHtml += `<div>${display}: ${roleName} - ${deathInfo}${sheriffMark}${coupleMark}</div>`;
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