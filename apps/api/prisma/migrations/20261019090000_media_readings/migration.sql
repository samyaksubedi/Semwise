-- CreateTable
CREATE TABLE "media_readings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "kind" "FileKind" NOT NULL,
    "status" "JobState" NOT NULL DEFAULT 'QUEUED',
    "text" TEXT,
    "error" TEXT,
    "seconds" INTEGER,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "media_readings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "media_readings_fileId_key" ON "media_readings"("fileId");

-- CreateIndex
CREATE INDEX "media_readings_tenantId_createdById_idx" ON "media_readings"("tenantId", "createdById");

-- CreateIndex
CREATE UNIQUE INDEX "media_readings_id_tenantId_key" ON "media_readings"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "media_readings_fileId_tenantId_key" ON "media_readings"("fileId", "tenantId");

-- AddForeignKey
ALTER TABLE "media_readings" ADD CONSTRAINT "media_readings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_readings" ADD CONSTRAINT "media_readings_classId_tenantId_fkey" FOREIGN KEY ("classId", "tenantId") REFERENCES "classes"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_readings" ADD CONSTRAINT "media_readings_fileId_tenantId_fkey" FOREIGN KEY ("fileId", "tenantId") REFERENCES "files"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;


-- Row-level security (second line of defence behind tenant-scoped queries).
ALTER TABLE "media_readings" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "media_readings"
  USING (semwise_rls_ok("tenantId")) WITH CHECK (semwise_rls_ok("tenantId"));
