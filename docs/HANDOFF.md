# Handoff

Updated 2026-10-19, after backend phase A (features 0 to 9), web phase A and the V1 hardening pass. Start a new session with the build prompt ([build-prompt.md](build-prompt.md)); it resumes from the checklist in [architecture.md](architecture.md) and this file.

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
| -   | Real-API smoke script, scan page cap, up to three CRs per section, decisions recorded               | `feat(ai)`          |
| 7   | CR voice transcription and photo reading, media retention                                           | `feat(media)`       |
| 8   | Student Q&A: router, re-checked retrieval, citations, labels, summaries                             | `feat(chat)`        |
| 9   | Catch-up view and date questions in chat                                                            | `feat(catchup)`     |

`pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test` (212 API tests, 4 shared) and `pnpm build` pass. Only step 0 was pushed; the rest are local commits (push when you are ready).

## Real AI check

`pnpm --filter @semwise/api smoke:ai` runs the whole loop against the real OpenAI API for about $0.02 (see [local-setup.md](local-setup.md)). It does nothing without `OPENAI_API_KEY`. Runs on 2026-10-19 found and fixed:

- `gpt-transcribe` refuses `response_format: verbose_json`; it now uses `json` and reads `usage.seconds` (or tokens for token-billed models).
- The transcription API reads the format from the file name: `dictation.mpeg` was refused, so audio types map to proper extensions.
- Unit titles carried the printed "Unit 1:" label, which doubled up in the index ("Unit 1: Unit 1: ..."); the prompt and the import now drop it.
- The chat answer presented general explanation as "what the class covered"; the prompt now requires a "General explanation:" section and [S1] markers.

Confirmed working: all six configured model names, strict JSON output, PDF file input (scanned path), image input, embeddings, and the price rows for every model.

## Decisions taken on the open questions (recorded in the docs)

1. SeaweedFS is the local R2 stand-in.
2. No approval setting means entries wait for the teacher.
3. Up to 3 CRs per section (`MAX_CRS_PER_SECTION` in shared); beyond that the admin names the CR to replace (`replaceStudentId`). Removal is per student: `DELETE /v1/sections/:id/cr/:studentId`.
4. A locked approval setting blocks teacher overrides in both directions.
5. Quotas reset on the UTC month (later improvement: the college's month).
6. Scanned PDFs go to the model as a file, capped at 60 pages (`AI_SCAN_MAX_PAGES`), metered like every call.
7. A real `OPENAI_API_KEY` is in `apps/api/.env` (git-ignored; never print, log or commit it).
8. (New) Chat answers are produced inside the request, not as a job; streaming is a later improvement.

## Web phase A (done; see "Not verified" below)

| Checkpoint                                                              | Commit                                                                                |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| (a) Shell, tokens, UI kit, sign-in, invites, password reset, profile    | `feat(web): shell, design tokens, UI kit, sign-in and profile`                        |
| (b) Admin overview, structure, students and teachers, classes, settings | `feat(web): admin overview, structure, students, classes and settings`                |
| (c) Admin syllabus review                                               | `feat(web): admin syllabus review`                                                    |
| (d) CR Today, My entries, teacher approvals and My classes              | `feat(web): CR entry with voice and photo, my entries, teacher approvals and classes` |
| (e) Student chat and catch-up                                           | `feat(web): student chat and catch-up`                                                |
| Fixes from the screenshot check                                         | `fix(web): issues found in the screenshot check`                                      |

Patterns borrowed (looked up before each checkpoint): per-change accept/reject with before/after and accept all (AI UX Playground, Revise); approvals with fixed approve/reject buttons, no confirm on approve, an inline one-line reject reason, and bulk kept behind an explicit Select mode (FinalApproval); record then edit the transcript (Apple Notes); source chips beside the claim with meaningful labels and a plain disclaimer near the input (NN/g on explainable AI); 2 to 4 suggestion chips that fill the box (AI UX Playground); a swipeable recent-days strip (Material date pickers).

### Verified, and how (2026-10-19)

- `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm build` pass; `pnpm test`: 212 API, 15 web, 4 shared tests.
- Screenshots against production builds (compiled API, `next start`) with the demo college (`seed:demo`): 19 pages for 5 roles (University Admin, Program Admin, CR, teacher, student) at 360, 768 and 1280 px in light and dark, 120 images. No sideways scroll at 360 px and no page errors. I looked at a sample of the images (mostly 360 px, some 768 and 1280, both themes), not every one.
- Interactions in a real headless browser at 360 px: the CR flow end to end (a board photo uploaded through the signed URL to local storage, read by the vision model, the text edited, organized by the worker, the "replace or add" prompt, sent, the status chip); teacher approvals with the count badge and the inline reject reason; the chat source sheet; a student's action sheet; the CSV import preview with per-row errors. One real chat question was asked through the API and its answer (labels, [S1] chips, general explanation) renders correctly.
- Fixed from the check: the college timezone showed "Africa/Abidjan" (browsers list Asia/Kathmandu as Asia/Katmandu, so the stored value was not an option); a teacher's class entries were oldest first; CR-facing copy after sending showed the teacher's text; destructive buttons were not red; the draft header did not name the subject; a cut-off search placeholder; a wrapping "Photo of the board" button.

### Not verified (known gaps; status after the hardening pass)

- **Microphone recording** is still untested in a real browser (headless has no microphone). The transcription path itself was checked through the API with the smoke script.
- Rendered but still not exercised in a browser (each calls an API with its own tests): moving and deactivating students, CSV import, inviting teachers and program admins, creating classes and changing teachers, saving settings, teacher "add an entry", the chat subject picker, deleting a chat, the quota meter. The other flows listed here before are now covered by the Playwright tests (see "V1 hardening").
- The invite progress card shows "0 of 3 sent" for the seeded invites: the seed creates invites without the email log the counts read. Real invites are counted.
- Done since: the keyboard run, the Super Admin colleges page, and committed browser tests.

Web conventions: client components fetch with TanStack Query (`features/admin/queries.ts`, `features/entries/shared.tsx` hold keys); forms in sheets use `FormSheet`; field errors come from `ApiError.field(path)`; every user-facing string is in `src/lib/strings.ts`; show the API's own message for 409s (it is already specific); uploads go through `lib/upload.ts`. To check screens on a low-memory machine, see local-setup.md ("Screenshots").

## V1 hardening (2026-10-19, all committed on `main`)

| #   | Item                                                                                                                                                                                                                                | Commit                                      |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| 1   | Startup role check (API and worker refuse a superuser or BYPASSRLS role); FORCE ROW LEVEL SECURITY on all 32 tenant tables; a test that fails on a tenant table without ENABLE, FORCE or a policy                                   | `feat(db)`                                  |
| 2   | Super Admin colleges page: list (name, slug, status, admin count, pending invites, "no college content" note), create with a grouped timezone list, suspend and reactivate with confirmation, invite a replacement University Admin | `feat(web): Super Admin colleges page`      |
| 3   | Playwright browser tests (`pnpm e2e`) with a fake OpenAI server, and fixes for the bugs they found                                                                                                                                  | `test(web)`                                 |
| 4   | Keyboard and screen-reader pass, fixes recorded in ui-ux.md                                                                                                                                                                         | `fix(web): keyboard and screen reader pass` |
| 5   | Dockerfiles (API, which the worker shares, and web), `infra/docker-compose.prod.yml` for Coolify, `scripts/db-backup.mjs`, [deploy.md](deploy.md)                                                                                   | `feat(deploy)`                              |

Bugs found and fixed along the way: confirming a sheet opened on top of another (suspend a college, deactivate a student) closed both; every sheet shared one title id, so dialogs had the wrong accessible name; a withdrawn change still showed as "Newer version"; closing a sheet that unmounts (the chat source) lost keyboard focus; the first chat answer was never announced to screen readers; spoken names ran words together ("History of CTopic", "1 waitingApprovals"); the photo button had no visible focus; the CR "Replace" buttons were all just "Replace"; the college timezone list mixed old and new zone names.

### Verified, and how

- `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm build` pass; `pnpm test`: 219 API, 19 web, 4 shared tests (real Postgres, Redis and Qdrant in Docker; OpenAI, R2 and email mocked).
- `pnpm e2e`: 7 Playwright tests pass (about 30 s, after about a minute of seeding and server start) against the compiled API and worker and `next start`, with the demo college reseeded and the AI answered by the fake server. Passed three runs in a row after the last fixes.
- Role check: a test starts `src/server.ts` and `src/worker.ts` with the owner (superuser) URL and expects exit code 1 and the message. Migrations were also applied as a non-superuser owner in a scratch database, where FORCE blocked that owner's writes without the bypass setting (then dropped).
- Super Admin page: screenshots at 360, 768 and 1280 px in light and dark against production builds; no sideways scroll at 360 px.
- Keyboard: a scripted Tab, Enter, Escape and arrow-key run through sign-in, chat, CR entry, approvals and the syllabus review, recording focus order, names, focus rings, dialog focus and live regions (details in ui-ux.md, "Keyboard pass").
- Deployment: both images built; the API image ran against the local services (migrations, ready check, worker start, refusal of the owner role); the whole production compose stack started locally with throwaway secrets (fresh volume, init script, health checks, Redis AOF and noeviction, Qdrant key required) and was removed with its volumes; a backup of the development database restored into a scratch database with equal row counts, forced RLS and the app role's grants.

### Not verified

- Microphone recording on real phones (Android Chrome, iOS Safari).
- A real screen reader (NVDA, VoiceOver, TalkBack); colour contrast measured with a tool.
- Coolify itself: the compose file was run with plain Docker Compose, not inside Coolify. In particular the bind mount of `infra/postgres-init-prod.sh` (deploy.md has the manual SQL if it does not run), domains, TLS and Coolify's environment UI.
- Real R2, Gmail and OpenAI in production. The browser tests use a fake OpenAI server; the real API was last checked with `smoke:ai` before this pass.
- Nothing was deployed and nothing was pushed.

### Next

1. By hand: the microphone on real phones; `pnpm test` on your machine (real Qdrant in Docker); `pnpm e2e` once.
2. Deploy to a pilot (deploy.md), set up daily backups off the VPS, and test one restore.
3. Backend phase B (features 10 to 16), each followed by its screens.

## Conventions and gotchas

- **Migrations:** change `schema.prisma`, then `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script > prisma/migrations/<timestamp>_<name>/migration.sql` (delete the "Loaded Prisma config" first line if it lands in the file), append `ENABLE ROW LEVEL SECURITY`, `FORCE ROW LEVEL SECURITY` and the `tenant_isolation` policy for every new tenant table (`rls-coverage.test.ts` fails otherwise), `npx prisma migrate deploy`, then run the diff again to confirm it is empty. Composite foreign keys go in the schema (`@relation(fields: [xId, tenantId], references: [id, tenantId])`); a one-to-one one also needs `@@unique([xId, tenantId])`.
- `prisma migrate reset` is blocked for AI agents; avoid needing it. `20261018214529_structure_path_integrity` is an empty, harmless migration.
- The Bash tool mangles backslashes and turns `\n` inside patch scripts into real newlines: write source with the file tools, or check the result after a scripted patch.
- `pg` prints "Calling client.query() when the client is already executing a query" during tests. It comes from Prisma 7's query interpreter loading `include` relations in parallel on one transaction connection; `pg@8` queues them safely. Do not upgrade to `pg@9` until Prisma serializes these.
- Cross-module hooks are wired in `apps/api/src/wiring.ts`. Module dependencies run one way: chat → catchup → sessions → media → files/classes; nothing imports chat.
- Browser tests: `apps/web/e2e`. `pnpm e2e` needs ports 3000, 4000 and 4010 free (stop dev servers) and **resets the demo college in the development database**. The fake OpenAI server is in `e2e/support/fake-openai.ts`: a new AI schema name needs a fake answer there. The real `OPENAI_API_KEY` is dropped from the e2e environment.
- Next.js builds a standalone server only with `NEXT_OUTPUT_STANDALONE=1` (the web Dockerfile sets it); locally `next start` is used.
- Tests: `test/world.ts` (two colleges; `addTeacher`, `addStudent` with `{ cr: true }`, `addClass`), `test/fakes.ts` (`FakeStorage`, `FakeAi` with `respond(schemaName, ...)`, `transcript`, `failNext`, deterministic `vectorFor`, `makePdf`), `test/syllabus.ts` (`publishSyllabus`), `test/jobs.ts` (`drainQueue`). Jobs run in-process; real Redis and Qdrant are used.

## Open questions

- Doc and code disagree (left as is): `EntryView.latest` is documented in `packages/shared/src/schemas/entries.ts` as "a newer draft, pending or rejected version", but the API also returns a withdrawn version there, and an API test expects it. The web app now hides a withdrawn `latest`. Decide whether the API should drop it (then change the test) or the comment should list WITHDRAWN.
- None blocking. Later improvements noted in the docs: quotas on the college's month, chat streaming, the Nepali beta test, and the photo-read quota (photos count toward the college budget only, not a per-CR limit).
