# Phase 10 Local Validation

Date: 2026-04-20

## Automated Checks

- `corepack pnpm check` passed.
- `corepack pnpm test` passed.
- `corepack pnpm build` passed.
- Targeted server regression before full test:
  - `corepack pnpm vitest run server/wsServer.test.ts server/controllerApi.test.ts`

## Browser Checks

Local production server:

```bash
NODE_ENV=production PORT=3000 node dist/index.js
```

Checked with `agent-browser`:

- `http://127.0.0.1:3000/`
  - Home page exposes receiver entry only.
  - No visible `/controller` link or controller card.
- `http://127.0.0.1:3000/receiver/phase10local`
  - Receiver registers successfully.
  - Sound economy HUD shows pool, inflation, and current state.
  - Track cards render as compact mobile list.
  - First Play button emits economy playback and changes to Stop.
  - Other Play buttons become disabled while one track is playing.
- `http://127.0.0.1:3000/controller`
  - Direct controller route still loads.
- `http://127.0.0.1:3000/receiver/phase10vote`
  - A four-option vote opens on mobile viewport.
  - Vote buttons fit in the viewport and lock receiver track interaction.

## Zeabur Status

This change touches Socket.IO, production routing, and Home/Controller route
behavior, so Zeabur single-replica validation is recommended before final
deployment. I checked the local workspace for a Zeabur CLI or deployment command
and found only `Dockerfile`, `zbpack.json`, and documentation; no callable
Zeabur deploy tool is currently installed in this environment.
