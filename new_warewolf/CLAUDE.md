# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A **Werewolf (狼人杀) game** with a configurable rule engine, AI players, web frontend, and WebSocket server.

## Commands

```bash
# Start the server
npm start
# Hot reload (Node.js --watch)
npm run dev
# Run all tests
node test/game.test.js
# Run a single test (modify test file temporarily)
# Debug mode
node --inspect server.js
node server.js --debug  # Enable debug mode in app
```

Server runs at `http://localhost:3000`.

## Architecture

### Core Principle: Config-Driven Design

- **GameEngine** (`engine/main.js`): Pure state driver with NO business logic. Only provides low-level APIs (`callSpeech`, `callVote`, `callSkill`, `handleDeath`, `buildActionData`).
- **PhaseManager** (`engine/phase.js`): Executes game flow via `PHASE_FLOW` array and phase `execute()` functions.
- **config.js** (`engine/config.js`): ALL business rules—roles, camps, win conditions, rule configurations, hooks (`getCamp`, `getVoteWeight`, `hasLastWords`, `ACTION_FILTERS`).
- **roles.js** (`engine/roles.js`): Role definitions with skills, constraints, event listeners. Includes `ATTACHMENTS` for sheriff/couple.

### Data Flow

```
Phase (phase.js) → GameEngine (main.js) → PlayerController (player.js) → AIController/HumanController → MessageManager → Client
```

### Key Design Patterns

1. **Config-driven**: Add roles/mechanics by modifying `config.js` and `roles.js`, not engine code
2. **Interface alignment**: AI and human controllers have identical method signatures (`getSpeechResult`, `getVoteResult`, `useSkill`)
3. **Event-driven**: Roles subscribe to events (`player:death`, `player:vote`, etc.) via listeners; return `{ cancel: true }` to cancel
4. **Phase-based**: Game flows through `PHASE_FLOW` with condition checking
5. **Request-Action**: Human players use `game.requestAction()` for WebSocket-based interaction

### Phase Flow

**First Night**: cupid → guard → night_werewolf_discuss → night_werewolf_vote → witch → seer → hunter_night
**Other Nights**: guard → night_werewolf_discuss → night_werewolf_vote → witch → seer → hunter_night
**First Day**: sheriff_campaign → sheriff_speech → sheriff_vote → day_announce → day_discuss → day_vote → post_vote
**Other Days**: day_announce → day_discuss → day_vote → post_vote

### Phase Types

| Type | Description | Completion |
|------|-------------|------------|
| `speech` | Sequential speaking | All speak |
| `vote` | Parallel voting | All vote |
| `target` | Select target | Execute |
| `choice` | Multi-choice (witch) | Complete/end |
| `campaign` | Opt-in (sheriff) | All decide |
| `instant` | Instant action (explode, withdraw) | Immediate |

### Win Conditions

- **Good**: All wolves eliminated
- **Wolf**: All gods killed OR all villagers killed (屠边)
- **Third** (couple): Both lovers alive, all others dead

## Adding New Mechanics

1. Add phase to `PHASE_FLOW` in `phase.js`
2. Add/modify role in `roles.js` with skills, events, constraints
3. Add hooks in `config.js` (`getVoteWeight`, `canVote`, `hasLastWords`, etc.)
4. Add action filters in `config.js` (`ACTION_FILTERS`) for target validation
5. Add tests in `test/game.test.js` using `createTestGame()` helper

## AI Configuration

Create `api_key.conf` for LLM-based AI:

```json
{
  "base_url": "https://api.example.com/v1",
  "auth_token": "your-token",
  "model": "model-name"
}
```

Without this file, AI uses `RandomAgent` (random decisions).

### AI Agent Types

- `llm`: Uses LLM API for decisions (requires `api_key.conf`)
- `random`: Random decisions based on available options
- `mock`: Preset behaviors for testing (use `setResponse()` in tests)

## Testing

Tests use `MockAgent` for deterministic behavior:

```javascript
const { game, aiControllers } = createTestGame(9);
setAI(aiControllers, playerId, 'vote', targetId);  // Set vote target
setAI(aiControllers, playerId, 'witch', { action: 'heal' });  // Set witch action
await game.phaseManager.executePhase('day_vote');
```

## Key Files

| File | Purpose |
|------|---------|
| `server.js` | Express + WebSocket entry, HTTP static file server |
| `engine/main.js` | GameEngine (pure state driver) |
| `engine/phase.js` | PhaseManager + PHASE_FLOW |
| `engine/config.js` | Business rules (RULES, WIN_CONDITIONS, HOOKS, ACTION_FILTERS) |
| `engine/roles.js` | Role definitions + ATTACHMENTS (sheriff, couple) |
| `engine/player.js` | PlayerController base class + HumanController |
| `engine/message.js` | MessageManager with visibility control (public/self/camp/couple) |
| `engine/vote.js` | VoteManager for vote calculation and election resolution |
| `engine/night.js` | NightManager for night action resolution |
| `ai/controller.js` | AIController + AIManager (LLM/Random/Mock agents) |
| `ai/prompts.js` | System prompts, phase prompts, AI profiles |
| `ai/agents/` | Individual agent implementations |
| `test/game.test.js` | 70+ test cases using MockAgent |

## Debugging

- Enable debug mode: `node server.js --debug`
- State includes `debugMode` flag for frontend
- Players can select `debugRole` during join for testing
- Logs: `logs/backend.log`, `logs/agent.log`, `logs/frontend.log`

## Common Tasks

### Add a new role
1. Define in `roles.js` with `id`, `name`, `camp`, `type`, `skills`, `events`
2. Add role to role pool in `engine/main.js` `assignRoles()`
3. Add to `ai/prompts.js` for AI prompts

### Add a new phase
1. Add to `PHASE_FLOW` in `phase.js` with `id`, `name`, `condition`, `execute`
2. Handle in game loop if needed

### Modify game rules
1. Update `RULES` in `config.js`
2. Update `HOOKS` for custom behavior
3. Update `WIN_CONDITIONS` if changing victory logic

## Memtion
1. 总是保证每个测试用例都能跑通
2. 文档不要有大段代码，用自然语言或伪代码描述逻辑