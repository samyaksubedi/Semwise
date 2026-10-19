-- Row-level security also applies to the table owner. The app role (semwise_app) never owned the
-- tables, so nothing changes for the API; this closes the gap for anything that connects as the
-- owner without being a superuser (superusers and BYPASSRLS roles still skip RLS: the API and the
-- worker refuse to start as one). Every new tenant table needs ENABLE, FORCE and a policy; the
-- test in src/common/db/rls-coverage.test.ts fails otherwise.
ALTER TABLE "tenants" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ai_usage" FORCE ROW LEVEL SECURITY;
ALTER TABLE "approval_settings" FORCE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" FORCE ROW LEVEL SECURITY;
ALTER TABLE "batches" FORCE ROW LEVEL SECURITY;
ALTER TABLE "class_sessions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "class_teachers" FORCE ROW LEVEL SECURITY;
ALTER TABLE "classes" FORCE ROW LEVEL SECURITY;
ALTER TABLE "conversations" FORCE ROW LEVEL SECURITY;
ALTER TABLE "email_logs" FORCE ROW LEVEL SECURITY;
ALTER TABLE "enrollments" FORCE ROW LEVEL SECURITY;
ALTER TABLE "entries" FORCE ROW LEVEL SECURITY;
ALTER TABLE "entry_topics" FORCE ROW LEVEL SECURITY;
ALTER TABLE "entry_versions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "files" FORCE ROW LEVEL SECURITY;
ALTER TABLE "indexed_chunks" FORCE ROW LEVEL SECURITY;
ALTER TABLE "invitations" FORCE ROW LEVEL SECURITY;
ALTER TABLE "media_readings" FORCE ROW LEVEL SECURITY;
ALTER TABLE "memberships" FORCE ROW LEVEL SECURITY;
ALTER TABLE "messages" FORCE ROW LEVEL SECURITY;
ALTER TABLE "programs" FORCE ROW LEVEL SECURITY;
ALTER TABLE "quotas" FORCE ROW LEVEL SECURITY;
ALTER TABLE "sections" FORCE ROW LEVEL SECURITY;
ALTER TABLE "semesters" FORCE ROW LEVEL SECURITY;
ALTER TABLE "student_records" FORCE ROW LEVEL SECURITY;
ALTER TABLE "subjects" FORCE ROW LEVEL SECURITY;
ALTER TABLE "syllabi" FORCE ROW LEVEL SECURITY;
ALTER TABLE "syllabus_change_requests" FORCE ROW LEVEL SECURITY;
ALTER TABLE "syllabus_pages" FORCE ROW LEVEL SECURITY;
ALTER TABLE "syllabus_topics" FORCE ROW LEVEL SECURITY;
ALTER TABLE "syllabus_versions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "tenant_plans" FORCE ROW LEVEL SECURITY;
