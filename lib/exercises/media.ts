/**
 * Exercise demonstration media.
 *
 * Media files are static assets served from a CDN (by default the app's own /media path, which
 * Next.js and Vercel serve from their edge). Set NEXT_PUBLIC_MEDIA_BASE_URL to point at an object
 * store or CDN instead (e.g. "https://media.example.com/forge"); the folder layout stays the same.
 *
 * Layout per exercise id:
 *   exercises/<id>/demo.webm, demo.mp4, poster.webp   real video loop (when available)
 *   exercises/<id>/f0.webp, f1.webp                   start and end position photos
 *   exercises/<id>/anim.webm, anim.mp4, anim.webp     illustrated loop (ExerciseDB), only for
 *                                                     exercises with neither of the above
 *
 * The manifest (media.generated.ts, written by scripts/media/build-media.mjs) only records what
 * exists plus dimensions, so the client never requests a file that is not there and stays small.
 */
import { MEDIA_CREDITS, MEDIA_MANIFEST } from "./media.generated"

export type MediaLicense = "CC-BY-SA-4.0" | "Unlicense" | "MIT"

export type MediaSource = "wger" | "free-exercise-db" | "exercisedb"

export interface MediaCredit {
  /** Who made the original. */
  author: string
  source: MediaSource
  license: MediaLicense
  /** Page of the original work. */
  sourceUrl: string
}

/**
 * Compact manifest row. v = [width, height, durationSeconds, creditIndex]; f = [width, height];
 * a = [width, height, durationSeconds] (illustrated animation).
 */
export interface MediaManifestEntry {
  v?: [number, number, number, number]
  f?: [number, number]
  a?: [number, number, number]
}

export interface ExerciseVideo {
  webm: string
  mp4: string
  poster: string
  width: number
  height: number
  durationSeconds: number
  credit: MediaCredit
  /** "cover" fills the frame (filmed video); "contain" keeps a drawn figure whole on its own background. */
  fit: "cover" | "contain"
}

export interface ExerciseFrames {
  start: string
  end: string
  width: number
  height: number
  credit: MediaCredit
}

export interface ExerciseMedia {
  video: ExerciseVideo | null
  frames: ExerciseFrames | null
  /** Illustrated loop, used only when there is no video or photo pair. */
  animation: ExerciseVideo | null
}

const FRAMES_CREDIT: MediaCredit = {
  author: "free-exercise-db contributors",
  source: "free-exercise-db",
  license: "Unlicense",
  sourceUrl: "https://github.com/yuhonas/free-exercise-db",
}

const ANIMATION_CREDIT: MediaCredit = {
  author: "AscendAPI",
  source: "exercisedb",
  license: "MIT",
  sourceUrl: "https://www.kaggle.com/datasets/exercisedb/fitness-exercises-dataset",
}

export const SOURCE_LABELS: Record<MediaSource, string> = {
  wger: "wger",
  "free-exercise-db": "free-exercise-db",
  exercisedb: "ExerciseDB",
}

export const LICENSE_LABELS: Record<MediaLicense, string> = {
  "CC-BY-SA-4.0": "CC BY-SA 4.0",
  Unlicense: "Public domain",
  MIT: "MIT",
}

export const LICENSE_URLS: Record<MediaLicense, string> = {
  "CC-BY-SA-4.0": "https://creativecommons.org/licenses/by-sa/4.0/",
  Unlicense: "https://unlicense.org/",
  MIT: "https://opensource.org/license/mit",
}

function baseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_MEDIA_BASE_URL
  return (raw && raw.trim() ? raw.trim() : "/media").replace(/\/+$/, "")
}

export function mediaUrl(path: string): string {
  return `${baseUrl()}/${path.replace(/^\/+/, "")}`
}

const cache = new Map<string, ExerciseMedia | null>()

/** Resolved media for an exercise, or null when there is none (the UI then draws the body map). */
export function mediaFor(exerciseId: string): ExerciseMedia | null {
  const hit = cache.get(exerciseId)
  if (hit !== undefined) return hit
  const row = (MEDIA_MANIFEST as Record<string, MediaManifestEntry | undefined>)[exerciseId]
  let result: ExerciseMedia | null = null
  if (row && (row.v || row.f || row.a)) {
    const dir = `exercises/${exerciseId}`
    const credit = row.v ? MEDIA_CREDITS[row.v[3]] : undefined
    result = {
      video:
        row.v && credit
          ? {
              webm: mediaUrl(`${dir}/demo.webm`),
              mp4: mediaUrl(`${dir}/demo.mp4`),
              poster: mediaUrl(`${dir}/poster.webp`),
              width: row.v[0],
              height: row.v[1],
              durationSeconds: row.v[2],
              credit: { ...credit, source: "wger", license: "CC-BY-SA-4.0" },
              fit: "cover",
            }
          : null,
      frames: row.f
        ? {
            start: mediaUrl(`${dir}/f0.webp`),
            end: mediaUrl(`${dir}/f1.webp`),
            width: row.f[0],
            height: row.f[1],
            credit: FRAMES_CREDIT,
          }
        : null,
      animation: row.a
        ? {
            webm: mediaUrl(`${dir}/anim.webm`),
            mp4: mediaUrl(`${dir}/anim.mp4`),
            poster: mediaUrl(`${dir}/anim.webp`),
            width: row.a[0],
            height: row.a[1],
            durationSeconds: row.a[2],
            credit: ANIMATION_CREDIT,
            fit: "contain",
          }
        : null,
    }
  }
  cache.set(exerciseId, result)
  return result
}

export function hasMedia(exerciseId: string): boolean {
  return mediaFor(exerciseId) !== null
}
