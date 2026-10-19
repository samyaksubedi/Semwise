# App flows

The end-to-end flow of every feature, from the user's side and from the system's side. Product rules are in [Semwise_Project_Context.md](Semwise_Project_Context.md); the tech behind each step is in [architecture.md](architecture.md). Feature numbers match the build order.

## Cross-cutting flows

**Every request**

1. Browser sends the request with its session cookie.
2. API checks origin and rate limit, loads the session, and resolves the **tenant** from the user's active membership (never from the client).
3. Controller validates the input with the shared Zod schema.
4. Service asks `authz` whether this role, in this scope, may do this action on this resource.
5. Repository runs the query with the tenant scope included.
6. Response uses the standard envelope; failures use `AppError` codes and carry a request ID.

**Every AI call**

1. Service asks the `ai` module for a task (route, answer, grade, extract ...).
2. `ai` checks the user and tenant **quota**; if exceeded, it stops with a clear message.
3. It calls OpenAI with the model configured for that task, passing retrieved text as delimited data.
4. It writes a **usage ledger** row (tenant, user, feature, model, tokens, cost, price snapshot).
5. Output is validated against a schema before use.

**Every background job** (PDF extraction, OCR, transcription, embedding, summaries, emails, reminders)

1. The service stores the source and enqueues a job in Redis (BullMQ) with an idempotency key.
2. The worker process picks it up; progress is stored as queued, running, failed or done.
3. Failures retry with backoff; after the last retry the job is marked failed and the user sees a retry option.
4. Success updates Postgres first, then Qdrant, then notifies the user if needed.

## 1. Foundations (auth, tenants, users, roles)

**Login**

1. User enters email and password. API checks the Argon2 hash; repeated failures lock the account briefly.
2. A session row is created; the browser gets an HttpOnly cookie. Only a hash of the token is stored.
3. If the user belongs to several colleges, they pick the active one; the choice is stored in the session.
4. The app shows the areas their roles allow (student, CR, teacher, admin).

**Forgot password**: request, email with single-use expiring link, set new password, all other sessions revoked. The response never reveals whether the email exists.

**Super Admin** has a separate login area and can only manage tenants, not college content. The colleges page says so on screen.

## 2. Tenant provisioning and academic structure

1. Super Admin creates the college (name, timezone) and the first University Admin's email.
2. That person gets an invite, sets a password, and lands in the University Admin area.
3. University Admin creates programs (BIT, BCA ...) and assigns Program Admins.
4. Program Admin creates a **batch** (BIT 2026), its **semesters**, and the **sections** for each semester.
5. Subjects are created when their syllabus is uploaded (feature 5), or manually first.
6. Everything is tenant-scoped and audit-logged.

## 3. Invitations and enrollment

1. Program Admin adds students (email + roll number), one by one or by CSV.
2. The system validates and dedupes, then queues invite emails through a **throttled queue**; the admin sees "sending, 120 of 400".
3. Student opens the link, sets a password, and is connected to the college, batch and semester section.
4. Program Admin assigns each student a section per semester (history kept), grants **CR** to up to three students per section, and assigns **teachers** to classes.
5. For the next semester the admin creates new sections and moves students; the old assignments stay as history.
6. Admin can resend, revoke, fix a wrong email or deactivate a student.

As built: a CSV needs the columns email, roll number and section (name optional); the preview lists errors per row (bad address, unknown section, duplicates in the file, a roll number or email already used) and writes nothing; the import adds the valid rows only. A resend waits 10 minutes after the last send and issues a new link. An email can be corrected only before the student joins. A section can have up to three CRs (`MAX_CRS_PER_SECTION` in the shared package); beyond that a grant is refused unless the admin names the CR to replace (`replaceStudentId`). CRs are removed one at a time (`DELETE /v1/sections/:id/cr/:studentId`); a CR moved to another section stops being CR. Deactivating removes the student's roles and current placement in this college only; past semesters and their own account stay.

## 4. Classes

1. Program Admin picks batch, semester, subject and section, and assigns the subject teacher.
2. The class is created only if the subject has a **published syllabus**.
3. The teacher sees the class in their area; the section's CR sees all classes of their section.

As built: the published-syllabus rule is checked through a gate the syllabus module provides (feature 5); until a subject has a published syllabus, creating its class answers 409. Reassigning the teacher moves access with the class at once. `GET /v1/classes/mine` lists the classes a person teaches, represents (CR) or attends (student).

## 5. Syllabus ingestion

1. Program Admin chooses batch and semester and uploads one syllabus PDF for a subject (direct to R2 via a signed URL; type and size checked).
2. A job extracts the text (OCR when scanned) and asks the AI for a structured draft: subject name and code, units, topics, credits, reference books, each with a source page.
3. Admin reviews the topic tree. Low-confidence items are highlighted; clicking one shows the source page.
4. To fix something, the admin edits directly or types a request ("Unit 3 is missing Laplace transforms"). The AI returns a list of proposed changes shown as a before/after diff; the admin accepts or rejects each.
5. Admin publishes. A new **syllabus version** is created; topics are chunked, embedded and indexed in Qdrant.
6. Later changes repeat the flow and create version 2; affected class-session topic mappings are flagged.
7. For a new batch, the admin can **copy from the previous batch** and review.

As built: the upload is a signed PUT straight to storage, then `complete` checks size and magic bytes. A PDF can be uploaded for a semester before its subject exists; after extraction the admin confirms (or corrects) the suggested name and code, which creates the subject. Extraction and publishing run as jobs and their state is shown on the version. Publishing keeps the previous version live until the new one is indexed. Plain-language requests are answered with proposed operations; each is accepted or rejected, and one that a previous accepted step made impossible is recorded as rejected. A PDF with little text per page counts as a scan: the PDF itself goes to the deep model, which reads the page images. Scans are capped at 60 pages (`AI_SCAN_MAX_PAGES`); a longer one fails at once with a clear message and no AI call. Every reading, scanned or not, is checked against the college's budget and written to the usage ledger. Printed labels such as "Unit 3:" are dropped from unit titles, because units are numbered by position. A semester's syllabus dashboard shows NONE, PROCESSING, DRAFT or PUBLISHED per subject, plus uploads waiting for their subject.

## 6. Class entries and approvals (CR and teacher)

1. After a lesson, the CR opens the section's classes, picks a subject, sets the `taught_on` date (default today) and types the topics and subtopics.
2. A job organizes the input into a structured record, maps topics to the syllabus tree and writes a short summary.
3. The CR reviews and submits. **Duplicate check:** a second entry for the same section, subject and date asks "replace or add?".
4. If auto-approval is **on** (teacher override, else program default), the entry is published. If **off**, it goes to the teacher's queue as **pending** and is hidden from students.
5. The teacher approves, edits or rejects (single or bulk). No action: email reminders at 24 and 48 hours, then escalation to the Program Admin; an optional setting publishes as "not reviewed by teacher" after a longer wait.
6. On publish: new vectors are indexed, the live pointer switches, old version vectors are deleted, and derived content is marked stale.
7. **Editing later:** the CR edits a published entry; with auto-approval off the edit goes through approval while the old version stays live.
8. Teachers can add entries directly; they skip approval.

As built: the entry is a draft until the author submits it; the organize job fills its topics (mapped to syllabus stable keys) and summary, which the author may correct. Only the active semester takes entries, the date is never in the future. A second entry on the same day answers 409 `DUPLICATE_ENTRY` listing the existing entry; `replace` turns the draft into the next version of that entry, `add` keeps both. Without any setting, entries wait for the teacher (auto-approval off). A teacher override needs the program default to be unlocked; a locked default blocks overrides in both directions. An edit whose topics are unchanged counts as a minor fix and publishes at once; an auto-approved edit emails the teachers. Reminder, escalation and unreviewed-publish jobs are delayed jobs cancelled when someone acts, and each re-checks that the version is still pending. Approved versions are indexed before they go live. Takedown removes the vectors; restore re-indexes. A new syllabus version flags entries mapped to topics that no longer exist.

## 7. CR voice and photo input

1. In the entry screen the CR taps the microphone (one to two minutes) or takes a photo of the whiteboard.
2. The file goes to R2; a job transcribes it (speech to text) or reads it (vision).
3. The CR sees the text, edits it, and continues with the normal entry flow from step 2 above.
4. Raw audio is deleted after transcription; photos follow the retention policy.

As built: the CR uploads the file for the class (`POST /v1/files/uploads` with `kind` AUDIO or PHOTO and `classId`), then asks for `POST /v1/classes/:id/transcriptions` or `/photo-readings` with `{ fileId }` (202). A job does the work; `GET /v1/media-readings/:id` shows its state and text. A reading is visible only to the person who uploaded the file. The dictation quota (60 a month by default) is checked before the job is queued, so a CR at the limit hears it at once; photo readings count toward the college budget only. Asking again for the same file returns the same reading. The entry is then created as usual with `inputKind` VOICE or PHOTO and `mediaFileId`; it must be the author's own finished reading for the same class and kind. Raw audio is deleted as soon as the transcription ends, whether it succeeded or failed (a recording never transcribed is deleted after 24 hours). A photo is kept until 30 days after its entry is published (30 days after the reading if it is never used). An hourly retention job deletes the bytes of files past their date and of uploads never completed after 24 hours; the rows stay as records. Silence and unreadable photos fail with advice to try again.

## 8. Student Q&A

1. Student types a question in chat, optionally pinning a subject.
2. A cheap model detects the language, rewrites the question for retrieval, identifies the subject, and classifies it: **in syllabus**, **related but outside**, or **unrelated**.
3. Unrelated: polite decline, no expensive call. Related-outside: continues but the answer will be labeled.
4. Retrieval: Qdrant search filtered by tenant, batch, semester, section and subject over published syllabus and class content; every hit is re-checked against Postgres (live version, permission).
5. Optionally adds the student's own notes for that subject, shown separately.
6. The answering model gets a bounded context (retrieved chunks as data, recent chat summary) and replies with source references (entry date and version, syllabus unit) and labels: from syllabus, reported in class, general explanation.
7. If the knowledge base has no answer, the reply says so.
8. The turn is saved to the student's private history; usage is logged.

As built: `POST /v1/chat/conversations` (optionally `pinnedSubjectId`, `includePast`), then `POST /v1/chat/conversations/:id/messages` with `{ text }` answers within the request (no job: a question is interactive, and the provider call has a 90-second timeout). The router (Luna) sees the student's subjects with their unit titles and the last six messages; UNRELATED gets a fixed polite decline with no retrieval or answer call. One embedding feeds two searches: syllabus topics of the student's batch and semesters, and class entries of the student's own sections. Every hit is re-checked in Postgres (the subject's live syllabus version; the entry's live version, not taken down, in one of the student's sections) and hits below a similarity of 0.2 are dropped; at most six sources go to the answer model (Mini, or Terra when the router marks the question complex). The answer marks sourced statements with keys such as [S1], which match the citations, and puts anything beyond the sources under "General explanation:". Labels are computed from the sources actually used (FROM_SYLLABUS, REPORTED_IN_CLASS), the model's flags (GENERAL_EXPLANATION, NOT_IN_MATERIAL) and the router (OUTSIDE_SYLLABUS for RELATED), not taken from the model alone. Router, embedding, answer and summary share the request id, so a question counts once against the monthly quota; the response carries the updated quota. Once ten messages beyond the recent six pile up, they are folded into the conversation's summary. Reading a conversation marks an answer `outdated` when a version it cites is no longer live. Only the student can read, rename, re-pin or delete their conversations; teachers and admins get 403 for chat and 404 for a student's conversation.

## 9. Catch-up and date-based questions

**In chat ("what was taught today / on Monday / while I was absent")**

1. A cheap model turns the phrase into a date range in the college's timezone.
2. Postgres returns all published entries for the student's section in that range, across subjects.
3. The AI combines the stored summaries into a per-subject answer.

**Catch-up screen**: the student picks dates and sees per-subject summaries directly (no AI call, summaries are precomputed), with a button to ask a follow-up in chat.

As built: `GET /v1/catchup?from&to&subjectId` (dates default to today in the college's timezone, at most 31 days) returns the live, visible entries of the student's current section grouped by subject in date order, with each entry's stored summary, topics and version; pending and taken-down entries never appear. In chat, the router also reads date phrases; the range is cleaned on the server (real dates, in order, never past today, at most the latest 31 days; an unusable range falls back to a normal question). The entries come from Postgres for the student's sections (current, plus past ones if the chat includes past semesters) and the pinned subject, and one Luna call summarizes them with [S1] markers, citing each entry. With no entries the reply says nothing was recorded, without any AI call. It counts as one chat question.

## 10. Student notes

1. Student writes a note in a subject (optionally tied to a topic or class session) or in the inbox; saved AI answers can be stored as notes.
2. Inbox notes get an AI suggestion of subject and topic; the student accepts or ignores.
3. Notes are embedded into the student's **private scope** (owner-filtered).
4. **Check my notes:** on demand, the AI compares each claim with syllabus and class content and marks it consistent, contradicting, not covered or possibly incorrect, with evidence. Nothing is changed automatically.
5. In chat, relevant notes appear as "From your notes".

## 11. Exams and exam scope

1. Program Admin creates an exam for the batch and semester, naming it (First Internal, Terminal ...) and marking it internal or external.
2. For each subject the admin adds date, marks and duration.
3. **Scope:** the admin or the subject teacher types a range ("Unit 1 to Unit 5, skip 2.4") or ticks topics on the tree; the AI maps text to topics and shows the matches for confirmation. Ambiguous phrases are flagged.
4. Publishing the scope creates a **scope version** and notifies students; changes later create a new version.
5. **Student asks "what comes in the exam?"**: a database lookup returns the exact scope and dates, citing when it was set. If no scope exists, it says so and shows the full syllabus as a fallback.

## 12. Study plan

1. Student opens exam prep, picks an exam (or subjects and topics) and enters hours available per day.
2. A scheduling algorithm spreads the scope topics over the days left, weighted by topic size and difficulty; topics not yet taught per class records are flagged.
3. The plan shows a day-by-day list; the student ticks topics done.
4. The plan re-adjusts when mastery or the exam scope changes.

## 13. Study cards

1. For each topic in a scope, a card (summary, key concepts, definitions, examples) is generated **once** from syllabus and class content and shared by all students; labeled AI-generated.
2. Cards are generated by background jobs, ideally in batch, when a scope is published.
3. When the source version changes, the card is regenerated.
4. The student opens a card from the plan and can ask "explain this simply" in a chat with the topic pinned.

## 14. Study room

1. Student picks an exam (scope filled in) or subjects and topics, and a question type.
2. The system serves cached questions (each with a hidden rubric); if a topic has none, it generates and caches them.
3. The student answers in free text, or pastes code for programming subjects.
4. The AI grades against the rubric and returns correct, partly correct or incorrect, what was missed, a model answer and a link to the topic card; for code it states that it read, but did not run, the code.
5. Mastery per topic updates (private) and feeds the study plan.
6. Teachers and admins see only aggregates, such as topics many students find hard.

## 15. Usage, quotas and plan limits

1. Every AI call writes a ledger row.
2. Quota checks run before each call (per user and per tenant, monthly).
3. University Admin sees their college's usage and spend; Super Admin sees all tenants and can change limits and plans.
4. Alerts fire when a tenant nears a limit.

## 16. Nepali beta (only if the test passes)

1. Language detected as Nepali or Romanized Nepali.
2. The cheap model rewrites the question into English for retrieval.
3. The answer is generated in English from English content and translated back; it is labeled beta.

## A day in the life

1. **Setup (once):** Super Admin creates the college; admins build programs, batches and sections; the Program Admin uploads and publishes subject syllabi, invites students, assigns teachers and CRs.
2. **During the term:** after each class the CR logs topics; the teacher approves; students see summaries and ask questions.
3. **Absent student:** opens Catch-up for the missed dates, then asks follow-ups.
4. **Before exams:** the admin or teacher publishes the exam scope; students ask "what comes in the exam?", get a plan, read the cards and practise in the study room.
5. **Next semester:** the admin creates new sections and subjects, moves students, and copies syllabi from the previous batch where it fits. Old data stays as history.
