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
  NIGHT_WEREWOLF_VOTE: 'action_night_werewolf_vote',
  CHAT: 'action_chat'
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
  playersLeft: document.getElementById('players-left'),
  playersRight: document.getElementById('players-right'),
  messages: document.getElementById('messages'),
  messagesSection: document.getElementById('messages-section'),
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
  readyBtn: document.getElementById('ready-btn'),
  presetPanel: document.getElementById('preset-panel'),
  presetPanelName: document.getElementById('preset-panel-name'),
  presetPanelRoles: document.getElementById('preset-panel-roles'),
  presetPanelRules: document.getElementById('preset-panel-rules'),
  waitingRoom: document.getElementById('waiting-room'),
  waitingPreset: document.getElementById('waiting-preset'),
  waitingPlayers: document.getElementById('waiting-players')
};

// 当前行动请求
let currentAction = null;
let messagesInitialized = false;
let lastPhase = null;
let nightTransitionShown = false;

function isNearBottom(el, threshold = 80) {
  return el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
}

function scrollToBottomIfNear(el) {
  if (isNearBottom(el)) {
    el.scrollTop = el.scrollHeight;
  }
}

// 板子列表
let presets = {};
let selectedPresetId = null;
let presetPanelOpen = false;
let lockedPresetId = null; // 当前被锁定的板子ID（第一个玩家选的）

// 服务器配置（从API获取）
let SERVER_DEBUG_MODE = false;

// AI 角色详情弹窗
function showProfilePopup(profileName, profile) {
  const popup = document.getElementById('profile-popup');
  const art = document.getElementById('profile-popup-art');
  const nameEl = document.getElementById('profile-popup-name');
  const detailEl = document.getElementById('profile-popup-detail');
  if (!popup || !art || !nameEl || !detailEl) return;

  art.src = `/profiles/${profileName}/${profile.splashArt || 'splash_art.webp'}`;
  nameEl.textContent = profile.name || profileName;
  let detail = '';
  if (profile.englishName) detail += `${profile.englishName}`;
  if (profile.faction) detail += ` | ${profile.faction}`;
  if (profile.path) detail += ` | ${profile.path}`;
  if (profile.element) detail += ` | ${profile.element}`;
  detailEl.textContent = detail;

  popup.classList.remove('hidden');
}

function closeProfilePopup() {
  const popup = document.getElementById('profile-popup');
  if (popup) popup.classList.add('hidden');
}

// 发言立绘滑入滑出
let speakerArtTimeout = null;
function showSpeakerArt(profileName, splashArt) {
  const el = document.getElementById('speaker-art');
  if (!el) return;
  const img = el.querySelector('img');
  if (!img) return;

  if (speakerArtTimeout) {
    clearTimeout(speakerArtTimeout);
    speakerArtTimeout = null;
  }

  img.src = `/profiles/${profileName}/${splashArt}`;
  el.classList.remove('hidden', 'slide-out');
  el.classList.add('slide-in');

  speakerArtTimeout = setTimeout(() => {
    el.classList.remove('slide-in');
    el.classList.add('slide-out');
    speakerArtTimeout = setTimeout(() => {
      el.classList.add('hidden');
      el.classList.remove('slide-out');
      speakerArtTimeout = null;
    }, 300);
  }, 1500);
}

// 天黑请闭眼转场
function showNightTransition() {
  const el = document.getElementById('night-transition');
  if (!el) return;

  // 重置字符动画
  el.querySelectorAll('.transition-char').forEach(ch => {
    ch.style.animation = 'none';
    ch.offsetHeight;
    ch.style.animation = '';
  });

  el.classList.remove('hidden', 'fade-out');

  // 2.5s 后淡出
  setTimeout(() => {
    el.classList.add('fade-out');
    setTimeout(() => {
      el.classList.add('hidden');
      el.classList.remove('fade-out');
    }, 500);
  }, 2500);
}

// 初始化
async function init() {
  if (window.frontendLogger) {
    window.frontendLogger.debug('初始化狼人杀游戏...');
  }

  try {
  elements.sendBtn.addEventListener('click', sendSpeech);
  elements.speechInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendSpeech();
  });

  // 加入游戏按钮
  document.getElementById('join-game-btn').addEventListener('click', () => {
    controller.sendSwitchRole('player');
  });

  // 开始游戏按钮（全 AI）
  document.getElementById('start-game-btn').addEventListener('click', () => {
    const btn = document.getElementById('start-game-btn');
    btn.disabled = true;
    btn.textContent = '开始中...';
    controller.sendStartGame();
  });

  document.getElementById('restart-btn').addEventListener('click', async () => {
    nightTransitionShown = false;
    messagesInitialized = false;
    await controller.reset();
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
    // 关闭板子下拉
    if (elements.waitingPreset && !elements.waitingPreset.contains(e.target)) {
      elements.waitingPreset.classList.remove('open');
    }
  });

  // 设置状态变更回调
  controller.onStateChange = updateUI;
  controller.onActionRequired = handleActionRequired;
  controller.onGameReady = handleGameReady;

  // 设置面板：输入名字后加入
  elements.readyBtn.addEventListener('click', ready);
  elements.playerNameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') ready();
  });

  // AI 头像点击弹窗关闭
  document.getElementById('profile-popup-overlay')?.addEventListener('click', closeProfilePopup);
  document.getElementById('profile-popup-close')?.addEventListener('click', closeProfilePopup);

  // 观战者视角切换
  document.querySelectorAll('#spectator-view-bar .view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      controller.spectatorView = view;
      controller.sendSwitchView(view);
      document.querySelectorAll('#spectator-view-bar .view-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      rerenderMessages();
    });
  });

  // 加载板子列表
  await loadPresets();

  // 检查 URL 是否有名字参数，有则自动加入
  const urlParams = new URLSearchParams(window.location.search);
  const nameFromUrl = urlParams.get('name');
  if (nameFromUrl) {
    elements.playerNameInput.value = nameFromUrl;
    ready();
  } else {
    // 显示名字输入面板
    elements.setupPanel.classList.remove('hidden');
  }

  if (window.frontendLogger) {
    window.frontendLogger.debug('初始化完成');
  }
  } catch(e) {
    if (window.frontendLogger) {
      window.frontendLogger.error('初始化失败: ' + e.message + ' stack: ' + e.stack);
    }
    // 即使出错也显示设置面板
    elements.setupPanel.classList.remove('hidden');
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
      window.frontendLogger.error('加载板子列表失败: ' + e.message + ' stack: ' + (e.stack || ''));
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
      if (isLocked && !isLockedSelected) return;
      selectedPresetId = id;
      renderPresetList(lockedPresetId);
      updateDebugRoleSelect(presets[id]?.roles);

      // 等待阶段：发送切换板子消息
      const state = controller.getState();
      if (state && state.phase === 'waiting' && controller.playerName) {
        controller.sendChangePreset(id);
      }
    });
    elements.presetList.appendChild(div);
  }
}

function buildDebugRoleOptionValues(roles, selectedRole) {
  const uniqueRoles = [...new Set(roles)];
  let html = '<option value="">随机</option>';
  for (const role of uniqueRoles) {
    const roleName = ROLE_NAMES[role] || role;
    html += `<option value="${role}"${role === selectedRole ? ' selected' : ''}>${roleName}</option>`;
  }
  return html;
}

function updateDebugRoleSelect(roles) {
  const debugRoleSelect = document.getElementById('debug-role-select');
  if (!debugRoleSelect || !roles) return;
  debugRoleSelect.innerHTML = buildDebugRoleOptionValues(roles);
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

// 切换板子信息面板（游戏中）
function togglePresetPanel() {
  const state = controller.getState();

  // 等待阶段：板子选择器已在 waiting-room 中，不弹面板
  if (state?.phase === 'waiting') {
    return;
  }

  // 游戏中：显示当前板子信息
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

  if (elements.presetList) elements.presetList.innerHTML = '';
}

// 加入房间（输入名字后点击"准备"）
async function ready() {
  const name = elements.playerNameInput.value.trim() || `玩家${Date.now() % 1000}`;
  const presetId = selectedPresetId || '9-standard';
  const debugRoleSelect = document.getElementById('debug-role-select');
  const debugRole = (SERVER_DEBUG_MODE && debugRoleSelect && debugRoleSelect.value) || null;

  const result = await controller.join(name, presetId, debugRole);
  if (result.error) {
    showError(result.error);
    return;
  }

  // 更新 URL
  const url = new URL(window.location);
  url.searchParams.set('name', name);
  window.history.replaceState({}, '', url);

  elements.setupPanel.classList.add('hidden');

  updateUI();
}

// 准备/取消准备（房间内）
function toggleReady() {
  const state = controller.getState();
  const myPlayer = controller.getMyPlayer();
  if (!myPlayer) return;

  if (myPlayer.ready) {
    controller.sendUnready();
  } else {
    controller.sendReady();
  }
}

// 处理行动请求
function handleActionRequired(msg) {
  currentAction = msg;
  document.body.classList.add('has-action');
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
      elements.speechInput.placeholder = '输入发言内容...';
      elements.speechInput.disabled = false;
      elements.sendBtn.disabled = false;
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
  document.body.classList.remove('has-action');
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

  const state = controller.getState();

  // waiting / game_over 阶段走 chat 通道
  if (state && (state.phase === 'waiting' || state.phase === 'game_over')) {
    controller.sendChat(content);
    elements.speechInput.value = '';
    return;
  }

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

// 渲染聊天消息
function renderChatMessage(msg, state) {
  const msgId = msg.displayId || msg.id;
  if (document.querySelector(`[data-msg-id="${msgId}"]`)) return;

  // 游戏简讯分割线
  if (msg.type === 'game_brief') {
    const tpl = document.getElementById('tpl-game-brief');
    const el = tpl.content.cloneNode(true).querySelector('.game-brief-divider');
    el.dataset.msgId = msgId;
    el.querySelector('.game-brief-content').textContent = msg.content;
    elements.messages.appendChild(el);
    return;
  }

  const myPlayer = controller.getMyPlayer();
  const isSelf = (myPlayer && msg.playerId == myPlayer.id) || (msg.playerName && msg.playerName === controller.playerName);
  const player = state?.players?.find(p => p.id == msg.playerId);
  const isAI = msg.isAI || (player && player.isAI);

  const avatarSrc = isAI && player && player.profileName
    ? `/profiles/${player.profileName}/${player.profile?.icon || 'icon.webp'}`
    : '/assets/masks/fools_mask.webp';

  const parsedContent = window.MessageParser
    ? window.MessageParser.parseMessageContent(msg.content)
    : msg.content;

  // @提及高亮（前缀匹配：@xxyyww 可匹配玩家 xx）
  const playerNames = (state?.players || []).map(p => p.name).filter(Boolean);
  playerNames.sort((a, b) => b.length - a.length);
  let highlightedContent = '';
  let i = 0;
  while (i < parsedContent.length) {
    if (parsedContent[i] === '@') {
      const textAfterAt = parsedContent.slice(i + 1);
      let matched = false;
      for (const name of playerNames) {
        if (textAfterAt.startsWith(name)) {
          highlightedContent += `@<span class="chat-mention">${name}</span>`;
          i += 1 + name.length;
          matched = true;
          break;
        }
      }
      if (!matched) {
        highlightedContent += '@';
        i++;
      }
    } else {
      highlightedContent += parsedContent[i];
      i++;
    }
  }

  const tpl = document.getElementById('tpl-chat-message');
  const el = tpl.content.cloneNode(true).querySelector('.chat-message');
  el.className = `chat-message chat-room${isSelf ? ' self' : ''}`;
  el.dataset.msgId = msgId;

  el.querySelector('.chat-avatar').src = avatarSrc;
  el.querySelector('.chat-avatar').alt = msg.playerName;
  el.querySelector('.chat-name').textContent = `${msg.playerName}`;
  el.querySelector('.chat-bubble').innerHTML = highlightedContent.replace(/\n/g, '<br>');

  elements.messages.appendChild(el);
}

function handleGameReady() {
  // 开始游戏按钮已在 updateDefaultAction 的 waiting 分支中渲染
  // game_ready 事件触发时确保 UI 刷新
  const state = controller.getState();
  if (state) updateDefaultAction(state);
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

// 重新渲染消息（观战者切换视角时调用）
function rerenderMessages() {
  elements.messages.innerHTML = '';
  const messages = controller.isSpectator ? controller.getFilteredMessages() : controller.getMessageHistory();
  const state = controller.getState();
  messages.forEach(msg => {
    if (msg.source === 'chat') {
      renderChatMessage(msg, state);
    } else {
      displayMessage(msg, state);
    }
  });
}

// 渲染等待房间
function renderWaitingRoom(state) {
  if (!elements.waitingRoom || !elements.waitingPlayers) return;

  elements.waitingPlayers.innerHTML = '';
  const myPlayer = controller.getMyPlayer();
  const total = state.playerCount || state.preset?.playerCount || 9;
  const isSpectator = controller.isSpectator;

  // 渲染板子选择器
  if (elements.waitingPreset) {
    const currentPresetId = state.presetId || selectedPresetId;
    const currentPreset = presets[currentPresetId];
    const currentName = currentPreset ? currentPreset.name : '选择板子';
    const currentRoles = currentPreset ? summarizeRoles(currentPreset.roles) : '';

    let dropdownHtml = '';
    for (const [id, preset] of Object.entries(presets)) {
      const isSelected = id === currentPresetId;
      const roleSummary = summarizeRoles(preset.roles);
      const rulesHtml = (preset.ruleDescriptions || []).map(r => `<div class="preset-rule">· ${r}</div>`).join('');
      dropdownHtml += `<div class="preset-option${isSelected ? ' selected' : ''}" data-preset-id="${id}">
        <div class="preset-name">${preset.name}${isSelected ? ' ✓' : ''}</div>
        <div class="preset-desc">${preset.description || ''}</div>
        <div class="preset-roles">${roleSummary}</div>
      </div>`;
    }

    elements.waitingPreset.innerHTML = `
      <div id="waiting-preset-current">
        <span class="preset-name">${currentName}</span>
        <span class="preset-roles">${currentRoles}</span>
        <span class="preset-arrow">▼</span>
      </div>
      <div id="waiting-preset-dropdown">${dropdownHtml}</div>
    `;

    // 点击切换下拉
    const currentEl = elements.waitingPreset.querySelector('#waiting-preset-current');
    currentEl.addEventListener('click', () => {
      elements.waitingPreset.classList.toggle('open');
    });

    // 点击选项
    elements.waitingPreset.querySelectorAll('#waiting-preset-dropdown .preset-option').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.dataset.presetId;
        if (id === currentPresetId) {
          elements.waitingPreset.classList.remove('open');
          return;
        }
        selectedPresetId = id;
        controller.sendChangePreset(id);
        elements.waitingPreset.classList.remove('open');
      });
    });
  }

  // 渲染玩家卡片
  state.players?.forEach((player, index) => {
    const position = index + 1;
    const isSelf = myPlayer && player.id === myPlayer.id && !isSpectator;
    const card = document.createElement('div');
    card.className = 'waiting-card';
    if (isSelf) card.classList.add('self');
    if (player.isAI) card.classList.add('ai');
    if (player.ready) card.classList.add('ready');

    const avatarSrc = player.isAI && player.profileName
      ? `/profiles/${player.profileName}/${player.profile?.icon || 'icon.webp'}`
      : '/assets/masks/fools_mask.webp';

    const statusText = player.ready ? '✓ 已准备' : '';

    const debugRoleSelect = SERVER_DEBUG_MODE && state.preset?.roles && isSelf && !player.ready
      ? buildDebugRoleOptionValues(state.preset.roles, player.debugRole)
      : '';

    let actionsHtml = '';
    if (state.phase === 'waiting') {
      if (isSelf && !player.ready) {
        actionsHtml = `
          <div class="waiting-card-row">
            <button class="waiting-btn ready-btn" data-action="ready">准备</button>
            <button class="waiting-btn spectate-btn" data-action="spectate">去观战</button>
          </div>
        `;
      } else if (isSelf && player.ready) {
        actionsHtml = `
          <div class="waiting-card-row">
            <button class="waiting-btn unready-btn" data-action="unready">取消准备</button>
          </div>
        `;
      } else if (player.isAI) {
        actionsHtml = `
          <div class="waiting-card-row">
            <button class="waiting-btn kick-btn" data-action="kick" data-player-id="${player.id}">踢出</button>
          </div>
        `;
      }
    }

    const nameRow = `<div class="waiting-card-name-row">
          <span class="waiting-card-name${isSelf && !player.ready ? ' editable' : ''}" ${isSelf && !player.ready ? 'contenteditable="true"' : ''} data-field="name">${player.name}</span>
          ${isSelf && !player.ready ? '<span class="waiting-card-edit-hint">✏</span>' : ''}
          ${debugRoleSelect ? `<select class="debug-role-select" data-action="debug-role">${debugRoleSelect}</select>` : ''}
        </div>`;
    const statusRow = statusText ? `<div class="waiting-card-status">${statusText}</div>` : '';

    card.innerHTML = `
      <img class="player-avatar" src="${avatarSrc}" alt="${player.name}" onerror="this.src='/assets/masks/fools_mask.webp'">
      <div class="waiting-card-body">
        ${nameRow}
        ${statusRow}
        ${actionsHtml}
      </div>
    `;

    // AI 玩家点击头像弹出详情
    if (player.isAI && player.profileName && player.profile) {
      card.querySelector('.player-avatar').style.cursor = 'pointer';
      card.querySelector('.player-avatar').addEventListener('click', () => {
        showProfilePopup(player.profileName, player.profile);
      });
    }

    // AI 玩家踢出按钮
    if (player.isAI && state.phase === 'waiting') {
      const kickBtn = card.querySelector('[data-action="kick"]');
      if (kickBtn) {
        kickBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          controller.removeAI(Number(kickBtn.dataset.playerId));
        });
      }
          }

    // 绑定自己卡片上的操作按钮
    if (isSelf) {
      card.addEventListener('click', (e) => {
        const target = e.target;
        const action = target.dataset?.action;
        if (action === 'ready') {
          controller.sendReady();
        } else if (action === 'unready') {
          controller.sendUnready();
        } else if (action === 'spectate') {
          controller.sendSpectate();
        }
      });

      // Debug 选角
      const debugRoleSelect = card.querySelector('[data-action="debug-role"]');
      if (debugRoleSelect) {
        debugRoleSelect.addEventListener('change', (e) => {
          e.stopPropagation();
          controller.sendChangeDebugRole(e.target.value || null);
        });
      }

      // 改名（contenteditable）
      const nameEl = card.querySelector('.waiting-card-name.editable');
      if (nameEl) {
        nameEl.addEventListener('blur', () => {
          const newName = nameEl.textContent.trim();
          if (newName && newName !== player.name) {
            controller.sendChangeName(newName);
            const url = new URL(window.location);
            url.searchParams.set('name', newName);
            window.history.replaceState({}, '', url);
          }
        });
        nameEl.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            nameEl.blur();
          }
        });
        nameEl.addEventListener('click', (e) => e.stopPropagation());
      }
    }

    elements.waitingPlayers.appendChild(card);
  });

  // 空位卡片
  if (state.phase === 'waiting') {
    const currentCount = state.players?.length || 0;
    for (let i = currentCount; i < total; i++) {
      const position = i + 1;
      const emptyCard = document.createElement('div');
      emptyCard.className = 'waiting-card empty-slot';
      emptyCard.innerHTML = `
        <img class="player-avatar" src="/assets/masks/aeon_aha.webp" alt="空位" style="opacity: 0.3;">
        <div class="waiting-card-info">
          <div class="waiting-card-name">${position}号 空位</div>
          <div class="waiting-card-status">点击添加AI</div>
        </div>
      `;
      emptyCard.addEventListener('click', () => controller.addAI());
      elements.waitingPlayers.appendChild(emptyCard);
    }
  }

  updateSpectatorViewBar(state);
}

// 更新观战者视角切换栏（游戏中固定在顶部）
function updateSpectatorViewBar(state) {
  const bar = document.getElementById('spectator-view-bar');
  if (!bar) return;

  const isWaiting = document.body.classList.contains('phase-waiting');
  const isGameover = document.body.classList.contains('phase-gameover');

  if (controller.isSpectator && !isWaiting && !isGameover) {
    bar.classList.remove('hidden');
    bar.querySelectorAll('.view-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === controller.spectatorView);
    });
  } else {
    bar.classList.add('hidden');
  }
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

  // 阶段切换时清空 DOM，让 updateMessages 从 messageHistory（= state.messages）重新渲染
  if (lastPhase && lastPhase !== state.phase) {
    elements.messages.innerHTML = '';
    messagesInitialized = false;
  }

  // 从等待进入游戏：播放天黑请闭眼转场
  if (lastPhase === 'waiting' && state.phase !== 'waiting' && !nightTransitionShown) {
    nightTransitionShown = true;
    showNightTransition();
  }

  lastPhase = state.phase;

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

  // 等待阶段渲染等待房间
  if (state.phase === 'waiting') {
    renderWaitingRoom(state);
  }

  // 观战者视角栏
  updateSpectatorViewBar(state);

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
    phaseText = '欢愉杀';
    if (state.presetLocked && state.presetId) {
      showPresetLocked(state.presetId);
    }
    elements.dayCount.textContent = '';
  } else {
    // 游戏中：合并轮次和阶段名到 phase-info
    if (state.dayCount > 0) {
      const isNight = ['cupid', 'guard', 'night_werewolf_discuss', 'night_werewolf_vote', 'witch', 'seer'].includes(state.phase);
      phaseText = `第${state.dayCount}${isNight ? '夜' : '天'} · ${phaseText}`;
    }
    if (state.preset) {
      phaseText += ` | ${state.preset.name} ▾`;
    }
    elements.dayCount.textContent = '';
  }
  elements.phaseInfo.textContent = phaseText;

  // 日夜切换 body class
  const nightPhases = ['cupid', 'guard', 'night_werewolf_discuss', 'night_werewolf_vote', 'witch', 'seer'];
  const dayPhases = ['sheriff_campaign', 'sheriff_speech', 'sheriff_vote', 'day_announce', 'day_discuss', 'day_vote', 'post_vote', 'last_words'];
  document.body.classList.remove('phase-night', 'phase-day', 'phase-waiting', 'phase-gameover');
  if (state.phase === 'waiting') {
    document.body.classList.add('phase-waiting');
  } else if (state.phase === 'game_over') {
    document.body.classList.add('phase-gameover');
  } else if (nightPhases.includes(state.phase)) {
    document.body.classList.add('phase-night');
  } else if (dayPhases.includes(state.phase)) {
    document.body.classList.add('phase-day');
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
  elements.playersLeft.innerHTML = '';
  elements.playersRight.innerHTML = '';

  // 等待阶段不渲染侧栏玩家（使用等待房间卡片）
  if (state.phase === 'waiting') return;

  const myPlayer = controller.getMyPlayer();
  const total = state.playerCount || state.preset?.playerCount || 9;
  const currentCount = state.players?.length || 0;

  // 构建玩家卡片数组（包括空位）
  const allCards = [];

  state.players?.forEach((player, index) => {
    const position = index + 1;
    const card = document.createElement('div');
    card.className = 'player-card';
    if (!player.alive) card.classList.add('dead');
    if (player.id === state.currentSpeaker) card.classList.add('current');
    if (myPlayer && player.id === myPlayer.id) card.classList.add('self');

    const isSheriff = player.isSheriff || state.sheriff === player.id;
    if (isSheriff) card.classList.add('sheriff');
    const isCouple = player.isCouple;
    const revealed = player.revealed;

    let roleText = '';
    if (player.role) {
      const roleId = player.role.id || player.role;
      if (myPlayer && player.id === myPlayer.id) {
        roleText = ROLE_NAMES[roleId] || '';
      } else if (myPlayer && (myPlayer.role.camp === CAMP.WOLF || myPlayer.role === 'werewolf') && (player.role.camp === CAMP.WOLF || player.role === 'werewolf')) {
        roleText = ROLE_NAMES[roleId] || '';
      } else if (controller.isSpectator) {
        // 观战者视角：villager 不显示角色，werewolf 显示狼人角色，god 显示所有
        const view = controller.spectatorView;
        if (view === 'god') {
          roleText = ROLE_NAMES[roleId] || '';
        } else if (view === 'werewolf' && (player.role.camp === CAMP.WOLF || player.role.id === 'werewolf')) {
          roleText = ROLE_NAMES[roleId] || '';
        }
      }
      if (state.phase === 'game_over') {
        roleText = ROLE_NAMES[roleId] || '';
      }
    }

    let statusText = player.alive ? (player.isAI ? 'AI' : '玩家') : '已死亡';
    if (isSheriff) statusText += ' 👑';
    if (isCouple) statusText += ' 💕';
    if (revealed) statusText += ' 📢';
    if (state.phase === 'waiting' && player.ready) statusText += ' ✓';

    // 头像：AI 玩家使用 profile 头像，人类玩家使用默认面具
    const avatarSrc = player.isAI && player.profileName
      ? `/profiles/${player.profileName}/${player.profile?.icon || 'icon.webp'}`
      : '/assets/masks/fools_mask.webp';
    const sheriffBadge = isSheriff ? '<div class="sheriff-badge">👑</div>' : '';

    card.innerHTML = `
      <div class="player-avatar-wrapper">
        <img class="player-avatar" src="${avatarSrc}" alt="${player.name}" onerror="this.src='/assets/masks/fools_mask.webp'">
        ${sheriffBadge}
      </div>
      <div class="player-position">${position}号</div>
      <div class="player-name">${player.name}</div>
            ${roleText ? `<div class="player-role">${roleText}${isCouple ? ' 💕' : ''}</div>` : ''}
    `;

    // AI 玩家点击头像弹出详情
    if (player.isAI && player.profileName && player.profile) {
      card.style.cursor = 'pointer';
      card.addEventListener('click', () => {
        showProfilePopup(player.profileName, player.profile);
      });
    }

    allCards.push(card);
  });

  // 等待阶段添加空位
  if (state.phase === 'waiting') {
    for (let i = currentCount; i < total; i++) {
      const position = i + 1;
      const emptySlot = document.createElement('div');
      emptySlot.className = 'player-card empty-slot';
      emptySlot.innerHTML = `
        <img class="player-avatar" src="/assets/masks/aeon_aha.webp" alt="空位" style="opacity: 0.3;">
        <div class="player-position">${position}号</div>
        <div class="player-name">空位</div>
        <div class="empty-text">+AI</div>
      `;
      emptySlot.addEventListener('click', () => controller.addAI());
      allCards.push(emptySlot);
    }
  }

  // 分配到左右列
  const splitIndex = Math.ceil(allCards.length / 2);
  for (let i = 0; i < allCards.length; i++) {
    if (i < splitIndex) {
      elements.playersLeft.appendChild(allCards[i]);
    } else {
      elements.playersRight.appendChild(allCards[i]);
    }
  }
}

// 更新消息
function updateMessages() {
  const messages = controller.isSpectator ? controller.getFilteredMessages() : controller.getMessageHistory();
  const state = controller.getState();
  let addedGame = false;
  let addedChat = false;

  messages.forEach(msg => {
    const msgId = msg.displayId || msg.id;
    if (!document.querySelector(`[data-msg-id="${msgId}"]`)) {
      if (msg.source === 'chat') {
        renderChatMessage(msg, state);
        addedChat = true;
      } else {
        displayMessage(msg, state);
        addedGame = true;
      }
    }
  });

  if (addedGame || addedChat) {
    const el = elements.messagesSection;
    if (window.frontendLogger) {
      window.frontendLogger.info(`[scroll] addedGame=${addedGame}, addedChat=${addedChat}, initialized=${messagesInitialized}, scrollTop=${el.scrollTop}, scrollHeight=${el.scrollHeight}, clientHeight=${el.clientHeight}`);
    }
    if (addedGame) {
      scrollToBottom(el);
    } else {
      scrollToBottomIfNear(el);
    }
    messagesInitialized = true;
  }
}

function scrollToBottom(el) {
  const doScroll = () => {
    el.scrollTop = el.scrollHeight;
    if (window.frontendLogger) {
      window.frontendLogger.info(`[scroll] scrollTop=${el.scrollTop}, scrollHeight=${el.scrollHeight}`);
    }
  };
  requestAnimationFrame(() => {
    doScroll();
    setTimeout(doScroll, 100);
    setTimeout(doScroll, 300);
  });
}

// 显示消息
function displayMessage(msg, state) {
  const msgId = msg.displayId || msg.id;
  if (msg.type === 'phase_start') {
    addPhaseDivider(msg.phaseName || msg.content || msg.phase, msgId, msg.phase, msg.round);
  } else if (msg.type === 'speech' || msg.type === 'wolf_speech' || msg.type === 'last_words' || msg.type === 'sheriff_speech') {
    const typeClass = msg.type === 'wolf_speech' ? 'wolf-channel' : (msg.type === 'last_words' ? 'last-words' : '');
    addChatMessage(msg, state, typeClass);

    // 发言立绘：白天发言阶段、AI 玩家、非夜晚
    if (msg.type === 'speech' && state) {
      const speaker = state.players?.find(p => p.id === msg.playerId);
      const isNight = ['cupid', 'guard', 'night_werewolf_discuss', 'night_werewolf_vote', 'witch', 'seer'].includes(state.phase);
      if (speaker && speaker.isAI && speaker.profileName && !isNight) {
        showSpeakerArt(speaker.profileName, speaker.profile?.splashArt || 'splash_art.webp');
      }
    }
  } else if ((msg.type === 'vote_result' || msg.type === 'wolf_vote_result') && msg.voteDetails) {
    const isWolfVote = msg.type === 'wolf_vote_result';
    // 从 msg.content 提取标题（第一行），如果没有则使用默认标题
    let title = isWolfVote ? '🔪 狼人刀人投票' : '投票结果';
    let bodyContent = msg.content || '';
    if (bodyContent.includes('\n')) {
      const firstLine = bodyContent.split('\n')[0].trim();
      if (firstLine) title = firstLine;
      bodyContent = bodyContent.split('\n').slice(1).join('\n');
    }
    // 按目标分组
    const byTarget = {};
    for (const v of msg.voteDetails) {
      if (!byTarget[v.target]) byTarget[v.target] = [];
      byTarget[v.target].push(v.voter);
    }
    let content = '<div class="vote-result">';
    content += `<div class="vote-title">${title}</div>`;
    content += '<div class="vote-details">';
    for (const [target, voters] of Object.entries(byTarget)) {
      // target 格式为 "3号玩家3"，提取前面的数字
      const numTarget = Number(target.match(/^(\d+)/)?.[1]);
      const count = msg.voteCounts?.[numTarget] || voters.length;
      const countStr = Number.isInteger(count) ? count : count.toFixed(1);
      content += `<div>${target} ${countStr}票（${voters.join('，')}）</div>`;
    }
    content += '</div>';
    if (isWolfVote && bodyContent) {
      const match = bodyContent.match(/最终击杀：(.+)/);
      if (match) content += `<div class="vote-final">最终击杀：${match[1]}</div>`;
    }
    content += '</div>';
    addMessage(content, isWolfVote ? 'wolf-vote-result' : 'vote-result', msgId);
  } else if (msg.type === 'vote_tie') {
    addMessage(msg.content, 'vote-tie', msgId);
  } else if (msg.type === 'sheriff_candidates') {
    addMessage(msg.content, 'sheriff-candidates', msgId);
  } else if (msg.type === 'sheriff_elected') {
    addMessage(msg.content, 'sheriff-elected', msgId);
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
    addMessage(content, 'system death', msgId);
  } else if (/^\[系统\]第\d+[夜天]$/.test(msg.content)) {
    return;
  } else if (msg.type === MSG.ACTION || msg.type === MSG.SYSTEM) {
    if (msg.visibility === VISIBILITY.SELF) {
      addMessage(`[私密] ${msg.content}`, 'private', msgId);
    } else if (msg.content.includes('平安夜')) {
      addMessage(msg.content, 'system peaceful', msgId);
    } else {
      addMessage(msg.content, msg.className || msg.type, msgId);
    }
  } else {
    addMessage(msg.content, msg.className || msg.type, msgId);
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
  // 使用模板
  const tpl = document.getElementById('tpl-message');
  const msg = tpl.content.cloneNode(true).querySelector('.message');
  msg.className = `message ${className}`;
  if (id) msg.dataset.msgId = id;
  msg.querySelector('.message-content').innerHTML = parsedContent.replace(/\n/g, '<br>');
  elements.messages.appendChild(msg);
}

// 添加聊天气泡消息（微信风格）
function addChatMessage(msg, state, typeClass = '') {
  const msgId = msg.displayId || msg.id;
  if (msgId && document.querySelector(`[data-msg-id="${msgId}"]`)) return;

  const myPlayer = controller.getMyPlayer();
  const isSelf = myPlayer && msg.playerId === myPlayer.id;
  const player = state?.players?.find(p => p.id === msg.playerId);
  const isSheriff = player && (player.isSheriff || state.sheriff === player.id);

  const avatarSrc = player && player.isAI && player.profileName
    ? `/profiles/${player.profileName}/${player.profile?.icon || 'icon.webp'}`
    : '/assets/masks/fools_mask.webp';

  const parsedContent = window.MessageParser
    ? window.MessageParser.parseMessageContent(msg.content)
    : msg.content;

  // 使用模板
  const tpl = document.getElementById('tpl-chat-message');
  const el = tpl.content.cloneNode(true).querySelector('.chat-message');
  el.className = `chat-message ${typeClass}${isSelf ? ' self' : ''}`;
  if (msgId) el.dataset.msgId = msgId;

  el.querySelector('.chat-avatar').src = avatarSrc;
  el.querySelector('.chat-avatar').alt = msg.playerName;
  const sheriffMark = isSheriff ? '<span class="chat-sheriff-mark">👑</span> ' : '';
  el.querySelector('.chat-name').innerHTML = `${sheriffMark}${msg.playerId}号 ${msg.playerName}`;
  el.querySelector('.chat-bubble').innerHTML = parsedContent.replace(/\n/g, '<br>');

  elements.messages.appendChild(el);
}

// 添加阶段分割线
function addPhaseDivider(phaseText, msgId = null, msgPhase = null, msgRound = null) {
  if (msgId && document.querySelector(`[data-msg-id="${msgId}"]`)) {
    return;
  }
  // 放逐后处理阶段不显示分割线
  if (msgPhase === 'post_vote') {
    return;
  }
  // 使用模板
  const tpl = document.getElementById('tpl-phase-divider');
  const divider = tpl.content.cloneNode(true).querySelector('.phase-divider');

  const nightPhases = ['cupid', 'guard', 'night_werewolf_discuss', 'night_werewolf_vote', 'witch', 'seer'];
  const dayPhases = ['sheriff_campaign', 'sheriff_speech', 'sheriff_vote', 'day_announce', 'day_discuss', 'day_vote', 'last_words'];

  let displayText = phaseText;
  if (msgPhase) {
    const round = msgRound || 1;
    if (nightPhases.includes(msgPhase)) {
      divider.classList.add('night');
      displayText = `第${round}夜 · ${phaseText}`;
    } else if (dayPhases.includes(msgPhase)) {
      divider.classList.add('day');
      displayText = `第${round}天 · ${phaseText}`;
    }
  } else {
    const state = controller.getState();
    if (state) {
      if (nightPhases.includes(state.phase)) {
        divider.classList.add('night');
      } else if (dayPhases.includes(state.phase)) {
        divider.classList.add('day');
      }
    }
  }

  if (msgId) divider.dataset.msgId = msgId;
  divider.querySelector('span').textContent = displayText;
  elements.messages.appendChild(divider);
}

function _renderSpectatorBadge(spectators, spectatorCount) {
  const actionSection = document.getElementById('action-section');
  const existing = actionSection.querySelector('.spectator-badge');
  if (existing) existing.remove();
  const existingPopup = actionSection.querySelector('.spectator-popup');
  if (existingPopup) existingPopup.remove();

  if (spectatorCount <= 0) return;

  const badge = document.createElement('span');
  badge.className = 'spectator-badge';
  badge.textContent = `👁 ${spectatorCount}`;
  elements.actionPrompt.appendChild(badge);
  badge.addEventListener('click', (e) => {
    e.stopPropagation();
    const popup = actionSection.querySelector('.spectator-popup');
    if (popup) { popup.remove(); return; }
    const newPopup = document.createElement('div');
    newPopup.className = 'spectator-popup';
    newPopup.innerHTML = spectators.map(s =>
      `<span class="spectator-item">${s.name}${s.name === controller.playerName ? ' (你)' : ''}</span>`
    ).join('');
    actionSection.appendChild(newPopup);
    setTimeout(() => {
      const close = (ev) => {
        if (!newPopup.contains(ev.target) && ev.target !== badge) {
          newPopup.remove();
          document.removeEventListener('click', close);
        }
      };
      document.addEventListener('click', close);
    }, 0);
  });
}

function updateDefaultAction(state) {
  elements.actionInput.classList.remove('active');
  elements.voteButtons.classList.remove('active');
  elements.skillButtons.classList.remove('active');
  elements.actionPrompt.textContent = '';
  elements.voteButtons.innerHTML = '';
  elements.skillButtons.innerHTML = '';

  // 隐藏内联按钮
  document.getElementById('join-game-btn').classList.add('hidden');
  document.getElementById('start-game-btn').classList.add('hidden');
  document.getElementById('restart-btn').classList.add('hidden');

  const myPlayer = controller.getMyPlayer();
  const spectators = state.spectators || [];
  const spectatorCount = spectators.length;

  // 游戏中观战者：显示视角切换栏
  if (controller.isSpectator && state.phase !== 'waiting' && state.phase !== 'game_over') {
    elements.actionPrompt.innerHTML = `<span style="font-size:12px;">👁 观战中${spectatorCount > 1 ? ` (${spectatorCount}人)` : ''}</span>`;
    const bar = document.getElementById('spectator-view-bar');
    bar.classList.remove('hidden');
    bar.querySelectorAll('.view-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === controller.spectatorView);
    });
    return;
  }

  document.getElementById('spectator-view-bar').classList.add('hidden');

  if (!myPlayer && !controller.isSpectator) {
    elements.actionPrompt.textContent = '请先加入游戏';
    return;
  }

  if (myPlayer && !myPlayer.alive && state.phase !== 'last_words' && state.phase !== 'game_over' && state.phase !== 'post_vote') {
    elements.actionPrompt.innerHTML = '<span style="font-size:12px;">你已死亡，观战中...</span>';
    return;
  }

  if (state.phase === 'waiting') {
    const current = state.players?.length || 0;
    const total = state.playerCount || state.preset?.playerCount || 9;
    const readyCount = state.players?.filter(p => p.ready).length || 0;
    const allAI = state.players?.length > 0 && state.players.every(p => p.isAI);
    const allReady = current === total && readyCount === total;

    // 聊天输入框
    elements.actionInput.classList.add('active');
    elements.speechInput.placeholder = '输入消息...';
    elements.speechInput.disabled = false;
    elements.sendBtn.disabled = false;

    // 加入游戏按钮：仅观战者 + 有空位
    const joinBtn = document.getElementById('join-game-btn');
    if (joinBtn) {
      joinBtn.classList.toggle('hidden', !controller.isSpectator || current >= total);
    }

    // 开始游戏按钮：仅全 AI 就绪
    const startBtn = document.getElementById('start-game-btn');
    if (startBtn) {
      const shouldShow = allAI && allReady;
      startBtn.classList.toggle('hidden', !shouldShow);
      if (shouldShow) {
        startBtn.disabled = false;
        startBtn.textContent = '开始游戏';
      }
    }

    // 状态文字
    if (controller.isSpectator) {
      elements.actionPrompt.innerHTML = `<span style="font-size:12px;">👁 观战中 | ${current}/${total}</span>`;
    } else if (myPlayer && myPlayer.ready) {
      elements.actionPrompt.innerHTML = `<span style="font-size:12px;">已准备 (${readyCount}/${total})</span>`;
    } else if (myPlayer && !myPlayer.ready) {
      elements.actionPrompt.innerHTML = `<span style="font-size:12px;">等待准备... (${readyCount}/${total})</span>`;
    } else {
      elements.actionPrompt.innerHTML = `<span style="font-size:12px;">${current < total ? `等待玩家加入... (${current}/${total})` : '人已齐...'}</span>`;
    }

    // 观战者计数徽章（绝对定位，不影响布局）
    _renderSpectatorBadge(spectators, spectatorCount);

    return;
  }

  if (state.phase === 'game_over') {
    let winnerText = '';
    let winnerClass = '';
    switch (state.winner) {
      case CAMP.WOLF:
        winnerText = '🎭 狼人阵营获胜！';
        winnerClass = 'winner-wolf';
        break;
      case CAMP.GOOD:
        winnerText = '🎭 好人阵营获胜！';
        winnerClass = 'winner-good';
        break;
      case CAMP.THIRD:
        winnerText = '🎭 第三方获胜！';
        winnerClass = 'winner-third';
        break;
      default:
        winnerText = '🎭 游戏结束';
        winnerClass = '';
    }

    const DEATH_REASONS = {
      wolf: '被狼人击杀',
      poison: '被女巫毒杀',
      conflict: '同守同救',
      vote: '被放逐',
      hunter: '被猎人带走',
      couple: '殉情'
    };

    let gameOverHtml = `<div class="game-over"><strong class="${winnerClass}">${winnerText}</strong>`;
    gameOverHtml += '<div class="all-roles">';
    if (state.gameOverInfo && state.gameOverInfo.players) {
      state.gameOverInfo.players.forEach((p, idx) => {
        const display = p.display || `${idx + 1}号${p.name}`;
        const roleName = p.role ? ROLE_NAMES[p.role.id] || p.role.id : '未知';
        const deathInfo = p.alive ? '存活' : (p.deathReason ? `死亡(${DEATH_REASONS[p.deathReason] || p.deathReason})` : '死亡');
        const sheriffMark = p.isSheriff ? ' 👑警长' : '';
        const coupleMark = p.isCouple ? ' 💕情侣' : '';
        gameOverHtml += `<div>${display}: ${roleName} - ${deathInfo}${sheriffMark}${coupleMark}</div>`;
      });
    }
    gameOverHtml += '</div></div>';

    elements.actionPrompt.innerHTML = gameOverHtml;

    // 返回房间按钮（行内）
    document.getElementById('restart-btn').classList.remove('hidden');

    // 聊天输入框
    elements.actionInput.classList.add('active');
    elements.speechInput.placeholder = '输入消息...';
    elements.speechInput.disabled = false;
    elements.sendBtn.disabled = false;

    _renderSpectatorBadge(spectators, spectatorCount);

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
  // playing 阶段无行动时禁用输入框
  elements.speechInput.disabled = true;
  elements.speechInput.placeholder = '';
  elements.sendBtn.disabled = true;
}

// 启动
init();