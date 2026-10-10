/**
 * Held-out verification set for the coach: 32 user profiles the engine was never tuned against
 * (the tuning set is scripts/coach/samples.test.ts). Each profile is simulated on its weekly
 * training days with plausible logged loads. One session per profile is written; the session is
 * chosen so the set covers every template type (push, pull, legs, upper, lower, full body) and a
 * mix of first sessions and sessions with one or two weeks of history.
 *
 *   COACH_VERIFY=1 pnpm exec vitest run scripts/coach/verify-samples.test.ts
 *
 * Writes .coach/verify/samples/<profile>--day<N>.txt (the exact input the in-app coach receives)
 * and .coach/verify/profiles.json. Skipped during the normal test run.
 */
import fs from "node:fs"
import path from "node:path"
import { describe, it } from "vitest"

import { buildCoachRequest } from "@/lib/coach/context"
import { buildCoachMessage } from "@/lib/coach/message"
import { addDays } from "@/lib/dates"
import type { CompletedWorkout, EquipmentPreset, Gender, TrainingDays } from "@/lib/domain/types"
import { EQUIPMENT_PRESETS } from "@/lib/domain/types"
import { generateWorkout } from "@/lib/engine"
import { completeAtTop, makeInput, makeProfile, progressFromHistory, trainingDayOffsets } from "@/lib/engine/test-fixtures"
import { getExercise } from "@/lib/exercises"
import type { BodyArea, Difficulty, Equipment, Goal } from "@/lib/exercises/types"

const OUT = path.resolve(import.meta.dirname, "../../.coach/verify")
const FIRST_DATE = "2026-10-05" // a Monday

interface Case {
  name: string
  goal: Goal
  experience: Difficulty
  gender: Gender
  weightKg: number
  days: TrainingDays
  preset: EquipmentPreset
  equipment?: Equipment[]
  minutes: 30 | 45 | 60 | 75
  limitations: BodyArea[]
  /** 0 = first session, 7 = first session of week two. */
  day: 0 | 7
}

const c = (
  name: string,
  goal: Goal,
  experience: Difficulty,
  gender: Gender,
  weightKg: number,
  preset: EquipmentPreset,
  days: TrainingDays,
  minutes: Case["minutes"],
  limitations: BodyArea[],
  day: Case["day"],
  equipment?: Equipment[],
): Case => ({ name, goal, experience, gender, weightKg, preset, days, minutes, limitations, day, equipment })

const CASES: Case[] = [
  c("v01-hyp-beg-f55-db-3d45", "muscle_gain", "beginner", "female", 55, "dumbbells", 3, 45, [], 0),
  c("v02-hyp-int-m95-gym-5d60-elbow", "muscle_gain", "intermediate", "male", 95, "full_gym", 5, 60, ["elbow"], 7),
  c("v03-hyp-adv-m110-home-4d75", "muscle_gain", "advanced", "male", 110, "home_gym", 4, 75, [], 0),
  c("v04-hyp-int-f70-kb-3d45", "muscle_gain", "intermediate", "female", 70, "custom", 3, 45, [], 7, ["kettlebell", "bodyweight", "pull_up_bar"]),
  c("v05-hyp-beg-u130-gym-2d60-knee-lb", "muscle_gain", "beginner", "unspecified", 130, "full_gym", 2, 60, ["knee", "lower_back"], 0),
  c("v06-hyp-adv-f58-bw-6d45", "muscle_gain", "advanced", "female", 58, "bodyweight", 6, 45, [], 7),
  c("v07-str-beg-f62-gym-3d60", "strength", "beginner", "female", 62, "full_gym", 3, 60, [], 7),
  c("v08-str-int-m78-home-4d75-wrist", "strength", "intermediate", "male", 78, "home_gym", 4, 75, ["wrist"], 0),
  c("v09-str-adv-f70-gym-4d60-shoulder", "strength", "advanced", "female", 70, "full_gym", 4, 60, ["shoulder"], 7),
  c("v10-str-int-u85-db-3d45", "strength", "intermediate", "unspecified", 85, "dumbbells", 3, 45, [], 0),
  c("v11-str-beg-m120-gym-2d45-hip", "strength", "beginner", "male", 120, "full_gym", 2, 45, ["hip"], 7),
  c("v12-str-adv-m88-gym-6d75", "strength", "advanced", "male", 88, "full_gym", 6, 75, [], 0),
  c("v13-fat-beg-m115-gym-3d45-knee", "fat_loss", "beginner", "male", 115, "full_gym", 3, 45, ["knee"], 7),
  c("v14-fat-int-f72-db-4d30", "fat_loss", "intermediate", "female", 72, "dumbbells", 4, 30, [], 0),
  c("v15-fat-adv-m84-gym-5d60", "fat_loss", "advanced", "male", 84, "full_gym", 5, 60, [], 7),
  c("v16-fat-beg-f95-home-2d45-lb", "fat_loss", "beginner", "female", 95, "home_gym", 2, 45, ["lower_back"], 0),
  c("v17-fat-int-u68-bw-5d30-ankle", "fat_loss", "intermediate", "unspecified", 68, "bodyweight", 5, 30, ["ankle"], 7),
  c("v18-fat-beg-m140-machines-3d60-knee-ankle", "fat_loss", "beginner", "male", 140, "custom", 3, 60, ["knee", "ankle"], 0, ["cardio_machine", "machine", "cable", "bodyweight"]),
  c("v19-gen-beg-f60-bw-3d30", "general_fitness", "beginner", "female", 60, "bodyweight", 3, 30, [], 7),
  c("v20-gen-int-m80-gym-3d60-neck", "general_fitness", "intermediate", "male", 80, "full_gym", 3, 60, ["neck"], 0),
  c("v21-gen-adv-f66-home-4d45", "general_fitness", "advanced", "female", 66, "home_gym", 4, 45, [], 7),
  c("v22-gen-beg-u75-db-4d45-shoulder-wrist", "general_fitness", "beginner", "unspecified", 75, "dumbbells", 4, 45, ["shoulder", "wrist"], 0),
  c("v23-gen-int-m100-bands-2d30", "general_fitness", "intermediate", "male", 100, "custom", 2, 30, [], 7, ["band", "bodyweight", "bench"]),
  c("v24-gen-beg-m68-gym-6d30", "general_fitness", "beginner", "male", 68, "full_gym", 6, 30, [], 0),
  c("v25-end-beg-m90-gym-3d45", "endurance", "beginner", "male", 90, "full_gym", 3, 45, [], 7),
  c("v26-end-int-f55-home-4d60-knee", "endurance", "intermediate", "female", 55, "home_gym", 4, 60, ["knee"], 0),
  c("v27-end-adv-m70-gym-6d75", "endurance", "advanced", "male", 70, "full_gym", 6, 75, [], 7),
  c("v28-end-int-u80-db-2d30-lb", "endurance", "intermediate", "unspecified", 80, "dumbbells", 2, 30, ["lower_back"], 0),
  c("v29-end-beg-f65-bw-5d45-hip", "endurance", "beginner", "female", 65, "bodyweight", 5, 45, ["hip"], 7),
  c("v30-hyp-int-m72-gym-6d45", "muscle_gain", "intermediate", "male", 72, "full_gym", 6, 45, [], 7),
  c("v31-str-int-f60-gym-4d60-knee", "strength", "intermediate", "female", 60, "full_gym", 4, 60, ["knee"], 7),
  c("v32-fat-adv-f62-gym-6d75-shoulder", "fat_loss", "advanced", "female", 62, "full_gym", 6, 75, ["shoulder"], 0),
]

describe.skipIf(!process.env.COACH_VERIFY)("coach verification samples", () => {
  it("writes held-out review inputs", () => {
    const dir = path.join(OUT, "samples")
    fs.rmSync(dir, { recursive: true, force: true })
    fs.mkdirSync(dir, { recursive: true })
    const written: Array<Case & { file: string; equipmentResolved: Equipment[]; title: string }> = []
    for (const k of CASES) {
      const equipment = k.preset === "custom" ? (k.equipment ?? ["bodyweight"]) : EQUIPMENT_PRESETS[k.preset]
      const profile = makeProfile({
        id: `verify-${k.name}`,
        goal: k.goal,
        experience: k.experience,
        gender: k.gender,
        weightKg: k.weightKg,
        trainingDaysPerWeek: k.days,
        equipmentPreset: k.preset,
        equipment,
        durationPreferenceMinutes: k.minutes,
        limitations: k.limitations,
      })
      // Spread the samples over the rotation: case i takes session (i * 5) mod (2 x days), so
      // with 32 cases every template position and both weeks appear. Cases marked day 0 keep the
      // first session (no history).
      const index = CASES.indexOf(k)
      const session = k.day === 0 && index % 4 === 0 ? 0 : (index * 5) % (2 * k.days)
      const offsets = trainingDayOffsets(k.days, 21)
      const target = offsets[session]!
      const history: CompletedWorkout[] = []
      for (const day of offsets) {
        const input = makeInput(profile, addDays(FIRST_DATE, day), [...history].reverse(), progressFromHistory(history))
        const workout = generateWorkout(input)
        if (day === target) {
          const file = `${k.name}--day${day + 1}.txt`
          fs.writeFileSync(path.join(dir, file), buildCoachMessage(buildCoachRequest(workout, input)))
          written.push({ ...k, file, equipmentResolved: equipment, title: workout.title })
          break
        }
        history.push(completeAtTop(workout, getExercise, 40, { loads: "calibrated", lifter: profile }))
      }
    }
    fs.writeFileSync(path.join(OUT, "profiles.json"), JSON.stringify(written, null, 1))
    console.log(`verification samples: ${written.length} written to ${dir}`)
  })
})
