# Handoff

Updated 2026-10-19, after backend phase A (features 0 to 9). Start a new session with the build prompt ([build-prompt.md](build-prompt.md)); it resumes from the checklist in [architecture.md](architecture.md) and this file.

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

## Next

**Web phase A** per [ui-ux.md](ui-ux.md), mobile first, in flow order: login, admin structure, invitations, syllabus review, CR entry (with voice and photo), approval queue, student chat and catch-up. Read `node_modules/next/dist/docs/` first (Next.js 16.4). Check each screen at 360, 768 and 1280 px, light and dark.

## Conventions and gotchas

- **Migrations:** change `schema.prisma`, then `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script > prisma/migrations/<timestamp>_<name>/migration.sql` (delete the "Loaded Prisma config" first line if it lands in the file), append the RLS policy for every new tenant table, `npx prisma migrate deploy`, then run the diff again to confirm it is empty. Composite foreign keys go in the schema (`@relation(fields: [xId, tenantId], references: [id, tenantId])`); a one-to-one one also needs `@@unique([xId, tenantId])`.
- `prisma migrate reset` is blocked for AI agents; avoid needing it. `20261018214529_structure_path_integrity` is an empty, harmless migration.
- The Bash tool mangles backslashes and turns `\n` inside patch scripts into real newlines: write source with the file tools, or check the result after a scripted patch.
- `pg` prints "Calling client.query() when the client is already executing a query" during tests. It comes from Prisma 7's query interpreter loading `include` relations in parallel on one transaction connection; `pg@8` queues them safely. Do not upgrade to `pg@9` until Prisma serializes these.
- Cross-module hooks are wired in `apps/api/src/wiring.ts`. Module dependencies run one way: chat → catchup → sessions → media → files/classes; nothing imports chat.
- Tests: `test/world.ts` (two colleges; `addTeacher`, `addStudent` with `{ cr: true }`, `addClass`), `test/fakes.ts` (`FakeStorage`, `FakeAi` with `respond(schemaName, ...)`, `transcript`, `failNext`, deterministic `vectorFor`, `makePdf`), `test/syllabus.ts` (`publishSyllabus`), `test/jobs.ts` (`drainQueue`). Jobs run in-process; real Redis and Qdrant are used.

## Open questions

- None blocking. Later improvements noted in the docs: quotas on the college's month, chat streaming, the Nepali beta test, and the photo-read quota (photos count toward the college budget only, not a per-CR limit).
