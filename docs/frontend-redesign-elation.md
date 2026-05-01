# 前端重设计：二相乐园 × 欢愉狼人杀

## 核心美学

二相乐园（4.0版本）的关键视觉要素：
- **面具/假面** — 幻月游戏的入场券，8枚面具，身份隐藏与揭示
- **二次元/漫画风** — 二维市、粗描边、对话框、漫画分镜
- **欢愉霓虹** — 粉紫撞色、荧光青、全息光效
- **游戏化一切** — 冲突也变成游戏，HUD化、成就弹窗
- **满月/幻月** — 夜晚的核心意象，阿哈的注视
- **阿哈的笑** — 标志性面具笑脸

与狼人杀的天然契合：狼人杀本身就是面具游戏、身份博弈、夜晚与白天的轮转。

---

## 1. 色彩体系 — 欢愉命途

```css
:root {
  /* 主色 — 欢愉粉紫 */
  --elation-pink: #ff6b9d;
  --elation-purple: #c77dff;
  --elation-cyan: #7df9ff;
  --elation-gold: #ffd166;

  /* 背景 — 二相乐园夜空 */
  --bg-deep: #0d0a1a;
  --bg-mid: #1a1035;
  --bg-surface: rgba(255, 107, 157, 0.06);

  /* 功能色 */
  --wolf-crimson: #ff4d6a;
  --good-cyan: #7df9ff;
  --death-purple: #9b59b6;
  --vote-gold: #ffd166;
  --sheriff-gold: #f0c040;

  /* 命途色 — 技能按钮 */
  --path-preservation: #f0c040;   /* 守卫-存护 */
  --path-erudition: #7dd3fc;      /* 预言家-智识 */
  --path-nihility: #9b59b6;       /* 女巫-虚无 */
  --path-destruction: #ff4d6a;    /* 猎人-毁灭 */
  --path-harmony: #ff6b9d;        /* 丘比特-同谐 */
  --path-elation: #c77dff;        /* 欢愉（投票/通用） */

  /* 文字 */
  --text-primary: #f0e6ff;
  --text-secondary: #a89cc8;
  --text-muted: #6b5f8a;
}
```

---

## 2. 玩家卡片 — 面具系统

每个玩家是一张面具卡片：

- **存活时**：显示角色圆形头像（icon.webp），外圈是欢愉命途色光环
- **死亡时**：面具碎裂动画（CSS clip-path + grayscale），头像变灰 + 对角裂纹
- **当前发言者**：头像外圈脉冲发光（@keyframes elationPulse，粉紫渐变）
- **自己**：头像右下角有「你」标记，用欢愉粉底色
- **警长**：头像上方悬浮 sheriff 徽章，用金色命途光效
- **未加入/空位**：显示阿哈面具剪影轮廓，虚线描边
- **情侣标记**：💕 替换为命途粉心光效

头像加载：后端返回 AI 角色的 profile 名称，前端请求 `/profiles/:name/icon.webp`。

```css
.player-avatar {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  border: 2px solid var(--elation-purple);
  object-fit: cover;
  background: var(--bg-deep);
}

.player-card.dead .player-avatar {
  filter: grayscale(1) brightness(0.5);
  border-color: var(--text-muted);
  clip-path: polygon(0 0, 45% 0, 50% 48%, 55% 0, 100% 0,
                     100% 100%, 55% 100%, 50% 52%, 45% 100%, 0 100%);
}

.player-card.current .player-avatar {
  animation: elationPulse 1.5s ease-in-out infinite;
  box-shadow: 0 0 12px var(--elation-pink), 0 0 24px var(--elation-purple);
}

@keyframes elationPulse {
  0%, 100% { box-shadow: 0 0 12px var(--elation-pink), 0 0 24px var(--elation-purple); }
  50% { box-shadow: 0 0 20px var(--elation-pink), 0 0 40px var(--elation-purple); }
}
```

---

## 3. 阶段分割线 — 幻月幕布

- **夜晚**：满月图案 + 深紫幕布 + 星点 + 「第N夜 · 幻月之下」
- **白天**：日轮图案 + 暖金幕布 + 光粒子 + 「第N天 · 聚光灯下」
- 分割线两侧用阿哈面具弧线装饰（✧ ⟡ ✦）

```css
.phase-divider.night span {
  background: linear-gradient(135deg, var(--bg-deep), #2a1a4a);
  color: var(--elation-cyan);
  border: 1px solid rgba(125, 249, 255, 0.2);
}

.phase-divider.day span {
  background: linear-gradient(135deg, #2a1f0a, #1a1520);
  color: var(--elation-gold);
  border: 1px solid rgba(255, 209, 102, 0.2);
}
```

---

## 4. 消息气泡 — 漫画对话框

二相乐园是二次元/漫画世界，消息用漫画对话框风格：

- **发言消息**：左下角小三角指向发送者，背景半透明粉紫，左侧角色命途色竖条
- **系统消息**：全息面板风格，顶部渐变光条
- **死亡消息**：红色光条 + 面具碎裂标记
- **狼人频道**：暗紫底 + 虚空紫光晕，暗网通讯感
- **遗言**：opacity 0.85 + 斜体，灵魂消散感
- **私密消息**：虚线边框 + 锁图标，加密通讯风

---

## 5. 操作区 — 命途技能面板

每种技能按钮用对应命途色描边 + 微光：

- 守卫(存护) = 金色边框 + 盾牌图标
- 预言家(智识) = 蓝紫边框 + 眼睛图标
- 女巫(虚无) = 暗紫边框 + 药瓶图标
- 猎人(毁灭) = 红色边框 + 箭头图标
- 投票(欢愉) = 粉紫边框 + 面具图标
- 输入框：底部固定「梦境终端」风格，荧光边框
- 「准备」按钮 → 「入梦」按钮，入场动画

---

## 6. 设置面板 — 幻月游戏入口

- 标题「幻月游戏」+ 阿哈面具装饰
- 副标题「天黑请闭眼」
- 板子选择卡片：漫画分镜风格，选中时命途色发光
- 名字输入框：霓虹描边
- 「入梦」按钮：大号粉紫渐变，hover 时面具微笑动画

---

## 7. 日夜视觉切换

```css
body.phase-night {
  background: linear-gradient(170deg, #0d0a1a 0%, #1a1035 50%, #0d0a1a 100%);
}
body.phase-night::before {
  content: '';
  position: fixed;
  top: -20vh;
  right: -10vw;
  width: 40vw;
  height: 40vw;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(125,249,255,0.08) 0%, transparent 70%);
  pointer-events: none;
}

body.phase-day {
  background: linear-gradient(170deg, #1a1520 0%, #2a1f2a 50%, #1a1520 100%);
}
```

---

## 8. 游戏结算 — 命途启示

- 胜利阵营：命途色大字 + 阿哈面具动画（好人胜=微笑，狼人胜=哭泣）
- 玩家列表：用 splash_art.webp 立绘展示真实身份，卡片翻转揭示
- 「再来一局」→ 欢愉风格确认按钮

---

## 9. 角色立绘使用场景

**A. 游戏结算页**：每个玩家卡片从背面（阿哈面具）翻转到正面（角色立绘+身份）。

**B. 玩家详情弹窗**：点击玩家头像，弹出半屏弹窗，上方立绘，下方角色信息。

**C. 身份揭示**：游戏开始分配身份时，全屏展示自己的角色立绘+身份名+简短描述，3秒后收起。

---

## 10. 实施优先级

| 阶段 | 内容 | 工作量 | 冲击力 |
|------|------|--------|--------|
| P0 | 色彩体系 + 背景渐变 + 日夜切换 | 小 | 极高 |
| P0 | 玩家卡片面具化 + 头像显示 | 中 | 极高 |
| P0 | 阶段分割线幻月化 | 小 | 高 |
| P1 | 消息气泡漫画风 | 中 | 高 |
| P1 | 操作区命途色改造 | 中 | 高 |
| P1 | 设置面板幻月游戏化 | 中 | 中 |
| P2 | 角色立绘（结算/弹窗/揭示） | 大 | 高 |
| P2 | 微交互动画 | 大 | 中 |

---

## 后端配合

- API 返回 AI 玩家的 profile 名称，前端据此加载 icon.webp
- 静态文件服务 ai/profiles/*/icon.webp 和 splash_art.webp
- 游戏开始时推送身份分配事件，前端触发立绘揭示动画