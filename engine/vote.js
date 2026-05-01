/**
 * 投票管理器
 */

const { getPlayerDisplay } = require('./utils');
const { MSG, VISIBILITY, DEATH_REASON, ACTION } = require('./constants');
const { buildMessage, formatVoteDetails } = require('./message_template');

class VoteManager {
  constructor(game) {
    this.game = game;
  }

  // 计算投票结果（通用方法）
  calculateVoteResults(voters, options = {}) {
    const { useWeight = true, allowEmpty = false } = options;
    const voteCounts = {};
    const voteDetails = [];

    for (const voter of voters) {
      const targetId = this.game.votes[voter.id];
      const target = targetId ? this.game.players.find(p => p.id === Number(targetId)) : null;

      voteDetails.push({
        voter: getPlayerDisplay(this.game.players, voter),
        target: target ? getPlayerDisplay(this.game.players, target) : '弃权'
      });

      if (targetId || allowEmpty) {
        const weight = useWeight
          ? this.game.config.hooks?.getVoteWeight?.(voter, this.game) || 1
          : 1;
        const countKey = Number(targetId) || 0;
        voteCounts[countKey] = (voteCounts[countKey] || 0) + weight;
      }
    }

    return { voteCounts, voteDetails };
  }

  // 计算最高票（通用方法）
  findMaxVotes(voteCounts) {
    let maxVotes = 0;
    let maxPlayer = null;

    Object.entries(voteCounts).forEach(([id, count]) => {
      if (count > maxVotes) {
        maxVotes = count;
        maxPlayer = this.game.players.find(p => p.id === parseInt(id));
      }
    });

    return { maxVotes, maxPlayer };
  }

  // 处理平票（通用方法）
  findTopVotes(voteCounts, maxVotes) {
    return Object.entries(voteCounts)
      .filter(([, count]) => count === maxVotes)
      .map(([id]) => this.game.players.find(p => p.id === parseInt(id)));
  }

  // 广播投票结果
  _broadcastVoteResult(title, voteDetails, voteCounts) {
    // 格式化票型
    const voteLines = voteDetails.map(d => `${d.voter} → ${d.target}`);
    const content = `${title}\n${voteLines.join('\n')}`;

    this.game.message.add({
      type: 'vote_result',
      content: buildMessage('DAY_VOTE', { 票型: formatVoteDetails(voteDetails) }),
      voteDetails,
      voteCounts,
      visibility: VISIBILITY.PUBLIC
    });
  }

  // 广播平票消息
  _broadcastTie(topVotes, message) {
    this.game.message.add({
      type: 'vote_tie',
      content: buildMessage('VOTE_TIE', {
        平票玩家: topVotes.map(p => getPlayerDisplay(this.game.players, p)).join('，')
      }),
      visibility: VISIBILITY.PUBLIC
    });
  }

  // 处理放逐投票结果
  _handleBanishResult(maxPlayer) {
    if (!maxPlayer) return;

    const deathResult = this.game.handleDeath(maxPlayer, DEATH_REASON.VOTE);

    // 白痴翻牌免疫：死亡被取消，不发公告也不设遗言
    if (deathResult.cancelled) return;

    this.game.lastWordsPlayer = deathResult.lastWordsPlayer;

    // 添加放逐死亡公告
    this.game.message.add({
      type: MSG.DEATH_ANNOUNCE,
      content: buildMessage('VOTE_ANNOUNCE', {
        player: getPlayerDisplay(this.game.players, maxPlayer)
      }),
      deaths: [maxPlayer],
      visibility: VISIBILITY.PUBLIC
    });
  }

  // 结算投票（支持PK）
  async resolve() {
    const voters = this.game.players.filter(p => p.alive && p.state?.canVote !== false);
    const { voteCounts, voteDetails } = this.calculateVoteResults(voters, { useWeight: true });

    this._broadcastVoteResult('投票结果', voteDetails, voteCounts);

    const { maxVotes, maxPlayer } = this.findMaxVotes(voteCounts);
    const topVotes = this.findTopVotes(voteCounts, maxVotes);

    if (topVotes.length > 1) {
      // 平票，进入PK
      return await this._resolveBanishPK(topVotes);
    }

    this._handleBanishResult(maxPlayer);
    this.game.votes = {};
    return { done: true };
  }

  // PK放逐投票
  async _resolveBanishPK(topVotes) {
    // 排除已翻牌的白痴作为PK候选人
    const validCandidates = topVotes.filter(c => !(c.role.id === 'idiot' && c.state?.revealed));

    if (validCandidates.length === 0) {
      this._broadcastTie(topVotes, 'PK候选人均为已翻牌白痴，无人出局');
      this.game.votes = {};
      return { done: true };
    }

    if (validCandidates.length === 1) {
      // 只有一个有效候选人，直接放逐
      this._broadcastTie(validCandidates, `PK仅剩1人，直接放逐`);
      this._handleBanishResult(validCandidates[0]);
      this.game.votes = {};
      return { done: true };
    }

    this._broadcastTie(topVotes, '平票，进入PK');

    // PK投票：所有存活玩家都能投票
    const pkCandidates = validCandidates;
    const pkVoters = this.game.players.filter(p => p.alive && p.state?.canVote !== false);

    if (pkVoters.length === 0) {
      // 没有可投票的玩家（比如所有人都平票），无人出局
      this._broadcastTie(pkCandidates, 'PK无法继续，无人出局');
      this.game.votes = {};
      return { done: true };
    }

    // 清空投票，准备PK
    this.game.votes = {};

    // 进行PK投票（不带权重），排除已翻牌的白痴和投票者自己
    const getPKAllowedTargets = (voterId) => {
      // PK候选人中排除已翻牌的白痴
      const validCandidates = pkCandidates.filter(c =>
        !(c.role.id === 'idiot' && c.state?.revealed)
      );
      // 再排除投票者自己
      return validCandidates
        .filter(c => c.id !== voterId)
        .map(c => c.id);
    };

    await Promise.all(pkVoters.map(voter =>
      this.game.callVote(voter.id, ACTION.POST_VOTE, { allowedTargets: getPKAllowedTargets(voter.id) })
    ));

    // 计算PK结果
    const pkResult = this.calculateVoteResults(pkVoters, { useWeight: false });
    this._broadcastVoteResult('PK投票结果', pkResult.voteDetails, pkResult.voteCounts);

    const { maxVotes: pkMaxVotes } = this.findMaxVotes(pkResult.voteCounts);
    const pkTopVotes = this.findTopVotes(pkResult.voteCounts, pkMaxVotes);

    if (pkTopVotes.length > 1) {
      // PK仍平票，无人出局
      this._broadcastTie(pkTopVotes, 'PK仍平票，无人出局');
      this.game.votes = {};
      return { done: true };
    }

    // PK有结果，放逐最高票玩家
    const winner = pkTopVotes[0];
    this._handleBanishResult(winner);
    this.game.votes = {};
    return { done: true };
  }

  // ========== 选举投票 ==========

  // 广播警长当选消息
  _broadcastSheriffElected(winner, isPK = false) {
    this.game.message.add({
      type: 'sheriff_elected',
      content: buildMessage('SHERIFF_ELECTED', {
        player: getPlayerDisplay(this.game.players, winner)
      }),
      visibility: VISIBILITY.PUBLIC,
      sheriffId: winner.id
    });
  }

  // 执行一轮选举投票
  async _runElectionRound(candidates, voters, useWeight, title) {
    const allowedTargets = candidates.map(c => c.id);
    await Promise.all(voters.map(voter =>
      this.game.callVote(voter.id, ACTION.SHERIFF_VOTE, { allowedTargets })
    ));

    const { voteCounts, voteDetails } = this.calculateVoteResults(voters, { useWeight });
    this._broadcastVoteResult(title, voteDetails, voteCounts);

    const { maxVotes, maxPlayer: winner } = this.findMaxVotes(voteCounts);
    const topVotes = this.findTopVotes(voteCounts, maxVotes);

    return { winner, topVotes, voteCounts };
  }

  // 结算警长选举投票
  async resolveElection(candidates, voters, allPlayers) {
    // 边界情况
    if (candidates.length === 0) {
      this.game.sheriff = null;
      this.game.message.add({ type: MSG.SYSTEM, content: buildMessage('NO_SHERIFF_CANDIDATE', {}), visibility: VISIBILITY.PUBLIC });
      return { done: true };
    }

    // 检查是否有存活的警下玩家（非候选人）
    const offStagePlayers = allPlayers?.filter(p => !p.state?.isCandidate && p.alive) || [];
    if (offStagePlayers.length === 0 && candidates.length >= 2) {
      // 所有人都上警，候选人互投是允许的
      // 继续正常流程
    } else if (offStagePlayers.length === 0 && candidates.length === 1) {
      // 只有一人竞选且警下无人，直接当选
      this.game.sheriff = candidates[0].id;
      this._broadcastSheriffElected(candidates[0]);
      return { done: true };
    }

    if (candidates.length === 1) {
      this.game.sheriff = candidates[0].id;
      this._broadcastSheriffElected(candidates[0]);
      return { done: true };
    }

    // 第一轮投票
    const { winner, topVotes } = await this._runElectionRound(candidates, voters, true, '警长投票结果');

    if (topVotes.length > 1) {
      const result = await this._resolvePK(topVotes);
      this.game.votes = {};
      return result;
    }

    if (winner) {
      this.game.sheriff = winner.id;
      this._broadcastSheriffElected(winner);
    }

    this.game.votes = {};
    return { done: true };
  }

  // PK投票
  async _resolvePK(topVotes) {
    const pkVoters = this.game.players.filter(p => !p.state?.isCandidate && p.alive);

    if (pkVoters.length === 0) {
      this.game.sheriff = null;
      this._broadcastTie(topVotes, '平票，无法PK，无警长');
      return { done: true };
    }

    this.game.votes = {};
    const { winner, topVotes: pkTopVotes } = await this._runElectionRound(topVotes, pkVoters, false, 'PK投票结果');

    if (pkTopVotes.length > 1) {
      this.game.sheriff = null;
      this._broadcastTie(pkTopVotes, '再平票，无警长');
    } else if (winner) {
      this.game.sheriff = winner.id;
      this._broadcastSheriffElected(winner, true);
    }

    return { done: true };
  }
}

module.exports = { VoteManager };