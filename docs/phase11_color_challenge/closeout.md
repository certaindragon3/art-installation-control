# Phase 11 Closeout: Color Challenge / Score Game

Date: 2026-04-20

Local URL tested: `http://127.0.0.1:3001`

Corresponding feedback: `docs/phase11_color_challenge/source/ColorHitGame.cs`

Depends on: Phase 10 final-touch economy is already delivered. Phase 11 remains separate from the Sound Economy game over state.

## Delivered

- Implemented the professor `ColorHitGame.cs` flow as a Web / Socket.IO module.
- Added independent `ReceiverState.config.colorChallenge` state for palette, assigned color, two-choice rounds, timing duration, scoring parameters, and game over.
- Server now generates each round and guarantees exactly two distinct choices with one matching `assignedColorId`.
- Receiver pages render assigned color, score, red-green-red timing bar, moving pointer, and two color buttons.
- Receiver choice submissions are server-authoritative through `submit_color_challenge_choice`.
- Server applies correct reward, wrong-choice penalty, timeout miss penalty, next-round generation, and score game over.
- Controller can show/hide, enable/disable, reset/revive, tune timing and scoring, edit palette, and export results.
- Color Challenge export is available for professor / Unity review.

## Main Files

- `shared/wsTypes.ts`
- `server/wsServer.ts`
- `server/controllerApi.ts`
- `server/wsServer.test.ts`
- `server/controllerApi.test.ts`
- `client/src/pages/Receiver.tsx`
- `client/src/pages/Controller.tsx`
- `docs/prof_submission_docs/professor-plug-and-play-commands.md`
- `docs/phase11_color_challenge/source/ColorHitGame.cs`

## API / Protocol Changes

### Receiver State Snapshot

Every receiver snapshot now includes:

```typescript
interface ColorChallengeConfig {
  visible: boolean;
  enabled: boolean;
  score: number;
  startingScore: number;
  assignedColorId: string | null;
  palette: Array<{ colorId: string; label: string; color: string }>;
  choices: Array<{ colorId: string; label: string; color: string }>;
  correctChoiceIndex: number | null;
  iterationStartedAt: string | null;
  iterationDurationMs: number;
  minIntervalMs: number;
  maxIntervalMs: number;
  maxReward: number;
  minWrongPenalty: number;
  maxWrongPenalty: number;
  missPenalty: number;
  refreshAssignedColorEachIteration: boolean;
  gameOver: boolean;
  lastResult: ColorChallengeResult | null;
}
```

Default values:

```json
{
  "visible": false,
  "enabled": false,
  "score": 1,
  "startingScore": 1,
  "assignedColorId": null,
  "palette": [
    { "colorId": "red", "label": "Red", "color": "#ef4444" },
    { "colorId": "green", "label": "Green", "color": "#22c55e" },
    { "colorId": "blue", "label": "Blue", "color": "#3b82f6" },
    { "colorId": "yellow", "label": "Yellow", "color": "#eab308" }
  ],
  "choices": [],
  "correctChoiceIndex": null,
  "iterationStartedAt": null,
  "iterationDurationMs": 2500,
  "minIntervalMs": 2000,
  "maxIntervalMs": 3000,
  "maxReward": 3,
  "minWrongPenalty": 0.5,
  "maxWrongPenalty": 1.5,
  "missPenalty": 1,
  "refreshAssignedColorEachIteration": true,
  "gameOver": false,
  "lastResult": null
}
```

This appears in:

- `GET /api/config`
- `GET /api/controller/receivers`
- `POST /api/controller/command` responses
- Socket.IO `receiver_state_update`
- Socket.IO `receiver_list`

### Configure Color Challenge

Endpoint:

```http
POST /api/controller/command
Content-Type: application/json
```

Payload:

```json
{
  "command": "set_module_state",
  "targetId": "screen-a",
  "payload": {
    "module": "colorChallenge",
    "patch": {
      "visible": true,
      "enabled": true,
      "score": 1,
      "startingScore": 1,
      "minIntervalMs": 2000,
      "maxIntervalMs": 3000,
      "maxReward": 3,
      "minWrongPenalty": 0.5,
      "maxWrongPenalty": 1.5,
      "missPenalty": 1,
      "refreshAssignedColorEachIteration": true
    }
  }
}
```

Behavior:

- `targetId: "*"` broadcasts the same patch to all current receivers.
- `visible` and `enabled` together start a server-generated round.
- `minIntervalMs` and `maxIntervalMs` are milliseconds and are clamped to `250..600000`.
- If `maxIntervalMs < minIntervalMs`, the server normalizes the interval bounds.
- Penalty / reward numbers are clamped to non-negative values.
- `maxWrongPenalty` is normalized to be at least `minWrongPenalty`.
- Palette updates require at least two unique colors.

### Set Palette

```json
{
  "command": "set_module_state",
  "targetId": "screen-a",
  "payload": {
    "module": "colorChallenge",
    "patch": {
      "palette": [
        { "colorId": "red", "label": "Red", "color": "#ef4444" },
        { "colorId": "green", "label": "Green", "color": "#22c55e" },
        { "colorId": "blue", "label": "Blue", "color": "#3b82f6" },
        { "colorId": "yellow", "label": "Yellow", "color": "#eab308" }
      ]
    }
  }
}
```

Changing the palette starts a new round if the challenge is active. If the old `assignedColorId` no longer exists in the palette, the server chooses a new assigned color.

### Submit Choice

Receiver pages send this command automatically. External tools can use the same shape for testing.

```json
{
  "command": "submit_color_challenge_choice",
  "targetId": "screen-a",
  "payload": {
    "choiceIndex": 0,
    "colorId": "green",
    "pressedAt": "2026-04-20T13:30:00.000Z"
  }
}
```

Rules:

- `choiceIndex` must be `0` or `1`.
- `colorId` is optional, but when provided it must match the selected choice.
- `pressedAt` is optional ISO time. If absent, the server uses receive time.
- Future timestamps are clamped to server receive time.
- Receivers may only submit choices for their own final receiver ID.
- Controller / Unity / HTTP may submit for any target for testing.

Scoring:

```typescript
const t = clamp01((pressedAt - iterationStartedAt) / iterationDurationMs);
const greenness = 1 - Math.abs(2 * t - 1);
```

- Correct choice: `score += maxReward * greenness`
- Wrong choice: `score -= minWrongPenalty + (maxWrongPenalty - minWrongPenalty) * greenness`
- Timeout with no press: `score -= missPenalty`
- `score <= 0` sets `gameOver: true` and clamps `score` to `0`
- If still alive, the server immediately starts the next round

### Reset / Revive

```json
{
  "command": "color_challenge_reset",
  "targetId": "screen-a",
  "payload": {}
}
```

Reset keeps current visibility, enabled state, palette, intervals, and scoring parameters, then sets `score = startingScore`, clears game over, and starts a new round if active.

### Export Results

```http
GET /api/controller/color-challenge/export
```

Response shape:

```json
{
  "ok": true,
  "colorChallenge": {
    "generatedAt": "2026-04-20T13:30:00.000Z",
    "totalEvents": 3,
    "correct": 1,
    "wrong": 1,
    "misses": 1,
    "gameOvers": 1,
    "events": []
  }
}
```

Each event includes receiver id, label, score delta, final score, game over flag, choices, assigned color, correct index, `t`, and `greenness`.

## Unity / External Controller Guidance

Recommended workflow:

1. Call `GET /api/controller/receivers`.
2. Enable Color Challenge with `set_module_state` / `module: "colorChallenge"`.
3. Let students use the receiver page buttons.
4. Observe `ReceiverState.config.colorChallenge` through `/api/controller/receivers`, `/api/config`, or Socket.IO controller list updates.
5. Export `GET /api/controller/color-challenge/export` after a run.
6. Use `color_challenge_reset` to revive a receiver after game over.

Do not directly drive DOM buttons from Unity. Use the HTTP controller API or Socket.IO unified command protocol.

## Compatibility

- Existing Phase 5 `score` is unchanged and remains a manual display module.
- Existing Phase 10 `economy` game over is unchanged.
- Color Challenge has its own `gameOver` flag and does not stop sound playback.
- `reset_all_state` clears Color Challenge back to defaults.
- Existing legacy `audio_control`, `audio_playable`, `color_change`, and `text_message` messages are unchanged.

## Local Validation

Commands run:

```bash
corepack pnpm check
corepack pnpm test
corepack pnpm build
```

Results:

- `corepack pnpm check`: passed
- `corepack pnpm test`: passed, 32 tests
- `corepack pnpm build`: passed

Build note:

- Vite emitted the existing chunk-size warning for a `564.44 kB` JS bundle. The build completed successfully.

## Browser Smoke Test

Tooling: `agent-browser`

Environment: `http://127.0.0.1:3001`

Date: 2026-04-20

Setup:

- Initial `corepack pnpm dev` on port `3000` failed because the port was already in use.
- Smoke test server was started with `PORT=3001 corepack pnpm dev`.

Steps:

1. Opened `/receiver/phase11smoke`.
   - Observed receiver online and rendering existing economy / track UI.
2. Sent `set_module_state` over HTTP for `module: "colorChallenge"`.
   - Observed API returned `ok: true`.
   - Snapshot included Color Challenge with assigned color, score, red-green-red timing state, and game over after an intentional timeout.
3. Sent `color_challenge_reset` with a longer `30000ms` interval.
   - Observed new round with exactly two choices and one correct assigned color.
4. Used `agent-browser eval` to click the correct color button on the receiver page.
   - Observed receiver snapshot update from score `1` to `2.5`.
   - Observed `lastResult: correct`, positive score delta, and a new active round.
5. Opened `/controller` and selected `phase11smoke`.
   - Observed the Phase 11 Controller heading.
   - Observed Color Challenge controller panel with score, assigned color, round state, visible/enabled switches, timing/scoring inputs, palette editor, reset/revive, and export button.
6. Queried `GET /api/controller/color-challenge/export`.
   - Confirmed export counters included recorded correct and timeout events:

```json
{
  "totalEvents": 3,
  "correct": 1,
  "wrong": 0,
  "misses": 2,
  "gameOvers": 2
}
```

Notes:

- The controller snapshot showed the smoke receiver as offline after navigating the same browser tab away from `/receiver/phase11smoke` to `/controller`. This is expected for a single-tab smoke test; the receiver page socket disconnected when the tab navigated.
- Audio autoplay was not part of this phase and was not tested.

## Deployment Notes

- No Zeabur deployment was required for Phase 11 before local validation because this phase does not change Docker, production startup, static serving, `PORT`, reverse proxy behavior, or cross-device Socket.IO topology.
- The feature still relies on in-memory Socket.IO state.
- Production must remain single-replica.

## Not Covered / Follow-Up

- Not yet tested with many physical student devices at the same time.
- Professor may still tune default palette colors and score values after seeing the receiver UI.
