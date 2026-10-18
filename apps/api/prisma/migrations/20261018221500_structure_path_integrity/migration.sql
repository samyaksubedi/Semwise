-- DropForeignKey
ALTER TABLE "batches" DROP CONSTRAINT "batches_programId_fkey";

-- DropForeignKey
ALTER TABLE "invitations" DROP CONSTRAINT "invitations_programId_fkey";

-- DropForeignKey
ALTER TABLE "invitations" DROP CONSTRAINT "invitations_sectionId_fkey";

-- DropForeignKey
ALTER TABLE "memberships" DROP CONSTRAINT "memberships_programId_fkey";

-- DropForeignKey
ALTER TABLE "memberships" DROP CONSTRAINT "memberships_sectionId_fkey";

-- DropForeignKey
ALTER TABLE "sections" DROP CONSTRAINT "sections_batchId_fkey";

-- DropForeignKey
ALTER TABLE "sections" DROP CONSTRAINT "sections_programId_fkey";

-- DropForeignKey
ALTER TABLE "sections" DROP CONSTRAINT "sections_semesterId_fkey";

-- DropForeignKey
ALTER TABLE "semesters" DROP CONSTRAINT "semesters_batchId_fkey";

-- DropForeignKey
ALTER TABLE "semesters" DROP CONSTRAINT "semesters_programId_fkey";

-- DropForeignKey
ALTER TABLE "subjects" DROP CONSTRAINT "subjects_batchId_fkey";

-- DropForeignKey
ALTER TABLE "subjects" DROP CONSTRAINT "subjects_programId_fkey";

-- DropForeignKey
ALTER TABLE "subjects" DROP CONSTRAINT "subjects_semesterId_fkey";

-- CreateIndex
CREATE UNIQUE INDEX "batches_id_programId_tenantId_key" ON "batches"("id", "programId", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "programs_id_tenantId_key" ON "programs"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "sections_id_tenantId_key" ON "sections"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "semesters_id_batchId_programId_tenantId_key" ON "semesters"("id", "batchId", "programId", "tenantId");

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_programId_tenantId_fkey" FOREIGN KEY ("programId", "tenantId") REFERENCES "programs"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_sectionId_tenantId_fkey" FOREIGN KEY ("sectionId", "tenantId") REFERENCES "sections"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_programId_tenantId_fkey" FOREIGN KEY ("programId", "tenantId") REFERENCES "programs"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "semesters" ADD CONSTRAINT "semesters_programId_tenantId_fkey" FOREIGN KEY ("programId", "tenantId") REFERENCES "programs"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "semesters" ADD CONSTRAINT "semesters_batchId_programId_tenantId_fkey" FOREIGN KEY ("batchId", "programId", "tenantId") REFERENCES "batches"("id", "programId", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sections" ADD CONSTRAINT "sections_programId_tenantId_fkey" FOREIGN KEY ("programId", "tenantId") REFERENCES "programs"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sections" ADD CONSTRAINT "sections_batchId_programId_tenantId_fkey" FOREIGN KEY ("batchId", "programId", "tenantId") REFERENCES "batches"("id", "programId", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sections" ADD CONSTRAINT "sections_semesterId_batchId_programId_tenantId_fkey" FOREIGN KEY ("semesterId", "batchId", "programId", "tenantId") REFERENCES "semesters"("id", "batchId", "programId", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_programId_tenantId_fkey" FOREIGN KEY ("programId", "tenantId") REFERENCES "programs"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_batchId_programId_tenantId_fkey" FOREIGN KEY ("batchId", "programId", "tenantId") REFERENCES "batches"("id", "programId", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_semesterId_batchId_programId_tenantId_fkey" FOREIGN KEY ("semesterId", "batchId", "programId", "tenantId") REFERENCES "semesters"("id", "batchId", "programId", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_programId_tenantId_fkey" FOREIGN KEY ("programId", "tenantId") REFERENCES "programs"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_sectionId_tenantId_fkey" FOREIGN KEY ("sectionId", "tenantId") REFERENCES "sections"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

