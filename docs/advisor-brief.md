# Brief Note for Supervisor

The installation can now be controlled from Unity without automating the browser UI.

The recommended integration path is a small HTTP API hosted on the same production server:

- `GET https://artinstallation.certaindragon3.work/api/controller/receivers`
- `POST https://artinstallation.certaindragon3.work/api/controller/command`
- `POST https://artinstallation.certaindragon3.work/api/controller/clear-offline`

This API drives the same backend state and routing logic as the web controller, so Unity and the browser controller stay consistent.

Typical Unity workflow:

1. Request the receiver list and read each `receiverId`
2. Choose one receiver or use `"*"` for broadcast
3. Send commands such as:
   - `audio_control`
   - `audio_playable`
   - `color_change`
   - `text_message`

A full integration guide is available in [`docs/unity-controller-api.md`](./unity-controller-api.md), and a minimal Unity C# example is available in [`docs/examples/UnityArtInstallationController.cs`](./examples/UnityArtInstallationController.cs).
