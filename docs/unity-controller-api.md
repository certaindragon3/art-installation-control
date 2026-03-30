# Unity Controller Integration Manual

This project is deployed at:

```text
https://artinstallation.certaindragon3.work
```

For Unity development, the recommended integration is now the HTTP controller bridge. It is simpler than using a Socket.IO client inside Unity and still drives the exact same receiver state and command flow as the web controller.

## 1. Addresses

- Home UI: `https://artinstallation.certaindragon3.work/`
- Controller UI: `https://artinstallation.certaindragon3.work/controller`
- Receiver UI: `https://artinstallation.certaindragon3.work/receiver/:id`
- Health check: `GET https://artinstallation.certaindragon3.work/api/healthz`

Recommended for Unity:

- `GET https://artinstallation.certaindragon3.work/api/controller/receivers`
- `POST https://artinstallation.certaindragon3.work/api/controller/command`
- `POST https://artinstallation.certaindragon3.work/api/controller/clear-offline`

Still available for advanced clients:

- Socket.IO base URL: `https://artinstallation.certaindragon3.work`
- Socket.IO path: `/socket.io/`

## 2. Recommended Unity Path

Do not automate the browser UI.

Use the new HTTP API:

1. Unity polls `GET /api/controller/receivers`
2. Unity picks a `receiverId`
3. Unity sends commands to `POST /api/controller/command`

This is better for Unity because:

- no Socket.IO package is required
- `UnityWebRequest` is enough
- debugging is easier with browser devtools, curl, or Postman
- the server still uses the same internal Socket.IO routing to reach receivers

## 3. Receiver IDs

Each receiver is addressed by its `receiverId`.

Examples:

- `screen-a`
- `screen-b`
- `audio-north`

Broadcast to all receivers by sending:

```json
{
  "targetId": "*"
}
```

## 4. HTTP API

### 4.1 Get Receiver List

Request:

```http
GET /api/controller/receivers
```

Response:

```json
{
  "ok": true,
  "receivers": [
    {
      "receiverId": "screen-a",
      "label": "Main Screen",
      "connected": true,
      "audio": {
        "track1": { "playing": false, "playable": true },
        "track2": { "playing": false, "playable": true }
      },
      "iconColor": "#6366f1",
      "lastMessage": ""
    }
  ]
}
```

### 4.2 Send Command

Request:

```http
POST /api/controller/command
Content-Type: application/json
```

Body shape:

```json
{
  "type": "audio_control | audio_playable | color_change | text_message",
  "targetId": "receiver-id-or-*",
  "payload": {},
  "timestamp": "2026-03-30T12:34:56.000Z"
}
```

Notes:

- `timestamp` is optional for HTTP clients; the server will fill it if omitted
- `targetId` is a specific receiver ID or `"*"` for broadcast
- invalid payloads return `400`
- unknown target receivers return `404`

Success response:

```json
{
  "ok": true,
  "command": {
    "type": "text_message",
    "targetId": "screen-a",
    "payload": {
      "text": "Hello from Unity"
    },
    "timestamp": "2026-03-30T12:34:56.000Z"
  },
  "broadcast": false,
  "deliveredReceiverIds": ["screen-a"],
  "missingTargetId": null,
  "receivers": [
    {
      "receiverId": "screen-a",
      "label": "Main Screen",
      "connected": true,
      "audio": {
        "track1": { "playing": false, "playable": true },
        "track2": { "playing": false, "playable": true }
      },
      "iconColor": "#6366f1",
      "lastMessage": "Hello from Unity"
    }
  ]
}
```

### 4.3 Clear Offline Receivers

Request:

```http
POST /api/controller/clear-offline
```

Response:

```json
{
  "ok": true,
  "removedReceiverIds": ["screen-a"],
  "receivers": []
}
```

## 5. UI Element -> API Mapping

| Web controller UI element | Recommended Unity call |
| --- | --- |
| Select receiver | `GET /api/controller/receivers`, then cache `receiverId` |
| Track 1 Play/Pause | `POST /api/controller/command` with `type: "audio_control"` and `payload: { "trackId": 1, "action": "play" \| "pause" }` |
| Track 2 Play/Pause | `POST /api/controller/command` with `type: "audio_control"` and `payload: { "trackId": 2, "action": "play" \| "pause" }` |
| Track 1 Playable switch | `POST /api/controller/command` with `type: "audio_playable"` and `payload: { "trackId": 1, "playable": true \| false }` |
| Track 2 Playable switch | `POST /api/controller/command` with `type: "audio_playable"` and `payload: { "trackId": 2, "playable": true \| false }` |
| Preset color button | `POST /api/controller/command` with `type: "color_change"` and `payload: { "color": "#rrggbb" }` |
| Custom color picker | `POST /api/controller/command` with `type: "color_change"` and `payload: { "color": "#rrggbb" }` |
| Text `Send` button | `POST /api/controller/command` with `type: "text_message"` and a specific `targetId` |
| Text `Broadcast` button | `POST /api/controller/command` with `type: "text_message"` and `targetId: "*"` |
| `Clear Offline` button | `POST /api/controller/clear-offline` |

## 6. Command Examples

### Play track 1 on one receiver

```json
{
  "type": "audio_control",
  "targetId": "screen-a",
  "payload": {
    "trackId": 1,
    "action": "play"
  }
}
```

### Disable track 2

```json
{
  "type": "audio_playable",
  "targetId": "screen-a",
  "payload": {
    "trackId": 2,
    "playable": false
  }
}
```

### Change icon color

```json
{
  "type": "color_change",
  "targetId": "screen-a",
  "payload": {
    "color": "#22c55e"
  }
}
```

### Send text to one receiver

```json
{
  "type": "text_message",
  "targetId": "screen-a",
  "payload": {
    "text": "Hello from Unity"
  }
}
```

### Broadcast text to all receivers

```json
{
  "type": "text_message",
  "targetId": "*",
  "payload": {
    "text": "Showtime starts now"
  }
}
```

## 7. Unity Example

A minimal Unity HTTP client example is included here:

- [`docs/examples/UnityArtInstallationController.cs`](./examples/UnityArtInstallationController.cs)

It uses `UnityWebRequest` and can:

- fetch the receiver list
- send a sample text message
- send a sample color change
- clear offline receivers

## 8. Optional Direct Socket.IO Integration

If a future Unity build wants realtime push updates instead of HTTP polling, the original realtime protocol is still available.

Socket.IO event names:

- Client -> Server:
  - `register_controller`
  - `register_receiver`
  - `control_message`
  - `clear_offline_receivers`
- Server -> Client:
  - `receiver_list`
  - `receiver_command`
  - `receiver_state_update`

Socket.IO control message schema:

```json
{
  "type": "audio_control | audio_playable | color_change | text_message",
  "targetId": "receiver-id-or-*",
  "payload": {},
  "timestamp": "2026-03-30T12:34:56.000Z"
}
```

Under HTTPS, Socket.IO upgrades to secure realtime transport automatically.

## 9. Practical Development Advice

For your supervisor, the fastest path is:

1. Use the Unity HTTP example as the starting point
2. Poll `GET /api/controller/receivers` to discover available terminals
3. Drive the installation through `POST /api/controller/command`

If later they need a live operator dashboard inside Unity, then it becomes worth adding a Socket.IO Unity client.
