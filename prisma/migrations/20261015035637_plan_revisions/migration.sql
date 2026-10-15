-- AlterTable
ALTER TABLE "workout" ADD COLUMN     "programDay" JSONB;

-- CreateTable
CREATE TABLE "plan_revision" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "weekStart" TEXT NOT NULL,
    "programWeek" INTEGER NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "plan" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,
    "analysis" JSONB NOT NULL,
    "changes" JSONB NOT NULL,
    "inputHash" TEXT NOT NULL,
    "runId" TEXT,
    "proposedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "decidedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "statusReason" TEXT,

    CONSTRAINT "plan_revision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_approval" (
    "id" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "coachUserId" TEXT NOT NULL,
    "coachEmail" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_approval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_event" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "revisionId" TEXT,
    "type" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "reason" TEXT,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "adaptation_run" (
    "id" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "heartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "summary" JSONB,
    "error" TEXT,

    CONSTRAINT "adaptation_run_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "plan_revision_userId_weekStart_status_idx" ON "plan_revision"("userId", "weekStart", "status");

-- CreateIndex
CREATE INDEX "plan_revision_status_expiresAt_idx" ON "plan_revision"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "plan_revision_userId_weekStart_revisionNumber_key" ON "plan_revision"("userId", "weekStart", "revisionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "plan_approval_revisionId_key" ON "plan_approval"("revisionId");

-- CreateIndex
CREATE INDEX "plan_approval_coachUserId_createdAt_idx" ON "plan_approval"("coachUserId", "createdAt");

-- CreateIndex
CREATE INDEX "plan_event_userId_createdAt_idx" ON "plan_event"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "plan_event_revisionId_idx" ON "plan_event"("revisionId");

-- CreateIndex
CREATE UNIQUE INDEX "adaptation_run_periodKey_key" ON "adaptation_run"("periodKey");

-- AddForeignKey
ALTER TABLE "plan_revision" ADD CONSTRAINT "plan_revision_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_approval" ADD CONSTRAINT "plan_approval_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "plan_revision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_event" ADD CONSTRAINT "plan_event_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "plan_revision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Invariants Prisma's schema language cannot express (partial unique indexes), kept here and noted
-- in schema.prisma: an athlete has at most one active plan and at most one pending proposal per
-- target week, so a race between two approvals or two job deliveries cannot publish twice.
CREATE UNIQUE INDEX "plan_revision_one_active_per_week" ON "plan_revision"("userId", "weekStart") WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "plan_revision_one_pending_per_week" ON "plan_revision"("userId", "weekStart") WHERE "status" = 'PENDING';
