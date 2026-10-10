# FORGE — architecture brief

FORGE is a premium, mobile-first gym workout web app. Open it and today's workout is already
programmed; follow it one exercise at a time on a large swipeable card (swipe right = done,
swipe left = replace). Everything about the workout lives on the client; the backend only
persists user-specific history.

This file is the contract for everyone working in the repo. Read it fully before writing code.

## Stack (installed, do not add UI libraries)

| Concern | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router, Turbopack, React 19.3, TypeScript strict). Bundled docs: `node_modules/next/dist/docs/` — read before using any Next API. |
| Styling | Tailwind CSS v4 (`app/globals.css` holds all tokens via `@theme inline`). |
| Components | shadcn/ui **Base UI** variant in `components/ui/*` (`@base-ui/react`). No Radix. No other component library. |
| Animation / gesture | `motion` v14 (`import { motion, AnimatePresence, useMotionValue, useTransform, animate, useReducedMotion } from "motion/react"`) and `@use-gesture/react` (`useDrag`). |
| State | `zustand` v5 (+ `persist` middleware), `idb-keyval` for IndexedDB. |
| Backend | Next.js route handlers, Prisma 7 (`@prisma/adapter-pg`, `prisma.config.ts`), PostgreSQL, `better-auth` 1.7 (email+password, Google, magic link). |
| Icons | `lucide-react`. |
| Tests | `vitest` for pure TS (`pnpm test`). |
| Package manager | `pnpm`. |

## Directory layout and ownership

```
app/
  layout.tsx                 root: fonts, ThemeProvider (dark default), LazyToaster, ServiceWorkerRegistrar, viewport
  page.tsx                   Landing (marketing + CTA)
  onboarding/page.tsx        6-step onboarding → creates profile → /today
  sign-in/page.tsx           email/password (verified email required), Google, magic link (optional; guest mode works)
  reset-password/page.tsx    new password from the emailed reset link (?token=)
  (app)/layout.tsx           app shell with BottomNav (Today | Progress | History | Profile), TooltipProvider
  (app)/today/page.tsx       Today's workout: overview → swipe deck → complete screen
  (app)/progress/page.tsx
  (app)/history/page.tsx     list, and one workout's detail at ?w=<id> (static, works offline)
  (app)/history/[id]/page.tsx  redirects to /history?w=<id>
  (app)/profile/page.tsx
  exercise/[slug]/page.tsx   Exercise details (instructions, muscles, mistakes, alternatives, history)
  api/auth/[...all]/route.ts better-auth handler
  api/me/route.ts            GET, PUT
  api/workouts/route.ts      POST
  api/workouts/[id]/route.ts DELETE (tombstone)
  api/workouts/sync/route.ts POST (push, deletes, paged pull with hasMore)
  api/workouts/history/route.ts GET
  api/progress/route.ts      GET
components/
  ui/                        shadcn (Base UI). Customize via className; do not fork unless necessary.
  app/                       AppShell, BottomNav, PageHeader, EmptyState, ThemeToggle, SyncBadge…
  landing/                   Landing sections
  onboarding/                Onboarding steps
  workout/                   SwipeDeck, ExerciseCard, ExerciseMedia (muscle map), SetLogger, RestTimer,
                             WorkoutProgress, WorkoutOverview, WorkoutSummary, ReplaceSheet, ExerciseDetails…
  progress/  history/  profile/
lib/
  exercises/                 STATIC exercise library (types.ts, index.ts, one file per category)
  engine/                    Pure workout generation (types.ts = contract, index.ts = API)
  domain/types.ts            Profile, logs, completed workouts, PRs
  store/                     zustand stores (types.ts = contract, index.ts exports hooks)
  persistence/               localStorage + IndexedDB adapters
  sync/                      API contract (types.ts), client (client.ts), queue/flush
  auth.ts, auth-client.ts, prisma.ts
  ids.ts, dates.ts, units.ts, utils.ts
prisma/schema.prisma, prisma.config.ts
public/sw.js, public/offline.html   offline app shell (production only), manifest start_url /today
```

Contracts that must not change without updating every consumer:
`lib/exercises/types.ts`, `lib/domain/types.ts`, `lib/engine/types.ts`, `lib/store/types.ts`, `lib/sync/types.ts`.
Additive changes (new optional fields) are fine.

## Data rules

- Weights are stored in **kilograms** everywhere. Convert only at the UI edge with `lib/units.ts`.
- Dates: calendar keys are `YYYY-MM-DD` local (`lib/dates.ts`), timestamps are ISO strings.
- Ids: `lib/ids.ts` `newId()`.
- Exercises are referenced by `id` only. Never copy exercise data into persisted state.
- The active workout lives in the workout store (persisted to localStorage) and is the source of
  truth during a session. Completed workouts go to the history store (IndexedDB) and are synced
  in the background when the user is signed in. Swipes never wait on the network.
- Guest mode is first-class: the app must fully work without an account. Signing in only adds sync.

## Frontend-first flow

```
lib/exercises (static) → lib/engine.generateWorkout → useWorkoutStore (localStorage)
→ swipes update local state → finish() → useHistoryStore (IndexedDB) → useSyncStore.flush() → /api/workouts/sync
```

Sync details: local data belongs to one account at a time (`ownerUserId` in the sync store); a
different account never receives another account's workouts without the user's explicit choice.
Deleting a synced workout queues its id (`pendingDeletes`) and the server keeps a tombstone so
other devices drop it. Pulls are paged (`hasMore`); `lastSyncedAt` is the server's cursor and
`lastCompletedAt` is the time to show as "Synced X ago".

## Programming principles the engine must follow

Splits by training days: 2 → full body A/B; 3 → push/pull/legs for hypertrophy (intermediate+),
full body A/B/C otherwise; 4 → upper/lower ×2; 5 → push/pull/legs/upper/lower; 6 → push/pull/legs ×2.
Endurance alternates lifting and conditioning-led days: 4 days → Full body A, Conditioning A, Full
body B, Conditioning B; 5 days adds Full body C; 6 days adds Conditioning C. A conditioning-led day
is a lower + pull + trunk circuit at minimum sets, then a steady or interval block in the finisher
role (the day's main work, labelled "Conditioning" on the card). Upper A's secondary is a vertical
pull and its accessory pull a row (Upper B mirrors it); Full body A's second pull is a back compound;
Full body B's trunk work sits at priority 3. For hypertrophy, Upper A programs its triceps isolation
before its biceps curl so a 60-minute upper/lower week has direct triceps work.
Pick the next day in rotation unless the muscles it targets were trained heavily within 48h,
then pick the freshest alternative. Structure: warm-up (3–6 movements chosen for the day's
muscles, cardio first, dynamic not static) → primary compound → secondary compound → accessory →
isolation → optional finisher → cool-down stretches (for muscles trained: 3 at the bottom of their
hold range plus about 90 s of breathing for sessions of 60 minutes or less, 4 longer holds above
that, or when the main work cannot fill the time). Unloaded plyometric primers (and Olympic lifts)
open the main phase; loaded ballistic lifts keep their compound place. The warm-up primes each main
compound's pattern and serves the focus or a group a main lift loads; corrective drills are never
picked automatically; impact pulse raisers run 60–120 s, beginners start on low-impact cardio, and
the light cardio matches the finisher's machine when it can. The conditioning finisher is for
conditioning goals only (fat loss, general fitness, endurance). Its budget depends on the goal
(endurance about 25% of the session, fat loss and general fitness 1.3× the base), its rounds stay
within the exercise's setsRange (the time fitter protects about three quarters of them, and trims
isolation and accessory work first), a block whose minimum overruns the budget is set aside when
one fits, and a block completed in full progresses one lever per session (work per round, then a
round, then less rest). Endurance caps its lifting at 3/4/5/6 lifts for 30/45/60/75 minutes and
gives the conditioning block the time left.
Goal prescriptions: strength 3–6 sets × 3–6 reps, 150–240s rest, RIR 1–3; hypertrophy 3–5 × 6–15,
60–120s, RIR 1–3; fat loss / general fitness 2–4 × 10–15, 45–75s, add a conditioning finisher;
endurance 2–3 × 15–25, 30–60s. Heavy compounds (warmupRequired, at a load heavy enough to ramp
from) rest 180–240s for strength and 90–180s for hypertrophy, even past the lift's own range.
Strength support work rests by mechanics (isolation and trunk work 60–90s, loaded accessories
90–120s); a strength beginner's support work may start at 2 sets. RIR comes from a table by goal,
experience and role. Until the load is proven by logged history it stays at 3 (calibration) for
beginners, compounds, heavy and technique lifts; unproven accessory and isolation work for
intermediate and advanced lifters sits at RIR 2. Bodyweight presses and pulls start with a window
that leaves reps in reserve inside the lift's range, and a first exposure names an easier variation.
Beginners: fewer sets, no advanced exercises, more machines and dumbbells. Weekly set caps per
muscle group (beginner ~10, intermediate ~14, advanced ~18) are checked against the plan's other
sessions (trainingDaysPerWeek − 1) in the last 7 days,
with a soft ceiling of 1.3 × cap on the raw 7-day count. A capped compound keeps a 2-set
maintenance dose (at most 2 sets over, RIR +1, load held) instead of a stand-in. A rest day is
recommended (a reduced session: minimum sets, RIR +1, no finisher) after trainingDaysPerWeek
sessions in 7 days or 6 days in a row.
Core (trunk) work (core spec, `.coach/core-spec.json`) is measured by weekly coverage, not by
sessions: each rotation designates 2/2/2/3/3 core days for 2–6 day plans (`splits.ts coreDays`), a
session after 4 or more days without direct trunk work catches up, and a rolling 7 days holds at most
2/3/3/4/4 core days (other days give the slot to spare work). Core has its own weekly set cap by goal
and experience (`recovery.ts CORE_WEEKLY_SETS`, strength B/I/A 6/8/10, hypertrophy 6/10/12, fat loss
and general fitness 8/10/10, endurance 8/10/12) instead of the general cap. A protected core block
never trims or displaces a primary or secondary compound: it is added in spare time, else it takes
the slot of the lowest-priority isolation (never the day's only pull), else it waits for the next
session; the finished day is checked against the same day without it. In the time fitter it ranks
just below the compounds and keeps 2 sets. Sessions of 30 minutes or less dose every core plan at
2 sets (one-sided holds ≤ 30 s, one-sided reps ≤ 6–8 per side) and trunk work never gets build-up or
feeder sets. Families (anti-extension; anti-rotation; anti-lateral flexion plus core carries;
flexion/rotation) rotate by scoring against the rolling week, with goal emphasis, flexion at most
once a week (except trained hypertrophy), loadable trunk work first for trained strength and
hypertrophy lifters, and same-structure conflicts (lower back, hanging or overhead after a press,
grip after a heavy hinge or two pulls) penalised. Anti-movement trunk drills have RIR null and a
position-stop cue; core holds cap at 45 s (strength, hypertrophy, beginners) or 60 s, then add a set,
then a harder variation, and a first or missed hold names the easier hold. Unloaded trunk drills in
conditioning goals rest 30–45 s. Beginners and lower-back-flagged lifters (and trained lifters on a
heavy squat, hinge or vertical-press day of 45 minutes or more) get a dead-bug or bird-dog bracing
primer in a free warm-up place; ballistic torso twists never precede a heavy squat or hinge. No
trunk note sells fat loss, toning or injury prevention. Balance push/pull across the week; full-body and upper days
never press without pulling. Progressive overload: if the last session hit the top of its own rep
range on every set, add ~2.5% (upper) / ~5% (lower) rounded to the load step (kettlebells step to
the next bell); a step of more than ~10% (light dumbbells, the next bell) waits for a second
top-of-range session unless logged effort supports it; a window that changed between templates is
judged against last session's window, and only a window that shares no rep is translated through
e1RM; if reps were missed, repeat the load. Bodyweight work progresses reps, then hold time, then
sets, then a harder variation; with none available, conditioning goals shorten the rest, then the
lowering slows a second per session up to 6 s (the card's tempo says so). A first-time load is a
labelled starting estimate with a calibration note (its lighter sets build up to it), or "find your
working weight" (machines, cables, bands, lifts without a heuristic and, for intermediate and
advanced lifters, heavy compounds; the build-up sets are extra and are budgeted in the duration
estimate); a logged load far above the upper end of the estimate is held with a check note until
confirmed.
Respect `profile.limitations` (exclude exercises whose `contraindications` intersect) and
`excludedExerciseIds`; a support slot a flagged area empties gets a session note. Kit the Equipment
list cannot name yet (data tags `needs_adjustable_bench`, `needs_elevated_bench`,
`needs_battle_rope`) is assumed only for the full_gym preset. Support lifts repeat on their split
day while they progress: one rotates at a block boundary (about four exposures) or after two
stalled sessions, and a replacement must suit the goal. Deterministic: same input + seed → same
workout.

## UI and design system

- **Mobile first**, one-handed. Primary actions at the bottom. Touch targets ≥ 44px. No horizontal
  page scroll. Use `h-screen-safe`, `pt-safe`, `pb-safe`, `pb-nav` utilities (defined in globals.css).
- **Dark theme is default**; light must also look right. Use semantic tokens only
  (`bg-background`, `bg-card`, `bg-surface`, `bg-surface-2`, `text-muted-foreground`, `bg-primary`,
  `text-volt`, `bg-volt`, `bg-replace`, `bg-success`, `bg-info`). Never hard-code colors.
- Typography: big, tight headings (`font-heading tracking-tight`), stats in `text-stat` (mono,
  tabular), small uppercase labels in `text-label`. Keep copy minimal.
- Surfaces: `surface-card` utility or `Card`; `rounded-2xl`/`rounded-3xl`; `shadow-card`,
  `shadow-float`, `shadow-volt` for the active card.
- Motion: `animate-rise`, `animate-pop` for entrances; spring physics for the card; respect
  `useReducedMotion()`.
- Base UI note: there is no `asChild`. Use the `render` prop, e.g.
  `<DialogClose render={<Button variant="outline" />}>Close</DialogClose>`. Dialog/Sheet/Drawer
  content components already include portals and overlays. Select uses `SelectValue`,
  `SelectItem` with `value`. Tabs: `Tabs` + `TabsList` + `TabsTrigger value` + `TabsContent value`.
- Every interactive element must be keyboard reachable and labeled. Swiping is never the only way
  to act: always render explicit Done / Replace buttons.
- Haptics: `navigator.vibrate?.(10)` guarded, in `lib/haptics.ts`.
- Client components need `"use client"` at the top. Stores are client-only; read them inside
  client components. Gate on `hydrated` and render a skeleton until true.

## Next.js 16 specifics

- `params` and `searchParams` are Promises: `const { slug } = await params`.
- `cookies()` / `headers()` are async.
- Route handlers: `export async function GET(req: Request, ctx: RouteContext<'/api/x/[id]'>)`.
- Middleware is `proxy.ts` (not needed here; guest mode).
- `next.config.ts` is tiny; Turbopack is default. Do not add webpack config.

## Quality bar

- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` must all pass.
- Do not leave `console.log` in client code. No `any` unless unavoidable (and commented).
- Do not commit. Do not add dependencies without a strong reason.
