# Data model (conceptual)

The PostgreSQL tables in conceptual terms; the exact definition is `apps/api/prisma/schema.prisma`. Field lists show the important columns, not every column. Product rules are in [Semwise_Project_Context.md](Semwise_Project_Context.md); permissions are in [permissions.md](permissions.md).

## Conventions

- IDs are `cuid` strings. Every table has `createdAt`; mutable tables have `updatedAt`.
- **Every tenant-owned table has `tenantId`** (indexed) and is filtered by it in every query. Postgres row-level security is enabled on these tables as a second line of defence (see Tenant isolation below).
- **Versioned content is immutable.** A change creates a new version row; a pointer on the parent says which version is live. Old versions are kept for history and never retrieved by the AI.
- **Topic identity:** syllabus topics carry a `stableKey` that survives new syllabus versions, so class entries, exam scope, notes, study cards and mastery keep pointing at the same topic when the syllabus is edited.
- Money and token counts are integers (cost in micro-dollars).
- Deleting academic data is rare; use `status` (ACTIVE, ARCHIVED) so history stays intact.

## Identity and access

| Table           | Key fields                                                                                                                                                                                                                    | Notes                                                                                                                                                      |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Tenant`        | name, slug, timezone, status, settings                                                                                                                                                                                        | One college                                                                                                                                                |
| `User`          | email (unique), passwordHash, displayName, status (INVITED, ACTIVE, DEACTIVATED), failedLoginCount, lockedUntil                                                                                                               | One account for every person; globally unique email                                                                                                        |
| `Session`       | userId, activeTenantId, tokenHash (unique), expiresAt, absoluteExpiresAt, revokedAt                                                                                                                                           | Same pattern as the blog; the active college is stored here                                                                                                |
| `Membership`    | userId, tenantId?, role, programId?, sectionId?, status, grantedBy                                                                                                                                                            | Role + scope; roles: SUPER_ADMIN, UNIVERSITY_ADMIN, PROGRAM_ADMIN, TEACHER, CR, STUDENT. SUPER_ADMIN is the only role with no tenant                       |
| `StudentRecord` | tenantId, programId, batchId, userId? (set on joining), email, displayName?, rollNo (stored uppercase; unique per tenant), status (INVITED, ACTIVE, DEACTIVATED), invitationId                                                | Created when the student is invited, so admins can place, correct and withdraw them before they join; unique (tenantId, email) and (tenantId, userId)      |
| `Invitation`    | tenantId, email, displayName?, rollNo?, role, programId?, batchId?, semesterId?, sectionId?, tokenHash, expiresAt (7 days), usedAt, revokedAt, invitedById, emailLogId (send status lives in EmailLog), sendCount, lastSentAt | Single-use, expiring, bound to the email. Re-inviting the same person, role and scope refreshes the open invite (new token) instead of adding a second one |
| `PasswordReset` | userId, tokenHash, expiresAt, usedAt                                                                                                                                                                                          | Single-use                                                                                                                                                 |

## Academic structure

| Table          | Key fields                                                                           | Constraints                                                                                                                                                                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Program`      | tenantId, name, code, status                                                         | unique (tenantId, code)                                                                                                                                                                                                                                             |
| `Batch`        | programId, name, intakeYear, status                                                  | unique (programId, name)                                                                                                                                                                                                                                            |
| `Semester`     | batchId, number, startDate?, endDate?, status (UPCOMING, ACTIVE, COMPLETED)          | **Belongs to one batch** (no shared semester definitions); unique (batchId, number); at most one ACTIVE per batch (partial unique index); activating one completes the previous                                                                                     |
| `Section`      | semesterId, name                                                                     | Sections are per semester; names can repeat across semesters                                                                                                                                                                                                        |
| `Subject`      | semesterId, name, code, credits?                                                     | Per batch semester, because each batch has its own syllabus                                                                                                                                                                                                         |
| `Enrollment`   | studentRecordId, programId, batchId, semesterId, sectionId, status (ACTIVE, REMOVED) | unique (studentRecordId, semesterId); a move inside a semester updates the row (the audit log keeps the move), a new semester adds a row, so the rows are the section history; composite keys keep the section inside the semester and the student inside the batch |
| `Class`        | programId, batchId, semesterId, subjectId, sectionId, status (ACTIVE, ARCHIVED)      | unique (subjectId, sectionId); composite keys keep subject and section in the same semester; needs a published syllabus                                                                                                                                             |
| `ClassTeacher` | classId, userId, isPrimary                                                           | Teacher assignment; the user must hold TEACHER in the college; the first assigned is primary                                                                                                                                                                        |

Children repeat their path (programId, batchId, semesterId, tenantId). Composite foreign keys over those columns make the database refuse a row whose parent is in another college or whose path disagrees with its parent's. Memberships and invitations reference programs and sections through (id, tenantId) in the same way.

## Files

`FileObject`: tenantId, storageKey (`tenants/<tenantId>/<area>/<id>`), mime, size, kind (SYLLABUS_PDF, AUDIO, PHOTO), the path it belongs to (programId, batchId, semesterId, subjectId, sectionId, classId) for download checks, uploadedBy, status (PENDING, READY, DELETED), deleteAfter.

`MediaReading` (feature 7): tenantId, classId, fileId (unique), kind (AUDIO, PHOTO), status (job state), text, error, seconds (voice length), createdById. Private to its uploader; the CR edits the text before it becomes an entry.

`SyllabusPage`: versionId, pageNo, text (the extracted text of each PDF page, shown as the source next to an item).

## Syllabus

| Table                   | Key fields                                                                                                                                                                                                                                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Syllabus`              | programId, batchId, semesterId, subjectId? (empty while an imported PDF waits for the admin to confirm the suggested subject), currentVersionId (the live version)                                                                                                                                                       |
| `SyllabusVersion`       | syllabusId, versionNo, status (DRAFT, PUBLISHING, PUBLISHED, SUPERSEDED), sourceFileId, copiedFromVersionId, effectiveFrom, extraction (QUEUED, RUNNING, DONE, FAILED), extractionError, usedOcr, suggestedName/Code, credits, references (json), publishedBy, publishedAt; at most one DRAFT or PUBLISHING per syllabus |
| `SyllabusTopic`         | versionId, parentId, stableKey (kept for matching titles in a new version of the same subject; new keys for a copy to another batch), kind (UNIT, TOPIC, SUBTOPIC), title, description, hours, orderIndex, sourcePage, confidence (0-100; below 60 is highlighted)                                                       |
| `SyllabusChangeRequest` | versionId, requestText, proposedOps (json: each op with before/after and its decision), note (what the AI could not map), status (PROPOSED, ACCEPTED, PARTIAL, REJECTED), decidedBy, decidedAt                                                                                                                           |

## Class content

| Table             | Key fields                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ClassSession`    | classId, **taughtOn (date)**, createdBy                                                                                                                                                                                                                                                                                                                                                                                                | One per class and day (unique classId, taughtOn) |
| `Entry`           | sessionId, the class path (classId, programId, batchId, semesterId, sectionId, subjectId), taughtOn, authorId, currentVersionId (live), takenDownAt/By                                                                                                                                                                                                                                                                                 |
| `EntryVersion`    | entryId, versionNo, status (DRAFT, PENDING, APPROVED = being indexed, PUBLISHED, REJECTED, WITHDRAWN, SUPERSEDED), inputKind (TEXT, VOICE, PHOTO), mediaFileId, rawText, structured (json topics with stable keys), summary, organize (job state) and organizeError, syllabusVersionId, mappingStale, authorId, minorEdit, submittedAt, approvedBy, decidedAt, rejectionReason, unreviewed, reminderCount, lastReminderAt, escalatedAt |
| `EntryTopic`      | entryVersionId, topicStableKey, confidence                                                                                                                                                                                                                                                                                                                                                                                             |
| `ApprovalSetting` | tenantId, programId, classId? (null = the program default; one per program), autoApprove, locked, unreviewedPublishAfterDays?                                                                                                                                                                                                                                                                                                          |

Resolution of auto-approval: a class setting overrides the program default, unless the program setting is locked.

## Knowledge index

`IndexedChunk`: tenantId, sourceType (SYLLABUS_TOPIC, ENTRY_VERSION, NOTE), sourceId, sourceVersionId, ownerId? (for private notes), qdrantPointId, embeddingModel, embeddingVersion, status (LIVE, DELETED). It maps Postgres records to Qdrant points so superseded vectors can always be found and deleted.

## Chat (private to the student)

| Table          | Key fields                                                                                                      |
| -------------- | --------------------------------------------------------------------------------------------------------------- |
| `Conversation` | tenantId, userId, title, pinnedSubjectId?, includePast, summary, summarizedCount                                |
| `Message`      | conversationId, role, content, scope, language, citations (json), labels (json), model, requestId (ledger rows) |

## V2 tables

Notes, exams and exam scope, study plans, study cards, questions, attempts and mastery are planned in [roadmap-v2.md](roadmap-v2.md). Each table moves here when its feature is built.

## Operations

| Table        | Key fields                                                                                                                                                                                                                                                 |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AiUsage`    | tenantId, userId, feature, task (route, answer, embed ...), model, inputTokens, outputTokens, cachedTokens, audioSeconds, costMicros, priceId (the PriceTable row used), requestId (groups the calls of one user action; quotas count distinct requestIds) |
| `PriceTable` | model, unit (TOKENS, MINUTES), inputPer1M, outputPer1M, cachedPer1M, perMinute (micro-dollars), effectiveFrom; seeded by the first migration                                                                                                               |
| `Quota`      | tenantId? (null = platform default), scope (USER, TENANT), feature, limit; period is the calendar month (UTC; later: the college's month in its timezone); without a row the environment defaults apply                                                    |
| `TenantPlan` | tenantId, plan, monthlyAiBudget, limits                                                                                                                                                                                                                    |
| `AuditLog`   | tenantId? (null for platform actions), programId? (so a Program Admin can read their program's trail), actorId, action, entityType, entityId, before/after (json), ip, requestId                                                                           |
| `EmailLog`   | tenantId? (null for password resets), template, toHash, status (QUEUED, SENT, FAILED), messageId, attempts, error, sentAt (no email bodies or plain addresses)                                                                                             |

## Tenant isolation

As built (feature 1): every repository runs its queries through `withTenant(tenantId, ...)`, a transaction that first runs `set_config('app.tenant_id', ...)`, and also puts `tenantId` in every `where`. The policies use `semwise_rls_ok(tenantId)`. The API, worker and tests connect as `semwise_app` (no superuser, no BYPASSRLS); migrations run as the owner. A few cross-tenant lookups (login, the college switcher, Super Admin platform work, password-reset email) use `withSystem`, which sets `app.bypass_rls`. Every tenant table also has `FORCE ROW LEVEL SECURITY` (since the hardening pass), so the policies bind the table owner too unless it is a superuser; `src/common/db/rls-coverage.test.ts` fails if a table with a `tenantId` column lacks ENABLE, FORCE or a policy. The API and the worker check their own role at startup and refuse to start as a superuser or a BYPASSRLS role. Users, sessions, password resets and prices are global tables without RLS. Every tenant-owned table has its own `tenantId` column (denormalised on child tables such as Batch and Semester), so RLS and scoping never need a join.

1. Every repository function takes a scope object and puts `tenantId` in the query.
2. Row-level security policies on all tenant tables compare `tenantId` with a per-transaction database setting (`withTenant`). The application connects with a role that cannot bypass them.
3. Qdrant queries always carry the tenant filter, and private-note queries also filter by owner.
4. A shared isolation test suite proves that no module returns another tenant's, section's or student's data.
5. RLS is a second layer only: steps 1, 3 and 4 stay mandatory and RLS never replaces them.
