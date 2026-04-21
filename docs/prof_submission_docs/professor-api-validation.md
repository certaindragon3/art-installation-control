# Professor API Validation

Date: 2026-04-21

Tooling:
- `agent-browser`

Environment:
- Local dev server: `http://127.0.0.1:3100`

Receiver IDs used:
- `prof-main`
- `prof-main2`
- `prof-broadcast`

## Browser Setup

1. Opened `/receiver/prof-main`.
   - Receiver connected as `prof-main`.
2. Opened `/receiver/prof-main` in a second tab.
   - Server assigned final ID `prof-main2`.
3. Opened `/receiver/prof-broadcast`.
   - Receiver connected as `prof-broadcast`.
4. Opened `/controller`.
   - Controller listed all three receivers online.

## Coverage Matrix

| Area | API / Command | `agent-browser` result |
| --- | --- | --- |
| Base HTTP | `GET /api/healthz` | Returned `200` with `{ "ok": true }`. |
| Base HTTP | `GET /api/config` | Returned `200` with `configTtlMs: 60000`. |
| Base HTTP | `GET /api/controller/receivers` | Returned `prof-main`, `prof-main2`, and `prof-broadcast`. |
| Base HTTP | `POST /api/unity/register` | Returned `socketServerUrl`, `/socket.io`, transports, and event names `register_unity`, `control_message`, `interaction_event`. |
| Errors | Invalid command payload | Returned `400` with `Invalid control message payload`. |
| Errors | Missing receiver target | Returned `404` with `Receiver not found: missing-receiver`. |
| Broadcast response | `POST /api/controller/command` with `targetId: "*"` | Returned `broadcast: true` and `deliveredReceiverIds: ["prof-main", "prof-main2"]`. |
| Legacy compatibility | `text_message` | Updated `textDisplay.text` to `Legacy hello`. |
| Legacy compatibility | `color_change` | Updated `visuals.iconColor` to `#abcdef`. |
| Legacy compatibility | `audio_playable` | `track_01.playable` became `false` and `playing` stayed `false`. |
| Legacy compatibility | `audio_control` | `track_02.playing` became `true`. |
| Track patch | `set_track_state` | Verified `loopEnabled`, `loopControlLocked`, `volumeControlVisible`, `tempoFlashEnabled`, and `fillTime` persisted; `volumeValue: 1.7` clamped to `1`. |
| Track creation / removal | `set_track_state` then `remove_track` | Created `doc-temp-track`, then confirmed it was removed from `config.tracks`. |
| Groups | `set_group_state` | Created `doc_group`; `trackIds` synchronized to `track_01` and `track_02`. |
| Groups | `remove_group` | Removed `doc_group`; `track_02.groupId` reset to `null`. |
| Visible tracks | `set_visible_tracks` with `targetId: "*"` | `prof-main` and `prof-broadcast` were reduced to `["track_01"]`; hidden `track_02` was forced to `playing: false`. |
| Score | `set_module_state(module=score)` | Alias payload `scoreVisible`, `scoreEnabled`, `scoreValue` produced `{ visible: true, enabled: true, value: 7 }`. |
| Score | `score_reset` | Reset score from `7` to `0` without hiding the module. |
| Map | `set_module_state(module=map)` instant coordinates | Alias payload `x: 1.5`, `y: -0.25` clamped to `playerPosX: 1`, `playerPosY: 0`. |
| Map | `set_module_state(module=map)` movement | `startX/startY/targetX/targetY` were normalized; `durationMs: 50` clamped to `100`; `startedAt` auto-generated. |
| Map | `set_module_state(module=map)` movement stop | `movement: null` removed the active interpolation state. |
| Pulse | `set_module_state(module=pulse)` | Verified `{ visible: true, enabled: true, active: true, bpm: 120 }` in receiver snapshot. |
| Timing UI | Receiver `Press On Beat` | Receiver page showed the timing module and accepted a click through `agent-browser`. |
| Timing export | `GET /api/controller/timing/export` | Logged `1` attempt with `pulseActive: true`, `pulseIntervalMs: 500`, `timingValue: 0.586`, `timing: false`. |
| Voting | `set_vote_state` | Receiver snapshot showed vote `doc_vote_main` with `Alpha` and `Beta`. |
| Voting | Receiver vote submit | Receiver clicked `Alpha`; snapshot stored `selectedOptionId: "alpha"` and `submittedAt`. |
| Voting export | `GET /api/controller/votes/export` | Export showed `submittedCount: 1`, `totalEligible: 1`, `missingReceiverIds: []`, and `Alpha.voteCount: 1`. |
| Voting reset | `vote_reset_all` | Cleared `selectedOptionId` back to `null` without removing the question. |
| Economy config | `set_module_state(module=economy)` | Negative `earnRatePerSecond` and `inflationGrowthPerSecond` clamped to `0`; `refreshIntervalMs: 500` clamped to `1000`. |
| Economy play | `request_track_play` | After restoring `track_01.playable = true`, play succeeded with `currentTrackId: "track_01"`, populated `playStartedAt` / `playEndsAt`, and `currencySeconds` dropped from `10` to `6.317`. |
| Economy stop | `request_track_stop` | Cleared `currentTrackId`, `playStartedAt`, and `playEndsAt`; `track_01.playing` became `false`. |
| Economy failure | `request_track_play` with `currencySeconds: 0` and `inflation: 100` | Entered `gameOver: true` with `lastError: "insufficient_currency"`. |
| Economy reset | `economy_reset` | Restored `currencySeconds` to `startingSeconds`, reset `inflation` to `1`, and cleared `lastError`. |
| Color challenge config | `set_module_state(module=colorChallenge)` | Started a round with `assignedColorId: "green"`, two visible choices, and `iterationDurationMs: 800`. |
| Color challenge submit | `submit_color_challenge_choice` | Correct submission returned `reason: "correct"`, `greenness: 0.55`, `scoreDelta: 1.65`, and `score: 3.65`. |
| Color challenge export | `GET /api/controller/color-challenge/export` | Export contained the same submission with `submissionId: "doc-submit-1"`. |
| Color challenge reset | `color_challenge_reset` | Restored score to `2`, left `gameOver: false`, and wrote `lastResult.reason: "reset"`. |
| Full reset | `reset_all_state` | Cleared groups, vote, map movement, timing, text, score, and color challenge state; restored default visuals and live economy defaults. |
| Offline cleanup | `POST /api/controller/clear-offline` | After closing the `prof-broadcast` tab, receiver showed `connected: false`; clear-offline removed it and returned `removedReceiverIds: ["prof-broadcast"]`. |

## Notes From Validation

- `request_track_play` checks track state before economy cost. During testing, a previous legacy `audio_playable` command left `track_01.playable = false`, which correctly caused `lastError: "track_disabled"` until the track was re-enabled.
- `reset_all_state` restores economy defaults, but subsequent serialized snapshots can already show slightly advanced `currencySeconds` and `inflation` because the economy state is live and time-based.
- No Phase 7 optional API was exercised because that phase remains intentionally deferred.
