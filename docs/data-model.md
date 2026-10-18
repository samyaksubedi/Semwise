# Data model (conceptual)

The planned PostgreSQL tables, in Prisma terms, before the real `schema.prisma` is written. Field lists show the important columns, not every column. Product rules are in [Semwise_Project_Context.md](Semwise_Project_Context.md); permissions are in [permissions.md](permissions.md).

## Conventions

- IDs are `cuid` strings. Every table has `createdAt`; mutable tables have `updatedAt`.
- **Every tenant-owned table has `tenantId`** (indexed) and is filtered by it in every query. Postgres row-level security is enabled on these tables as a second line of defence (see Tenant isolation below).
- **Versioned content is immutable.** A change creates a new version row; a pointer on the parent says which version is live. Old versions are kept for history and never retrieved by the AI.
- **Topic identity:** syllabus topics carry a `stableKey` that survives new syllabus versions, so class entries, exam scope, notes, study cards and mastery keep pointing at the same topic when the syllabus is edited.
- Money and token counts are integers (cost in micro-dollars).
- Deleting academic data is rare; use `status` (ACTIVE, ARCHIVED) so history stays intact.

## Identity and access

| Table             | Key fields                                                                                                   | Notes                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `Tenant`          | name, slug, timezone, status, settings                                                                       | One college                                                      |
| `User`            | email (unique), passwordHash, displayName, status (INVITED, ACTIVE, DEACTIVATED), failedLoginCount, lockedUntil | One account for every person; globally unique email           |
| `Session`         | userId, activeTenantId, tokenHash (unique), expiresAt, absoluteExpiresAt, revokedAt                          | Same pattern as the blog; the active college is stored here      |
| `Membership`      | userId, tenantId, role, programId?, sectionId?, status, grantedBy                                            | Role + scope; roles: SUPER_ADMIN, UNIVERSITY_ADMIN, PROGRAM_ADMIN, TEACHER, CR, STUDENT |
| `StudentRecord`   | userId, tenantId, rollNo (unique per tenant), status                                                         | A person's student identity in one college                       |
| `Invitation`      | tenantId, email, rollNo?, roleIntent, scope, tokenHash, expiresAt, usedAt, revokedAt, sendStatus, sentAt     | Single-use, expiring, bound to the email                          |
| `PasswordReset`   | userId, tokenHash, expiresAt, usedAt                                                                         | Single-use                                                       |

## Academic structure

| Table          | Key fields                                              | Constraints                                                     |
| -------------- | ------------------------------------------------------- | --------------------------------------------------------------- |
| `Program`      | tenantId, name, code, status                            | unique (tenantId, code)                                         |
| `Batch`        | programId, name, intakeYear, status                     | unique (programId, name)                                        |
| `Semester`     | batchId, number, startDate?, endDate?, status           | **Belongs to one batch** (no shared semester definitions); unique (batchId, number) |
| `Section`      | semesterId, name                                        | Sections are per semester; names can repeat across semesters   |
| `Subject`      | semesterId, name, code, credits?                        | Per batch semester, because each batch has its own syllabus    |
| `Enrollment`   | studentRecordId, batchId, semesterId, sectionId, status | unique (studentRecordId, semesterId); the history of sections is the set of rows |
| `Class`        | semesterId, subjectId, sectionId                        | unique (subjectId, sectionId); needs a published syllabus      |
| `ClassTeacher` | classId, userId, isPrimary                              | Teacher assignment                                             |

## Files

`FileObject`: tenantId, storageKey (`tenants/<tenantId>/<area>/<id>`), mime, size, kind (SYLLABUS_PDF, AUDIO, PHOTO), uploadedBy, status (PENDING, READY, DELETED), deleteAfter.

## Syllabus

| Table                   | Key fields                                                                                           |
| ----------------------- | ---------------------------------------------------------------------------------------------------- |
| `Syllabus`              | subjectId (unique), currentVersionId                                                                 |
| `SyllabusVersion`       | syllabusId, versionNo, status (DRAFT, PUBLISHED, SUPERSEDED), sourceFileId, effectiveFrom, publishedBy, publishedAt |
| `SyllabusTopic`         | versionId, parentId, stableKey, kind (UNIT, TOPIC, SUBTOPIC), title, description, orderIndex, sourcePage, confidence |
| `SyllabusChangeRequest` | versionId, requestText, proposedOps (json), status (PROPOSED, ACCEPTED, REJECTED), decidedBy, decidedAt |

## Class content

| Table             | Key fields                                                                                                                               |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `ClassSession`    | classId, **taughtOn (date)**, createdBy                                                                                                  |
| `Entry`           | sessionId, currentVersionId, authorId                                                                                                    |
| `EntryVersion`    | entryId, versionNo, status (DRAFT, PENDING, PUBLISHED, REJECTED, SUPERSEDED), inputKind (TEXT, VOICE, PHOTO), rawText, structured (json), summary, syllabusVersionId, approvedBy, decidedAt, rejectionReason, reminder timestamps, escalatedAt |
| `EntryTopic`      | entryVersionId, topicStableKey, confidence                                                                                               |
| `ApprovalSetting` | tenantId, programId?, classId?, autoApprove, locked, unreviewedPublishAfterDays?                                                          |

Resolution of auto-approval: a class setting overrides the program default, unless the program setting is locked.

## Knowledge index

`IndexedChunk`: tenantId, sourceType (SYLLABUS_TOPIC, ENTRY_VERSION, NOTE), sourceId, sourceVersionId, ownerId? (for private notes), qdrantPointId, embeddingModel, embeddingVersion, status (LIVE, DELETED). It maps Postgres records to Qdrant points so superseded vectors can always be found and deleted.

## Chat and notes (private to the student)

| Table          | Key fields                                                                          |
| -------------- | ----------------------------------------------------------------------------------- |
| `Conversation` | tenantId, userId, title, pinnedSubjectId?, summary                                  |
| `Message`      | conversationId, role, content, citations (json), labels (json), model, usageId      |
| `Note`         | tenantId, userId, subjectId?, topicStableKey?, sessionId?, body, source (MANUAL, AI_ANSWER), state (INBOX, FILED) |
| `NoteCheck`    | noteId, result (json), createdAt                                                    |

## Exams

| Table              | Key fields                                                                                                 |
| ------------------ | ---------------------------------------------------------------------------------------------------------- |
| `Exam`             | tenantId, batchId, semesterId, name, kind (INTERNAL, EXTERNAL), status                                      |
| `ExamSubject`      | examId, subjectId, date, marks, durationMinutes, scopeMode (FULL_SYLLABUS, SELECTED), currentScopeVersionId |
| `ExamScopeVersion` | examSubjectId, versionNo, inputText?, status, setBy, publishedAt                                            |
| `ExamScopeTopic`   | scopeVersionId, topicStableKey                                                                              |

## Study

| Table          | Key fields                                                                                               |
| -------------- | -------------------------------------------------------------------------------------------------------- |
| `StudyPlan`    | tenantId, userId, examId?, hoursPerDay, status                                                            |
| `StudyPlanItem`| planId, topicStableKey, plannedDate, status                                                               |
| `StudyCard`    | topicStableKey, syllabusVersionId, body, sourceHash, status (shared by all students)                      |
| `Question`     | topicStableKey, syllabusVersionId, kind, prompt, rubric (json), marks, sourceHash, status, reportCount (shared) |
| `Attempt`      | userId, questionId, answerKind (TEXT, CODE), answerText, result (json), score, usageId (private)          |
| `Mastery`      | userId, topicStableKey, score, updatedAt (private)                                                        |

## Operations

| Table        | Key fields                                                                                                           |
| ------------ | -------------------------------------------------------------------------------------------------------------------- |
| `AiUsage`    | tenantId, userId, feature, model, inputTokens, outputTokens, cachedTokens, costMicros, priceVersion, requestId        |
| `PriceTable` | model, inputPer1M, outputPer1M, cachedPer1M, effectiveFrom                                                            |
| `Quota`      | scope (USER, TENANT), feature, period (MONTH), limit                                                                  |
| `TenantPlan` | tenantId, plan, monthlyAiBudget, limits                                                                               |
| `AuditLog`   | tenantId, actorId, action, entityType, entityId, before/after (json), ip, requestId                                   |
| `EmailLog`   | tenantId, template, toHash, status, messageId, attempts, sentAt (no email bodies or plain addresses)                  |

## Tenant isolation

1. Every repository function takes a scope object and puts `tenantId` in the query.
2. Row-level security policies on all tenant tables compare `tenantId` with a per-request database setting. The application connects with a role that cannot bypass them. A Prisma client extension sets the value for each request's queries.
3. Qdrant queries always carry the tenant filter, and private-note queries also filter by owner.
4. A shared isolation test suite proves that no module returns another tenant's, section's or student's data.
5. If RLS proves too awkward with Prisma, steps 1, 3 and 4 remain mandatory and RLS is reconsidered; it is not allowed to replace them.
