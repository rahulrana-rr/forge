# FORGE

Premium, mobile-first gym workout web app. Open it and today's workout is already programmed;
follow it one exercise at a time on a swipeable card. Everything about the workout runs on the
client; the backend only persists per-user history, progress and the profile for signed-in users.

Read [`ARCHITECTURE.md`](./ARCHITECTURE.md) before touching code: it is the contract for the stack,
directory ownership, data rules and the design system.

## Stack

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript strict · Tailwind CSS v4 · shadcn/ui (Base UI) ·
zustand + IndexedDB on the client · Prisma 7 + PostgreSQL · better-auth 1.7 · pnpm.

## Prerequisites

- Node.js 20 or newer
- [pnpm](https://pnpm.io) 9 or newer (`corepack enable` is the easiest way to get it)
- PostgreSQL 15 or newer, either installed locally or via Docker (see below)
- Optional: a Google OAuth client and a [Resend](https://resend.com) API key for the social and
  magic-link sign-in methods. Email + password works with no extra setup.

Use `pnpm` only. Never `npm` or `yarn`.

## Quick start

```bash
pnpm install                 # also runs `prisma generate` (needs no database)
cp .env.example .env         # then edit DATABASE_URL and BETTER_AUTH_SECRET
pnpm db:migrate              # applies prisma/migrations to the database in DATABASE_URL
pnpm dev                     # http://localhost:3000
```

## Environment variables

Copy `.env.example` to `.env`. `.env*` files are git-ignored, except the `.env.example` template.

| Variable                   | Required | Purpose                                                                                                   |
| -------------------------- | -------- | --------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`             | yes      | Postgres connection string, e.g. `postgresql://gymapp:gymapp@localhost:5432/gymapp`                       |
| `BETTER_AUTH_SECRET`       | yes      | Signing secret for sessions. Generate with `openssl rand -base64 32`. The template leaves it empty, which better-auth refuses; in production `lib/auth.ts` also refuses anything shorter than 32 characters or a placeholder. |
| `BETTER_AUTH_URL`          | yes      | Public origin of the app, e.g. `http://localhost:3000`. Used to build OAuth callback and magic-link URLs.   |
| `NEXT_PUBLIC_APP_URL`      | yes      | Same origin, exposed to the browser for the auth client and added to better-auth's trusted origins.        |
| `GOOGLE_CLIENT_ID`         | no       | Google OAuth client id. Google sign-in is only registered when both Google values are set.                  |
| `GOOGLE_CLIENT_SECRET`     | no       | Google OAuth client secret.                                                                                |
| `ANTHROPIC_API_KEY`        | no       | Enables the coach review. Without it workouts show as "Not reviewed by the coach".                      |
| `COACH_MODEL`              | no       | Override the coach model (default `claude-opus-5-5`).                                                   |
| `NEXT_PUBLIC_MEDIA_BASE_URL` | no     | CDN or object-store URL mirroring `public/media`. Defaults to the app's own `/media`.                    |
| `NEXT_PUBLIC_AUTH_GOOGLE`  | no       | `"1"` to show the Google button in the UI. Keep in sync with the two values above.                         |
| `RESEND_API_KEY`           | prod     | Resend API key for auth emails: sign-up verification, password reset and magic links. Required in production (sign-up fails without it). Development logs the links to the server console. |
| `EMAIL_FROM`               | no       | Sender for auth emails, e.g. `FORGE <noreply@yourdomain.com>` (must be a verified Resend domain).          |

## Database

### Option A: local PostgreSQL

```bash
createdb gymapp
# DATABASE_URL="postgresql://<your-os-user>@localhost:5432/gymapp"
```

### Option B: Docker

`docker-compose.yml` starts Postgres 17 with user/password/database all set to `gymapp`:

```bash
docker compose up -d db
# DATABASE_URL="postgresql://gymapp:gymapp@localhost:5432/gymapp"
```

### Migrations

Prisma 7 reads `DATABASE_URL` through `prisma.config.ts` (which loads `.env`). The generated client
lives in `lib/generated/prisma` (git-ignored, rebuilt by `pnpm install` / `pnpm db:generate`).

| Command                                          | What it does                                                                |
| ------------------------------------------------ | --------------------------------------------------------------------------- |
| `pnpm db:migrate`                                | Dev: create a migration from schema changes (if any) and apply all pending. |
| `pnpm exec prisma migrate dev --name <name>`     | Same, with an explicit migration name.                                      |
| `pnpm db:deploy`                                 | Production / CI: apply committed migrations only.                           |
| `pnpm db:generate`                               | Regenerate the Prisma client after editing `prisma/schema.prisma`.          |
| `pnpm db:studio`                                 | Browse the database.                                                        |

The schema (`prisma/schema.prisma`) holds the better-auth tables (`user`, `session`, `account`,
`verification`) and the app tables (`user_profile`, `workout`, `exercise_performance`,
`user_progress`). To check that the auth tables still match what better-auth expects after a
better-auth upgrade:

```bash
pnpm dlx @better-auth/cli@latest generate --config lib/auth.ts --output /tmp/forge-auth-schema.prisma -y
diff /tmp/forge-auth-schema.prisma prisma/schema.prisma
```

Keep the `@@map` table names; add missing fields additively and ship them as a new migration.

## Development

| Command           | What it does                                           |
| ----------------- | ------------------------------------------------------ |
| `pnpm dev`        | Next.js dev server with Turbopack on port 3000.        |
| `pnpm typecheck`  | `tsc --noEmit`.                                        |
| `pnpm lint`       | ESLint (next/core-web-vitals + typescript).            |
| `pnpm test`       | Vitest for pure TypeScript (`lib/**/*.test.ts`).       |
| `pnpm format`     | Prettier.                                              |

Next.js 16 allows one `next dev` per checkout: a second start exits and prints the port of the
running server (`.next/dev/logs/next-development.log` has its PID). Reuse it or stop it first.

## Build and run

```bash
pnpm build   # prisma generate && next build
pnpm start   # serves the production build (needs the same env vars)
```

Run `pnpm db:deploy` against the production database before the first start and after every
deploy that adds a migration.

## Authentication

Auth is handled by better-auth (`lib/auth.ts` on the server, `lib/auth-client.ts` in the browser,
`app/api/auth/[...all]/route.ts` as the handler). Sessions last 30 days, are refreshed daily and
cached in a signed cookie for 5 minutes to keep `/api/*` calls cheap.

### Email + password

Enabled by default, minimum password length 8. A new account must confirm its email before a
password sign-in works: sign-up sends a confirmation link (valid 1 hour) and the form shows
"Check your inbox"; opening the link signs the user in. Signing in before confirming re-sends the
link. "Forgot password?" on the sign-in tab emails a reset link to `/reset-password` (valid
1 hour); setting a new password signs the account out everywhere. All of these emails go through
the same sender as magic links (see below), so production needs `RESEND_API_KEY`.

### Google OAuth

1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials) create an
   **OAuth client ID** of type *Web application*.
2. Add `http://localhost:3000` (and your production origin) to *Authorized JavaScript origins*.
3. Add `<BETTER_AUTH_URL>/api/auth/callback/google` to *Authorized redirect URIs*, e.g.
   `http://localhost:3000/api/auth/callback/google`.
4. Put the client id and secret in `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, and set
   `NEXT_PUBLIC_AUTH_GOOGLE="1"` so the UI shows the button.

The Google provider is only registered when both values are present, so leaving them empty simply
hides the option.

### Magic link (and the other auth emails)

Magic links, sign-up confirmations and password resets are sent through the [Resend](https://resend.com) HTTP API (no SDK dependency).

1. Create an API key in Resend and put it in `RESEND_API_KEY`.
2. Verify your sending domain and set `EMAIL_FROM`, e.g. `FORGE <noreply@yourdomain.com>`.
   Without a verified domain Resend only delivers to your own account email.
3. Links expire after 5 minutes and can be used once.

**Without `RESEND_API_KEY`**: in development each link is printed to the terminal running
`pnpm dev` (`[auth] Magic link for <email>: <url>`, `[auth] Email verification link for …`,
`[auth] Password reset link for …`); open it in the browser. In production, sign-up, password
reset and magic links fail with a clear server error without the key.

### Guest mode

Signing in is optional. The app is fully usable as a guest: the profile, today's workout and the
history live on the device (localStorage + IndexedDB). Signing in only adds background sync of the
profile and completed workouts to the server, and lets a second device pull them.

Local data belongs to one account at a time. The first sync with an account adopts the guest data
on the device; if a different account signs in while another account's workouts are still on the
device, sync pauses until the user picks "Use this device's data for this account" or resets local
data. Sign out offers to remove the account's data from a shared device.

### Offline

Production builds register `public/sw.js`, a small service worker: navigations are network-first
with the cached page as a fallback, `/_next/static` is cache-first, and the main routes plus their
static assets are precached on install, so the app opens offline after the first visit. Uncached
pages fall back to `public/offline.html`. The worker never touches `/api` or RSC requests, and it
is unregistered in development. The web manifest starts at `/today`.

## Exercise media

Every exercise card shows a demonstration when one exists, otherwise the muscle map.

- **Videos**: 32 exercises have a real video loop from the [wger](https://wger.de) exercise database,
  licensed [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Each clip is trimmed to
  an 8-second loop, scaled to 640 px, stripped of audio and re-encoded to WebM (VP9) and MP4 (H.264)
  with a WebP poster. The author is credited on the card and the details page; the modified clips
  are shared under the same licence. Every clip was checked by eye against the exercise it is
  assigned to.
- **Photos**: 287 exercises have start and finish photos from
  [free-exercise-db](https://github.com/yuhonas/free-exercise-db) (public domain), shown as a
  looping crossfade on the card and side by side in the details view. Every pair was checked by eye.
- **Animations**: 43 exercises with neither a video nor photos use an illustrated loop from the
  [ExerciseDB open-source dataset](https://www.kaggle.com/datasets/exercisedb/fitness-exercises-dataset)
  (180p GIFs by AscendAPI, listed as MIT), scaled to 360 px and re-encoded as a muted WebM/MP4 loop
  on a white background. Each match was checked frame by frame against the exercise; matches that
  showed a different implement, position or movement were left out, as were the two low-impact
  marches (the closest animation is a high-knee jog). Licence caveat: the ExerciseDB API repository
  is AGPL-3.0 and AscendAPI sells commercial rights with its paid plans, so confirm the terms with
  AscendAPI before a commercial launch (details in `public/media/CREDITS.md`).
- **Coverage**: 333 of 460 exercises have media; the rest show the muscle map.
- **Playback**: only the top card plays; the card underneath preloads. Video does not autoplay with
  reduced motion, Data Saver or a 2G connection (a play button is shown instead), and pauses when the
  app is in the background. A failed load falls back to the muscle map.

Files live in `public/media/exercises/<id>/` (about 35 MB) with credits in
`public/media/CREDITS.md`. To serve them from object storage or a CDN, mirror `public/media` and set
`NEXT_PUBLIC_MEDIA_BASE_URL`. To rebuild after editing `scripts/media/mapping.json` (needs `ffmpeg`
with libx264 and libvpx-vp9, and `cwebp`):

```bash
pnpm media:build            # build anything missing
pnpm media:build --force    # rebuild everything
```

Priority is video, then photos, then animation. To drop the ExerciseDB animations, remove the
`animation` entries from the mapping and rebuild. A licensed library with full video coverage can
replace or extend all of this: add the files under the same layout and list them in the mapping.

## Coach review

Before a workout starts, it is reviewed by a senior-coach reviewer running on Claude
(`claude-opus-5-5` by default, override with `COACH_MODEL`). The review checks exercise choice,
sets, reps, rest, intensity, weekly volume, recovery and safety against the user's goal, experience
and limitations, and returns a structured verdict (approved, approved with changes, or rejected)
with issues, per-exercise notes and a corrected plan.

- **Corrections are constrained.** The coach may only swap to exercises the engine has already
  vetted for the user's equipment, level, limitations and exclusions; the server re-checks every
  change and clamps implausible numbers. Rejected changes are listed, never silently applied.
- **Fail safe.** Without `ANTHROPIC_API_KEY`, offline, rate limited, or on any error, the workout is
  shown as "Not reviewed by the coach". Only a successful review shows as approved. Users can
  switch back to the original plan before starting, and can turn the review off in Profile.
- **Data.** The client sends only ids, numbers and enums (`lib/coach/schema.ts`); the server builds
  the prompt from the static library. Nothing is stored. `POST /api/coach/review` is open to guests
  and rate limited in memory (15 per hour per user or IP); use a shared limiter in production.
- **Development.** `.claude/agents/coach.md` defines the same reviewer as a Claude Code agent.
  `pnpm coach:samples` writes the exact coach inputs for 12 profiles to `.coach/samples/` for review.

## API

All routes except `/api/auth/*` need a better-auth session cookie and answer JSON. Types live in
`lib/sync/types.ts`; request bodies are validated with zod (`lib/sync/server/validation.ts`).

| Route                        | Method | Purpose                                                                                                 |
| ---------------------------- | ------ | ------------------------------------------------------------------------------------------------------- |
| `/api/auth/*`                | *      | better-auth (sign-up, sign-in, sign-out, session, OAuth callbacks, magic link).                         |
| `/api/me`                    | GET    | `{ user, profile }`; `profile` is `null` until the client has pushed one.                               |
| `/api/me`                    | PUT    | Upsert the profile. Last-write-wins on `updatedAt`; always `200` with the winning profile.               |
| `/api/workouts`              | POST   | Upsert one `CompletedWorkout` by its client id (idempotent).                                            |
| `/api/workouts/:id`          | DELETE | Delete one workout (idempotent). It stays as a tombstone so other devices drop it on their next pull.   |
| `/api/workouts/sync`         | POST   | Push a batch (each validated independently; see `acceptedIds` / `rejected`), optionally push the profile and `deletedIds`, pull workouts changed after `since` (up to 500 per page; keep pulling with `serverTime` as `since` while `hasMore`). The response's `deletedIds` lists workouts deleted elsewhere. `serverTime` is a cursor that trails server time by ~10 s, not a clock. |
| `/api/workouts/history`      | GET    | `?cursor=<iso>&limit=50` keyset pagination by `completedAt` desc.                                        |
| `/api/progress`              | GET    | Per-exercise bests, last 5 sessions per exercise, lifetime totals.                                      |

Errors always look like `{ "error": { "code": "...", "message": "..." } }`:
`401 unauthenticated`, `400 validation_error` / `invalid_json`, `404 not_found`, `409 conflict` (a
workout id that belongs to another account), `413 payload_too_large` (1 MB per body, 4 MB for
sync; the client halves its push batch on 413), `500 internal_error` (details are only logged
server-side).

Workout ids are client-generated UUIDs and are scoped to the signed-in user; a sync never writes
another account's rows. Every upsert rebuilds that workout's `exercise_performance` rows (one per
completed set with reps or time) and recomputes `user_progress` for the exercises touched. A
delete removes the workout's `exercise_performance` rows, recomputes progress and keeps the row with
`deletedAt` set; a later push of the same id is acknowledged but never brings it back.

### Not implemented

- **Rate limiting** on `/api/*` is out of scope for now. better-auth applies its own built-in
  limits to `/api/auth/*`; put the app behind a proxy/edge rate limiter before exposing it publicly.
- Account deletion / data export endpoints.
