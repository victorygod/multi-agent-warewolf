# 压缩可见性过滤

## 现状

压缩逻辑内聚在 `MessageManager.compress()` 中，直接从 `this.messages`（LLM 对话历史）提取内容，不再依赖 `getVisibleMessages` 回调。

`this.messages` 中的内容来源于 `formatIncomingMessages(context)`，而 `context.messages` 由 `AIController.buildContext()` 通过 `this.getVisibleMessages()` 获取——已在入口处完成可见性过滤。因此压缩输入天然只包含该玩家可见的消息，不存在泄露问题。

## 历史问题（已解决）

旧实现中 `compressHistoryAfterVote` 直接接收 `game.message.messages`（全量消息），导致非狼人玩家的压缩摘要包含狼人讨论等 `visibility=camp` 的消息。

修复方式：改为从 `this.messages` 提取压缩内容，而非绕回原始游戏消息队列。