/**
 * 角色定义 - 技能、约束、事件监听
 */

const { getCamp, RULES } = require('./config');
const { getPlayerDisplay } = require('./utils');

// 角色定义
const ROLES = {
  // === 好人阵营 ===

  // 平民
  villager: {
    id: 'villager',
    name: '平民',
    camp: 'good',
    type: 'villager',
    skills: {},
    constraints: { canExplode: false, canSelfKill: false }
  },

  // 预言家
  seer: {
    id: 'seer',
    name: '预言家',
    camp: 'good',
    type: 'god',
    state: { seerChecks: [] },
    skills: {
      seer: {
        type: 'target',
        visibility: 'self',
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
          const isWolf = getCamp(target, game) === 'wolf';
          // 记录查验历史
          player.state.seerChecks = player.state.seerChecks || [];
          player.state.seerChecks.push({
            targetId: target.id,
            result: isWolf ? 'wolf' : 'good',
            night: game.nightCount
          });
          game.message.add({
            type: 'action',
            content: `你查验了 ${getPlayerDisplay(game.players, target)}，TA是${isWolf ? '狼人' : '好人'}`,
            playerId: player.id,
            visibility: 'self',
            metadata: { targetId: target.id, result: isWolf ? 'wolf' : 'good' }
          });
        }
      }
    },
    constraints: { canExplode: false, canSelfKill: false }
  },

  // 女巫
  witch: {
    id: 'witch',
    name: '女巫',
    camp: 'good',
    type: 'god',
    state: { heal: 1, poison: 1 },
    skills: {
      witch: {
        type: 'choice',
        visibility: 'self',
        execute: (choice, player, game) => {
          const { action, targetId } = choice;

          // 使用解药
          if (action === 'heal' && player.state.heal > 0) {
            if (game.werewolfTarget && !RULES.witch.canSelfHeal && game.werewolfTarget === player.id) {
              return { success: false, message: '不能自救' };
            }
            player.state.heal--;
            game.healTarget = game.werewolfTarget;
            game.message.add({
              type: 'action',
              content: `你使用解药救了 ${getPlayerDisplay(game.players, game.players.find(p => p.id === game.werewolfTarget))}`,
              playerId: player.id,
              visibility: 'self'
            });
          }

          // 使用毒药
          if (action === 'poison' && player.state.poison > 0 && targetId) {
            const target = game.players.find(p => p.id === targetId);
            if (!target?.alive) return { success: false, message: '目标已死亡' };
            player.state.poison--;
            game.poisonTarget = targetId;
            game.message.add({
              type: 'action',
              content: `你毒杀了 ${getPlayerDisplay(game.players, target)}`,
              playerId: player.id,
              visibility: 'self'
            });
          }

          return { success: true };
        }
      }
    },
    constraints: { canExplode: false, canSelfKill: false }
  },

  // 猎人
  hunter: {
    id: 'hunter',
    name: '猎人',
    camp: 'good',
    type: 'god',
    state: { canShoot: true },
    skills: {
      // 猎人射击 - 死亡时触发（白天公布死讯时和白天放逐后）
      shoot: {
        type: 'target',
        availablePhases: ['day_announce', 'post_vote'],
        canUse: (player, game, extraData) => {
          const deathReason = extraData?.deathReason || 'wolf';
          if (!player.state.canShoot) return false;
          // 被毒死或同守同救不能开枪
          if (deathReason === 'poison' || deathReason === 'conflict') return false;
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
              type: 'action',
              content: `猎人 ${getPlayerDisplay(game.players, player)} 选择放弃开枪`,
              playerId: player.id,
              visibility: 'public'
            });
            return { success: true, skipped: true };
          }
          if (!target.alive) return;
          player.state.canShoot = false;
          target.deathReason = 'hunter'; // 设置死亡原因
          game.deathQueue.push(target);
          game.message.add({
            type: 'action',
            content: `猎人 ${getPlayerDisplay(game.players, player)} 开枪带走了 ${getPlayerDisplay(game.players, target)}`,
            playerId: player.id,
            visibility: 'public'
          });
        }
      }
    },
    events: {
      'player:death': (data, game, player) => {
        console.log(`[Hunter Event] player:death 触发: player=${player.id}, reason=${data.reason}, canShoot before=${player.state.canShoot}`);
        // 被毒死或同守同救不能开枪
        if (data.player.id === player.id && (data.reason === 'poison' || data.reason === 'conflict')) {
          player.state.canShoot = false;
          console.log(`[Hunter Event] 猎人被${data.reason === 'poison' ? '毒死' : '同守同救'}，设置 canShoot = false`);
        }
      }
    },
    constraints: { canExplode: false, canSelfKill: false }
  },

  // 守卫
  guard: {
    id: 'guard',
    name: '守卫',
    camp: 'good',
    type: 'god',
    state: { lastGuardTarget: null },
    skills: {
      guard: {
        type: 'target',
        visibility: 'self',
        validate: (target, player, game) => {
          if (!target.alive) return false;
          if (!RULES.guard.allowRepeatGuard && player.state.lastGuardTarget === target.id) {
            return false;
          }
          return true;
        },
        execute: (target, player, game) => {
          player.state.lastGuardTarget = target.id;
          game.guardTarget = target.id;
          game.message.add({
            type: 'action',
            content: `你守护了 ${getPlayerDisplay(game.players, target)}`,
            playerId: player.id,
            visibility: 'self'
          });
        }
      }
    },
    constraints: { canExplode: false, canSelfKill: false }
  },

  // 白痴
  idiot: {
    id: 'idiot',
    name: '白痴',
    camp: 'good',
    type: 'god',
    state: { revealed: false, canVote: true },
    skills: {},
    events: {
      'player:death': (data, game, player) => {
        // 被投票出局时免疫
        if (data.player.id === player.id && data.reason === 'vote' && !player.state.revealed) {
          player.state.revealed = true;
          player.state.canVote = false;
          player.alive = true; // 免疫死亡
          game.message.add({
            type: 'action',
            content: `白痴 ${getPlayerDisplay(game.players, player)} 翻牌免疫放逐`,
            playerId: player.id,
            visibility: 'public'
          });
          return { cancel: true };
        }
      }
    },
    constraints: { canExplode: false, canSelfKill: false }
  },

  // 丘比特
  cupid: {
    id: 'cupid',
    name: '丘比特',
    camp: 'good',
    type: 'god',
    skills: {
      cupid: {
        type: 'double_target',
        visibility: 'couple',
        validate: (targets, player, game) => {
          if (targets.length !== 2) return false;
          // 丘比特可以选择自己作为情侣之一
          return targets.every(t => t.alive);
        },
        execute: (targets, player, game) => {
          game.couples = targets.map(t => t.id);
          game.message.add({
            type: 'action',
            content: `你连接了 ${getPlayerDisplay(game.players, targets[0])} 和 ${getPlayerDisplay(game.players, targets[1])} 为情侣`,
            playerId: player.id,
            visibility: 'self'
          });
          // 通知情侣
          targets.forEach(t => {
            game.message.add({
              type: 'system',
              content: `你和 ${getPlayerDisplay(game.players, targets.find(x => x.id !== t.id))} 是情侣`,
              playerId: t.id,
              visibility: 'self'
            });
          });
        }
      }
    },
    constraints: { canExplode: false, canSelfKill: false }
  },

  // === 狼人阵营 ===

  // 狼人
  werewolf: {
    id: 'werewolf',
    name: '狼人',
    camp: 'wolf',
    type: 'wolf',
    skills: {
      // 狼人自爆 - 白天任意阶段可触发
      explode: {
        type: 'instant',
        availablePhases: ['sheriff_campaign', 'sheriff_speech', 'sheriff_vote', 'day_discuss', 'day_vote'],
        canUse: (player) => player.alive,
        execute: (_, player, game) => {
          player.alive = false;

          // 广播自爆消息
          game.message.add({
            type: 'explode',
            content: `狼人 ${getPlayerDisplay(game.players, player)} 自爆`,
            playerId: player.id,
            visibility: 'public'
          });

          // 警长没选出来时自爆，提示警徽流失
          if (!game.sheriff && ['sheriff_campaign', 'sheriff_speech', 'sheriff_vote'].includes(game.phaseManager?.getCurrentPhase()?.id)) {
            game.message.add({
              type: 'system',
              content: '警徽流失',
              visibility: 'public'
            });
          }

          return { success: true };
        }
      }
    },
    constraints: { canExplode: true, canSelfKill: true }
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

  return {
    ...role,
    state: role.state ? { ...role.state } : {}
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
      campaign: {
        type: 'instant',
        availablePhases: ['sheriff_campaign'],
        canUse: (player, game) => player.alive && !player.state?.withdrew,
        execute: (_, player, game) => {
          player.state = player.state || {};
          player.state.isCandidate = true;
          return { success: true, run: true };
        }
      },
      // 退水 - 候选人可用，只在警长发言阶段
      withdraw: {
        type: 'instant',
        availablePhases: ['sheriff_speech'],
        canUse: (player, game) => player.state?.isCandidate && !player.state?.withdrew,
        execute: (_, player, game) => {
          player.state.withdrew = true;
          // 广播退水消息
          game.message.add({
            type: 'system',
            content: `${getPlayerDisplay(game.players, player)} 退水`,
            visibility: 'public'
          });
          return { success: true, withdraw: true };
        }
      },
      // 指定发言顺序 - 警长可用
      assignOrder: {
        type: 'target',
        availablePhases: ['day_discuss'],
        canUse: (player, game) => game.sheriff === player.id && player.alive,
        validate: (target, player, game) => target?.alive && target.id !== player.id,
        execute: (target, player, game) => {
          game.sheriffAssignOrder = target.id;
          game.message.add({
            type: 'system',
            content: `警长指定从 ${getPlayerDisplay(game.players, target)} 开始发言`,
            visibility: 'public'
          });
          return { success: true };
        }
      },
      // 传递警徽
      passBadge: {
        type: 'target',
        availablePhases: ['day_announce', 'post_vote'],
        canUse: (player, game) => game.sheriff === player.id && !player.alive,
        validate: (target, player, game) => target?.alive && target?.id !== player.id,
        execute: (target, player, game) => {
          const alivePlayers = game.players.filter(p => p.alive && p.id !== player.id);
          // 无存活玩家，警徽流失
          if (alivePlayers.length === 0 || !target) {
            game.sheriff = null;
            game.sheriffAssignOrder = null;
            game.message.add({
              type: 'system',
              content: '警长死亡，警徽流失',
              visibility: 'public'
            });
            return { success: true, flowed: true };
          }
          // 传警徽给目标
          game.sheriff = target.id;
          game.sheriffAssignOrder = null;
          game.message.add({
            type: 'system',
            content: `警长传警徽给 ${getPlayerDisplay(game.players, target)}`,
            visibility: 'public'
          });
          return { success: true };
        }
      }
    },
    // 警长死亡事件
    events: {
      'player:death': (data, game, player) => {
        // 警长死亡时标记
        if (data.player.id === game.sheriff) {
          player.state = player.state || {};
          player.state.sheriffDied = true;
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
          partner.deathReason = 'couple';
          game.deathQueue.push(partner);
          game.message.add({
            type: 'system',
            content: `${getPlayerDisplay(game.players, partner)} 殉情`,
            visibility: 'public'
          });
        }
      }
    }
  }
};

// 获取附加身份定义
function getAttachment(attachmentId) {
  return ATTACHMENTS[attachmentId] || null;
}

module.exports = { ROLES, ATTACHMENTS, getRole, createPlayerRole, getAttachment };