-- CreateEnum
CREATE TYPE "FileKind" AS ENUM ('SYLLABUS_PDF', 'AUDIO', 'PHOTO');

-- CreateEnum
CREATE TYPE "FileStatus" AS ENUM ('PENDING', 'READY', 'DELETED');

-- CreateEnum
CREATE TYPE "SyllabusVersionStatus" AS ENUM ('DRAFT', 'PUBLISHING', 'PUBLISHED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "JobState" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "TopicKind" AS ENUM ('UNIT', 'TOPIC', 'SUBTOPIC');

-- CreateEnum
CREATE TYPE "ChangeRequestStatus" AS ENUM ('PROPOSED', 'ACCEPTED', 'PARTIAL', 'REJECTED');

-- CreateEnum
CREATE TYPE "ChunkSource" AS ENUM ('SYLLABUS_TOPIC', 'ENTRY_VERSION', 'NOTE');

-- CreateEnum
CREATE TYPE "ChunkStatus" AS ENUM ('LIVE', 'DELETED');

-- CreateTable
CREATE TABLE "files" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "kind" "FileKind" NOT NULL,
    "programId" TEXT,
    "batchId" TEXT,
    "semesterId" TEXT,
    "subjectId" TEXT,
    "sectionId" TEXT,
    "classId" TEXT,
    "uploadedById" TEXT,
    "status" "FileStatus" NOT NULL DEFAULT 'PENDING',
    "deleteAfter" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "syllabi" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "semesterId" TEXT NOT NULL,
    "subjectId" TEXT,
    "currentVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "syllabi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "syllabus_versions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "syllabusId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "status" "SyllabusVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "sourceFileId" TEXT,
    "copiedFromVersionId" TEXT,
    "effectiveFrom" DATE,
    "extraction" "JobState" NOT NULL DEFAULT 'DONE',
    "extractionError" TEXT,
    "usedOcr" BOOLEAN NOT NULL DEFAULT false,
    "suggestedName" TEXT,
    "suggestedCode" TEXT,
    "credits" INTEGER,
    "references" JSONB NOT NULL DEFAULT '[]',
    "createdById" TEXT,
    "publishedById" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "syllabus_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "syllabus_pages" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "pageNo" INTEGER NOT NULL,
    "text" TEXT NOT NULL,

    CONSTRAINT "syllabus_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "syllabus_topics" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "parentId" TEXT,
    "stableKey" TEXT NOT NULL,
    "kind" "TopicKind" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "hours" INTEGER,
    "orderIndex" INTEGER NOT NULL,
    "sourcePage" INTEGER,
    "confidence" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "syllabus_topics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "syllabus_change_requests" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "requestText" TEXT NOT NULL,
    "proposedOps" JSONB NOT NULL,
    "note" TEXT,
    "status" "ChangeRequestStatus" NOT NULL DEFAULT 'PROPOSED',
    "createdById" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "syllabus_change_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "indexed_chunks" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sourceType" "ChunkSource" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceVersionId" TEXT NOT NULL,
    "ownerId" TEXT,
    "qdrantPointId" TEXT NOT NULL,
    "embeddingModel" TEXT NOT NULL,
    "embeddingVersion" INTEGER NOT NULL DEFAULT 1,
    "status" "ChunkStatus" NOT NULL DEFAULT 'LIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "indexed_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "files_storageKey_key" ON "files"("storageKey");

-- CreateIndex
CREATE INDEX "files_tenantId_kind_status_idx" ON "files"("tenantId", "kind", "status");

-- CreateIndex
CREATE INDEX "files_status_deleteAfter_idx" ON "files"("status", "deleteAfter");

-- CreateIndex
CREATE UNIQUE INDEX "files_id_tenantId_key" ON "files"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "syllabi_subjectId_key" ON "syllabi"("subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "syllabi_currentVersionId_key" ON "syllabi"("currentVersionId");

-- CreateIndex
CREATE INDEX "syllabi_tenantId_semesterId_idx" ON "syllabi"("tenantId", "semesterId");

-- CreateIndex
CREATE UNIQUE INDEX "syllabi_id_tenantId_key" ON "syllabi"("id", "tenantId");

-- CreateIndex
CREATE INDEX "syllabus_versions_tenantId_status_idx" ON "syllabus_versions"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "syllabus_versions_syllabusId_versionNo_key" ON "syllabus_versions"("syllabusId", "versionNo");

-- CreateIndex
CREATE UNIQUE INDEX "syllabus_versions_id_tenantId_key" ON "syllabus_versions"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "syllabus_pages_versionId_pageNo_key" ON "syllabus_pages"("versionId", "pageNo");

-- CreateIndex
CREATE INDEX "syllabus_topics_tenantId_versionId_idx" ON "syllabus_topics"("tenantId", "versionId");

-- CreateIndex
CREATE UNIQUE INDEX "syllabus_topics_versionId_stableKey_key" ON "syllabus_topics"("versionId", "stableKey");

-- CreateIndex
CREATE INDEX "syllabus_change_requests_tenantId_versionId_idx" ON "syllabus_change_requests"("tenantId", "versionId");

-- CreateIndex
CREATE UNIQUE INDEX "indexed_chunks_qdrantPointId_key" ON "indexed_chunks"("qdrantPointId");

-- CreateIndex
CREATE INDEX "indexed_chunks_tenantId_sourceType_sourceVersionId_status_idx" ON "indexed_chunks"("tenantId", "sourceType", "sourceVersionId", "status");

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "syllabi" ADD CONSTRAINT "syllabi_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "syllabi" ADD CONSTRAINT "syllabi_semesterId_batchId_programId_tenantId_fkey" FOREIGN KEY ("semesterId", "batchId", "programId", "tenantId") REFERENCES "semesters"("id", "batchId", "programId", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "syllabi" ADD CONSTRAINT "syllabi_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "syllabi" ADD CONSTRAINT "syllabi_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "syllabus_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "syllabus_versions" ADD CONSTRAINT "syllabus_versions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "syllabus_versions" ADD CONSTRAINT "syllabus_versions_syllabusId_tenantId_fkey" FOREIGN KEY ("syllabusId", "tenantId") REFERENCES "syllabi"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "syllabus_versions" ADD CONSTRAINT "syllabus_versions_sourceFileId_tenantId_fkey" FOREIGN KEY ("sourceFileId", "tenantId") REFERENCES "files"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "syllabus_pages" ADD CONSTRAINT "syllabus_pages_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "syllabus_pages" ADD CONSTRAINT "syllabus_pages_versionId_tenantId_fkey" FOREIGN KEY ("versionId", "tenantId") REFERENCES "syllabus_versions"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "syllabus_topics" ADD CONSTRAINT "syllabus_topics_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "syllabus_topics" ADD CONSTRAINT "syllabus_topics_versionId_tenantId_fkey" FOREIGN KEY ("versionId", "tenantId") REFERENCES "syllabus_versions"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "syllabus_topics" ADD CONSTRAINT "syllabus_topics_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "syllabus_topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "syllabus_change_requests" ADD CONSTRAINT "syllabus_change_requests_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "syllabus_change_requests" ADD CONSTRAINT "syllabus_change_requests_versionId_tenantId_fkey" FOREIGN KEY ("versionId", "tenantId") REFERENCES "syllabus_versions"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "indexed_chunks" ADD CONSTRAINT "indexed_chunks_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------- Row-level security ----------
ALTER TABLE "files" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "files"
  USING (semwise_rls_ok("tenantId")) WITH CHECK (semwise_rls_ok("tenantId"));

ALTER TABLE "syllabi" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "syllabi"
  USING (semwise_rls_ok("tenantId")) WITH CHECK (semwise_rls_ok("tenantId"));

ALTER TABLE "syllabus_versions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "syllabus_versions"
  USING (semwise_rls_ok("tenantId")) WITH CHECK (semwise_rls_ok("tenantId"));

ALTER TABLE "syllabus_pages" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "syllabus_pages"
  USING (semwise_rls_ok("tenantId")) WITH CHECK (semwise_rls_ok("tenantId"));

ALTER TABLE "syllabus_topics" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "syllabus_topics"
  USING (semwise_rls_ok("tenantId")) WITH CHECK (semwise_rls_ok("tenantId"));

ALTER TABLE "syllabus_change_requests" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "syllabus_change_requests"
  USING (semwise_rls_ok("tenantId")) WITH CHECK (semwise_rls_ok("tenantId"));

ALTER TABLE "indexed_chunks" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "indexed_chunks"
  USING (semwise_rls_ok("tenantId")) WITH CHECK (semwise_rls_ok("tenantId"));

-- At most one open draft (or one being published) per syllabus.
CREATE UNIQUE INDEX "syllabus_versions_one_open" ON "syllabus_versions" ("syllabusId") WHERE "status" IN ('DRAFT', 'PUBLISHING');
