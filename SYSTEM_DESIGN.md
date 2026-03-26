# Multi-Receiver Art Installation Control System -- System Design Document

**Author:** Manus AI  
**Date:** 2026-03-26  
**Version:** 1.0

---

## 1. System Architecture Overview

The system adopts a classic **star topology** architecture, with a central WebSocket server acting as the message hub between one Controller and multiple Receivers. All three components communicate over persistent WebSocket connections powered by Socket.IO, which provides automatic reconnection, room-based routing, and transport fallback (WebSocket with polling fallback) for reliable operation in domestic network environments without VPN dependency.

The data flow follows a unidirectional command pattern: the Controller issues commands to the Server, which validates, records, and routes each command to the designated Receiver based on the `targetId` field. The Server maintains an authoritative in-memory state for every registered Receiver, ensuring consistency even when clients reconnect.

```
Controller (Browser)          Server (Node.js + Socket.IO)          Receiver A (Browser)
     |                               |                                    |
     |--- register_controller ------>|                                    |
     |                               |<--- register_receiver --- Receiver A
     |                               |<--- register_receiver --- Receiver B
     |<--- receiver_list ------------|                                    |
     |                               |                                    |
     |--- control_message ---------->|                                    |
     |   (targetId: "A")             |--- receiver_command -------------->|
     |                               |                                    |
     |<--- receiver_list ------------|  (updated state broadcast)         |
```

The Server plays three critical roles in this architecture. First, it serves as a **registry** that tracks all connected Receivers and their current states. Second, it functions as a **message router** that inspects the `targetId` field of each incoming command and delivers it only to the intended Receiver (or broadcasts to all when `targetId` is `"*"`). Third, it acts as a **state synchronizer** that keeps the Controller informed of all Receiver states through periodic list updates.

---

## 2. URL Structure and Identity Design

### 2.1 Route Definitions

The system uses path-based routing to distinguish between the three roles. Each role has a dedicated URL that can be accessed directly from any browser on the same network.

| Role | URL Pattern | Description |
|------|-------------|-------------|
| Home | `/` | Landing page with links to Controller and Receiver |
| Controller | `/controller` | Central control panel for managing all receivers |
| Receiver | `/receiver/:id` | Terminal endpoint identified by a unique path parameter |

### 2.2 Receiver Identity Mechanism

Each Receiver is uniquely identified by the `:id` segment in its URL path. This design was chosen over query parameters or cookie-based identification for several important reasons.

The path-based approach makes each Receiver's identity immediately visible in the URL bar, which simplifies deployment in physical installation environments where operators need to quickly verify which terminal is which. For example, opening `https://your-domain.com/receiver/stage-left` on one device and `https://your-domain.com/receiver/stage-right` on another creates two independently controllable endpoints with self-documenting URLs.

The identity lifecycle works as follows: when a Receiver page loads, it extracts the `:id` from the URL path, establishes a WebSocket connection to the server, and emits a `register_receiver` event containing its `receiverId` and an optional human-readable `label`. The server stores this registration and assigns the socket to a Socket.IO room named `receiver:{id}`, enabling targeted message delivery. If a Receiver with the same ID reconnects (e.g., after a page refresh or network interruption), the server updates the socket reference while preserving the existing state.

### 2.3 Recommended Deployment URLs

For a production art installation, the recommended URL scheme would be:

| Device | URL | Purpose |
|--------|-----|---------|
| Control tablet | `https://install.example.com/controller` | Operator's control interface |
| Display 1 | `https://install.example.com/receiver/display-1` | First visual terminal |
| Display 2 | `https://install.example.com/receiver/display-2` | Second visual terminal |
| Speaker node | `https://install.example.com/receiver/audio-north` | Audio playback terminal |

No additional query parameters, room IDs, or authentication tokens are required for the basic demo. For production deployments, a simple shared secret or PIN-based authentication layer can be added to prevent unauthorized access.

---

## 3. Message Format Design

### 3.1 JSON Message Schema

All control messages follow a unified JSON structure that enables type-safe routing and payload handling:

```typescript
interface ControlMessage {
  type: MessageType;        // "audio_control" | "audio_playable" | "color_change" | "text_message"
  targetId: string;         // Receiver ID or "*" for broadcast
  payload: MessagePayload;  // Type-specific payload object
  timestamp: string;        // ISO 8601 timestamp
}
```

The `type` field determines how the message is interpreted. The `targetId` field controls routing: a specific Receiver ID for targeted delivery, or the wildcard `"*"` for broadcasting to all connected Receivers. The `payload` field carries the type-specific data, and the `timestamp` provides ordering and debugging information.

### 3.2 Message Type Definitions

The system supports four distinct message types, each with its own payload structure:

| Message Type | Payload Fields | Description |
|-------------|---------------|-------------|
| `audio_control` | `trackId: 1 \| 2`, `action: "play" \| "pause"` | Play or pause a specific audio track |
| `audio_playable` | `trackId: 1 \| 2`, `playable: boolean` | Enable or disable a track's playability |
| `color_change` | `color: string` | Set the icon color (CSS color value) |
| `text_message` | `text: string` | Display a text message on the receiver |

### 3.3 Typical Message Examples

**Play Track 1 on Receiver A:**
```json
{
  "type": "audio_control",
  "targetId": "A",
  "payload": { "trackId": 1, "action": "play" },
  "timestamp": "2026-03-26T03:00:00.000Z"
}
```

**Disable Track 2 on Receiver B:**
```json
{
  "type": "audio_playable",
  "targetId": "B",
  "payload": { "trackId": 2, "playable": false },
  "timestamp": "2026-03-26T03:00:05.000Z"
}
```

**Change icon color on Receiver A to red:**
```json
{
  "type": "color_change",
  "targetId": "A",
  "payload": { "color": "#ef4444" },
  "timestamp": "2026-03-26T03:00:10.000Z"
}
```

**Broadcast a text message to all receivers:**
```json
{
  "type": "text_message",
  "targetId": "*",
  "payload": { "text": "Performance begins in 5 minutes" },
  "timestamp": "2026-03-26T03:00:15.000Z"
}
```

---

## 4. Multi-User Identification and Independent Control

### 4.1 Receiver Registration Flow

The system distinguishes different Receivers through a registration protocol that executes automatically when each Receiver page loads:

1. The Receiver page extracts its unique ID from the URL path parameter (e.g., `/receiver/A` yields ID `"A"`).
2. Upon WebSocket connection, the Receiver emits a `register_receiver` event with its `receiverId` and optional `label`.
3. The server creates (or updates) an entry in its in-memory `receivers` Map, keyed by the `receiverId`.
4. The server assigns the socket to a Socket.IO room named `receiver:{receiverId}`.
5. The server sends the current state back to the Receiver via `receiver_state_update`.
6. The server broadcasts an updated receiver list to all connected Controllers via `receiver_list`.

### 4.2 Targeted Message Delivery

When the Controller sends a `control_message`, the server inspects the `targetId` field and routes accordingly:

| `targetId` Value | Routing Behavior |
|-----------------|-----------------|
| Specific ID (e.g., `"A"`) | Delivered only to the socket in room `receiver:A` |
| Wildcard `"*"` | Delivered to all registered receivers |

This room-based routing is handled by Socket.IO's built-in room mechanism, which is both efficient and reliable. The server never broadcasts control messages to Controller sockets, maintaining clean separation of concerns.

### 4.3 Server-Side State Management

The server maintains an authoritative `ReceiverState` object for each registered Receiver:

```typescript
interface ReceiverState {
  receiverId: string;
  label: string;
  connected: boolean;
  audio: {
    track1: { playing: boolean; playable: boolean };
    track2: { playing: boolean; playable: boolean };
  };
  iconColor: string;
  lastMessage: string;
}
```

Every control message updates this state before being forwarded to the Receiver. This design ensures that the Controller always displays accurate state information, and that Receivers can recover their full state after reconnection.

---

## 5. Socket.IO Event Reference

The following table summarizes all WebSocket events used in the system:

| Event Name | Direction | Payload | Purpose |
|-----------|-----------|---------|---------|
| `register_controller` | Client -> Server | (none) | Register a socket as a Controller |
| `register_receiver` | Client -> Server | `{ receiverId, label? }` | Register a socket as a Receiver |
| `control_message` | Client -> Server | `ControlMessage` | Send a control command |
| `receiver_list` | Server -> Controller | `{ receivers: ReceiverState[] }` | Updated list of all receivers |
| `receiver_command` | Server -> Receiver | `ControlMessage` | Forwarded control command |
| `receiver_state_update` | Server -> Receiver | `ReceiverState` | Full state sync on reconnection |

---

## 6. Frontend Page Specifications

### 6.1 Controller Page (`/controller`)

The Controller page provides a comprehensive control panel with the following sections:

**Header:** Displays the system title, connection status badge (green "Connected" or red "Disconnected"), and real-time WebSocket state.

**Receiver List (Left Panel):** A scrollable list of all registered Receivers, each showing the receiver label, ID, connection status indicator (green/red dot), current icon color, and audio track states. Clicking a receiver selects it as the control target.

**Target Selector:** A dropdown that mirrors the receiver list selection, allowing quick switching between targets.

**Audio Control Section:** For each of the two audio tracks, the panel displays the current state (Playing/Paused) with a toggle button, and a Playable switch that can enable or disable the track entirely. When a track is disabled, the play button becomes inactive.

**Icon Color Section:** A grid of 12 preset color swatches for quick selection, plus a native color picker for custom colors. The current color is displayed as a small circle in the section header.

**Text Message Section:** A text input field with a "Send" button for targeted delivery and a "Broadcast" button for sending to all receivers simultaneously. The last sent message is displayed above the input for reference.

### 6.2 Receiver Page (`/receiver/:id`)

The Receiver page is designed as a clean, immersive display terminal:

**Header:** Shows the receiver ID, a descriptive label, and the connection status badge.

**Central Icon Display:** A large hexagonal icon that changes color in response to `color_change` commands. The icon features a glowing shadow effect that matches the current color, creating a visually striking centerpiece for art installations.

**Audio Status Section:** Displays the state of both audio tracks (Playing/Ready/Disabled) with appropriate icons. Audio playback is controlled entirely by the Controller; the Receiver page has no local play/pause buttons.

**Message Display Section:** A centered text area that shows the most recently received text message. New messages trigger a brief highlight animation to draw attention.

**Footer:** Displays the receiver ID and WebSocket connection status for debugging purposes.

---

## 7. Technology Stack

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| Frontend Framework | React 19 + TypeScript | Type safety, component reusability |
| UI Components | shadcn/ui + Tailwind CSS 4 | Consistent design system, rapid development |
| Routing | Wouter | Lightweight client-side routing |
| Real-time Communication | Socket.IO 4.8 | Reliable WebSocket with automatic fallback |
| Backend Runtime | Node.js + Express | Shared language with frontend, mature ecosystem |
| Build Tool | Vite 7 | Fast HMR, optimized production builds |
| Testing | Vitest | Fast, TypeScript-native test runner |

---

## 8. Extension Recommendations

### 8.1 Scaling to More Receivers

The current in-memory state management works well for dozens of Receivers. For installations with hundreds of concurrent devices, consider the following upgrades:

**Persistent State Storage:** Replace the in-memory `Map` with a Redis-backed store. This enables horizontal scaling across multiple server instances and provides state persistence across server restarts.

**Namespace Partitioning:** Use Socket.IO namespaces to separate different installation zones (e.g., `/zone-a`, `/zone-b`), each with its own set of Receivers and Controllers.

**Connection Pooling:** Implement a connection manager that monitors Receiver health and automatically removes stale entries after a configurable timeout.

### 8.2 Additional Media Types

The message format is designed for extensibility. Adding new control types requires three steps:

1. Define a new `MessageType` value and corresponding payload interface in `shared/wsTypes.ts`.
2. Add a handler case in the server's `applyCommand` function.
3. Implement the rendering logic in the Receiver page's command handler.

Potential extensions include video playback control, animation triggers, servo motor positioning, LED strip patterns, and sensor data feedback from Receivers to the Controller.

### 8.3 Production Deployment Considerations

**Authentication:** Add a simple PIN or token-based authentication layer to prevent unauthorized access. The Controller could require a master PIN, while Receivers could use device-specific tokens.

**HTTPS:** Deploy behind a reverse proxy (e.g., Nginx or Caddy) with TLS certificates for secure WebSocket connections (`wss://`).

**Monitoring:** Implement a health check endpoint and connection metrics dashboard to monitor the installation's operational status during live events.

**Offline Resilience:** Add a service worker to cache the Receiver page assets, allowing terminals to display their last known state even during brief network interruptions.

**Multi-Controller Support:** The current architecture already supports multiple simultaneous Controllers. Each Controller receives the same receiver list updates and can independently control any Receiver.

---

## 9. File Structure

```
art-installation-control/
  shared/
    wsTypes.ts          # Message types, event names, audio URLs
    const.ts            # Shared constants
  server/
    wsServer.ts         # Socket.IO server initialization and message routing
    wsServer.test.ts    # Vitest tests for message types and state
    _core/
      index.ts          # Express + Socket.IO server entry point
  client/src/
    hooks/
      useSocket.ts      # Shared WebSocket connection hook
    pages/
      Home.tsx          # Landing page with role selection
      Controller.tsx    # Control panel with audio/color/text controls
      Receiver.tsx      # Display terminal with audio/visual/text rendering
    App.tsx             # Route definitions
```

---

## 10. Quick Start Guide

**Step 1:** Open the home page at `/` and review the system architecture.

**Step 2:** Open `/receiver/A` in one browser tab and `/receiver/B` in another. Each tab will automatically register with the server and display its unique ID.

**Step 3:** Open `/controller` in a third tab. The Controller will show both Receivers in the left panel with their connection status.

**Step 4:** Select a Receiver from the list or dropdown, then use the Audio, Color, and Text controls to send commands. Observe the changes appearing in real-time on the targeted Receiver tab.

**Step 5:** Try the "Broadcast" button in the Text Message section to send a message to all Receivers simultaneously.
