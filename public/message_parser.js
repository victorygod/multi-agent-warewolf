/**
 * 消息解析器 - 解析 msg.content 中的标签并返回带样式的 HTML
 * 标签格式: [类型|目标]内容 或 [类型]内容
 * 示例: [发言|3号张三]我是好人 => <span class="msg-tag msg-speech">发言|3号张三</span>我是好人
 *       [系统|私密]消息 => <span class="msg-tag msg-system-private">系统|私密</span>消息
 */

const TAG_STYLES = {
  '发言': 'msg-speech',
  '遗言': 'msg-last-words',
  '狼人讨论': 'msg-wolf-speech',
  '警长竞选发言': 'msg-sheriff-speech',
  '系统': 'msg-system',
  '私密': 'msg-private',
  '警长': 'msg-sheriff',
  '投票': 'msg-vote',
  '死亡': 'msg-death',
  '游戏结束': 'msg-game-over'
};

function parseMessageContent(content) {
  if (!content) return '';

  // 移除 [标签] 部分，只保留内容
  // [发言|3号张三]内容 => 内容
  // [系统]内容 => 内容
  return content.replace(/\[([^\]]+)\]/g, '');
}

function getMessageClass(msg) {
  const type = msg.type;
  const visibility = msg.visibility;

  if (type === 'phase_start') return 'phase-start';
  if (type === 'system') return visibility === 'self' ? 'system-private' : 'system';
  if (type === 'speech' || type === 'wolf_speech' || type === 'last_words') return 'speech';
  if (type === 'vote_result' || type === 'wolf_vote_result') return 'vote-result';
  if (type === 'death_announce') return 'death-announce';
  if (type === 'game_over') return 'game-over';
  if (type === 'action') return visibility === 'self' ? 'action-private' : 'action';

  return '';
}

// 导出到全局
if (typeof window !== 'undefined') {
  window.MessageParser = {
    parseMessageContent,
    getMessageClass
  };
}

// Node.js 导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseMessageContent, getMessageClass };
}