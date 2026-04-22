# Phase 12 Production API Smoke

Date: 2026-04-22

Environment: `https://artinstallation.certaindragon3.work`

Tooling: live HTTP requests plus `agent-browser`

Receivers used:

- `p12api20260422a`
- `p12api20260422b`

Screenshot directory:

- `docs/phase12_final_polish/evidence/production-api-smoke-2026-04-22/screenshots/`

## Goal

Run a real production smoke across the controller HTTP API, the live receiver UI, and the current Phase 12 behaviors with screenshot evidence instead of relying on local-only validation.

## Coverage

Covered on production:

- health/config/receiver list endpoints
- HTTP command validation and missing-receiver error handling
- legacy commands: `text_message`, `color_change`, `audio_playable`, `audio_control`
- unified commands: `set_visible_tracks`, `set_track_state`, `remove_track`, `set_group_state`, `remove_group`, `set_module_state`
- vote flow plus `GET /api/controller/votes/export`
- timing flow plus `GET /api/controller/timing/export`
- economy play/stop/reset plus `request_track_play`, `request_track_stop`, `economy_reset`
- Phase 12 Color Challenge submit/export flow plus `GET /api/controller/color-challenge/export`
- combined score export via `GET /api/controller/scoreboard/export`
- offline cleanup via `POST /api/controller/clear-offline`

## Screenshots

1. Receiver A initial state

![Receiver A initial](/Users/huangjiesen/大四/s4/G哥项目/art-installation-control/docs/phase12_final_polish/evidence/production-api-smoke-2026-04-22/screenshots/01-receiver-a-initial.png)

2. Receiver B initial state

![Receiver B initial](/Users/huangjiesen/大四/s4/G哥项目/art-installation-control/docs/phase12_final_polish/evidence/production-api-smoke-2026-04-22/screenshots/02-receiver-b-initial.png)

3. Controller initial state with both receivers online

![Controller initial](/Users/huangjiesen/大四/s4/G哥项目/art-installation-control/docs/phase12_final_polish/evidence/production-api-smoke-2026-04-22/screenshots/03-controller-initial.png)

4. Vote UI on Receiver A

![Receiver A vote](/Users/huangjiesen/大四/s4/G哥项目/art-installation-control/docs/phase12_final_polish/evidence/production-api-smoke-2026-04-22/screenshots/04-receiver-a-vote.png)

5. Timing and tracks UI on Receiver A

![Receiver A timing and tracks](/Users/huangjiesen/大四/s4/G哥项目/art-installation-control/docs/phase12_final_polish/evidence/production-api-smoke-2026-04-22/screenshots/05-receiver-a-timing-tracks.png)

6. Economy-disabled free play on Receiver A

![Receiver A economy disabled free play](/Users/huangjiesen/大四/s4/G哥项目/art-installation-control/docs/phase12_final_polish/evidence/production-api-smoke-2026-04-22/screenshots/06-receiver-a-economy-disabled-freeplay.png)

7. Color Challenge active on Receiver A

![Receiver A color challenge](/Users/huangjiesen/大四/s4/G哥项目/art-installation-control/docs/phase12_final_polish/evidence/production-api-smoke-2026-04-22/screenshots/07-receiver-a-color-challenge.png)

8. Color Challenge full-round state on Receiver A

![Receiver A color challenge full](/Users/huangjiesen/大四/s4/G哥项目/art-installation-control/docs/phase12_final_polish/evidence/production-api-smoke-2026-04-22/screenshots/08-receiver-a-color-challenge-full.png)

9. Controller final state after cleanup

![Controller final](/Users/huangjiesen/大四/s4/G哥项目/art-installation-control/docs/phase12_final_polish/evidence/production-api-smoke-2026-04-22/screenshots/09-controller-final.png)

10. Redeployed Unity registration response showing `https://` origin

![Unity register https recheck](/Users/huangjiesen/大四/s4/G哥项目/art-installation-control/docs/phase12_final_polish/evidence/production-api-smoke-2026-04-22/screenshots/10-unity-register-https-recheck.png)

11. Controller page after redeploy recheck

![Controller redeploy recheck](/Users/huangjiesen/大四/s4/G哥项目/art-installation-control/docs/phase12_final_polish/evidence/production-api-smoke-2026-04-22/screenshots/11-controller-redeploy-recheck.png)

## Result Summary

Production smoke passed for the main controller and receiver flows. The deployed app correctly handled:

- live receiver registration and snapshot reporting
- command validation errors with JSON responses
- legacy and current command compatibility
- vote submission and export aggregation
- timing submissions and export capture
- economy-on paid playback, economy-off free playback, insufficient-currency failure, and economy reset
- Phase 12 Color Challenge linked-track round generation, submit scoring, timeout behavior, export shape, and combined scoreboard export
- controller offline-receiver cleanup

The initial production issue found during smoke was the Unity registration origin described below. It was fixed, redeployed, and rechecked later the same day.

## Key Production Checks

### Core HTTP endpoints

- `GET /api/healthz` returned `200` with `{"ok":true}`.
- `GET /api/config` returned `200` and exposed the live receiver snapshots used during smoke.
- `GET /api/controller/receivers` returned both receivers online at the start and correctly reflected the later offline cleanup.
- `POST /api/controller/command` returned `400` for an empty body and `404` for a missing receiver id.

### Legacy compatibility

Receiver A accepted all of the currently preserved legacy commands through `POST /api/controller/command`:

- `text_message`
- `color_change`
- `audio_playable`
- `audio_control`

This confirmed that the final professor API docs still match live production behavior for the legacy bridge surface.

### Vote flow

- Production opened vote `prod_vote_0422` on Receiver A.
- Receiver A rendered the vote UI and accepted a submission.
- `GET /api/controller/votes/export` reported `submittedCount: 1`, the expected option count, and no missing receivers.

### Timing flow

- Production enabled pulse plus timing on Receiver A.
- Receiver A rendered the timing button and accepted an interaction.
- `GET /api/controller/timing/export` reported `totalAttempts: 1` and the recorded timing payload for Receiver A.

### Economy flow

Production verified all three Phase 10 and Phase 12 economy states:

1. `economy.enabled = false`
   - `request_track_play` still started playback on a visible playable track.
   - No currency spend or game-over lock was applied.
   - Receiver UI hid the old disabled economy card.

2. `economy.enabled = true` with enough currency
   - `request_track_play` started playback and reduced `currencySeconds`.
   - Inflation advanced from `1` as expected.
   - `request_track_stop` succeeded.

3. `economy.enabled = true` without enough currency
   - `request_track_play` returned a game-over economy state with `lastError = "insufficient_currency"`.
   - `economy_reset` restored the default non-game-over state.

### Color Challenge flow

Production verified both timeout and successful submit behavior:

- timeout path produced a miss/game-over export entry
- successful submit path produced a scored event with live `greenness`, `scoreDelta`, linked `trackId`, `trackLabel`, and `trackUrl`
- `GET /api/controller/color-challenge/export` and `GET /api/controller/scoreboard/export` both reflected the expected Phase 12 fields

Example production round fields observed during smoke:

```json
{
  "iterationId": "color-round-30ea5c23-5c8f-41e5-86f8-2e5d61d27094",
  "assignedColorId": "green",
  "correctChoiceIndex": 1,
  "iterationDurationMs": 20000,
  "barCycleDurationMs": 900,
  "barStartProgress": 0.8602359282944285
}
```

Example successful production submit result:

```json
{
  "reason": "correct",
  "greenness": 0.535609245431317,
  "scoreDelta": 1.6068277362939511,
  "score": 2.606827736293951,
  "gameOver": false
}
```

## Initial Production Finding

### `POST /api/unity/register` exported `http://` instead of `https://`

Observed on live production:

```json
{
  "socketServerUrl": "http://artinstallation.certaindragon3.work"
}
```

Expected public origin:

```json
{
  "socketServerUrl": "https://artinstallation.certaindragon3.work"
}
```

Root cause:

- the Express app was not trusting the reverse proxy
- the controller API derived `socketServerUrl` from `req.protocol`
- under Zeabur this left the app seeing the internal `http` hop instead of the forwarded public `https` origin

Local fix already applied:

- [server/_core/app.ts](/Users/huangjiesen/大四/s4/G哥项目/art-installation-control/server/_core/app.ts:90) now sets `app.set("trust proxy", true)`
- [server/controllerApi.test.ts](/Users/huangjiesen/大四/s4/G哥项目/art-installation-control/server/controllerApi.test.ts:2062) now verifies `x-forwarded-proto: https` is honored by `/api/unity/register`

Local verification after the fix:

```bash
pnpm vitest run server/controllerApi.test.ts
```

Result:

- `25` tests passed

## Redeploy Recheck

After the proxy-trust fix was deployed, production was rechecked with fresh live requests and browser screenshots.

Live recheck results:

- `GET /api/healthz` returned `{"ok":true}`
- `POST /api/unity/register` returned `socketServerUrl: "https://artinstallation.certaindragon3.work"`
- `GET /api/controller/receivers` returned `{"ok":true,"receivers":[]}`

Confirmed live Unity registration payload:

```json
{
  "ok": true,
  "role": "unity",
  "socketServerUrl": "https://artinstallation.certaindragon3.work",
  "socketPath": "/socket.io"
}
```

Redeploy recheck conclusion:

- the reverse-proxy origin bug is resolved on production
- the previously failing Unity registration path now matches the professor-facing API docs
- no additional production regressions were observed in the redeploy spot-check

## Cleanup

Production cleanup was completed at the end of smoke:

- Receiver A was reset with `reset_all_state`
- Receiver B browser tab was closed
- `POST /api/controller/clear-offline` removed Receiver B from the live list

Final state check:

- controller showed only Receiver A online
- no active vote remained
- visible tracks were cleared back to an empty list on Receiver A
