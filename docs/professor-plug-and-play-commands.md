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

Animate the receiver marker from a start position to a target position.
This is the recommended Unity workflow: send one movement command, then the
receiver page interpolates locally. Unity does not need to send a position every
frame.

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
        "movement": {
          "fromX": 0.10,
          "fromY": 0.80,
          "toX": 0.90,
          "toY": 0.20,
          "durationMs": 20000,
          "loop": true
        }
      }
    }
  }'
```

Set an instant marker position for debug or manual placement. This also stops
the current movement animation:

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

Stop the movement animation without hiding the map:

```bash
curl -X POST "$BASE_URL/api/controller/command" \
  -H "Content-Type: application/json" \
  -d '{
    "command": "set_module_state",
    "targetId": "screen-a",
    "payload": {
      "module": "map",
      "patch": {
        "movement": null
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

Important: this is a separate command. Do **not** extend the older
`set_track_state` payload by changing `trackId` into `string[]`.

Use:

```json
{
  "command": "set_visible_tracks",
  "targetId": "*",
  "payload": {
    "trackIds": ["Accident1.mp3", "Alarm1.mp3", "Birds-001.mp3"]
  }
}
```

Do not use:

```json
{
  "command": "set_track_state",
  "targetId": "*",
  "payload": {
    "trackId": ["Accident1.mp3", "Alarm1.mp3"],
    "patch": {
      "visible": true
    }
  }
}
```

Show a small list of tracks on all receivers:

```bash
curl -X POST "$BASE_URL/api/controller/command" \
  -H "Content-Type: application/json" \
  -d '{
    "command": "set_visible_tracks",
    "targetId": "*",
    "payload": {
      "trackIds": ["Accident1.mp3", "Alarm1.mp3", "Birds-001.mp3"]
    }
  }'
```

Show tracks on one receiver only:

```bash
curl -X POST "$BASE_URL/api/controller/command" \
  -H "Content-Type: application/json" \
  -d '{
    "command": "set_visible_tracks",
    "targetId": "screen-a",
    "payload": {
      "trackIds": ["TrafficBackground-001.mp3", "River1.mp3"]
    }
  }'
```

The array is the complete visible list, not an incremental patch:

- `["Accident1.mp3"]` means only `Accident1.mp3` is visible.
- `[]` means all tracks are hidden.
- Hidden tracks are also stopped if they were playing.

For the current legacy demo tracks, `track_01` and `track_02` are still accepted.

One duplicated filename exists in the current audio drop:

```text
CitySounds/LightRain.mp3    -> LightRain.mp3
NatureSounds/LightRain.mp3  -> LightRain.mp3__2
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
5. Show the map and send a 20s looping movement
6. Enable timing challenge
7. Open `/receiver/:id` and try the timing button
8. Export timing results
9. Reset all
