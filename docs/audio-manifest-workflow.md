# Audio Manifest Workflow

This workflow is for the final audio drop of roughly 120 files.

## Rule

Keep every uploaded audio filename unchanged.

- `trackId`: exact filename, including extension
- `label`: filename without extension
- `url`: static asset URL under `/audio/`

Example:

```text
metal_hit_03.wav
```

Generates:

```json
{
  "trackId": "metal_hit_03.wav",
  "label": "metal_hit_03",
  "url": "/audio/metal_hit_03.wav"
}
```

Unity or the controller can then use the filename as the control string:

```json
{
  "command": "set_visible_tracks",
  "targetId": "*",
  "payload": {
    "trackIds": ["metal_hit_03.wav", "bell_short_01.wav"]
  }
}
```

Any track not listed is hidden and stopped.

## Generate

Place audio files in:

```bash
client/public/audio
```

Then run:

```bash
corepack pnpm audio:manifest
```

The script scans supported audio extensions and writes:

```bash
shared/trackManifest.generated.ts
```

The app reads this generated file as the default track library.

Supported extensions:

```text
.aac .aif .aiff .flac .m4a .mp3 .ogg .wav .webm
```

## Notes

- Nested folders are supported.
- URL path segments are encoded, so spaces in filenames remain valid on disk.
- Duplicate filenames in different nested folders receive a `__2`, `__3`, etc. suffix in `trackId`.
- `shared/trackManifest.overrides.json` can preserve explicit IDs for special cases.
- The current overrides keep the two legacy demo tracks available as `track_01` and `track_02`.
- For the professor's final audio package, new files will use exact filenames as control strings unless an override is added.
