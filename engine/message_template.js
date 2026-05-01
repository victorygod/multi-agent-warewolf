const { MSG_TEMPLATE } = require('./constants');

function buildMessage(templateKey, params) {
  let template = MSG_TEMPLATE[templateKey];
  if (!template) return '';

  for (const [key, value] of Object.entries(params || {})) {
    template = template.replace(`{${key}}`, value);
  }
  return template;
}

function getSelfMark(playerId, currentPlayerId) {
  if (playerId === currentPlayerId) return '(你)';
  return '';
}

function buildMessageWithSelf(templateKey, params, currentPlayerId) {
  let template = MSG_TEMPLATE[templateKey];
  if (!template) return '';

  const result = { ...params };

  // 如果有 playerId 字段，自动判断是否是自己
  if (result.playerId !== undefined && currentPlayerId !== undefined) {
    result.self = getSelfMark(result.playerId, currentPlayerId);
  }

  for (const [key, value] of Object.entries(result || {})) {
    template = template.replace(`{${key}}`, value);
  }
  return template;
}


function formatPlayerList(players) {
  return players.map(p => `${p.position}号${p.name}`).join('，');
}

function formatVoteDetails(voteDetails) {
  const byTarget = {};
  for (const v of voteDetails) {
    if (!byTarget[v.target]) byTarget[v.target] = [];
    byTarget[v.target].push(v.voter);
  }
  return Object.entries(byTarget)
    .map(([target, voters]) => `${target}(${voters.join(',')})`)
    .join('，');
}

module.exports = {
  buildMessage,
  buildMessageWithSelf,
  getSelfMark,
  formatPlayerList,
  formatVoteDetails,
  MSG_TEMPLATE
};