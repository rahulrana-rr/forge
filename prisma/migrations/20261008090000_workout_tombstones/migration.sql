-- Workout deletes become tombstones so they propagate through sync.
ALTER TABLE "workout" ADD COLUMN "deletedAt" TIMESTAMP(3);
