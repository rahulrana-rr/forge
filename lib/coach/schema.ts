/**
 * Coach review contract: the JSON the coach model returns, and the request the client sends.
 *
 * The review shape follows the coach brief exactly (review_status, overall_score, issues,
 * exercise_reviews, programming_feedback, final_recommendations, approved_workout). Two additive
 * fields make it usable by the app: `slot_id` on exercise reviews and approved items, and
 * `exercise_id` on approved items, so corrections map back onto the workout without guessing
 * from names.
 */
import { z } from "zod"

export const REVIEW_STATUSES = ["APPROVED", "APPROVED_WITH_CHANGES", "REJECTED"] as const
export type ReviewStatus = (typeof REVIEW_STATUSES)[number]

const level = z.enum(["high", "moderate", "low"])

export const CoachIssueSchema = z.object({
  severity: z.enum(["critical", "high", "medium", "low"]),
  category: z.enum(["safety", "programming", "technique", "recovery", "goal_alignment", "clarity"]),
  exercise_name: z.string().describe("Exercise name, or a workout-level label such as \"Whole workout\"."),
  problem: z.string(),
  recommendation: z.string(),
})

export const CoachExerciseReviewSchema = z.object({
  slot_id: z.string().describe("slot_id of the reviewed exercise, copied from the input."),
  exercise_name: z.string(),
  status: z.enum(REVIEW_STATUSES),
  reasoning: z.string(),
  corrected_sets: z.number().int().nullable(),
  corrected_reps: z.string().nullable().describe("e.g. \"8-10\", \"12\" or \"45s\"; null when unchanged."),
  corrected_rest_seconds: z.number().int().nullable(),
  technique_cues: z.array(z.string()),
  alternative_exercises: z.array(z.string()).describe("exercise_id values from the allowed alternatives."),
})

export const CoachApprovedItemSchema = z.object({
  slot_id: z.string().nullable().describe("slot_id from the input, or null for an exercise the coach added."),
  exercise_id: z.string().describe("Must be an exercise_id present in the input (workout or allowed alternatives)."),
  exercise_name: z.string(),
  phase: z.enum(["warmup", "main", "cooldown"]),
  role: z.enum(["warmup", "primary_compound", "secondary_compound", "accessory", "isolation", "finisher", "cooldown"]),
  sets: z.number().int(),
  reps_min: z.number().int().nullable().describe("null for timed work."),
  reps_max: z.number().int().nullable().describe("null for timed work."),
  duration_seconds: z.number().int().nullable().describe("Seconds per set for timed work, null otherwise."),
  rest_seconds: z.number().int(),
  rir: z.number().int().nullable(),
  tempo: z.string().nullable(),
  coach_note: z.string().nullable().describe("One short cue shown on the card, or null."),
})

export const CoachReviewSchema = z.object({
  review_status: z.enum(REVIEW_STATUSES),
  overall_score: z.number().int().describe("0 to 100."),
  goal_alignment: level,
  experience_level_match: level,
  safety_assessment: z.enum(["low_concern", "needs_attention", "high_concern"]),
  summary: z.string(),
  issues: z.array(CoachIssueSchema),
  exercise_reviews: z.array(CoachExerciseReviewSchema),
  programming_feedback: z.object({
    volume: z.string(),
    intensity: z.string(),
    recovery: z.string(),
    exercise_balance: z.string(),
    estimated_duration_minutes: z.number().int().nullable(),
  }),
  final_recommendations: z.array(z.string()),
  approved_workout: z.array(CoachApprovedItemSchema),
})

export type CoachIssue = z.infer<typeof CoachIssueSchema>
export type CoachExerciseReview = z.infer<typeof CoachExerciseReviewSchema>
export type CoachApprovedItem = z.infer<typeof CoachApprovedItemSchema>
export type CoachReview = z.infer<typeof CoachReviewSchema>

/* ------------------------------------------------------------------ */
/* Request                                                             */
/* ------------------------------------------------------------------ */

const id = z.string().min(1).max(128)

/**
 * A note code (lib/coach/notes.ts). Validated as a code-shaped string rather than an enum so a
 * newer client's code does not fail an older server: the server renders known codes only.
 */
const noteCode = z.string().regex(/^[a-z][a-z_]{0,39}$/)

const repWindow = z.tuple([z.number().int().min(1).max(100), z.number().int().min(1).max(100)])

/** One completed set as logged. Assisted lifts log the assistance as a negative load. */
const LoggedSetSchema = z.object({
  weightKg: z.number().min(-500).max(500).nullable(),
  reps: z.number().int().min(0).max(100).nullable(),
  durationSeconds: z.number().int().min(0).max(3600).nullable().optional(),
  /** Rate of perceived exertion 1-10, only when the lifter logged it. */
  rpe: z.number().min(1).max(10).nullable().optional(),
})

/**
 * The lifter's most recent completed session of a slot's exercise (coach round 2, R23), so the
 * coach can judge progression: what was prescribed then, what each completed set logged, and for
 * how many sessions in a row the load has not moved.
 */
const LastSessionSchema = z.object({
  daysAgo: z.number().int().min(0).max(365),
  prescribedReps: repWindow.nullable(),
  prescribedDurationSeconds: z.number().int().min(1).max(3600).nullable(),
  sets: z.array(LoggedSetSchema).min(1).max(12),
  /**
   * Consecutive sessions, newest first, logged at the last session's working (heaviest) load, the
   * last session included. Counted over the history the device sends. Absent without a load.
   */
  sameLoadSessions: z.number().int().min(1).max(50).optional(),
})

/**
 * What the client sends. Only ids, numbers and enums: the server looks up every exercise in the
 * static library and writes the prompt itself, so the endpoint cannot be used as a free-form
 * model proxy and no exercise text travels over the network. Engine notes travel as codes.
 */
export const CoachRequestSchema = z.object({
  workout: z.object({
    id,
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    title: z.string().max(80),
    split: z.string().max(40),
    focus: z.array(z.string().max(40)).max(13),
    estimatedMinutes: z.number().int().min(1).max(240),
    exercises: z
      .array(
        z.object({
          slotId: id,
          exerciseId: id,
          phase: z.enum(["warmup", "main", "cooldown"]),
          role: z.string().max(40),
          sets: z.number().int().min(1).max(12),
          reps: repWindow.nullable(),
          durationSeconds: z.number().int().min(1).max(3600).nullable(),
          restSeconds: z.number().int().min(0).max(600),
          tempo: z.string().max(20).nullable(),
          rir: z.number().int().min(0).max(6).nullable(),
          recommendedWeightKg: z.number().min(0).max(500).nullable(),
          weightSource: z.enum(["history", "estimate", "user"]).nullable(),
          /** Engine-vetted replacements for this slot (equipment, level, limitations already checked). */
          alternatives: z.array(id).max(8),
          /**
           * Alternatives that bring back a stand-in slot's planned lift although its muscle group is
           * over this week's set cap (ReplacementCandidate.overCap). A subset of `alternatives`.
           */
          overCapAlternatives: z.array(id).max(8).optional(),
          /**
           * The card note the engine wrote for this slot, as a code (lib/coach/notes.ts): its
           * leading sentence only. Kept for older servers; newer ones read engineNotes.
           */
          engineNote: noteCode.nullable().optional(),
          /**
           * Every sentence of the card note as a code, the leading one first (a ramp-up sentence,
           * then a starting-guess or find-your-working-weight note). Coach round 2, R23.
           */
          engineNotes: z.array(noteCode).max(8).optional(),
          /** Main-phase slots whose exercise has logged history: the last session (R23). */
          lastSession: LastSessionSchema.optional(),
        }),
      )
      .min(1)
      .max(40),
    /** Session-level engine notes (rest day, light day, limitation), as codes. */
    notes: z.array(noteCode).max(10).optional(),
  }),
  profile: z.object({
    goal: z.enum(["muscle_gain", "strength", "fat_loss", "general_fitness", "endurance"]),
    experience: z.enum(["beginner", "intermediate", "advanced"]),
    gender: z.enum(["male", "female", "unspecified"]),
    weightKg: z.number().min(25).max(350),
    trainingDaysPerWeek: z.number().int().min(1).max(7),
    durationPreferenceMinutes: z.number().int().min(15).max(180),
    equipment: z.array(z.string().max(40)).max(40),
    /** Body areas the user asked us to protect. Sent for this review only; never stored. */
    limitations: z.array(z.string().max(40)).max(12),
  }),
  /**
   * The engine's 7-day window (days 0–6 before the workout day), newest first: what was trained
   * and how hard. No dates beyond day offsets.
   */
  recentTraining: z
    .array(
      z.object({
        daysAgo: z.number().int().min(0).max(14),
        title: z.string().max(80),
        focus: z.array(z.string().max(40)).max(13),
        /** Direct working sets: conditioning finishers and cardio are in conditioningMinutes. */
        workingSets: z.number().int().min(0).max(200),
        /** Main-phase exercises completed, in order (finishers included). */
        mainExerciseIds: z.array(id).max(20).optional(),
        conditioningMinutes: z.number().int().min(0).max(600).optional(),
      }),
    )
    .max(14),
  /**
   * Direct working sets per muscle group over the engine's 7-day window before today's session:
   * the counts the weekly cap is checked against (computeRecovery().setsLast7). Conditioning is
   * not a muscle group's working sets; see conditioningMinutesLast7.
   */
  weeklySetsByGroup: z.record(z.string().max(40), z.number().int().min(0).max(200)),
  /** Minutes of conditioning work (finishers and cardio) over the same window. */
  conditioningMinutesLast7: z.number().int().min(0).max(3000).optional(),
})

export type CoachRequest = z.infer<typeof CoachRequestSchema>
export type CoachLastSession = z.infer<typeof LastSessionSchema>

/** What the API route returns to the client. */
export interface CoachResponse {
  review: CoachReview
  /** Coach changes the server could not accept (unknown ids, unsafe values) and therefore dropped. */
  rejectedChanges: string[]
  model: string
  reviewedAt: string
}

export interface CoachErrorBody {
  error: { code: "coach_unavailable" | "rate_limited" | "invalid_request" | "coach_failed" | "coach_refused"; message: string }
}
