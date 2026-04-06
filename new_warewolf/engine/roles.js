/**
 * 角色定义 - 技能、约束、事件监听
 */

const { RULES, getCamp } = require('./config');

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
    skills: {
      seer: {
        type: 'target',
        visibility: 'self',
        validate: (target, player, game) => target.id !== player.id && target.alive,
        execute: (target, player, game) => {
          const isWolf = getCamp(target, game) === 'wolf';
          game.message.add({
            type: 'action',
            content: `你查验了 ${target.name}，TA是${isWolf ? '狼人' : '好人'}`,
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
              content: `你使用解药救了 ${game.players.find(p => p.id === game.werewolfTarget)?.name}`,
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
              content: `你毒杀了 ${target.name}`,
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
    skills: {},
    globalAbilities: [{
      id: 'shoot',
      availablePhases: ['day_speech', 'day_vote', 'last_words'],
      canUse: (player) => player.state.canShoot && !player.alive,
      execute: (target, player, game) => {
        if (!target?.alive) return { action: 'continue' };
        player.state.canShoot = false;
        game.deathQueue.push(target);
        game.message.add({
          type: 'action',
          content: `猎人 ${player.name} 开枪带走了 ${target.name}`,
          playerId: player.id,
          visibility: 'public'
        });
        return { action: 'continue' };
      }
    }],
    events: {
      'player:death': (data, player, game) => {
        // 被毒死不能开枪
        if (data.player.id === player.id && data.reason === 'poison') {
          player.state.canShoot = false;
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
            content: `你守护了 ${target.name}`,
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
            content: `白痴 ${player.name} 翻牌免疫放逐`,
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
          return targets.every(t => t.alive && t.id !== player.id);
        },
        execute: (targets, player, game) => {
          game.couples = targets.map(t => t.id);
          game.message.add({
            type: 'action',
            content: `你连接了 ${targets[0].name} 和 ${targets[1].name} 为情侣`,
            playerId: player.id,
            visibility: 'self'
          });
          // 通知情侣
          targets.forEach(t => {
            game.message.add({
              type: 'system',
              content: `你和 ${targets.find(x => x.id !== t.id).name} 是情侣`,
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
      werewolf: {
        type: 'target',
        visibility: 'camp',
        validate: (target, player, game) => target.alive,
        execute: (target, player, game) => {
          game.werewolfTarget = target.id;
          game.message.add({
            type: 'action',
            content: `狼人选择击杀 ${target.name}`,
            playerId: player.id,
            visibility: 'camp'
          });
        }
      }
    },
    globalAbilities: [{
      id: 'explode',
      availablePhases: ['sheriff_campaign', 'sheriff_speech', 'sheriff_vote', 'day_speech', 'day_vote'],
      canUse: (player) => player.alive,
      execute: (_, player, game) => {
        player.alive = false;
        game.sheriff = null; // 吞警徽
        game.message.add({
          type: 'action',
          content: `狼人 ${player.name} 自爆`,
          playerId: player.id,
          visibility: 'public'
        });
        return { action: 'jumpToPhase', phase: 'night_resolve' };
      }
    }],
    constraints: { canExplode: true, canSelfKill: true }
  },

  // 狼美人
  wolf_beauty: {
    id: 'wolf_beauty',
    name: '狼美人',
    camp: 'wolf',
    type: 'wolf',
    skills: {
      wolf_beauty: {
        type: 'target',
        visibility: 'self',
        validate: (target, player, game) => target.alive && getCamp(target, game) !== 'wolf',
        execute: (target, player, game) => {
          game.werewolfTarget = target.id;
          game.charmTarget = target.id;
          game.message.add({
            type: 'action',
            content: `你魅惑了 ${target.name}`,
            playerId: player.id,
            visibility: 'self'
          });
        }
      }
    },
    events: {
      'player:death': (data, game, player) => {
        // 狼美人死亡时，被魅惑者跟随死亡
        if (data.player.id === player.id && game.charmTarget) {
          const charmed = game.players.find(p => p.id === game.charmTarget);
          if (charmed?.alive) {
            game.deathQueue.push(charmed);
          }
        }
      }
    },
    constraints: { canExplode: false, canSelfKill: false }
  },

  // 骑士（好人阵营）
  knight: {
    id: 'knight',
    name: '骑士',
    camp: 'good',
    type: 'god',
    skills: {},
    globalAbilities: [{
      id: 'duel',
      availablePhases: ['day_speech', 'day_vote'],
      canUse: (player) => player.alive,
      execute: (target, player, game) => {
        if (!target?.alive) return { action: 'continue' };

        const isWolf = getCamp(target, game) === 'wolf';
        const deadPlayer = isWolf ? target : player;

        game.message.add({
          type: 'action',
          content: `骑士 ${player.name} 决斗 ${target.name}，${isWolf ? '狼人死亡' : '骑士死亡'}`,
          playerId: player.id,
          visibility: 'public'
        });

        if (isWolf) {
          deadPlayer.alive = false;
          return { action: 'jumpToPhase', phase: 'night_resolve' };
        } else {
          game.deathQueue.push(deadPlayer);
          return { action: 'continue' };
        }
      }
    }],
    constraints: { canExplode: false, canSelfKill: false }
  }
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

// 角色名称映射
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

module.exports = { ROLES, getRole, createPlayerRole, ROLE_NAMES };