/**
 * 角色定义 - 技能、约束、事件监听
 */

const { getCamp } = require('./config');
const { getPlayerDisplay } = require('./utils');
const { ACTION, PHASE, CAMP, DEATH_REASON, ROLE_TYPE, VISIBILITY, MSG } = require('./constants');
const { buildMessage, getSelfMark, formatPlayerList } = require('./message_template');

// 角色定义
const ROLES = {
  // === 好人阵营 ===

  // 平民
  villager: {
    id: 'villager',
    name: '平民',
    camp: CAMP.GOOD,
    type: ROLE_TYPE.VILLAGER,
    skills: {}
  },

  // 预言家
  seer: {
    id: 'seer',
    name: '预言家',
    camp: CAMP.GOOD,
    type: ROLE_TYPE.GOD,
    state: { seerChecks: [] },
    skills: {
      [ACTION.SEER]: {
        type: 'target',
        visibility: VISIBILITY.SELF,
        validate: (target, player, game) => {
          if (target.id === player.id) return false;
          if (!target.alive) return false;
          // 检查是否已经查验过
          const seerChecks = player.state.seerChecks || [];
          if (seerChecks.some(c => c.targetId === target.id)) {
            return false;
          }
          return true;
        },
        execute: (target, player, game) => {
          const isWolf = getCamp(target, game) === CAMP.WOLF;
          // 记录查验历史
          player.state.seerChecks = player.state.seerChecks || [];
          player.state.seerChecks.push({
            targetId: target.id,
            result: isWolf ? CAMP.WOLF : CAMP.GOOD,
            night: game.round
          });
          game.message.add({
            type: MSG.ACTION,
            content: buildMessage('SEER_CHECK', {
              player: getPlayerDisplay(game.players, player),
              target: getPlayerDisplay(game.players, target),
              result: isWolf ? '狼人' : '好人'
            }),
            playerId: player.id,
            visibility: VISIBILITY.SELF,
            metadata: { targetId: target.id, result: isWolf ? CAMP.WOLF : CAMP.GOOD }
          });
        }
      }
    }
  },

  // 女巫
  witch: {
    id: 'witch',
    name: '女巫',
    camp: CAMP.GOOD,
    type: ROLE_TYPE.GOD,
    state: { heal: 1, poison: 1 },
    skills: {
      [ACTION.WITCH]: {
        type: 'choice',
        visibility: VISIBILITY.SELF,
        execute: (choice, player, game, extraData) => {
          const { action, targetId } = choice;

          // 使用解药
          if (action === 'heal' && player.state.heal > 0) {
            // 检查是否可以自救：extraData.canSelfHeal 优先，否则使用 effectiveRules 配置
            const canSelfHeal = extraData?.canSelfHeal ?? game.effectiveRules?.witch?.canSelfHeal ?? true;
            if (game.werewolfTarget && !canSelfHeal && game.werewolfTarget === player.id) {
              return { success: false, message: '不能自救' };
            }
            player.state.heal--;
            game.healTarget = game.werewolfTarget;
            game.message.add({
              type: MSG.ACTION,
              content: buildMessage('WITCH_HEAL', {
                player: getPlayerDisplay(game.players, player),
                target: game.werewolfTarget ? getPlayerDisplay(game.players, game.players.find(p => p.id === game.werewolfTarget)) : '无人'
              }),
              playerId: player.id,
              visibility: VISIBILITY.SELF
            });
          }

          // 使用毒药
          if (action === 'poison' && player.state.poison > 0 && targetId) {
            const target = game.players.find(p => p.id === targetId);
            if (!target?.alive) return { success: false, message: '目标已死亡' };
            player.state.poison--;
            game.poisonTarget = targetId;
            game.message.add({
              type: MSG.ACTION,
              content: buildMessage('WITCH_POISON', {
                player: getPlayerDisplay(game.players, player),
                target: getPlayerDisplay(game.players, target)
              }),
              playerId: player.id,
              visibility: VISIBILITY.SELF
            });
          }

          return { success: true };
        }
      }
    }
  },

  // 猎人
  hunter: {
    id: 'hunter',
    name: '猎人',
    camp: CAMP.GOOD,
    type: ROLE_TYPE.GOD,
    state: { canShoot: true },
    skills: {
      // 猎人射击 - 死亡时触发（白天公布死讯时和白天放逐后）
      [ACTION.SHOOT]: {
        type: 'target',
        availablePhases: [PHASE.DAY_ANNOUNCE, PHASE.POST_VOTE],
        canUse: (player, game, extraData) => {
          const deathReason = extraData?.deathReason || DEATH_REASON.WEREWOLF;
          if (!player.state.canShoot) return false;
          // 同守同救不能开枪
          if (deathReason === DEATH_REASON.CONFLICT) return false;
          // 被毒死不能开枪（由板子规则控制）
          if (deathReason === DEATH_REASON.POISON && !(game.effectiveRules?.hunter?.canShootIfPoisoned ?? false)) return false;
          // 玩家已死亡才能开枪
          if (player.alive) return false;
          return true;
        },
        validate: (target, player, game) => target?.alive && target.id !== player.id,
        execute: (target, player, game) => {
          // 放弃开枪（target 为 null）
          if (!target) {
            player.state.canShoot = false;
            game.message.add({
              type: MSG.ACTION,
              content: buildMessage('HUNTER_PASS', {
                player: getPlayerDisplay(game.players, player)
              }),
              playerId: player.id,
              visibility: VISIBILITY.PUBLIC
            });
            return { success: true, skipped: true };
          }
          if (!target.alive) return;
          player.state.canShoot = false;
          target.deathReason = DEATH_REASON.HUNTER; // 设置死亡原因
          game.deathQueue.push(target);
          game.message.add({
            type: MSG.ACTION,
            content: buildMessage('HUNTER_SHOOT', {
              player: getPlayerDisplay(game.players, player),
              target: getPlayerDisplay(game.players, target)
            }),
            playerId: player.id,
            visibility: VISIBILITY.PUBLIC
          });
        }
      }
    },
    events: {
      'player:death': (data, game, player) => {
        // 同守同救不能开枪
        if (data.player.id === player.id && data.reason === DEATH_REASON.CONFLICT) {
          player.state.canShoot = false;
        }
        // 被毒死不能开枪（由板子规则控制）
        if (data.player.id === player.id && data.reason === DEATH_REASON.POISON && !(game.effectiveRules?.hunter?.canShootIfPoisoned ?? false)) {
          player.state.canShoot = false;
        }
      }
    }
  },

  // 守卫
  guard: {
    id: 'guard',
    name: '守卫',
    camp: CAMP.GOOD,
    type: ROLE_TYPE.GOD,
    state: { lastGuardTarget: null },
    skills: {
      [ACTION.GUARD]: {
        type: 'target',
        visibility: VISIBILITY.SELF,
        validate: (target, player, game) => {
          if (!target.alive) return false;
          if (!(game.effectiveRules?.guard?.allowRepeatGuard ?? false) && player.state.lastGuardTarget === target.id) {
            return false;
          }
          return true;
        },
        execute: (target, player, game) => {
          player.state.lastGuardTarget = target.id;
          game.guardTarget = target.id;
          game.message.add({
            type: MSG.ACTION,
            content: buildMessage('GUARD_PROTECT', {
              player: getPlayerDisplay(game.players, player),
              target: getPlayerDisplay(game.players, target)
            }),
            playerId: player.id,
            visibility: VISIBILITY.SELF
          });
        }
      }
    }
  },

  // 白痴
  idiot: {
    id: 'idiot',
    name: '白痴',
    camp: CAMP.GOOD,
    type: ROLE_TYPE.GOD,
    state: { revealed: false, canVote: true },
    skills: {},
    events: {
      'player:death': (data, game, player) => {
        // 被投票出局时免疫
        if (data.player.id === player.id && data.reason === DEATH_REASON.VOTE && !player.state.revealed) {
          player.state.revealed = true;
          player.state.canVote = false;
          player.alive = true; // 免疫死亡
          game.message.add({
            type: MSG.ACTION,
            content: `白痴 ${getPlayerDisplay(game.players, player)} 翻牌免疫放逐，已失去投票权`,
            playerId: player.id,
            visibility: VISIBILITY.PUBLIC
          });
          return { cancel: true };
        }
      }
    }
  },

  // 丘比特
  cupid: {
    id: 'cupid',
    name: '丘比特',
    camp: CAMP.GOOD,
    type: ROLE_TYPE.GOD,
    skills: {
      [ACTION.CUPID]: {
        type: 'double_target',
        visibility: VISIBILITY.COUPLE,
        validate: (targets, player, game) => {
          if (targets.length !== 2) return false;
          // 丘比特可以选择自己作为情侣之一
          return targets.every(t => t.alive);
        },
        execute: (targets, player, game) => {
          game.couples = targets.map(t => t.id);
          game.message.add({
            type: MSG.ACTION,
            content: buildMessage('CUPID_LINK_SELF', {
              player: getPlayerDisplay(game.players, player),
              t1: getPlayerDisplay(game.players, targets[0]),
              t2: getPlayerDisplay(game.players, targets[1])
            }),
            playerId: player.id,
            visibility: VISIBILITY.SELF
          });
          // 通知情侣
          targets.forEach(t => {
            const partner = targets.find(x => x.id !== t.id);
            game.message.add({
              type: MSG.SYSTEM,
              content: buildMessage('CUPLE_NOTIFY', {
                player: getPlayerDisplay(game.players, partner)
              }),
              playerId: t.id,
              visibility: VISIBILITY.SELF
            });
          });
        }
      }
    }
  },

  // === 狼人阵营 ===

  // 狼人
  werewolf: {
    id: 'werewolf',
    name: '狼人',
    camp: CAMP.WOLF,
    type: 'wolf',
    skills: {
      // 狼人自爆 - 白天任意阶段可触发
      [ACTION.EXPLODE]: {
        type: 'instant',
        availablePhases: [PHASE.SHERIFF_CAMPAIGN, PHASE.SHERIFF_SPEECH, PHASE.SHERIFF_VOTE, PHASE.DAY_DISCUSS, PHASE.DAY_VOTE],
        canUse: (player) => player.alive,
        execute: (_, player, game) => {
          player.alive = false;

          // 广播自爆消息
          game.message.add({
            type: 'explode',
            content: buildMessage('WEREWOLF_EXPLODE', {
              player: getPlayerDisplay(game.players, player)
            }),
            playerId: player.id,
            visibility: VISIBILITY.PUBLIC
          });

          // 狼人警长自爆，警徽直接销毁（不传递）
          if (game.sheriff === player.id) {
            game.sheriff = null;
            game.message.add({
              type: MSG.SYSTEM,
              content: buildMessage('SHERIFF_BADGE_LOST', {}),
              visibility: VISIBILITY.PUBLIC
            });
          } else if (!game.sheriff && [PHASE.SHERIFF_CAMPAIGN, PHASE.SHERIFF_SPEECH, PHASE.SHERIFF_VOTE].includes(game.phaseManager?.getCurrentPhase()?.id)) {
            // 警长没选出来时自爆，提示警徽流失
            game.message.add({
              type: MSG.SYSTEM,
              content: buildMessage('SHERIFF_BADGE_LOST', {}),
              visibility: VISIBILITY.PUBLIC
            });
          }

          return { success: true };
        }
      }
    }
  },

};

// 获取角色定义
function getRole(roleId) {
  return ROLES[roleId] || null;
}

// 创建玩家角色实例
function createPlayerRole(roleId) {
  const role = getRole(roleId);
  if (!role) return null;

  const state = {};
  if (role.state) {
    for (const [key, val] of Object.entries(role.state)) {
      state[key] = Array.isArray(val) ? [...val] : (typeof val === 'object' && val !== null ? { ...val } : val);
    }
  }

  return {
    ...role,
    state
  };
}

// ========== 附加身份定义 ==========

const ATTACHMENTS = {
  // 警长
  sheriff: {
    id: 'sheriff',
    name: '警长',
    skills: {
      // 竞选 - 所有人可用，只在警长竞选阶段
      [ACTION.SHERIFF_CAMPAIGN]: {
        type: 'instant',
        availablePhases: [PHASE.SHERIFF_CAMPAIGN],
        canUse: (player, game) => player.alive && !player.state?.withdrew,
        execute: (_, player, game) => {
          player.state = player.state || {};
          player.state.isCandidate = true;
          return { success: true, run: true };
        }
      },
      // 退水 - 候选人可用，只在警长发言阶段
      [ACTION.WITHDRAW]: {
        type: 'instant',
        availablePhases: [PHASE.SHERIFF_SPEECH],
        canUse: (player, game) => player.state?.isCandidate && !player.state?.withdrew,
        execute: (_, player, game) => {
          player.state.withdrew = true;
          // 广播退水消息
          game.message.add({
            type: MSG.SYSTEM,
            content: buildMessage('WITHDRAW', {
              player: getPlayerDisplay(game.players, player)
            }),
            visibility: VISIBILITY.PUBLIC
          });
          return { success: true, withdraw: true };
        }
      },
      // 指定发言顺序 - 警长可用
      [ACTION.ASSIGN_ORDER]: {
        type: 'target',
        availablePhases: [PHASE.DAY_DISCUSS],
        canUse: (player, game) => game.sheriff === player.id && player.alive,
        validate: (target, player, game) => target?.alive && target.id !== player.id,
        execute: (target, player, game) => {
          game.sheriffAssignOrder = target.id;
          game.message.add({
            type: MSG.SYSTEM,
            content: buildMessage('SHERIFF_ASSIGN_ORDER', {
              player: getPlayerDisplay(game.players, target)
            }),
            visibility: VISIBILITY.PUBLIC
          });
          return { success: true };
        }
      },
      // 传递警徽
      [ACTION.PASS_BADGE]: {
        type: 'target',
        availablePhases: [PHASE.DAY_ANNOUNCE, PHASE.POST_VOTE],
        canUse: (player, game) => game.sheriff === player.id && !player.alive,
        validate: (target, player, game) => target?.alive && target?.id !== player.id,
        execute: (target, player, game) => {
          const alivePlayers = game.players.filter(p => p.alive && p.id !== player.id);
          // 无存活玩家，警徽流失
          if (alivePlayers.length === 0 || !target) {
            game.sheriff = null;
            game.sheriffAssignOrder = null;
            game.message.add({
              type: MSG.SYSTEM,
              content: '警长死亡，警徽流失',
              visibility: VISIBILITY.PUBLIC
            });
            return { success: true, flowed: true };
          }
          // 传警徽给目标
          game.sheriff = target.id;
          game.sheriffAssignOrder = null;
          game.message.add({
            type: MSG.SYSTEM,
            content: `警长传警徽给 ${getPlayerDisplay(game.players, target)}`,
            visibility: VISIBILITY.PUBLIC
          });
          return { success: true };
        }
      }
    }
  },

  // 情侣（附加身份）
  couple: {
    id: 'couple',
    name: '情侣',
    skills: {},
    events: {
      'player:death': (data, game, player) => {
        // 情侣死亡，伴侣殉情
        if (data.player.id !== player.id) return;

        const partner = game.players.find(p =>
          game.couples?.includes(p.id) &&
          p.id !== player.id &&
          p.alive
        );

        if (partner) {
          partner.deathReason = DEATH_REASON.COUPLE;
          game.deathQueue.push(partner);
        }
      }
    }
  }
};

module.exports = { ATTACHMENTS, createPlayerRole };