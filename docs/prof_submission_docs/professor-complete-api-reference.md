# Professor Unity API Reference

Date verified: 2026-04-21

Scope:
- Consolidates all shipped non-optional work from Phase 1, 2, 3, 4, 5, 6, 8, 9, 10, and 11.
- Reconciles early-phase docs against the current codebase, so this file is the professor-facing source of truth.
- Phase 7 optional features are intentionally excluded.

Related docs:
- [Professor Plug-And-Play Commands](./professor-plug-and-play-commands.md)
- [Professor API Validation](./professor-api-validation.md)
- [Polling System Payloads](./polling-system-payloads.md)

## Base URLs

Production:

```text
https://artinstallation.certaindragon3.work
```

Local:

```text
http://127.0.0.1:3100
```

## Important Runtime Constraints

- Socket.IO state, vote sessions, timing logs, and color challenge logs all live in memory.
- Production must stay single-replica. Do not scale this service horizontally.
- `receiverId` uniqueness is enforced by the server at registration time. If two browsers request the same ID, the server assigns a final unique ID such as `screen-a2`.
- Unity should always read the final `receiverId` from `GET /api/controller/receivers` instead of assuming the requested route ID.

## Recommended Unity Workflow

1. Call `GET /api/controller/receivers` to discover the current final `receiverId` list.
2. Send control actions through `POST /api/controller/command`.
3. Read back the updated authoritative state from `GET /api/controller/receivers`.
4. Use export endpoints when Unity needs JSON snapshots of the current scoreboard or any vote, timing, or color challenge logs.
5. Use `POST /api/unity/register` only if Unity wants the Socket.IO metadata for listening to `interaction_event`.

## HTTP Endpoints

### `GET /api/healthz`

Health check.

Response:

```json
{
  "ok": true
}
```

### `GET /api/config`

Returns the authoritative snapshot for every current receiver.

Response shape:

```json
{
  "ok": true,
  "configTtlMs": 60000,
  "receivers": [
    {
      "receiverId": "screen-a",
      "label": "Receiver screen-a",
      "connected": true,
      "configVersion": 12,
      "configIssuedAt": "2026-04-21T02:27:49.569Z",
      "configExpiresAt": "2026-04-21T02:28:49.569Z",
      "config": {}
    }
  ]
}
```

### `GET /api/controller/receivers`

Recommended discovery endpoint for Unity. Returns the same receiver snapshot structure as `GET /api/config`.

### `POST /api/controller/command`

Main Unity control bridge. Every command in this document uses this endpoint.

Request:

```http
POST /api/controller/command
Content-Type: application/json
```

Success response shape:

```json
{
  "ok": true,
  "command": {
    "command": "set_module_state",
    "targetId": "*",
    "payload": {
      "module": "score",
      "patch": {
        "visible": true,
        "enabled": true,
        "value": 3
      }
    },
    "timestamp": "2026-04-21T02:32:56.554Z"
  },
  "broadcast": true,
  "deliveredReceiverIds": ["prof-main", "prof-main2"],
  "receivers": []
}
```

Error responses:

```json
{
  "ok": false,
  "error": "Invalid control message payload"
}
```

```json
{
  "ok": false,
  "error": "Receiver not found: missing-receiver"
}
```

Unity envelope reminder:

```json
{
  "command": "set_module_state",
  "targetId": "screen-a",
  "payload": {
    "module": "economy",
    "patch": {
      "enabled": true,
      "lastError": null
    }
  }
}
```

- `command` is the action name such as `set_module_state`. Do not put a receiver ID or `*` in this field.
- `targetId` is the final receiver ID such as `screen-a`, or `*` for broadcast.
- For module updates, `payload` must contain both `module` and `patch`. Sending raw economy fields directly under `payload` is not valid.
- If you want to clear a nullable field such as `lastError`, send JSON `null`. `lastError:` with no value after the colon is malformed JSON and the server will reject it before command validation.

### `POST /api/controller/clear-offline`

Removes disconnected receivers that are still retained in memory.

Response:

```json
{
  "ok": true,
  "removedReceiverIds": ["screen-a"],
  "receivers": []
}
```

### `GET /api/controller/votes/export`

Returns aggregated vote session history.

### `GET /api/controller/timing/export`

Returns all timing attempts currently kept in memory.

### `GET /api/controller/color-challenge/export`

Returns all color challenge result events currently kept in memory.

### `GET /api/controller/scoreboard/export`

Returns the current per-receiver score snapshot, including economy remaining seconds and score-system values.

### `POST /api/unity/register`

Returns Socket.IO metadata for Unity listeners.

Response:

```json
{
  "ok": true,
  "role": "unity",
  "socketServerUrl": "http://127.0.0.1:3100",
  "socketPath": "/socket.io",
  "transports": ["websocket", "polling"],
  "events": {
    "register": "register_unity",
    "command": "control_message",
    "interaction": "interaction_event"
  },
  "config": {
    "ok": true,
    "configTtlMs": 60000,
    "receivers": []
  }
}
```

## Receiver Targeting Rules

- `targetId: "receiver-a"` targets one final assigned receiver ID.
- `targetId: "*"` broadcasts to all currently registered receivers.
- Broadcast only affects receivers that exist at dispatch time.
- Duplicate requested IDs are normalized by the server during registration. In local validation on 2026-04-21, opening `/receiver/prof-main` twice produced `prof-main` and `prof-main2`.

## Receiver Snapshot Model

Every receiver snapshot includes:

```json
{
  "receiverId": "screen-a",
  "label": "Receiver screen-a",
  "connected": true,
  "configVersion": 12,
  "config": {
    "tracks": [],
    "groups": [],
    "pulse": {},
    "vote": null,
    "score": {},
    "map": {},
    "timing": {},
    "textDisplay": {},
    "visuals": {},
    "economy": {},
    "colorChallenge": {}
  }
}
```

This snapshot is returned by:
- `GET /api/config`
- `GET /api/controller/receivers`
- `POST /api/controller/command`
- `POST /api/controller/clear-offline`

## Unified Command Catalog

All commands below are sent to `POST /api/controller/command`.

### 1. `set_track_state`

Advanced per-track patching. If the `trackId` does not exist, the server creates it.

Example:

```json
{
  "command": "set_track_state",
  "targetId": "screen-a",
  "payload": {
    "trackId": "track_01",
    "patch": {
      "visible": true,
      "enabled": true,
      "basePrice": 3.7,
      "playable": true,
      "playing": false,
      "groupId": "group_rhythm",
      "loopEnabled": true,
      "loopControlVisible": true,
      "loopControlLocked": false,
      "volumeValue": 0.5,
      "volumeControlVisible": true,
      "volumeControlEnabled": true,
      "tempoFlashEnabled": true,
      "fillTime": 2.5
    }
  }
}
```

Behavior:
- `basePrice` clamps to `>= 0`.
- `volumeValue` clamps to `0..1`.
- `fillTime` clamps to `>= 0`.
- `playable: false` immediately forces `playing: false`.
- Setting `groupId` automatically synchronizes group membership.
- Creating a new track without specifying fields uses sensible defaults.

### 2. `set_visible_tracks`

Recommended student-facing track workflow after Phase 8.

Example:

```json
{
  "command": "set_visible_tracks",
  "targetId": "*",
  "payload": {
    "trackIds": ["track_01", "TrafficBackground-003.mp3"]
  }
}
```

Behavior:
- The array is the full visible list, not an incremental patch.
- Any track not listed becomes `visible: false`.
- Hidden tracks stop automatically if they were playing.
- If a hidden track was the active economy track, `economy.currentTrackId` and play timing are cleared.

### 3. `remove_track`

Removes a track from `config.tracks` and from every group that referenced it.

Example:

```json
{
  "command": "remove_track",
  "targetId": "screen-a",
  "payload": {
    "trackId": "doc-temp-track"
  }
}
```

### 4. `set_group_state`

Still supported for advanced / legacy workflows, but no longer the recommended main student UI path.

Example:

```json
{
  "command": "set_group_state",
  "targetId": "screen-a",
  "payload": {
    "groupId": "group_rhythm",
    "patch": {
      "label": "Rhythm",
      "color": "#f97316",
      "visible": true,
      "enabled": true,
      "trackIds": ["track_01", "track_02"]
    }
  }
}
```

Behavior:
- `trackIds` synchronizes both `group.trackIds` and every target track's `groupId`.
- Track IDs that do not exist are ignored.

### 5. `remove_group`

Deletes a group and clears `groupId` from tracks that pointed to it.

Example:

```json
{
  "command": "remove_group",
  "targetId": "screen-a",
  "payload": {
    "groupId": "group_rhythm"
  }
}
```

### 6. `set_module_state`

Generic module patch command. Supported `module` values:

- `visuals`
- `textDisplay`
- `pulse`
- `score`
- `map`
- `timing`
- `economy`
- `colorChallenge`

#### `module: "visuals"`

Example:

```json
{
  "command": "set_module_state",
  "targetId": "screen-a",
  "payload": {
    "module": "visuals",
    "patch": {
      "iconColor": "#22c55e"
    }
  }
}
```

#### `module: "textDisplay"`

Example:

```json
{
  "command": "set_module_state",
  "targetId": "screen-a",
  "payload": {
    "module": "textDisplay",
    "patch": {
      "visible": true,
      "enabled": true,
      "text": "Hello from Unity"
    }
  }
}
```

#### `module: "pulse"`

Example:

```json
{
  "command": "set_module_state",
  "targetId": "screen-a",
  "payload": {
    "module": "pulse",
    "patch": {
      "visible": true,
      "enabled": true,
      "active": true,
      "bpm": 120
    }
  }
}
```

Behavior:
- `bpm` is clamped by the pulse scheduler.
- When active, receiver browsers get Socket.IO `pulse` events.

#### `module: "score"`

Example:

```json
{
  "command": "set_module_state",
  "targetId": "screen-a",
  "payload": {
    "module": "score",
    "patch": {
      "visible": true,
      "enabled": true,
      "value": 12
    }
  }
}
```

Compatibility aliases:
- `scoreVisible`
- `scoreEnabled`
- `scoreValue`

#### `module: "map"`

Instant position example:

```json
{
  "command": "set_module_state",
  "targetId": "screen-a",
  "payload": {
    "module": "map",
    "patch": {
      "visible": true,
      "enabled": true,
      "playerPosX": 0.2,
      "playerPosY": 0.8
    }
  }
}
```

Movement example:

```json
{
  "command": "set_module_state",
  "targetId": "screen-a",
  "payload": {
    "module": "map",
    "patch": {
      "movement": {
        "fromX": 0.1,
        "fromY": 0.8,
        "toX": 0.9,
        "toY": 0.2,
        "durationMs": 20000,
        "loop": true
      }
    }
  }
}
```

Stop movement:

```json
{
  "command": "set_module_state",
  "targetId": "screen-a",
  "payload": {
    "module": "map",
    "patch": {
      "movement": null
    }
  }
}
```

Compatibility aliases:
- `mapVisible`
- `mapEnabled`
- `x`
- `y`
- `movement.startX`
- `movement.startY`
- `movement.targetX`
- `movement.targetY`

Behavior:
- Coordinates clamp to `0..1`.
- Instant `playerPosX` or `playerPosY` clears any active movement.
- Movement `durationMs` clamps to `100..600000`.
- `movement.startedAt` auto-fills when omitted.
- `loop` defaults to `true`.
- Unity should send one movement segment per path segment. Do not stream map coordinates every frame.

#### `module: "timing"`

Example:

```json
{
  "command": "set_module_state",
  "targetId": "screen-a",
  "payload": {
    "module": "timing",
    "patch": {
      "visible": true,
      "enabled": true,
      "targetCenter": 0.5,
      "timingTolerance": 0.08
    }
  }
}
```

Compatibility aliases:
- `timingVisible`
- `timingEnabled`
- `center`
- `tosingTolerance`

Behavior:
- `targetCenter` clamps to `0..1`.
- `timingTolerance` clamps to `0..0.5`.
- Timing follows the shared server pulse, not audio playback position.

#### `module: "economy"`

Example:

```json
{
  "command": "set_module_state",
  "targetId": "screen-a",
  "payload": {
    "module": "economy",
    "patch": {
      "visible": true,
      "enabled": false,
      "startingSeconds": 30,
      "currencySeconds": 30,
      "earnRatePerSecond": 0.25,
      "refreshIntervalMs": 30000,
      "inflation": 1,
      "inflationGrowthPerSecond": 0.025,
      "inflationGrowsWhilePlaying": true,
      "gameOver": false,
      "lastError": null
    }
  }
}
```

Behavior:
- Numeric economy fields clamp to `>= 0`.
- `refreshIntervalMs` clamps to `>= 1000`.
- `enabled: false` stops all tracks.
- `gameOver: true` stops all tracks.
- Inflation compounds from the current multiplier over elapsed real time.
- Economy stays off until you explicitly set `enabled: true`.
- Cost is `track.basePrice * economy.inflation`.
- If a track does not define `basePrice`, the current runtime falls back to `durationSeconds` for backward compatibility.

#### `module: "colorChallenge"`

Example:

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
        { "colorId": "blue", "label": "Blue", "color": "#3b82f6" }
      ],
      "assignedColorId": "green",
      "refreshAssignedColorEachIteration": false
    }
  }
}
```

Behavior:
- `minIntervalMs` and `maxIntervalMs` clamp to `250..600000`.
- If `maxIntervalMs < minIntervalMs`, the server normalizes them into ascending order.
- Reward and penalty fields clamp to `>= 0`.
- `maxWrongPenalty` is normalized to be at least `minWrongPenalty`.
- Palette updates require at least two unique colors.
- `assignedColorId` must exist in the active palette or it is ignored.
- `visible: true` and `enabled: true` start a round when the receiver is not game over.

### 7. `set_vote_state`

Creates or replaces the current vote for the target receiver, or clears it with `vote: null`.

Example:

```json
{
  "command": "set_vote_state",
  "targetId": "screen-a",
  "payload": {
    "vote": {
      "voteId": "vote_demo",
      "question": "Choose the next rule",
      "options": [
        { "id": "alpha", "label": "Alpha" },
        { "id": "beta", "label": "Beta" }
      ],
      "visible": true,
      "enabled": true,
      "visibilityDuration": 15,
      "allowRevote": true,
      "selectedOptionId": null,
      "submittedAt": null
    }
  }
}
```

Clear current vote:

```json
{
  "command": "set_vote_state",
  "targetId": "screen-a",
  "payload": {
    "vote": null
  }
}
```

Compatibility fields accepted in the input vote object:
- `id`
- `title`
- `voteQuestion`
- `voteOptions`
- `voteVisible`
- `voteEnabled`
- `voteAllowRevote`

### 8. `vote_reset_all`

Clears the current receiver-local vote selection without deleting the question itself.

Example:

```json
{
  "command": "vote_reset_all",
  "targetId": "screen-a",
  "payload": {}
}
```

Behavior:
- Clears `selectedOptionId`.
- Clears `submittedAt`.
- Does not remove the active vote definition.

### 9. `score_reset`

Sets `score.value` back to `0`.

Example:

```json
{
  "command": "score_reset",
  "targetId": "screen-a",
  "payload": {}
}
```

### 10. `reset_all_state`

Resets the entire receiver config to current defaults.

Example:

```json
{
  "command": "reset_all_state",
  "targetId": "screen-a",
  "payload": {}
}
```

Behavior:
- Resets tracks, groups, pulse, vote, score, map, timing, text, visuals, economy, and color challenge to defaults.
- All tracks return to the default hidden state (`visible: false`) after reset. Reset is not equivalent to `Show All`.
- Economy is live-authoritative, so `currencySeconds` and `inflation` may already have advanced slightly by the time the next snapshot is serialized.

### 11. `request_track_play`

Recommended formal student playback path after Phase 10.

Example:

```json
{
  "command": "request_track_play",
  "targetId": "screen-a",
  "payload": {
    "trackId": "track_01"
  }
}
```

Preconditions:
- Economy enabled.
- Receiver not game over.
- No vote lock.
- Track exists, is visible, enabled, playable, and has a URL plus positive `durationSeconds`.
- No other track is currently playing.
- Receiver can afford the track cost.

On success:
- Deducts cost from `currencySeconds`.
- Sets `economy.currentTrackId`.
- Sets `economy.playStartedAt` and `economy.playEndsAt`.
- Sets that track `playing: true`.

Typical failure values for `economy.lastError`:
- `economy_disabled`
- `game_over`
- `vote_lock`
- `track_hidden`
- `missing_duration`
- `track_disabled`
- `already_playing`
- `insufficient_currency`

Default tuning note:
- The shipped defaults keep economy disabled until the professor/operator enables it.
- After enablement, the default idle earnings and compounding inflation still make even the cheapest track unaffordable at about 3 minutes.

### 12. `request_track_stop`

Stops the currently playing economy track.

Example:

```json
{
  "command": "request_track_stop",
  "targetId": "screen-a",
  "payload": {
    "trackId": "track_01"
  }
}
```

On success:
- Sets that track `playing: false`.
- Clears `economy.currentTrackId`.
- Clears `playStartedAt` and `playEndsAt`.
- Clears `lastError`.

### 13. `economy_reset`

Revives a receiver after game over without changing the visible track list.

Example:

```json
{
  "command": "economy_reset",
  "targetId": "screen-a",
  "payload": {}
}
```

Behavior:
- Restores `currencySeconds` to `startingSeconds`.
- Restores `inflation` to `1`.
- Clears active track and timing fields.
- Clears `gameOver`.
- Clears `lastError`.

### 14. `submit_color_challenge_choice`

Allows HTTP / Unity orchestration of a color challenge result, although the browser receiver normally sends this automatically.

Example:

```json
{
  "command": "submit_color_challenge_choice",
  "targetId": "screen-a",
  "payload": {
    "roundId": "color-round-123",
    "submissionId": "color-submit-456",
    "choiceIndex": 0,
    "colorId": "green",
    "pressedAt": "2026-04-21T02:10:40.000Z"
  }
}
```

Optional fields:
- `clientTimestamp`
- `nextRound`

Behavior:
- `roundId` should match the current `config.colorChallenge.iterationId`.
- `choiceIndex` may be `0`, `1`, or `null` for a timeout miss.
- `pressedAt` future times are clamped to server receive time.
- If the receiver survives the round, the server starts the next round automatically.

### 15. `color_challenge_reset`

Resets the color challenge state while preserving configuration.

Example:

```json
{
  "command": "color_challenge_reset",
  "targetId": "screen-a",
  "payload": {}
}
```

Behavior:
- Restores `score` to `startingScore`.
- Clears `gameOver`.
- Creates a fresh round if the module is visible and enabled.
- Sets `lastResult.reason` to `reset`.

## Export Endpoints

### Scoreboard Export

`GET /api/controller/scoreboard/export`

This is the current score snapshot endpoint. It is intended for the professor / Unity side when a spreadsheet-style record of the latest results is needed instead of raw event logs. The controller UI `Download Score CSV` button uses this endpoint and converts the JSON into CSV.

Returns:

```json
{
  "ok": true,
  "scoreboard": {
    "generatedAt": "2026-04-21T02:33:40.000Z",
    "totalReceivers": 2,
    "receivers": [
      {
        "receiverId": "screen-a",
        "label": "Screen A",
        "connected": true,
        "economyRemainingSeconds": 18.5,
        "economyEnabled": true,
        "economyGameOver": false,
        "manualScoreValue": 7,
        "scoreSystemScore": 2.75,
        "scoreSystemEnabled": true,
        "scoreSystemGameOver": false
      }
    ]
  }
}
```

Field notes:

- `economyRemainingSeconds` is the current live `economy.currencySeconds` snapshot at export time.
- `manualScoreValue` is the Phase 5 per-player score card value.
- `scoreSystemScore` is the Phase 11 score-system value from the Color Challenge module.
- `connected` helps distinguish active receivers from disconnected snapshots that are still retained until `clear-offline`.

### Vote Export

`GET /api/controller/votes/export`

Returns vote sessions in this shape:

```json
{
  "ok": true,
  "votes": [
    {
      "voteId": "vote_demo",
      "question": "Choose the next rule",
      "options": [
        { "optionId": "alpha", "label": "Alpha", "voteCount": 1 },
        { "optionId": "beta", "label": "Beta", "voteCount": 0 }
      ],
      "allowRevote": true,
      "visibilityDuration": 30,
      "openedAt": "2026-04-21T02:29:55.000Z",
      "closesAt": "2026-04-21T02:30:25.000Z",
      "closedAt": null,
      "closeReason": null,
      "isActive": true,
      "submittedCount": 1,
      "totalEligible": 1,
      "missingReceiverIds": [],
      "eligibleReceivers": []
    }
  ]
}
```

### Timing Export

`GET /api/controller/timing/export`

Returns:

```json
{
  "ok": true,
  "timing": {
    "generatedAt": "2026-04-21T02:29:27.000Z",
    "totalAttempts": 1,
    "hits": 0,
    "misses": 1,
    "attempts": []
  }
}
```

### Color Challenge Export

`GET /api/controller/color-challenge/export`

Returns:

```json
{
  "ok": true,
  "colorChallenge": {
    "generatedAt": "2026-04-21T02:31:18.000Z",
    "totalEvents": 1,
    "correct": 1,
    "wrong": 0,
    "misses": 0,
    "gameOvers": 0,
    "events": []
  }
}
```

## Legacy Compatibility Commands

These are still accepted by `POST /api/controller/command`, but they are only recommended for the old two-track demo workflow.

### `audio_control`

```json
{
  "type": "audio_control",
  "targetId": "screen-a",
  "payload": {
    "trackId": 2,
    "action": "play"
  }
}
```

### `audio_playable`

```json
{
  "type": "audio_playable",
  "targetId": "screen-a",
  "payload": {
    "trackId": 1,
    "playable": false
  }
}
```

### `color_change`

```json
{
  "type": "color_change",
  "targetId": "screen-a",
  "payload": {
    "color": "#abcdef"
  }
}
```

### `text_message`

```json
{
  "type": "text_message",
  "targetId": "screen-a",
  "payload": {
    "text": "Legacy hello"
  }
}
```

Compatibility notes:
- `trackId: 1` maps to `track_01`.
- `trackId: 2` maps to `track_02`.
- `text_message` writes the same `textDisplay.text` state used by the modern module snapshot.
- `color_change` writes the same `visuals.iconColor` state used by the modern module snapshot.

## Practical Integration Notes

- Use `set_visible_tracks` to control what students are allowed to choose.
- Use `request_track_play` and `request_track_stop` for the final receiver-led playback economy.
- Keep `set_track_state.playing` only for operator debugging or manual override.
- Keep groups only if the Unity workflow explicitly still needs them. They are supported, but not the main post-Phase-8 student workflow.
- Timing is synchronized to the shared pulse clock, not to currently playing audio files.
- Map movement is segment-based and browser-interpolated. Unity should not send one position every frame.
