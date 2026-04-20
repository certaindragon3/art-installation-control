# Phase 10 D9 Loop Movement Verification

Date: 2026-04-20

Tooling: `agent-browser`

Production URL tested:

```text
https://artinstallation.certaindragon3.work
```

Receiver route:

```text
https://artinstallation.certaindragon3.work/receiver/phase10loopcheck
```

## Command

Sent this production HTTP command:

```json
{
  "command": "set_module_state",
  "targetId": "phase10loopcheck",
  "payload": {
    "module": "map",
    "patch": {
      "visible": true,
      "enabled": true,
      "movement": {
        "fromX": 0.1,
        "fromY": 0.8,
        "toX": 0.9,
        "toY": 0.2,
        "durationMs": 4000,
        "loop": true
      }
    }
  }
}
```

Production API returned `ok: true` and delivered the command to `phase10loopcheck`.

## Browser Evidence

The receiver page showed:

- `Classroom Map`
- `Tracking Enabled`
- `Looping 4.0s`

Screenshot:

- `phase10-loop-movement-receiver.png`

## Coordinate Samples

`agent-browser eval` sampled the receiver page text every second. Coordinates repeated every 4 seconds, which verifies that `loop: true` continuously loops from start to target instead of stopping at target.

| t | Left -> Right | Back -> Front |
|---|---:|---:|
| 0s | 73.3 | 67.5 |
| 1s | 13.3 | 22.5 |
| 2s | 33.3 | 37.5 |
| 3s | 53.3 | 52.5 |
| 4s | 73.3 | 67.5 |
| 5s | 13.3 | 22.5 |
| 6s | 33.3 | 37.5 |
| 7s | 53.3 | 52.5 |
| 8s | 73.7 | 67.7 |
| 9s | 13.7 | 22.7 |

## Result

Pass. Current production behavior matches the Phase 9 design:

- `loop: true` loops continuously.
- Movement is rendered on the receiver page from browser-local time interpolation.
- No finite `loop_times` behavior was tested or required for Phase 10.

Cleanup command sent after verification:

```json
{
  "command": "set_module_state",
  "targetId": "phase10loopcheck",
  "payload": {
    "module": "map",
    "patch": {
      "movement": null
    }
  }
}
```
