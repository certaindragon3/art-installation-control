# Phase 11 Closeout: Color Challenge / Score Game

Date: 2026-04-21

Production URL tested: `https://artinstallation.certaindragon3.work`

Corresponding feedback: `docs/phase11_color_challenge/source/ColorHitGame.cs`

Depends on: Phase 10 receiver-led sound economy is already delivered. Phase 11 remains an independent scoring game and does not merge its `gameOver` state into the economy module.

## Delivered

- Implemented the professor `ColorHitGame.cs` flow as a Web / Socket.IO gameplay module.
- Added independent `ReceiverState.config.colorChallenge` state for palette, assigned color, round timing, scoring, latest result, and game over.
- Receiver pages now resolve rounds locally so the button press and next-round transition do not wait on network RTT.
- Server validates each submitted round result, applies the authoritative score delta, records export events, and broadcasts updated receiver snapshots back to controller and receiver clients.
- Color Challenge stays separate from Phase 10 economy. Economy playback and Phase 5 manual score remain intact.
- Controller UI can show or hide the game, enable or disable it, tune timing and penalties, edit the palette, reset or revive a receiver, and export results.
- Professor-facing plug-and-play command docs now include copyable Phase 11 payloads.

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

### Socket.IO / Unified Command Surface

No new top-level Socket.IO event names were added. Phase 11 reuses the existing unified command path:

- Socket.IO controllers send `control_message`.
- HTTP / Unity callers send `POST /api/controller/command`.

New Phase 11 command names:

- `set_module_state` with `payload.module: "colorChallenge"`
- `submit_color_challenge_choice`
- `color_challenge_reset`

### Receiver Snapshot Change

Every receiver snapshot now includes `config.colorChallenge`:

```typescript
interface ColorChallengeConfig {
  visible: boolean;
  enabled: boolean;
  score: number;
  startingScore: number;
  iterationId: string | null;
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

Default shape:

```json
{
  "visible": false,
  "enabled": false,
  "score": 1,
  "startingScore": 1,
  "iterationId": null,
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

This snapshot appears in:

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

Minimal payload:

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
- `visible: true` and `enabled: true` together start a valid round when the receiver is not in `gameOver`.
- `minIntervalMs` and `maxIntervalMs` are milliseconds and clamp to the server range.
- If `maxIntervalMs < minIntervalMs`, the server normalizes the pair into ascending order.
- Numeric reward and penalty fields clamp to non-negative values.
- `maxWrongPenalty` is normalized to be at least `minWrongPenalty`.
- `assignedColorId` can pin the target color to an existing palette entry. Sending `null` clears the pin.
- `refreshAssignedColorEachIteration: false` keeps reusing the same assigned color until it is changed or cleared.
- `palette` updates require at least two unique colors and start a new round when the game is active.
- Sending `gameOver: false` revives the module if needed, but `color_challenge_reset` is the simpler operator path.

Palette example:

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

### Submit A Choice

Receiver pages send this automatically. HTTP / Unity can use the same payload for testing or external orchestration.

```json
{
  "command": "submit_color_challenge_choice",
  "targetId": "screen-a",
  "payload": {
    "roundId": "color-round-123",
    "submissionId": "color-submit-456",
    "choiceIndex": 0,
    "colorId": "green",
    "pressedAt": "2026-04-21T02:10:40.000Z",
    "nextRound": {
      "iterationId": "color-round-124",
      "assignedColorId": "green",
      "choices": [
        { "colorId": "green", "label": "Green", "color": "#22c55e" },
        { "colorId": "red", "label": "Red", "color": "#ef4444" }
      ],
      "correctChoiceIndex": 0,
      "iterationStartedAt": "2026-04-21T02:10:40.000Z",
      "iterationDurationMs": 2400
    }
  }
}
```

Rules:

- `roundId` should match the receiver's active `iterationId` when receiver-led reconciliation is used.
- `submissionId` is echoed back in `lastResult` and export events.
- `choiceIndex` may be `0`, `1`, or `null` for a timeout miss.
- `colorId` is optional, but when provided it must match the selected choice.
- `pressedAt` is optional ISO time. `clientTimestamp` is also accepted as a numeric fallback.
- Future timestamps are clamped to server receive time.
- `nextRound` is optional. Receiver pages send it so the server can accept the locally prepared next round instead of generating a fresh one.
- Receivers may only submit choices for their own final receiver ID through the socket path. HTTP / controller callers can target any receiver for testing.

Scoring formula:

```typescript
const t = clamp01((pressedAt - iterationStartedAt) / iterationDurationMs);
const greenness = 1 - Math.abs(2 * t - 1);
```

Score behavior:

- Correct choice: `score += maxReward * greenness`
- Wrong choice: `score -= minWrongPenalty + (maxWrongPenalty - minWrongPenalty) * greenness`
- Timeout or late press: `score -= missPenalty`
- `score <= 0` clamps to `0` and sets `gameOver: true`
- If the receiver survives the round, a new round starts immediately

Example result from production closeout verification:

```json
{
  "reason": "correct",
  "choiceIndex": 1,
  "colorId": "green",
  "assignedColorId": "green",
  "correctChoiceIndex": 1,
  "iterationId": "color-round-a1e9e806-7bbc-4fc8-80b0-e85d91c80592",
  "t": 0.019733333333333332,
  "greenness": 0.03946666666666665,
  "scoreDelta": 0.11839999999999995,
  "submissionId": "phase11closeout-submit-correct",
  "score": 2.1184,
  "gameOver": false
}
```

### Reset / Revive

Use the dedicated reset command to recover after game over while preserving the current configuration:

```json
{
  "command": "color_challenge_reset",
  "targetId": "screen-a",
  "payload": {}
}
```

Behavior:

- Keeps `visible`, `enabled`, palette, timing, reward, and penalty values.
- Resets `score` back to `startingScore`.
- Clears `gameOver`.
- Writes a `lastResult` entry with `reason: "reset"`.
- Starts a fresh round immediately if the challenge is visible and enabled.

### Export Results

Phase 11 adds one direct export route:

```http
GET /api/controller/color-challenge/export
```

Response shape:

```json
{
  "ok": true,
  "colorChallenge": {
    "generatedAt": "2026-04-21T02:11:12.293Z",
    "totalEvents": 79,
    "correct": 27,
    "wrong": 2,
    "misses": 50,
    "gameOvers": 3,
    "events": []
  }
}
```

Each exported event includes:

- `receiverId`
- `label`
- `reason`
- `scoreDelta`
- `score`
- `gameOver`
- `submissionId`
- `assignedColorId`
- `correctChoiceIndex`
- `choices`
- `t`
- `greenness`
- `isoTimestamp`

## Unity / External Controller Guidance

Recommended integration flow:

1. Call `GET /api/controller/receivers` and choose the final `receiverId`.
2. Enable the game with `set_module_state` and `module: "colorChallenge"`.
3. Let students interact on `/receiver/:id`.
4. Read live state from `/api/controller/receivers`, `/api/config`, or Socket.IO controller updates.
5. Export cumulative results with `GET /api/controller/color-challenge/export`.
6. Use `color_challenge_reset` to revive a receiver after game over.

Do not drive DOM buttons from Unity. Use the HTTP controller bridge or the existing Socket.IO unified command path.

## Compatibility / Migration

- Existing Phase 5 `score` remains a separate manual display module.
- Existing Phase 10 `economy` remains unchanged.
- Color Challenge has its own `gameOver` flag and does not stop economy playback.
- `reset_all_state` clears Color Challenge back to defaults.
- Legacy `audio_control`, `audio_playable`, `color_change`, and `text_message` remain unchanged.
- Palette input accepts structured objects and also tolerates simple string entries internally, but professor-facing docs standardize on `{ colorId, label, color }`.

## Local Validation

Commands rerun on 2026-04-21:

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

- Vite emitted the existing large-chunk warning for `dist/public/assets/index-BmCboc2K.js` at `568.89 kB`.
- The build still completed successfully and produced `dist/index.js`.

## Browser Smoke Test

Tooling: `agent-browser`

Environment: `https://artinstallation.certaindragon3.work`

Date: 2026-04-21

Receiver used: `phase11closeout`

1. Opened `/receiver/phase11closeout`.
   - Observed the receiver connect online on production.
   - After enabling Phase 11 over HTTP, `agent-browser` confirmed receiver-page text for `Color Challenge`, `Greenness`, and `Score`.
2. Enabled Color Challenge over `POST /api/controller/command` with a short `4s` interval.
   - Observed the timeout path trigger naturally.
   - Controller state later showed the receiver row as `Color 0.0 over`, confirming the `missPenalty` and `gameOver` path on production.
3. Opened `/controller`.
   - Observed the heading `Phase 11 Controller`.
   - Observed the Phase 11 panel with visible and enabled switches, score and interval inputs, palette editor, `Reset / Revive`, and `Export JSON`.
4. Reconfigured the same receiver over HTTP to `startingScore = 2`, `minIntervalMs = 30000`, and `maxIntervalMs = 30000`, then submitted a correct choice while the receiver page stayed open.
   - Controller state updated to `Receiver phase11closeout ... Color 2.1`, confirming that the authoritative score increased on production.
   - The selected receiver panel also reflected the updated values `Starting Score 2`, `Min Seconds 30`, and `Max Seconds 30`.
5. Queried `GET /api/controller/color-challenge/export`.
   - Confirmed cumulative export counts were present.
   - Filtered by `receiverId == "phase11closeout"` and confirmed both a recent correct event and later miss events for the production smoke sequence.

Export excerpts from the production smoke:

```json
{
  "receiverId": "phase11closeout",
  "reason": "correct",
  "score": 2.1184,
  "scoreDelta": 0.11839999999999995,
  "gameOver": false,
  "submissionId": "phase11closeout-submit-correct",
  "isoTimestamp": "2026-04-21T02:10:40.000Z"
}
```

```json
{
  "receiverId": "phase11closeout",
  "reason": "miss",
  "score": 1.1183999999999998,
  "scoreDelta": -1,
  "gameOver": false,
  "submissionId": null,
  "isoTimestamp": "2026-04-21T02:11:10.000Z"
}
```

Browser-automation note:

- The controller DOM is intentionally dense because it also exposes the full track matrix. For this closeout, `agent-browser` was used to verify visible production UI state, while state-changing actions were sent through the documented HTTP controller API for deterministic validation.

## Deployment / Running Notes

- Phase 11 is already deployed and was verified directly against the production Zeabur URL above.
- The gameplay state is still stored in server memory.
- Production must remain single-replica.
- No extra Docker, `PORT`, static hosting, or health-check changes were required in this phase.

## Not Covered / Follow-Up

- Multi-device classroom-scale manual playtesting is still pending.
- The default palette and score numbers may still be tuned after professor review.
- Export counters are cumulative since process start, so receiver-specific analysis should filter by `receiverId`.
