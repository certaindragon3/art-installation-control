#!/usr/bin/env node
import { execFile } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const SUPPORTED_EXTENSIONS = new Set([
  ".aac",
  ".aif",
  ".aiff",
  ".flac",
  ".m4a",
  ".mp3",
  ".ogg",
  ".wav",
  ".webm",
]);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const audioDir = path.resolve(
  repoRoot,
  process.argv[2] ?? "client/public/audio"
);
const outFile = path.resolve(
  repoRoot,
  process.argv[3] ?? "shared/trackManifest.generated.ts"
);
const overridesFile = path.resolve(
  repoRoot,
  process.argv[4] ?? "shared/trackManifest.overrides.json"
);
const publicAudioRoot = path.resolve(repoRoot, "client/public");
const execFileAsync = promisify(execFile);
const CATEGORY_COLORS = [
  "#ef4444",
  "#f59e0b",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
  "#f97316",
  "#84cc16",
];

function toPosixPath(value) {
  return value.split(path.sep).join("/");
}

function encodeUrlPath(value) {
  return toPosixPath(value)
    .split("/")
    .map(segment => encodeURIComponent(segment))
    .join("/");
}

function stableCategoryColor(categoryId) {
  let hash = 0;
  for (const char of categoryId) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }

  return CATEGORY_COLORS[hash % CATEGORY_COLORS.length];
}

function resolveCategoryId(relativeAudioPath, override) {
  if (typeof override.categoryId === "string" && override.categoryId.trim()) {
    return override.categoryId.trim();
  }

  const segments = relativeAudioPath.split("/");
  return segments.length > 1 ? segments[0] : "root";
}

async function readDurationSeconds(filePath, override) {
  if (
    typeof override.durationSeconds === "number" &&
    Number.isFinite(override.durationSeconds) &&
    override.durationSeconds > 0
  ) {
    return override.durationSeconds;
  }

  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath,
    ]);
    const duration = Number.parseFloat(stdout.trim());
    return Number.isFinite(duration) && duration > 0 ? duration : 0;
  } catch {
    return 0;
  }
}

async function collectAudioFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectAudioFiles(fullPath)));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      files.push(fullPath);
    }
  }

  return files;
}

async function readOverrides() {
  try {
    const raw = await readFile(overridesFile, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      if (error.code === "ENOENT") {
        return {};
      }
    }

    throw error;
  }
}

function getOverride(overrides, relativeAudioPath, baseName) {
  const relativeOverride = overrides[relativeAudioPath];
  if (relativeOverride && typeof relativeOverride === "object") {
    return relativeOverride;
  }

  const baseNameOverride = overrides[baseName];
  if (baseNameOverride && typeof baseNameOverride === "object") {
    return baseNameOverride;
  }

  return {};
}

function buildTrackId(filePath, override, seenTrackIds) {
  const baseName = path.basename(filePath);
  const requestedTrackId =
    typeof override.trackId === "string" && override.trackId.trim()
      ? override.trackId.trim()
      : baseName;
  let trackId = requestedTrackId;
  let suffix = 2;

  while (seenTrackIds.has(trackId)) {
    trackId = `${requestedTrackId}__${suffix}`;
    suffix += 1;
  }

  seenTrackIds.add(trackId);
  return trackId;
}

async function buildTrackDefinition(filePath, overrides, seenTrackIds) {
  const relativeToAudioDir = toPosixPath(path.relative(audioDir, filePath));
  const relativeToPublic = path.relative(publicAudioRoot, filePath);
  const baseName = path.basename(filePath);
  const override = getOverride(overrides, relativeToAudioDir, baseName);
  const defaultLabel = baseName.slice(
    0,
    baseName.length - path.extname(baseName).length
  );

  const trackId = buildTrackId(filePath, override, seenTrackIds);
  const categoryId = resolveCategoryId(relativeToAudioDir, override);
  const durationSeconds = await readDurationSeconds(filePath, override);

  return {
    trackId,
    label:
      typeof override.label === "string" && override.label.trim()
        ? override.label.trim()
        : defaultLabel,
    url: `/${encodeUrlPath(relativeToPublic)}`,
    durationSeconds: Number(durationSeconds.toFixed(3)),
    categoryId,
    categoryColor:
      typeof override.categoryColor === "string" &&
      override.categoryColor.trim()
        ? override.categoryColor.trim()
        : stableCategoryColor(categoryId),
  };
}

const files = (await collectAudioFiles(audioDir)).sort((left, right) =>
  left.localeCompare(right)
);
const seenTrackIds = new Set();
const overrides = await readOverrides();
const tracks = await Promise.all(
  files.map(file => buildTrackDefinition(file, overrides, seenTrackIds))
);

const missingDurations = tracks.filter(track => track.durationSeconds <= 0);

const content = `// Generated by scripts/generate-audio-manifest.mjs.
// Do not edit by hand; keep audio filenames unchanged and rerun the script.

export const GENERATED_TRACK_LIBRARY = ${JSON.stringify(tracks, null, 2)} as const;
`;

await writeFile(outFile, content, "utf8");

console.log(
  `Generated ${tracks.length} tracks -> ${path.relative(repoRoot, outFile)}`
);
if (missingDurations.length > 0) {
  console.warn(
    `Warning: ${missingDurations.length} track(s) have no readable duration: ${missingDurations
      .map(track => track.trackId)
      .join(", ")}`
  );
}
