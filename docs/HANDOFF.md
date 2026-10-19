# Handoff

Written at the end of a long session (2026-10-19) so a fresh session can continue from the build checklist in [architecture.md](architecture.md). Start a new session with the same build prompt ([build-prompt.md](build-prompt.md)); it resumes from the checklist and this file.

## Done (backend, all committed on `main`)

| #   | Feature                                                                                             | Commit              |
| --- | --------------------------------------------------------------------------------------------------- | ------------------- |
| 0   | Scaffold: workspace, shared package, API + worker, local services, CI                               | `feat(scaffold)`    |
| 1   | Foundations: auth, tenants, users, memberships, authz matrix, audit, usage ledger, email queue, RLS | `feat(foundations)` |
| 2   | Tenant provisioning, invitations core, academic structure                                           | `feat(structure)`   |
| 3   | Student invites, CSV import, sections per semester, CR, teacher invites                             | `feat(enrollments)` |
| 4   | Classes (subject x section x teacher)                                                               | `feat(classes)`     |
| 5   | Files, AI layer, syllabus ingestion, knowledge index (Qdrant)                                       | `feat(syllabus)`    |
| 6   | Class entries, topic mapping, versions, approval workflow, reminders                                | `feat(sessions)`    |

`pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test` (180 tests) and `pnpm build` pass. Only step 0 was pushed; features 0 to 6 are local commits (push when you are ready).

## Next

1. **Feature 7: CR voice and photo input.** The pieces exist: `FileObject` kinds AUDIO and PHOTO with magic-byte checks, `POST /v1/files/uploads` with `classId` (FILE_UPLOAD_MEDIA, CR only), `AiProvider.transcribe` (multipart to `/audio/transcriptions`), `InputPart` image input, `EntryVersion.inputKind` and `mediaFileId`, and `sessionsService.create` already checks ENTRY_USE_MEDIA and that the file belongs to the class and the uploader. To add: `aiService.transcribe` (feature DICTATION, per-user quota `QUOTA_CR_DICTATIONS_PER_MONTH`, ledger in audio seconds) and `aiService.readPhoto` (feature PHOTO_READ, vision model, `dataBlock`-style instruction that the image is data). Add endpoints `POST /v1/classes/:id/transcriptions` and `/photo-readings` that run as AI-queue jobs and return text for the CR to edit before creating the entry. Raw audio is deleted right after transcription (`filesService.deleteNow`); photos get `deleteAfter` = published + 30 days, plus a maintenance job that deletes files past `deleteAfter`. Tests with `FakeAi.transcript`.
2. **Feature 8: student Q&A.** Add `Conversation` and `Message` (private: `PRIVATE_DATA_READ` / `CHAT_USE`, owner only, never admins). Router call (cheap model: language, rewritten query, subject guess, class IN_SYLLABUS / RELATED / UNRELATED, date-question detection); unrelated means a polite decline with no expensive call. Retrieval via `knowledgeService.search` with tenant + batch + semester (+ past semesters if the student opts in) + the student's section for class content + subject filter; **re-check every hit against Postgres** (syllabus topic in the live version; entry version is the entry's `currentVersionId` and not taken down) before use. Then the answer (Mini; escalate to Terra for complex or code questions), with citations (entry date and version, syllabus unit) and labels (from syllabus / reported in class / general explanation). Quota CHAT counted per request (`countsAsNewRequest: false` for follow-up calls in one request). Long histories summarized. Mark past answers "based on content later corrected" when a cited version is superseded.
3. **Feature 9: catch-up and date questions.** `sessionsService.liveForSections(scope, sectionIds, from, to)` already returns live entries with stored summaries. The catch-up endpoint makes no AI call; date questions use the router to turn the phrase into a range in the college timezone (`common/time.ts` has `todayIn`, `addDays`, `weekday`), then one cheap summarizing call.
4. **Web phase A** (after 9): screens in flow order per [ui-ux.md](ui-ux.md). Read `node_modules/next/dist/docs/` first; Next.js 16.4 is current.

## Conventions and gotchas learned this session

- **Migrations:** change `schema.prisma`, then generate SQL with `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script > prisma/migrations/<timestamp>_<name>/migration.sql` (because `migrate dev` refuses non-interactive runs), append the RLS policy for every new tenant table (`semwise_rls_ok("tenantId")`), `npx prisma migrate deploy`, then run the diff again to confirm "no drift". Model composite foreign keys in the schema (for example `@relation(fields: [programId, tenantId], references: [id, tenantId])`), or Prisma will try to drop them. Partial unique indexes can live in SQL only.
- `prisma migrate reset` is blocked when an AI agent runs it (it needs your consent); avoid needing it.
- `20261018214529_structure_path_integrity` is an empty migration left by an aborted `migrate dev`; it is harmless and already applied, so leave it.
- The Bash tool breaks on apostrophes inside heredocs and mangles backslashes in inline scripts; write source files with the file tools, and for patch scripts write a `.cjs` file to the scratchpad. The shell's working directory sometimes resets to the repo root: `cd` with an absolute path in each command (`npx prisma` at the root hangs on an install prompt).
- Cross-module hooks are wired in `apps/api/src/wiring.ts` (enrollment and teaching loaders for authz, the student accept handler, the syllabus gate for classes, the syllabus-published listener).
- Tests: `test/world.ts` (two colleges; `addTeacher`, `addStudent`, `addClass`), `test/fakes.ts` (`FakeStorage`, `FakeAi` with `respond(schemaName, ...)`, deterministic `vectorFor`, `makePdf`), `test/syllabus.ts` (`publishSyllabus`), `test/jobs.ts` (`drainQueue`). Jobs are run in-process; real Redis and Qdrant are used.

## Open questions for you

1. **MinIO** no longer publishes public Docker images; SeaweedFS's S3 gateway is used locally instead (docs updated). OK?
2. With no approval setting at all, entries **wait for the teacher** (auto-approval off). The docs do not say which default applies; I chose the safe one.
3. **One CR per section** is enforced; granting a second needs an explicit `replace`. Some colleges have two CRs per section. Should that be allowed?
4. When the Program Admin **locks** the approval setting, teachers can change the override in neither direction (the docs only say they cannot turn it on).
5. Monthly quotas and budgets reset on the **UTC** month, not the college's month.
6. Scanned syllabi are read by sending the **PDF itself** to the deep model (no local OCR tooling). This costs more per scan; confirm the model accepts PDF input when real keys are used.
7. No manual end-to-end run with real OpenAI yet. Everything is tested with mocks, SeaweedFS and Mailpit. A real check of extraction and organizing will need an `OPENAI_API_KEY` in `apps/api/.env`.
