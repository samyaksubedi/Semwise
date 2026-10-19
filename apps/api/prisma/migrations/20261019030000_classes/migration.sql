-- CreateTable
CREATE TABLE "classes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "semesterId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "status" "StructureStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "classes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_teachers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "class_teachers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "classes_tenantId_semesterId_idx" ON "classes"("tenantId", "semesterId");

-- CreateIndex
CREATE INDEX "classes_tenantId_sectionId_idx" ON "classes"("tenantId", "sectionId");

-- CreateIndex
CREATE UNIQUE INDEX "classes_subjectId_sectionId_key" ON "classes"("subjectId", "sectionId");

-- CreateIndex
CREATE UNIQUE INDEX "classes_id_tenantId_key" ON "classes"("id", "tenantId");

-- CreateIndex
CREATE INDEX "class_teachers_tenantId_userId_idx" ON "class_teachers"("tenantId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "class_teachers_classId_userId_key" ON "class_teachers"("classId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "subjects_id_semesterId_batchId_programId_tenantId_key" ON "subjects"("id", "semesterId", "batchId", "programId", "tenantId");

-- AddForeignKey
ALTER TABLE "classes" ADD CONSTRAINT "classes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classes" ADD CONSTRAINT "classes_programId_tenantId_fkey" FOREIGN KEY ("programId", "tenantId") REFERENCES "programs"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classes" ADD CONSTRAINT "classes_batchId_programId_tenantId_fkey" FOREIGN KEY ("batchId", "programId", "tenantId") REFERENCES "batches"("id", "programId", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classes" ADD CONSTRAINT "classes_semesterId_batchId_programId_tenantId_fkey" FOREIGN KEY ("semesterId", "batchId", "programId", "tenantId") REFERENCES "semesters"("id", "batchId", "programId", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classes" ADD CONSTRAINT "classes_subjectId_semesterId_batchId_programId_tenantId_fkey" FOREIGN KEY ("subjectId", "semesterId", "batchId", "programId", "tenantId") REFERENCES "subjects"("id", "semesterId", "batchId", "programId", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classes" ADD CONSTRAINT "classes_sectionId_semesterId_batchId_programId_tenantId_fkey" FOREIGN KEY ("sectionId", "semesterId", "batchId", "programId", "tenantId") REFERENCES "sections"("id", "semesterId", "batchId", "programId", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_teachers" ADD CONSTRAINT "class_teachers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_teachers" ADD CONSTRAINT "class_teachers_classId_tenantId_fkey" FOREIGN KEY ("classId", "tenantId") REFERENCES "classes"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_teachers" ADD CONSTRAINT "class_teachers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------- Row-level security ----------
ALTER TABLE "classes" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "classes"
  USING (semwise_rls_ok("tenantId")) WITH CHECK (semwise_rls_ok("tenantId"));

ALTER TABLE "class_teachers" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "class_teachers"
  USING (semwise_rls_ok("tenantId")) WITH CHECK (semwise_rls_ok("tenantId"));
