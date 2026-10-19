-- CreateEnum
CREATE TYPE "EntryVersionStatus" AS ENUM ('DRAFT', 'PENDING', 'APPROVED', 'PUBLISHED', 'REJECTED', 'WITHDRAWN', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "InputKind" AS ENUM ('TEXT', 'VOICE', 'PHOTO');

-- CreateTable
CREATE TABLE "class_sessions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "taughtOn" DATE NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "class_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "semesterId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "taughtOn" DATE NOT NULL,
    "authorId" TEXT,
    "currentVersionId" TEXT,
    "takenDownAt" TIMESTAMP(3),
    "takenDownById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entry_versions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "status" "EntryVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "inputKind" "InputKind" NOT NULL DEFAULT 'TEXT',
    "mediaFileId" TEXT,
    "rawText" TEXT NOT NULL,
    "structured" JSONB NOT NULL DEFAULT '{}',
    "summary" TEXT,
    "organize" "JobState" NOT NULL DEFAULT 'QUEUED',
    "organizeError" TEXT,
    "syllabusVersionId" TEXT,
    "mappingStale" BOOLEAN NOT NULL DEFAULT false,
    "authorId" TEXT,
    "minorEdit" BOOLEAN NOT NULL DEFAULT false,
    "submittedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "unreviewed" BOOLEAN NOT NULL DEFAULT false,
    "reminderCount" INTEGER NOT NULL DEFAULT 0,
    "lastReminderAt" TIMESTAMP(3),
    "escalatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "entry_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entry_topics" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "entryVersionId" TEXT NOT NULL,
    "topicStableKey" TEXT NOT NULL,
    "confidence" INTEGER NOT NULL,

    CONSTRAINT "entry_topics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_settings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "classId" TEXT,
    "autoApprove" BOOLEAN NOT NULL,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "unreviewedPublishAfterDays" INTEGER,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "class_sessions_tenantId_taughtOn_idx" ON "class_sessions"("tenantId", "taughtOn");

-- CreateIndex
CREATE UNIQUE INDEX "class_sessions_classId_taughtOn_key" ON "class_sessions"("classId", "taughtOn");

-- CreateIndex
CREATE UNIQUE INDEX "class_sessions_id_tenantId_key" ON "class_sessions"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "entries_currentVersionId_key" ON "entries"("currentVersionId");

-- CreateIndex
CREATE INDEX "entries_tenantId_sectionId_taughtOn_idx" ON "entries"("tenantId", "sectionId", "taughtOn");

-- CreateIndex
CREATE INDEX "entries_tenantId_classId_taughtOn_idx" ON "entries"("tenantId", "classId", "taughtOn");

-- CreateIndex
CREATE UNIQUE INDEX "entries_id_tenantId_key" ON "entries"("id", "tenantId");

-- CreateIndex
CREATE INDEX "entry_versions_tenantId_status_idx" ON "entry_versions"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "entry_versions_entryId_versionNo_key" ON "entry_versions"("entryId", "versionNo");

-- CreateIndex
CREATE UNIQUE INDEX "entry_versions_id_tenantId_key" ON "entry_versions"("id", "tenantId");

-- CreateIndex
CREATE INDEX "entry_topics_tenantId_topicStableKey_idx" ON "entry_topics"("tenantId", "topicStableKey");

-- CreateIndex
CREATE UNIQUE INDEX "entry_topics_entryVersionId_topicStableKey_key" ON "entry_topics"("entryVersionId", "topicStableKey");

-- CreateIndex
CREATE UNIQUE INDEX "approval_settings_classId_key" ON "approval_settings"("classId");

-- CreateIndex
CREATE INDEX "approval_settings_tenantId_programId_idx" ON "approval_settings"("tenantId", "programId");

-- AddForeignKey
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_classId_tenantId_fkey" FOREIGN KEY ("classId", "tenantId") REFERENCES "classes"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entries" ADD CONSTRAINT "entries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entries" ADD CONSTRAINT "entries_sessionId_tenantId_fkey" FOREIGN KEY ("sessionId", "tenantId") REFERENCES "class_sessions"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entries" ADD CONSTRAINT "entries_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "entry_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entry_versions" ADD CONSTRAINT "entry_versions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entry_versions" ADD CONSTRAINT "entry_versions_entryId_tenantId_fkey" FOREIGN KEY ("entryId", "tenantId") REFERENCES "entries"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entry_topics" ADD CONSTRAINT "entry_topics_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entry_topics" ADD CONSTRAINT "entry_topics_entryVersionId_tenantId_fkey" FOREIGN KEY ("entryVersionId", "tenantId") REFERENCES "entry_versions"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_settings" ADD CONSTRAINT "approval_settings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------- Row-level security ----------
ALTER TABLE "class_sessions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "class_sessions"
  USING (semwise_rls_ok("tenantId")) WITH CHECK (semwise_rls_ok("tenantId"));

ALTER TABLE "entries" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "entries"
  USING (semwise_rls_ok("tenantId")) WITH CHECK (semwise_rls_ok("tenantId"));

ALTER TABLE "entry_versions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "entry_versions"
  USING (semwise_rls_ok("tenantId")) WITH CHECK (semwise_rls_ok("tenantId"));

ALTER TABLE "entry_topics" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "entry_topics"
  USING (semwise_rls_ok("tenantId")) WITH CHECK (semwise_rls_ok("tenantId"));

ALTER TABLE "approval_settings" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "approval_settings"
  USING (semwise_rls_ok("tenantId")) WITH CHECK (semwise_rls_ok("tenantId"));

-- One program default per program (class overrides have their own unique classId).
CREATE UNIQUE INDEX "approval_settings_program_default" ON "approval_settings" ("programId") WHERE "classId" IS NULL;
