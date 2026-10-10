#!/usr/bin/env node
/**
 * Builds exercise demonstration media from scripts/media/mapping.json.
 *
 *   pnpm media:build            build anything missing
 *   pnpm media:build --force    rebuild everything
 *
 * Sources:
 *   - wger.de exercise videos, CC BY-SA 4.0. Each clip is trimmed to a short loop, scaled to
 *     640 px wide, re-encoded (VP9 WebM + H.264 MP4, no audio) and credited on screen. The
 *     derivatives are shared under the same licence (see public/media/CREDITS.md).
 *   - free-exercise-db start/end position photos, Unlicense (public domain). Converted to WebP.
 *   - ExerciseDB open-source 180p GIF animations (Kaggle "fitness-exercises-dataset", listed as
 *     MIT by AscendAPI), only for exercises with neither of the above. Scaled 2x and re-encoded
 *     as a muted video loop, which is a fraction of the GIF's size. See CREDITS.md for the
 *     licence caveat.
 *
 * Videos are read straight from the source URL: ffmpeg range-requests only the part it needs, so
 * nothing large is downloaded. Requires ffmpeg (libx264, libvpx-vp9) and cwebp on PATH.
 *
 * Outputs: public/media/exercises/<id>/…, public/media/CREDITS.md, lib/exercises/media.generated.ts
 */
import { execFile } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

const run = promisify(execFile)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const MAPPING = path.join(ROOT, "scripts/media/mapping.json")
const OUT_DIR = path.join(ROOT, "public/media/exercises")
const MANIFEST = path.join(ROOT, "lib/exercises/media.generated.ts")
const CREDITS = path.join(ROOT, "public/media/CREDITS.md")
const FEDB_BASE = "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises"
const FORCE = process.argv.includes("--force")
const CONCURRENCY = 4

/** Loop length and where to start, as a share of the clip: skip the set-up, keep 2–3 reps. */
const LOOP_SECONDS = 8
const START_SHARE = 0.1
const WIDTH = 640
/** ExerciseDB GIFs are 180 px square: double them with Lanczos so browsers upscale less. */
const ANIM_WIDTH = 360

const mapping = JSON.parse(fs.readFileSync(MAPPING, "utf8"))
const entries = Object.entries(mapping.exercises)

function exists(p) {
  return fs.existsSync(p) && fs.statSync(p).size > 0
}

async function probeSize(file) {
  const { stdout } = await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", file])
  const [w, h] = stdout.trim().split("x").map(Number)
  return [w, h]
}

async function probeDuration(file) {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file])
  return Math.round(Number(stdout.trim()) * 10) / 10
}

async function download(url, dest) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()))
}

async function buildFrames(id, fedbId) {
  const dir = path.join(OUT_DIR, id)
  fs.mkdirSync(dir, { recursive: true })
  for (const n of [0, 1]) {
    const out = path.join(dir, `f${n}.webp`)
    if (!FORCE && exists(out)) continue
    const tmp = path.join(dir, `.f${n}.jpg`)
    await download(`${FEDB_BASE}/${encodeURIComponent(fedbId)}/${n}.jpg`, tmp)
    await run("cwebp", ["-quiet", "-q", "72", "-resize", String(WIDTH), "0", "-metadata", "none", tmp, "-o", out])
    fs.rmSync(tmp, { force: true })
  }
  return probeSize(path.join(dir, "f0.webp"))
}

async function buildVideo(id, video) {
  const dir = path.join(OUT_DIR, id)
  fs.mkdirSync(dir, { recursive: true })
  const mp4 = path.join(dir, "demo.mp4")
  const webm = path.join(dir, "demo.webm")
  const poster = path.join(dir, "poster.webp")
  const total = Number(video.durationS) || LOOP_SECONDS
  const start = video.start ?? Math.min(total * START_SHARE, Math.max(0, total - LOOP_SECONDS))
  const length = video.length ?? Math.min(LOOP_SECONDS, Math.max(2, total - start - 0.2))
  const vf = `scale=${WIDTH}:-2:flags=lanczos,fps=30`
  const input = ["-v", "error", "-y", "-ss", start.toFixed(2), "-i", video.url, "-t", length.toFixed(2), "-an", "-map_metadata", "-1"]
  if (FORCE || !exists(mp4)) {
    await run("ffmpeg", [...input, "-vf", `${vf},format=yuv420p`, "-c:v", "libx264", "-profile:v", "high", "-preset", "slow", "-crf", "28", "-movflags", "+faststart", mp4], { timeout: 600000 })
  }
  if (FORCE || !exists(webm)) {
    // Encode the WebM from the finished MP4 so both formats show exactly the same frames.
    await run("ffmpeg", ["-v", "error", "-y", "-i", mp4, "-an", "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "44", "-row-mt", "1", "-deadline", "good", "-cpu-used", "2", webm], { timeout: 600000 })
  }
  if (FORCE || !exists(poster)) {
    const jpg = path.join(dir, ".poster.jpg")
    await run("ffmpeg", ["-v", "error", "-y", "-ss", "0.3", "-i", mp4, "-frames:v", "1", "-q:v", "2", jpg])
    await run("cwebp", ["-quiet", "-q", "70", "-metadata", "none", jpg, "-o", poster])
    fs.rmSync(jpg, { force: true })
  }
  const [w, h] = await probeSize(mp4)
  return [w, h, await probeDuration(mp4)]
}

async function buildAnimation(id, anim) {
  const dir = path.join(OUT_DIR, id)
  fs.mkdirSync(dir, { recursive: true })
  const mp4 = path.join(dir, "anim.mp4")
  const webm = path.join(dir, "anim.webm")
  const poster = path.join(dir, "anim.webp")
  if (FORCE || !exists(mp4)) {
    const gif = path.join(dir, ".anim.gif")
    await download(anim.gifUrl, gif)
    // fps=20 resamples the GIF's per-frame delays to a constant rate that every player loops cleanly.
    await run("ffmpeg", ["-v", "error", "-y", "-i", gif, "-vf", `scale=${ANIM_WIDTH}:-2:flags=lanczos,fps=20,format=yuv420p`, "-an", "-map_metadata", "-1", "-c:v", "libx264", "-profile:v", "high", "-preset", "slow", "-crf", "26", "-movflags", "+faststart", mp4])
    fs.rmSync(gif, { force: true })
  }
  if (FORCE || !exists(webm)) {
    await run("ffmpeg", ["-v", "error", "-y", "-i", mp4, "-an", "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "40", "-row-mt", "1", "-deadline", "good", "-cpu-used", "2", webm])
  }
  if (FORCE || !exists(poster)) {
    const png = path.join(dir, ".anim.png")
    await run("ffmpeg", ["-v", "error", "-y", "-i", mp4, "-frames:v", "1", png])
    await run("cwebp", ["-quiet", "-q", "80", "-metadata", "none", png, "-o", poster])
    fs.rmSync(png, { force: true })
  }
  const [w, h] = await probeSize(mp4)
  return [w, h, await probeDuration(mp4)]
}

const results = {}
const failures = []
let cursor = 0
async function worker() {
  while (cursor < entries.length) {
    const [id, spec] = entries[cursor++]
    const row = {}
    try {
      if (spec.frames?.fedbId) row.f = await buildFrames(id, spec.frames.fedbId)
      if (spec.video?.url) row.v = await buildVideo(id, spec.video)
      // An animation is only a stand-in: real footage or photos always win.
      if (spec.animation?.gifUrl && !row.v && !row.f) row.a = await buildAnimation(id, spec.animation)
      results[id] = { row, spec }
      process.stdout.write(spec.video ? "V" : row.a ? "a" : ".")
    } catch (err) {
      failures.push(`${id}: ${String(err.message).split("\n")[0]}`)
      process.stdout.write("x")
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker))
process.stdout.write("\n")

// Remove output folders for exercises no longer in the mapping.
if (fs.existsSync(OUT_DIR)) {
  for (const dir of fs.readdirSync(OUT_DIR)) {
    if (!mapping.exercises[dir]) fs.rmSync(path.join(OUT_DIR, dir), { recursive: true, force: true })
  }
}

// Credits: one row per distinct wger author + exercise page.
const credits = []
const creditIndex = new Map()
const manifest = {}
for (const [id, { row, spec }] of Object.entries(results).sort(([a], [b]) => a.localeCompare(b))) {
  const out = {}
  if (row.f) out.f = row.f
  if (row.v && spec.video) {
    const key = `${spec.video.author}|${spec.video.wgerExerciseId}`
    if (!creditIndex.has(key)) {
      creditIndex.set(key, credits.length)
      credits.push({ author: spec.video.author || "wger contributor", sourceUrl: `https://wger.de/en/exercise/${spec.video.wgerExerciseId}/view/` })
    }
    out.v = [...row.v, creditIndex.get(key)]
  }
  if (row.a) out.a = row.a
  if (out.f || out.v || out.a) manifest[id] = out
}

const ts = `// AUTO-GENERATED by scripts/media/build-media.mjs. Do not edit by hand; run \`pnpm media:build\`.
import type { MediaManifestEntry } from "./media"

/** wger video authors. Videos are CC BY-SA 4.0; each row is credited on screen. */
export const MEDIA_CREDITS: { author: string; sourceUrl: string }[] = ${JSON.stringify(credits, null, 2)}

export const MEDIA_MANIFEST: Record<string, MediaManifestEntry> = ${JSON.stringify(manifest)}
`
fs.writeFileSync(MANIFEST, ts)

const videoRows = Object.entries(results).filter(([, r]) => r.row.v)
const animRows = Object.entries(results).filter(([, r]) => r.row.a)
const md = `# Exercise media credits

## Videos: CC BY-SA 4.0

Exercise demonstration videos come from the [wger](https://wger.de) exercise database and are
licensed under [Creative Commons Attribution-ShareAlike 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
FORGE trims each clip to a short loop, scales it, removes the audio and re-encodes it. These
modified versions are shared under the same licence.

| Exercise | Author | Original |
| --- | --- | --- |
${videoRows
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([id, r]) => `| ${id} | ${r.spec.video.author || "wger contributor"} | https://wger.de/en/exercise/${r.spec.video.wgerExerciseId}/view/ |`)
  .join("\n")}

## Photos: public domain

Start and end position photos come from [free-exercise-db](https://github.com/yuhonas/free-exercise-db),
released under the [Unlicense](https://unlicense.org/). FORGE resizes them and converts them to WebP.

## Animations: ExerciseDB (AscendAPI)

Exercises with neither a video nor a photo pair use the open-source 180p GIF animations from
ExerciseDB by AscendAPI, as published in the Kaggle dataset
[fitness-exercises-dataset](https://www.kaggle.com/datasets/exercisedb/fitness-exercises-dataset),
which lists the MIT licence (see \`exercisedb-LICENSE.txt\`). FORGE scales each GIF to 360 px and
re-encodes it as a muted video loop.

Licence caveat: the ExerciseDB API code repository (github.com/ExerciseDB/exercisedb-api) is
AGPL-3.0, and AscendAPI sells "commercial rights" with its paid plans. Confirm the terms for the
open-source animations with AscendAPI before a commercial launch. Removing every \`animation\`
entry from scripts/media/mapping.json and running \`pnpm media:build\` takes them out.

| Exercise | ExerciseDB id | ExerciseDB name |
| --- | --- | --- |
${animRows
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([id, r]) => `| ${id} | ${r.spec.animation.edbId} | ${r.spec.animation.name} |`)
  .join("\n")}
`
fs.writeFileSync(CREDITS, md)

let bytes = 0
for (const dir of fs.existsSync(OUT_DIR) ? fs.readdirSync(OUT_DIR) : []) {
  for (const f of fs.readdirSync(path.join(OUT_DIR, dir))) bytes += fs.statSync(path.join(OUT_DIR, dir, f)).size
}
console.log(`media: ${Object.keys(manifest).length} exercises, ${videoRows.length} videos, ${Object.values(manifest).filter((m) => m.f).length} photo pairs, ${animRows.length} animations, ${(bytes / 1e6).toFixed(1)} MB`)
if (failures.length) {
  console.error(`failed (${failures.length}):\n  ${failures.join("\n  ")}`)
  process.exitCode = 1
}
