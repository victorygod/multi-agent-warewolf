# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

## Commands

```bash
npm start                    # Start server at http://localhost:3000
npm run dev                  # Start with --watch (auto-restart on changes)
node server.js --debug       # Enable debug mode (allows role selection)

node test/helpers/test-runner.js                           # Run all tests
node test/helpers/test-runner.js --dir test/unit            # Unit tests only
node test/helpers/test-runner.js --dir test/integration     # Integration tests only
node test/helpers/test-runner.js --file test/unit/engine/phase.test.js  # Single file
node test/helpers/test-runner.js --grep "角色"              # Pattern match

node cli_client.js           # CLI client for manual game simulation
```

## Architecture

### Game Flow

`server.js` → `ServerCore` → `GameEngine` → `PhaseManager` → `PHASE_FLOW`

1. **ServerCore** (`server-core.js`): WebSocket server, player connection management, message routing. Override hooks (`createAIManager`, `createAI`, `shouldAutoStart`) for test injection.
2. **GameEngine** (`engine/main.js`): Game state, player actions API (`callSpeech`, `callVote`, `callSkill`), death chain processing, role assignment. Does NOT drive game flow — that's PhaseManager's job.
3. **PhaseManager** (`engine/phase.js`): Drives game via `PHASE_FLOW` array. Each phase has `id`, `name`, optional `condition`, and `execute(game)`. Loop: outer = rounds, inner = phases per round.
4. **PlayerController** (`engine/player.js`): Base class with shared skill execution logic. `HumanController` subclass uses `requestAction` (WebSocket). `AIController` (in `ai/controller.js`) uses the Agent system.

### Key Design Patterns

- **Phase calls Engine API, Engine calls Controller**: Phase flow calls `game.callSkill()`, `game.callVote()`, `game.callSpeech()`. Engine resolves to `PlayerController` (AI or Human) which handles the actual decision.
- **Tool-based AI decisions**: AI Agent (`ai/agent/agent.js`) uses LLM function calling. Each ACTION type has a corresponding tool in `ai/agent/tools.js` with `buildSchema` and `execute`. Agent loop: LLM call → tool call → execute → append to history.
- **Message visibility**: `MessageManager` (`engine/message.js`) stores all messages. Each message has `visibility` (PUBLIC/SELF/CAMP/COUPLE). `getVisibleTo(player, game)` filters using `VisibilityRules`.
- **Config-driven rules**: `engine/config.js` defines `BOARD_PRESETS` (role compositions, rule overrides, win conditions), `HOOKS` (getCamp, hasLastWords, checkWin), and `ACTION_FILTERS` (target validation). `getEffectiveRules(preset)` merges preset rules over defaults.
- **Role system**: `engine/roles.js` defines roles with `skills` (target/double_target/choice/instant types) and `events` (player:death). `ATTACHMENTS` defines sheriff and couple as overlay identities.

### AI Agent Pipeline

`AIController.buildContext()` → `Agent.enqueue()` → `Agent.answer()` → model fallback chain (MockModel → LLMModel → RandomModel) → `_agentLoop()` with tool calling → result back to Controller.

- `ai/agent/prompt.js`: System prompt construction, per-action task prompts, AI profile loading from `ai/profiles/`
- `ai/agent/message_manager.js`: Per-player message history with LLM context compression
- `ai/agent/formatter.js`: Formats game messages into LLM-consumable text
- `ai/agent/tools.js`: Tool registry with `registerTool`, `getTool`, `getToolsForAction`

### Constants

All enums in `engine/constants.js`: `PHASE`, `ACTION`, `MSG`, `VISIBILITY`, `CAMP`, `ROLE_TYPE`, `DEATH_REASON`, `MSG_TEMPLATE`. Action IDs use `action_` prefix (e.g., `action_guard`) to distinguish from phase IDs.

## Testing

Custom test framework in `test/helpers/test-runner.js` (describe/it/beforeEach/afterEach). No external test libraries.

- **Unit tests** (`test/unit/`): Use `game-harness.js` which creates `GameEngine` + mock `AIManager` with `MockModel`. Tests run <1s.
- **Integration tests** (`test/integration/`): Use `server-harness.js` which starts real WebSocket server. ~23s.
- **MockModel** (`test/helpers/mock-model.js`): Deterministic AI responses. Configure via `presetResponses` (static) and `customStrategies` (functions receiving context).
- **Timeout = bug**: MockModel responds in <10ms. If tests timeout, the logic is stuck — never increase timeout.
- **setForcedRole**: When forcing a human role, swaps with AI to avoid duplication.
- **Log isolation**: Each test file gets its own log via `setTestLogPath`/`resetTestLogPath`. Normal runs write to `logs/backend.log`.

## Important Conventions

- No comments in production code (不要在代码里加注释)
- All logging must go through `utils/logger.js` (`createLogger`). Never use `console.log` in production code.
- AI creation is near-instant (0.001s) — no async init needed.
- `api_key.conf` (gitignored) provides LLM config. Without it, AI falls back to `RandomModel`.
- Docs should use natural language or pseudocode, not large code blocks.
- Every test must pass. If a test breaks, fix the code, not the test.
