/**
 * tools.js - 工具定义集
 * 每个工具 = schema + execute，自包含
 * 所有工具都支持弃权（返回 skip: true）
 * 成功时返回 { success: true, action: { ... } }
 */

const { ACTION } = require('../../engine/constants');

// ========== 工具注册表 ==========
const TOOL_REGISTRY = {};

function registerTool(tool) {
  TOOL_REGISTRY[tool.name] = tool;
}

function getTool(actionType) {
  return TOOL_REGISTRY[actionType] || null;
}

function getToolsForAction(requiredAction, context) {
  const tool = getTool(requiredAction);
  if (!tool) return [];
  const schema = tool.buildSchema(context);
  return schema ? [{ type: 'function', function: schema }] : [];
}

// ========== 通用校验辅助 ==========

function validateTarget(target, alivePlayers, allowedTargets) {
  const targetId = parseInt(target);
  if (isNaN(targetId)) return '目标无效，请输入数字编号';
  if (!alivePlayers.find(p => p.id === targetId)) return `${targetId}号玩家已死亡或不存在`;
  if (allowedTargets && allowedTargets.length > 0 && !allowedTargets.includes(targetId)) {
    return `${targetId}号不在可选范围内，可选：[${allowedTargets.join(', ')}]`;
  }
  return true;
}

// 检查对象是否只包含允许的键
function validateAllowedKeys(input, allowedKeys, toolName) {
  if (typeof input !== 'object' || input === null) return null;
  const keys = Object.keys(input);
  for (const key of keys) {
    if (!allowedKeys.includes(key)) {
      return { success: false, error: `参数名错误，未知参数: ${key}，期望: ${allowedKeys.join(', ')}` };
    }
  }
  return null;
}

// ========== 工厂函数 ==========

// 投票工具工厂
function createVoteTool(name, description) {
  return {
    name,
    description,

    buildSchema(context) {
      const { extraData = {}, alivePlayers = [] } = context;
      return {
        name,
        description: this.description,
        parameters: {
          type: 'object',
          properties: {
            target: {
              type: 'integer',
              description: '要投票的玩家位置编号（1-based），弃权填 null',
              enum: extraData.allowedTargets || alivePlayers.map(p => p.id)
            }
          },
          required: []
        }
      };
    },

    execute(input, context) {
      // 弃权处理
      if (input === null || input === undefined || (typeof input === 'object' && input.target === null)) {
        return { success: true, skip: true };
      }

      const target = typeof input === 'object' ? input.target : input;
      if (target == null) {
        return { success: true, skip: true };
      }

      const validResult = validateTarget(target, context.alivePlayers, context.extraData?.allowedTargets);
      if (validResult !== true) {
        return { success: false, error: String(validResult) };
      }

      return { success: true, action: { target: parseInt(target) } };
    }
  };
}

// 讨论/发言工具工厂
function createDiscussTool(name, description) {
  return {
    name,
    description,

    buildSchema() {
      return {
        name,
        description: this.description,
        parameters: {
          type: 'object',
          properties: {
            content: { type: 'string', description: '发言内容，弃权填 null 或空字符串' }
          },
          required: []
        }
      };
    },

    execute(input, context) {
      // 参数名错误检查
      if (typeof input === 'object' && input !== null) {
        const keyError = validateAllowedKeys(input, ['content'], this.name);
        if (keyError) return keyError;
      }

      // 弃权处理
      if (input === null || input === undefined || input === '' || (typeof input === 'object' && !input.content)) {
        return { success: true, skip: true };
      }

      const content = typeof input === 'object' ? input.content : input;
      if (!content || typeof content !== 'string' || content.trim().length === 0) {
        return { success: true, skip: true };
      }

      // 参数类型检查
      if (typeof content !== 'string') {
        return { success: false, error: '参数类型错误: content 应为字符串' };
      }

      return { success: true, action: { content: content.trim() } };
    }
  };
}

// ========== 工具定义 ==========

// 投票类工具
registerTool(createVoteTool(ACTION.POST_VOTE, '投票给一名玩家'));
registerTool(createVoteTool(ACTION.DAY_VOTE, '白天投票给一名玩家'));
registerTool(createVoteTool(ACTION.SHERIFF_VOTE, '警长投票给一名玩家'));
registerTool(createVoteTool(ACTION.NIGHT_WEREWOLF_VOTE, '狼人夜间投票给一名玩家'));

// 讨论/发言类工具
registerTool(createDiscussTool(ACTION.DAY_DISCUSS, '白天发表言论'));
registerTool(createDiscussTool(ACTION.SHERIFF_SPEECH, '警长竞选发言'));
registerTool(createDiscussTool(ACTION.LAST_WORDS, '发表遗言'));
registerTool(createDiscussTool(ACTION.NIGHT_WEREWOLF_DISCUSS, '狼人夜间讨论'));

registerTool({
  name: ACTION.WITCH,
  description: '女巫使用技能',

  buildSchema(context) {
    const actionEnum = [];
    if (context.witchPotion?.heal) actionEnum.push('heal');
    if (context.witchPotion?.poison) actionEnum.push('poison');
    actionEnum.push('skip');

    return {
      name: ACTION.WITCH,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: actionEnum, description: 'heal/poison/skip' },
          target: { type: 'integer', description: '毒药目标（poison 时必填）' }
        },
        required: ['action']
      }
    };
  },

  execute(input, context) {
    // 支持简写格式：'heal', 'poison', 'skip', null
    if (typeof input === 'string') {
      input = { action: input };
    } else if (input === null || input === undefined) {
      return { success: true, skip: true };
    }

    // 参数名错误检查
    if (typeof input === 'object' && input !== null) {
      const keyError = validateAllowedKeys(input, ['action', 'target'], this.name);
      if (keyError) return keyError;
    }

    // 缺少必填参数检查
    if (typeof input !== 'object' || input === null || !('action' in input)) {
      return { success: false, error: '缺少必填参数: action' };
    }

    const action = input.action;
    const target = input.target;

    if (action === 'skip') {
      return { success: true, skip: true };
    }

    if (action === 'heal') {
      if (!context.witchPotion?.heal) {
        return { success: false, error: '解药已用完' };
      }
      return { success: true, action: { action: 'heal' } };
    }

    if (action === 'poison') {
      if (!context.witchPotion?.poison) {
        return { success: false, error: '毒药已用完' };
      }
      if (target == null) {
        return { success: false, error: '使用毒药必须指定目标' };
      }
      const validResult = validateTarget(target, context.alivePlayers, context.extraData?.poisonTargets);
      if (validResult !== true) {
        return { success: false, error: String(validResult) };
      }
      return { success: true, action: { action: 'poison', targetId: parseInt(target) } };
    }

    return { success: false, error: '无效的女巫操作，可选：heal, poison, skip' };
  }
});

registerTool({
  name: ACTION.SEER,
  description: '预言家查验一名玩家',

  buildSchema(context) {
    const checkedIds = (context.self?.seerChecks || []).map(c => c.targetId);
    const candidates = context.alivePlayers
      .filter(p => p.id !== context.self?.id && !checkedIds.includes(p.id))
      .map(p => p.id);

    return {
      name: ACTION.SEER,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          target: { type: 'integer', description: '要查验的玩家位置编号，弃权填 null', enum: candidates }
        },
        required: []
      }
    };
  },

  execute(input, context) {
    // 弃权处理
    if (input === null || input === undefined || (typeof input === 'object' && input.target === null)) {
      return { success: true, skip: true };
    }

    const target = typeof input === 'object' ? input.target : input;
    if (target == null) {
      return { success: true, skip: true };
    }

    const validResult = validateTarget(target, context.alivePlayers, context.extraData?.allowedTargets);
    if (validResult !== true) {
      return { success: false, error: String(validResult) };
    }

    return { success: true, action: { target: parseInt(target) } };
  }
});

registerTool({
  name: ACTION.GUARD,
  description: '守卫守护一名玩家',

  buildSchema(context) {
    const lastGuardTarget = context.self?.lastGuardTarget;
    const candidates = context.alivePlayers
      .filter(p => p.id !== lastGuardTarget)
      .map(p => p.id);

    return {
      name: ACTION.GUARD,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          target: { type: 'integer', description: '要守护的玩家位置编号，弃权填 null', enum: candidates }
        },
        required: []
      }
    };
  },

  execute(input, context) {
    // 弃权处理
    if (input === null || input === undefined || (typeof input === 'object' && input.target === null)) {
      return { success: true, skip: true };
    }

    const target = typeof input === 'object' ? input.target : input;
    if (target == null) {
      return { success: true, skip: true };
    }

    const validResult = validateTarget(target, context.alivePlayers);
    if (validResult !== true) {
      return { success: false, error: String(validResult) };
    }

    return { success: true, action: { target: parseInt(target) } };
  }
});

registerTool({
  name: ACTION.CUPID,
  description: '丘比特连接两名玩家为情侣',

  buildSchema() {
    return {
      name: ACTION.CUPID,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          targets: { type: 'array', items: { type: 'integer' }, description: '选择两名玩家，弃权填 null 或空数组', minItems: 2, maxItems: 2 }
        },
        required: []
      }
    };
  },

  execute(input, context) {
    // 弃权处理
    if (input === null || input === undefined) {
      return { success: true, skip: true };
    }

    // 支持简写格式：[2, 3] 数组
    let targets;
    if (Array.isArray(input)) {
      targets = input;
    } else if (typeof input === 'object') {
      // 参数名错误检查
      const keyError = validateAllowedKeys(input, ['targets'], this.name);
      if (keyError) return keyError;
      targets = input.targets;
    }

    // 参数类型检查
    if (targets !== null && targets !== undefined && !Array.isArray(targets)) {
      return { success: false, error: '参数类型错误: targets 应为包含2个整数的数组' };
    }

    if (!targets || !Array.isArray(targets) || targets.length === 0) {
      return { success: true, skip: true };
    }

    if (targets.length !== 2) {
      return { success: false, error: '必须选择两名玩家' };
    }
    if (targets[0] === targets[1]) {
      return { success: false, error: '不能选择同一名玩家' };
    }
    for (const tid of targets) {
      // 检查 targets 元素是否为数字
      if (typeof tid !== 'number' || isNaN(tid)) {
        return { success: false, error: `${tid}号玩家不是合法选项` };
      }
      if (!context.alivePlayers.find(p => p.id === parseInt(tid))) {
        return { success: false, error: `${tid}号玩家不存在` };
      }
    }

    return { success: true, action: { targets: targets.map(id => parseInt(id)) } };
  }
});

registerTool({
  name: ACTION.SHOOT,
  description: '猎人开枪带走一名玩家，或放弃开枪',

  buildSchema(context) {
    const candidates = context.alivePlayers
      .filter(p => p.id !== context.self?.id)
      .map(p => p.id);

    return {
      name: ACTION.SHOOT,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          target: { type: 'integer', description: '要带走的玩家位置编号，弃权填 null', enum: candidates }
        },
        required: []
      }
    };
  },

  execute(input, context) {
    // 弃权处理
    if (input === null || input === undefined || (typeof input === 'object' && input.target === null)) {
      return { success: true, skip: true };
    }

    const target = typeof input === 'object' ? input.target : input;
    if (target == null) {
      return { success: true, skip: true };
    }

    const validResult = validateTarget(target, context.alivePlayers, context.extraData?.allowedTargets);
    if (validResult !== true) {
      return { success: false, error: String(validResult) };
    }

    return { success: true, action: { target: parseInt(target) } };
  }
});

registerTool({
  name: ACTION.SHERIFF_CAMPAIGN,
  description: '是否参与警长竞选',

  buildSchema() {
    return {
      name: ACTION.SHERIFF_CAMPAIGN,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          run: { type: 'boolean', description: 'true 参与，false/弃权 不参与' }
        },
        required: []
      }
    };
  },

  execute(input, context) {
    // 参数名错误检查
    if (typeof input === 'object' && input !== null) {
      const keyError = validateAllowedKeys(input, ['run'], this.name);
      if (keyError) return keyError;
    }

    // 弃权处理（null/undefined/false 都算弃权）
    if (input === null || input === undefined || input === false) {
      return { success: true, skip: true };
    }

    const run = typeof input === 'object' ? input.run : input;

    // 参数类型检查
    if (run !== undefined && run !== null && typeof run !== 'boolean') {
      return { success: false, error: '参数类型错误: run 应为布尔值' };
    }

    if (!run) {
      return { success: true, skip: true };
    }

    return { success: true, action: { run: true } };
  }
});

registerTool({
  name: ACTION.WITHDRAW,
  description: '是否退出警长竞选',

  buildSchema() {
    return {
      name: ACTION.WITHDRAW,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          withdraw: { type: 'boolean', description: 'true 退出，false/弃权 继续' }
        },
        required: []
      }
    };
  },

  execute(input, context) {
    // 参数名错误检查
    if (typeof input === 'object' && input !== null) {
      const keyError = validateAllowedKeys(input, ['withdraw'], this.name);
      if (keyError) return keyError;
    }

    // 弃权处理
    if (input === null || input === undefined || input === false) {
      return { success: true, skip: true };
    }

    const withdraw = typeof input === 'object' ? input.withdraw : input;

    // 参数类型检查
    if (withdraw !== undefined && withdraw !== null && typeof withdraw !== 'boolean') {
      return { success: false, error: '参数类型错误: withdraw 应为布尔值' };
    }

    if (!withdraw) {
      return { success: true, skip: true };
    }

    return { success: true, action: { withdraw: true } };
  }
});

registerTool({
  name: ACTION.PASS_BADGE,
  description: '将警徽传给一名玩家，或不传（警徽流失）',

  buildSchema(context) {
    const candidates = context.alivePlayers
      .filter(p => p.id !== context.self?.id)
      .map(p => p.id);

    return {
      name: ACTION.PASS_BADGE,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          target: { type: 'integer', description: '传给谁的位置编号，弃权填 null', enum: candidates }
        },
        required: []
      }
    };
  },

  execute(input, context) {
    // 弃权处理
    if (input === null || input === undefined || (typeof input === 'object' && input.target === null)) {
      return { success: true, skip: true };
    }

    const target = typeof input === 'object' ? input.target : input;
    if (target == null) {
      return { success: true, skip: true };
    }

    const validResult = validateTarget(target, context.alivePlayers, context.extraData?.allowedTargets);
    if (validResult !== true) {
      return { success: false, error: String(validResult) };
    }

    return { success: true, action: { target: parseInt(target) } };
  }
});

registerTool({
  name: ACTION.ASSIGN_ORDER,
  description: '指定从哪位玩家开始发言',

  buildSchema(context) {
    const candidates = context.alivePlayers
      .filter(p => p.id !== context.self?.id)
      .map(p => p.id);

    return {
      name: ACTION.ASSIGN_ORDER,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          target: { type: 'integer', description: '开始发言的玩家位置编号，弃权填 null', enum: candidates }
        },
        required: []
      }
    };
  },

  execute(input, context) {
    // 弃权处理
    if (input === null || input === undefined || (typeof input === 'object' && input.target === null)) {
      return { success: true, skip: true };
    }

    const target = typeof input === 'object' ? input.target : input;
    if (target == null) {
      return { success: true, skip: true };
    }

    const validResult = validateTarget(target, context.alivePlayers, context.extraData?.allowedTargets);
    if (validResult !== true) {
      return { success: false, error: String(validResult) };
    }

    return { success: true, action: { target: parseInt(target) } };
  }
});

module.exports = { getTool, getToolsForAction, TOOL_REGISTRY };
