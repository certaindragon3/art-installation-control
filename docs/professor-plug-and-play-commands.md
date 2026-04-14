# Professor Plug-And-Play Commands

Short copy-paste commands for testing the current workflow without using the web controller UI.

Polling/voting-specific payloads are in [`polling-system-payloads.md`](./polling-system-payloads.md).

## Current Note

The current `timing challenge` is based on the shared server pulse clock.

It is **not** aligned to the playback position of the currently playing track.

For now this is the main limitation that can safely be overlooked if timing-to-track alignment is not required yet.

## 1. Set Base URL

Local:

```bash
BASE_URL="http://127.0.0.1:3000"
```

Production:

```bash
BASE_URL="https://artinstallation.certaindragon3.work"
```

## 2. List Receivers

```bash
curl "$BASE_URL/api/controller/receivers"
```

Use the returned `receiverId`, for example `screen-a`.

## 3. Create Or Update A Group

Creates a group called `Rhythm` on one receiver:

```bash
curl -X POST "$BASE_URL/api/controller/command" \
  -H "Content-Type: application/json" \
  -d '{
    "command": "set_group_state",
    "targetId": "screen-a",
    "payload": {
      "groupId": "group_rhythm",
      "patch": {
        "label": "Rhythm",
        "color": "#f97316",
        "visible": true,
        "enabled": true
      }
    }
  }'
```

## 4. Regroup A Track

Assign `track_01` into `group_rhythm`:

```bash
curl -X POST "$BASE_URL/api/controller/command" \
  -H "Content-Type: application/json" \
  -d '{
    "command": "set_track_state",
    "targetId": "screen-a",
    "payload": {
      "trackId": "track_01",
      "patch": {
        "groupId": "group_rhythm"
      }
    }
  }'
```

Move `track_01` to a different group:

```bash
curl -X POST "$BASE_URL/api/controller/command" \
  -H "Content-Type: application/json" \
  -d '{
    "command": "set_track_state",
    "targetId": "screen-a",
    "payload": {
      "trackId": "track_01",
      "patch": {
        "groupId": "group_alt"
      }
    }
  }'
```

Ungroup `track_01`:

```bash
curl -X POST "$BASE_URL/api/controller/command" \
  -H "Content-Type: application/json" \
  -d '{
    "command": "set_track_state",
    "targetId": "screen-a",
    "payload": {
      "trackId": "track_01",
      "patch": {
        "groupId": null
      }
    }
  }'
```

Remove a group entirely:

```bash
curl -X POST "$BASE_URL/api/controller/command" \
  -H "Content-Type: application/json" \
  -d '{
    "command": "remove_group",
    "targetId": "screen-a",
    "payload": {
      "groupId": "group_rhythm"
    }
  }'
```

## 5. Start Pulse

Start pulse on one receiver at 90 BPM:

```bash
curl -X POST "$BASE_URL/api/controller/command" \
  -H "Content-Type: application/json" \
  -d '{
    "command": "set_module_state",
    "targetId": "screen-a",
    "payload": {
      "module": "pulse",
      "patch": {
        "visible": true,
        "enabled": true,
        "active": true,
        "bpm": 90
      }
    }
  }'
```

Change BPM:

```bash
curl -X POST "$BASE_URL/api/controller/command" \
  -H "Content-Type: application/json" \
  -d '{
    "command": "set_module_state",
    "targetId": "screen-a",
    "payload": {
      "module": "pulse",
      "patch": {
        "enabled": true,
        "active": true,
        "bpm": 120
      }
    }
  }'
```

Stop pulse:

```bash
curl -X POST "$BASE_URL/api/controller/command" \
  -H "Content-Type: application/json" \
  -d '{
    "command": "set_module_state",
    "targetId": "screen-a",
    "payload": {
      "module": "pulse",
      "patch": {
        "active": false
      }
    }
  }'
```

## 6. Show And Move The Map

Show the map and enable interaction:

```bash
curl -X POST "$BASE_URL/api/controller/command" \
  -H "Content-Type: application/json" \
  -d '{
    "command": "set_module_state",
    "targetId": "screen-a",
    "payload": {
      "module": "map",
      "patch": {
        "visible": true,
        "enabled": true,
        "playerPosX": 0.50,
        "playerPosY": 0.50
      }
    }
  }'
```

Move the receiver marker:

```bash
curl -X POST "$BASE_URL/api/controller/command" \
  -H "Content-Type: application/json" \
  -d '{
    "command": "set_module_state",
    "targetId": "screen-a",
    "payload": {
      "module": "map",
      "patch": {
        "playerPosX": 0.20,
        "playerPosY": 0.80
      }
    }
  }'
```

Hide the map:

```bash
curl -X POST "$BASE_URL/api/controller/command" \
  -H "Content-Type: application/json" \
  -d '{
    "command": "set_module_state",
    "targetId": "screen-a",
    "payload": {
      "module": "map",
      "patch": {
        "visible": false
      }
    }
  }'
```

## 7. Enable Timing Challenge

Show timing UI and set the hit window:

```bash
curl -X POST "$BASE_URL/api/controller/command" \
  -H "Content-Type: application/json" \
  -d '{
    "command": "set_module_state",
    "targetId": "screen-a",
    "payload": {
      "module": "timing",
      "patch": {
        "visible": true,
        "enabled": true,
        "targetCenter": 0.50,
        "timingTolerance": 0.08
      }
    }
  }'
```

Harder timing window:

```bash
curl -X POST "$BASE_URL/api/controller/command" \
  -H "Content-Type: application/json" \
  -d '{
    "command": "set_module_state",
    "targetId": "screen-a",
    "payload": {
      "module": "timing",
      "patch": {
        "targetCenter": 0.50,
        "timingTolerance": 0.03
      }
    }
  }'
```

Disable timing interaction but keep the UI visible:

```bash
curl -X POST "$BASE_URL/api/controller/command" \
  -H "Content-Type: application/json" \
  -d '{
    "command": "set_module_state",
    "targetId": "screen-a",
    "payload": {
      "module": "timing",
      "patch": {
        "visible": true,
        "enabled": false
      }
    }
  }'
```

## 8. Export Timing Results

```bash
curl "$BASE_URL/api/controller/timing/export"
```

## 9. Start Or Stop A Track

### Choose Which Tracks Students Can See

This replaces the old group-based workflow. Send the filenames or track IDs that
should be visible. Every other track is hidden and stopped.

```bash
curl -X POST "$BASE_URL/api/controller/command" \
  -H "Content-Type: application/json" \
  -d '{
    "command": "set_visible_tracks",
    "targetId": "*",
    "payload": {
      "trackIds": ["boing.mp3", "womp-womp.mp3"]
    }
  }'
```

For the current legacy demo tracks, `track_01` and `track_02` are still accepted:

```bash
curl -X POST "$BASE_URL/api/controller/command" \
  -H "Content-Type: application/json" \
  -d '{
    "command": "set_visible_tracks",
    "targetId": "*",
    "payload": {
      "trackIds": ["track_01"]
    }
  }'
```

Play `track_01`:

```bash
curl -X POST "$BASE_URL/api/controller/command" \
  -H "Content-Type: application/json" \
  -d '{
    "command": "set_track_state",
    "targetId": "screen-a",
    "payload": {
      "trackId": "track_01",
      "patch": {
        "playing": true
      }
    }
  }'
```

Pause `track_01`:

```bash
curl -X POST "$BASE_URL/api/controller/command" \
  -H "Content-Type: application/json" \
  -d '{
    "command": "set_track_state",
    "targetId": "screen-a",
    "payload": {
      "trackId": "track_01",
      "patch": {
        "playing": false
      }
    }
  }'
```

## 10. Reset Everything

Reset all state on one receiver:

```bash
curl -X POST "$BASE_URL/api/controller/command" \
  -H "Content-Type: application/json" \
  -d '{
    "command": "reset_all_state",
    "targetId": "screen-a",
    "payload": {}
  }'
```

Broadcast reset to all receivers:

```bash
curl -X POST "$BASE_URL/api/controller/command" \
  -H "Content-Type: application/json" \
  -d '{
    "command": "reset_all_state",
    "targetId": "*",
    "payload": {}
  }'
```

## 11. Suggested Quick Test Order

1. `GET /api/controller/receivers`
2. Create a group
3. Regroup `track_01`
4. Start pulse
5. Show the map and move the marker
6. Enable timing challenge
7. Open `/receiver/:id` and try the timing button
8. Export timing results
9. Reset all
