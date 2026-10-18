-- CreateEnum
CREATE TYPE "StudentStatus" AS ENUM ('INVITED', 'ACTIVE', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('ACTIVE', 'REMOVED');

-- CreateTable
CREATE TABLE "student_records" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "userId" TEXT,
    "email" TEXT NOT NULL,
    "displayName" TEXT,
    "rollNo" TEXT NOT NULL,
    "status" "StudentStatus" NOT NULL DEFAULT 'INVITED',
    "invitationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrollments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "semesterId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "studentRecordId" TEXT NOT NULL,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "student_records_invitationId_key" ON "student_records"("invitationId");

-- CreateIndex
CREATE INDEX "student_records_tenantId_batchId_status_idx" ON "student_records"("tenantId", "batchId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "student_records_tenantId_rollNo_key" ON "student_records"("tenantId", "rollNo");

-- CreateIndex
CREATE UNIQUE INDEX "student_records_tenantId_email_key" ON "student_records"("tenantId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "student_records_tenantId_userId_key" ON "student_records"("tenantId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "student_records_id_batchId_tenantId_key" ON "student_records"("id", "batchId", "tenantId");

-- CreateIndex
CREATE INDEX "enrollments_tenantId_semesterId_sectionId_status_idx" ON "enrollments"("tenantId", "semesterId", "sectionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "enrollments_studentRecordId_semesterId_key" ON "enrollments"("studentRecordId", "semesterId");

-- CreateIndex
CREATE UNIQUE INDEX "sections_id_semesterId_batchId_programId_tenantId_key" ON "sections"("id", "semesterId", "batchId", "programId", "tenantId");

-- AddForeignKey
ALTER TABLE "student_records" ADD CONSTRAINT "student_records_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_records" ADD CONSTRAINT "student_records_programId_tenantId_fkey" FOREIGN KEY ("programId", "tenantId") REFERENCES "programs"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_records" ADD CONSTRAINT "student_records_batchId_programId_tenantId_fkey" FOREIGN KEY ("batchId", "programId", "tenantId") REFERENCES "batches"("id", "programId", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_records" ADD CONSTRAINT "student_records_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_programId_tenantId_fkey" FOREIGN KEY ("programId", "tenantId") REFERENCES "programs"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_batchId_programId_tenantId_fkey" FOREIGN KEY ("batchId", "programId", "tenantId") REFERENCES "batches"("id", "programId", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_semesterId_batchId_programId_tenantId_fkey" FOREIGN KEY ("semesterId", "batchId", "programId", "tenantId") REFERENCES "semesters"("id", "batchId", "programId", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_sectionId_semesterId_batchId_programId_tenantI_fkey" FOREIGN KEY ("sectionId", "semesterId", "batchId", "programId", "tenantId") REFERENCES "sections"("id", "semesterId", "batchId", "programId", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_studentRecordId_batchId_tenantId_fkey" FOREIGN KEY ("studentRecordId", "batchId", "tenantId") REFERENCES "student_records"("id", "batchId", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------- Row-level security ----------
ALTER TABLE "student_records" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "student_records"
  USING (semwise_rls_ok("tenantId")) WITH CHECK (semwise_rls_ok("tenantId"));

ALTER TABLE "enrollments" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "enrollments"
  USING (semwise_rls_ok("tenantId")) WITH CHECK (semwise_rls_ok("tenantId"));
