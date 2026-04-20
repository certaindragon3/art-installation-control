# Phase 10 Production Browser Verification

Date: 2026-04-20

Production URL: `https://artinstallation.certaindragon3.work`

Tooling: `agent-browser 0.25.3`

Receiver used:

- Requested route: `/receiver/phase10verify0420`
- Final assigned receiver id: `phase10verify04202`
- Note: `phase10verify0420` already existed as an offline receiver, so the Phase 9 unique receiver-id logic assigned the active browser instance to `phase10verify04202`.

## Checks Performed

### Health And Config

- `GET /api/healthz` returned `200` with `{"ok":true}`.
- `GET /api/config` returned receiver snapshots containing Phase 10 track metadata:
  - `durationSeconds`
  - `categoryId`
  - `categoryColor`
  - `economy`

### Home Page Controller Entry

Opened `/` on a `390x844` mobile viewport.

Observed:

- Receiver ID textbox.
- `Join as Receiver` button.
- Receiver shortcut buttons.
- No visible `/controller` link or controller card.

### Direct Controller Route

Opened `/controller` directly.

Observed:

- Controller route loads successfully.
- Socket connection becomes `Connected` after a short wait.
- Controller lists online receiver `phase10verify04202`.
- Controller exposes Phase 10 economy controls:
  - economy enable / visible switches
  - starting seconds
  - earn rate
  - inflation growth
  - inflation grows while playing
  - `Reset / Revive Economy`
- Controller still exposes visible-track selector and manual play / pause controls.

Note: the production smoke originally found that the controller heading still said `Phase 6 Controller`. This was a copy issue, not a Phase 10 protocol failure, and the source was updated after the smoke test.

### Receiver UI And Track Visibility

Opened `/receiver/phase10verify0420` on a `390x844` mobile viewport.

Observed:

- Active receiver registered as `phase10verify04202`.
- Page displayed `Requested phase10verify0420, assigned phase10verify04202`.
- Receiver showed economy HUD with `Pool`, `Cost x`, and state.
- Receiver rendered compact track rows with `Play` and `Loop Off` controls.

Used HTTP controller API to make the test deterministic:

```json
{
  "command": "set_visible_tracks",
  "targetId": "phase10verify04202",
  "payload": {
    "trackIds": ["track_01"]
  }
}
```

Result:

- API returned `ok: true`.
- `deliveredReceiverIds` included `phase10verify04202`.
- Receiver snapshot showed only one interactive track row.

### Receiver-Led Playback

After clearing vote lock, clicked the receiver Play button.

Observed:

- Receiver UI changed from `Play` to `Stop`.
- `agent-browser click @ref` did not trigger the React handler reliably for this button, so the final click used DOM event fallback:

```js
Array.from(document.querySelectorAll("button"))
  .find(button => button.textContent?.trim() === "Play")
  ?.dispatchEvent(new MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    view: window
  }));
```

For clearer server-side evidence, also ran a deterministic long-track request:

```json
{
  "command": "request_track_play",
  "targetId": "phase10verify04202",
  "payload": {
    "trackId": "TrafficBackground-003.mp3"
  }
}
```

Before the request, the receiver was configured with:

- visible tracks: `["TrafficBackground-003.mp3"]`
- `currencySeconds: 100`
- `inflation: 1`

API result:

```json
{
  "ok": true,
  "deliveredReceiverIds": ["phase10verify04202"],
  "economy": {
    "currencySeconds": 65.6511424,
    "inflation": 1.0679,
    "currentTrackId": "TrafficBackground-003.mp3",
    "playStartedAt": "2026-04-20T13:18:22.008Z",
    "playEndsAt": "2026-04-20T13:18:57.352Z",
    "gameOver": false,
    "lastError": null
  },
  "track": {
    "trackId": "TrafficBackground-003.mp3",
    "playing": true,
    "durationSeconds": 35.344,
    "visible": true,
    "categoryId": "CitySounds",
    "categoryColor": "#14b8a6"
  }
}
```

Receiver UI also showed `Stop` for the active track.

### Game Over And Economy Reset

Forced insufficient currency:

```json
{
  "command": "set_module_state",
  "targetId": "phase10verify04202",
  "payload": {
    "module": "economy",
    "patch": {
      "currencySeconds": 1,
      "inflation": 1,
      "gameOver": false,
      "lastError": null
    }
  }
}
```

Then requested `TrafficBackground-003.mp3` again.

API result:

```json
{
  "economy": {
    "currencySeconds": 0,
    "currentTrackId": null,
    "playStartedAt": null,
    "playEndsAt": null,
    "gameOver": true,
    "lastError": "insufficient_currency"
  },
  "track": {
    "trackId": "TrafficBackground-003.mp3",
    "playing": false
  }
}
```

Receiver UI showed:

- `Pool0.0s`
- `Play` disabled
- `Loop Off` disabled

Then reset economy:

```json
{
  "command": "economy_reset",
  "targetId": "phase10verify04202",
  "payload": {}
}
```

API result:

```json
{
  "currencySeconds": 30,
  "inflation": 1,
  "currentTrackId": null,
  "gameOver": false,
  "lastError": null
}
```

Receiver UI returned to enabled `Play` / `Loop Off` controls.

### Vote Lock

Opened a four-option vote:

```json
{
  "command": "set_vote_state",
  "targetId": "phase10verify04202",
  "payload": {
    "vote": {
      "voteId": "phase10_closeout_vote2",
      "question": "Phase 10 vote lock?",
      "options": [
        { "id": "a", "label": "A" },
        { "id": "b", "label": "B" },
        { "id": "c", "label": "C" },
        { "id": "d", "label": "D" }
      ],
      "visible": true,
      "enabled": true,
      "visibilityDuration": 1000,
      "allowRevote": true,
      "selectedOptionId": null,
      "submittedAt": null
    }
  }
}
```

Observed:

- API returned `ok: true`.
- `GET /api/controller/receivers` showed `voteId: "phase10_closeout_vote2"` and `visible: true`.
- Receiver mobile viewport showed vote buttons `A`, `B`, `C`, `D`.
- Track controls were replaced by vote UI while the vote was active.

Cleanup:

- Sent `set_vote_state` with `vote: null`.
- Sent `economy_reset` for `phase10verify04202`.

## Notes

- Production verification used HTTPS. The HTTP origin has previously been blocked in browser automation by `ERR_BLOCKED_BY_CLIENT`.
- `agent-browser click @ref` did not reliably trigger the receiver Play React handler. DOM event fallback did trigger the same user-facing button and changed the UI to `Stop`.
- The controller route is intentionally still directly accessible. The production smoke originally found stale `Phase 6 Controller` copy; the source was updated after the smoke test.
- Socket.IO state remains in memory; Zeabur must continue running a single replica.
