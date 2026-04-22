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

The script scans supported audio extensions, reads duration with `ffprobe`, and
writes:

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
- Each generated track includes `durationSeconds`, `categoryId`, and `categoryColor`.
- `categoryId` defaults to the first folder under `client/public/audio`; root files use `root`.
- `shared/trackManifest.overrides.json` can preserve explicit IDs or override `label`, `durationSeconds`, `categoryId`, and `categoryColor`.
- The current overrides keep the two legacy demo tracks available as `track_01` and `track_02`.
- For the professor's final audio package, new files will use exact filenames as control strings unless an override is added.

## Current Professor Drop

The first professor audio drop has been copied into:

```bash
client/public/audio/CitySounds
client/public/audio/NatureSounds
```

This drop contains 79 files: 40 city sounds and 39 nature sounds. Together with
the two legacy demo files, the generated library currently has 81 tracks.

An additional `Spectrum` folder has also been copied into:

```bash
client/public/audio/Spectrum
```

This folder contains 40 files. The generated library currently has 121 tracks
total.

One filename appears in both folders:

```text
CitySounds/LightRain.mp3
NatureSounds/LightRain.mp3
```

Because control strings must be unique, the generated IDs are:

```text
LightRain.mp3
LightRain.mp3__2
```
