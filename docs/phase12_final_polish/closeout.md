# Phase 12 Closeout: Final Polish / Demo Fixes

Date: 2026-04-21

Local URL tested: `http://127.0.0.1:3101`

Corresponding feedback: `docs/final_fix.md`

Depends on: Phase 10 receiver-led sound economy and Phase 11 Color Challenge are already delivered. Phase 12 is a final polish and bug-fix pass on top of those systems.

## Delivered

- Color Challenge now uses a fast ping-pong timing marker that is independent from round timeout, and each round starts from a randomized spawn position.
- Color Challenge choices now carry linked track metadata. The correct choice is assigned from the current usable track pool, the wrong choice comes from a different track, and the receiver UI shows the target track name directly in the color block.
- Receiver color-choice buttons now display the linked track label and trigger the linked audio locally on press.
- Economy no longer hard-disables receiver playback when `economy.enabled = false`. In that mode, receiver playback still works, but no currency, inflation, or game-over cost check is applied.
- Receiver UI now hides the top economy status card when economy is off, removes the old `Disabled` economy wording, hides track cost when economy is inactive, and keeps visible tracks in a stable shuffled order instead of manifest order.
- Controller map preview now interpolates the existing Phase 9 movement payload locally instead of only showing the final target position, and the movement draft resyncs when the latest map snapshot changes.
- Controller system actions now label the scoreboard download explicitly as an economy + score export. The existing scoreboard export endpoint remains the source of truth.

## Main Files

- `shared/wsTypes.ts`
- `server/wsServer.ts`
- `server/controllerApi.ts`
- `server/controllerApi.test.ts`
- `client/src/pages/Receiver.tsx`
- `client/src/pages/Controller.tsx`
- `docs/phase12_final_polish/epic.md`

## API / Protocol Changes

### Color Challenge Round Shape

Phase 12 extends the current Color Challenge snapshot with choice-level track links and moving-bar timing fields:

```typescript
interface ColorChallengeChoice {
  colorId: string;
  label: string;
  color: string;
  trackId: string | null;
  trackLabel: string | null;
  trackUrl: string | null;
}

interface ColorChallengeConfig {
  choices: ColorChallengeChoice[];
  barCycleDurationMs: number;
  barStartProgress: number;
}
```

This shape now appears in:

- Socket.IO `receiver_state_update`
- Socket.IO `receiver_list`
- `GET /api/controller/receivers`
- `POST /api/controller/command` responses
- `GET /api/controller/color-challenge/export`

Example receiver snapshot excerpt:

```json
{
  "colorChallenge": {
    "visible": true,
    "enabled": true,
    "score": 5,
    "assignedColorId": "blue",
    "choices": [
      {
        "colorId": "blue",
        "label": "Blue",
        "color": "#3b82f6",
        "trackId": "track_02",
        "trackLabel": "Womp Womp",
        "trackUrl": "/audio/womp-womp.mp3"
      },
      {
        "colorId": "yellow",
        "label": "Yellow",
        "color": "#eab308",
        "trackId": "Crowd2.mp3",
        "trackLabel": "Crowd2",
        "trackUrl": "/audio/CitySounds/Crowd2.mp3"
      }
    ],
    "barCycleDurationMs": 900,
    "barStartProgress": 0.92
  }
}
```

Behavior:

- `iterationDurationMs` still controls timeout.
- `barCycleDurationMs` controls the full left-to-right-to-left marker loop.
- `barStartProgress` is randomized per round and places the marker at a random spawn position at round start.
- `greenness` is now computed from the moving marker position, not from simple round progress.

### `submit_color_challenge_choice`

No new top-level command name was added, but the optional `nextRound` payload now supports the new timing-bar and choice-track fields:

```json
{
  "command": "submit_color_challenge_choice",
  "targetId": "screen-a",
  "payload": {
    "roundId": "color-round-123",
    "submissionId": "color-submit-456",
    "choiceIndex": 0,
    "colorId": "blue",
    "pressedAt": "2026-04-21T13:06:41.900Z",
    "nextRound": {
      "iterationId": "color-round-124",
      "assignedColorId": "green",
      "choices": [
        {
          "colorId": "green",
          "label": "Green",
          "color": "#22c55e",
          "trackId": "Accident1.mp3",
          "trackLabel": "Accident1",
          "trackUrl": "/audio/CitySounds/Accident1.mp3"
        },
        {
          "colorId": "red",
          "label": "Red",
          "color": "#ef4444",
          "trackId": "Monkey-002.mp3",
          "trackLabel": "Monkey-002",
          "trackUrl": "/audio/NatureSounds/Monkey-002.mp3"
        }
      ],
      "correctChoiceIndex": 0,
      "iterationStartedAt": "2026-04-21T13:06:41.900Z",
      "iterationDurationMs": 10000,
      "barCycleDurationMs": 900,
      "barStartProgress": 0.31
    }
  }
}
```

Compatibility:

- Existing callers can keep omitting `nextRound`; the server still generates the next round.
- If a caller supplies `nextRound`, the server canonicalizes the linked track metadata against the current receiver track list.

### `request_track_play`

No new command name was added, but the behavior changed:

- When `economy.enabled = true`, Phase 10 cost / inflation / game-over checks still apply.
- When `economy.enabled = false`, the receiver may still play a visible, enabled, playable track without spending currency.
- The server still blocks hidden tracks, missing URLs / durations, vote-locked interaction, and concurrent playback.

Example remains:

```json
{
  "command": "request_track_play",
  "targetId": "screen-a",
  "payload": {
    "trackId": "track_01"
  }
}
```

### Score Download

No new HTTP route was added. Phase 12 continues to use:

```http
GET /api/controller/scoreboard/export
```

The returned JSON already includes both economy and score-system fields:

```json
{
  "generatedAt": "2026-04-21T13:06:41.804Z",
  "totalReceivers": 1,
  "receivers": [
    {
      "receiverId": "phase12-smoke",
      "economyRemainingSeconds": 30,
      "economyEnabled": false,
      "economyGameOver": false,
      "manualScoreValue": 0,
      "scoreSystemScore": 5,
      "scoreSystemEnabled": true,
      "scoreSystemGameOver": false
    }
  ]
}
```

Phase 12 only changes the operator-facing labeling and download filename so the combined export is easier to find during demos.

### Map Movement

API Changes: None.

Phase 12 does not change the Phase 9 movement transport. It only fixes the controller-side preview so the UI now honors the existing `movement.startedAt`, `movement.durationMs`, and `movement.loop` fields instead of appearing frozen at the final target.

## Local Validation

Executed locally:

```bash
corepack pnpm check
corepack pnpm test
corepack pnpm build
```

Results:

- `pnpm check` passed.
- `pnpm test` passed (`38` tests).
- `pnpm build` passed.
- `pnpm build` still emits the existing Vite chunk-size warning for the main client bundle; this is unchanged from previous phases.

## Browser Smoke Test

Tooling: `agent-browser`
Environment: `http://127.0.0.1:3101`
Date: 2026-04-21

1. Opened `/receiver/phase12-smoke`.
   - Receiver connected online.
   - Top area no longer showed the old economy-disabled card.

2. Primed state through HTTP controller commands.
   - Sent `set_visible_tracks` with `track_01`, `track_02`, `Accident1.mp3`, and `LightRain.mp3__2`.
   - Sent `set_module_state(module=colorChallenge)` with `visible: true`, `enabled: true`, `score: 5`, and a `10s` round.
   - Sent `set_module_state(module=map)` with looping movement from `(0.15, 0.80)` to `(0.85, 0.20)` over `6s`.

3. Re-opened `/receiver/phase12-smoke`.
   - Observed Color Challenge active.
   - Snapshot exposed button labels with linked tracks, for example `Blue / Accident1` and `Green / Monkey-002`.
   - This confirms the choice buttons now surface the linked sound metadata instead of color-only labels.

4. Opened `/controller`.
   - Observed the system action button label `Download Economy + Score CSV`.
   - Observed the selected receiver map movement fields were populated from the current snapshot (`Start 15/20`, `Target 85/80`, `6s`, `Loop`).

Browser limitations:

- `agent-browser` text snapshots do not provide a reliable frame-by-frame assertion for the moving marker position, so the controller preview interpolation was validated through the live UI plus code inspection rather than a textual pixel diff.
- Browser automation cannot assert audible playback output directly, so the local smoke verified linked track labels and URLs in state/UI rather than waveform output.

## Deployment / Runtime Notes

- No Zeabur deployment was run for Phase 12. The changes were local UI/runtime refinements and did not touch the deployment chain, Dockerfile, static asset hosting, `PORT`, or reverse-proxy behavior.
- Single-replica deployment remains required because Socket.IO state is still in-memory and authoritative in one Node process.

## Remaining Gaps / Follow-Up

- Professor-provided extra audio assets and updated classroom map artwork were not yet available in the repository during this phase.
- Audio-link smoke covered metadata visibility and local button wiring, but not human-perceived loudness / mix balance across real devices.
- Controller preview interpolation is now wired to the same movement timestamps as the receiver, but a dedicated visual regression harness does not exist yet for animated map verification.
