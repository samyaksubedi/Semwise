# Semwise Project Context

> **Purpose of this document:** The product brief for Semwise: vision, decisions made, academic hierarchy, roles, content flow, AI behaviour, exams, and the feature build order. For the tech stack, repo layout and code conventions, see [architecture.md](architecture.md). Items under **Open decisions** (section 17) are not yet settled. Last updated: 2026-10-19.

## 1. Project vision

**Semwise is a multi-tenant academic workspace and AI-powered academic memory for colleges and universities.**

It organizes an institution's academic structure and builds searchable knowledge from official syllabi and from what is actually taught in each class. Each student can ask questions and get answers grounded in the content they are authorized to see: their college, program, batch, semester, section and subjects. It also helps students prepare for exams.

Semwise is a pre-planned SaaS product, not a side project. The plan is to build the full product feature by feature, each fully finished and tested before the next.

### Product promise

> Semwise remembers what an institution teaches, organizes that knowledge by academic context, and helps each student understand and revise it.

## 2. Product and business model

- Semwise is **multi-tenant SaaS**. Many colleges use it; each college is one **tenant**. Tenant means one college's walled-off data.
- **Tenant isolation is essential.** College A must never reach College B's data, including through AI retrieval.
- Onboarding (manual at first): a college contacts Semwise, the **Super Admin** creates the tenant and the first **University Admin**. Self-service signup and billing come later.
- Each tenant has a **timezone** setting (used for "today" and date ranges). Dates are shown in English (AD) only for now.

## 3. Academic hierarchy

```text
Semwise
└── College / University (tenant)
    └── Program (BIT, BCA, BBA ...)
        └── Academic Batch (e.g. BIT 2026)
            ├── Semester
            │   ├── Subjects (each with its own syllabus, per batch)
            │   └── Sections (A, B ...)
            │       └── Class = Subject x Section, with a subject teacher
            │           └── Class Session (one lesson, with a taught_on date)
            └── Exams (whole batch; scope per subject)
```

### Entities

- **Program / Batch / Semester:** as above. Subjects vary by semester; there is no single flat subject list per program.
- **Subject:** a curriculum subject within a batch's semester. **Each subject has its own syllabus for each batch**, uploaded as its own PDF.
- **Section:** a group of students in a batch for a given semester. A student's section can change between semesters, so it is stored as a semester-specific enrollment with history, never as a permanent field on the user.
- **Class:** one subject offered to one section in one semester, with the subject teacher assigned.
- **Class Session:** one lesson. Every session carries a `taught_on` date, separate from created and approved timestamps. The CR defaults it to today and may backdate it.
- **Exam:** belongs to the whole batch (see section 12).

### Scope exclusions (for now)

- Combined classes and shared labs are **out of scope**. Each section's CR logs its own classes.
- There is no separate "class teacher". Approval belongs to the **subject teacher**.
- Assignments, quizzes and lab work are not tracked.

## 4. Roles, users and permissions

### One User table

A single `User` entity holds all people. Roles come from **memberships with a scope**, not from separate tables per user type. The same email is unique globally; one person can have memberships in several tenants.

### Roles

1. **Super Admin:** platform operator. Creates tenants and the first University Admin. Not a day-to-day admin of any college.
2. **University Admin:** manages the institution: programs, Program Admins, institution settings.
3. **Program Admin:** scoped to one program. Manages batches, subjects, syllabus uploads, section setup, student invitations, enrollments, teacher and CR assignment, exam setup and approval settings. Cannot manage other programs.
4. **Teacher (subject teacher):** assigned to specific classes. Approves, edits or rejects CR content for those classes, adds content directly (trusted, no approval step), and can set exam scope for their own subjects.
5. **CR (Class Representative):** a student with extra permissions **for one section** (all its subjects) in one semester. Granted by the Program Admin. Submits class content and can use voice and photo input.
6. **Student:** asks questions, keeps private notes and chat history, uses catch-up and exam preparation. Cannot upload shared content.

### Who can contribute shared knowledge

Only **Program Admin, University Admin, Teacher and CR** put shared context into the system. Whatever a student writes stays private to them.

### Privacy rules

- A student's private notes, chat history, practice answers and mastery data are visible only to that student. **Admins (including University Admin) cannot read them.** Admins and teachers see only aggregate figures.
- Nothing a student writes is ever shared or fed into another student's AI context.
- Verify scope on the server for every request and every retrieval. Never trust a client-supplied tenant, section or user ID.

## 5. Student onboarding (email invites)

1. The Program Admin adds each student's email (with roll number or student ID as a second identifier), individually or by CSV import.
2. The system emails an invite link. The student verifies and sets credentials, which connects their account to the tenant, batch and semester section.
3. The Program Admin can grant CR status to an existing student.

Requirements:

- Invite tokens are single-use, expiring, stored hashed, and bound to the invited email. Resending is rate-limited.
- Invited (pending) students have a distinct state until verified.
- Admins can revoke, re-invite, correct a wrong email, and deactivate students who leave.
- Email goes out through a **throttled queue** with a daily cap (the free Gmail account used at first has small sending limits), so a large CSV import sends over time and shows progress. The email provider can be replaced later without changing the flow; a provider with a custom domain (SPF and DKIM) will improve deliverability, since college mail often goes to spam.
- A person already in another tenant reuses their single account.

## 6. Syllabus ingestion (per subject, per batch)

The Program Admin uploads **one syllabus PDF per subject per batch**. The pipeline is draft, then review, then publish:

1. Admin picks the batch and semester and uploads the PDF. The AI suggests the subject name and code from it; the admin confirms.
2. Text is extracted (OCR for scanned PDFs, which costs more).
3. The AI produces a **structured draft**: units, topics, credits, reference books. Each item links to its source page; low-confidence items are highlighted.
4. The admin reviews an editable tree. Corrections can be made by direct editing **or by typing a plain-language request** (for example "Unit 3 is missing Laplace transforms").
5. Natural-language requests produce a **list of proposed changes (add, rename, move, delete)** shown as a before/after diff. The admin accepts or rejects them. The AI never silently rewrites the tree. Requests and decisions are kept as an audit trail.
6. **Publish** creates a syllabus version. Only published syllabi are chunked and embedded.

Further rules:

- Each subject has its own **versions with effective dates**; old versions are never overwritten. Class sessions keep a link to the version in force when they were taught. A new version triggers re-indexing and flags affected topic mappings.
- Subject status: no syllabus, draft or published, with a batch dashboard of what is missing. A published syllabus is required before classes can be created for that subject.
- **Copy from previous batch:** an admin can copy a subject's syllabus from an earlier batch, then review it. The copy is independent from then on.
- The syllabus topic tree is the backbone for mapping class sessions, checking questions, setting exam scope, and building study material.

## 7. Class knowledge (CR and teacher input)

- After a lesson, the CR (or the subject teacher) records **topics and subtopics** by typed text, a **short voice dictation**, or a **photo** (for example a whiteboard). Voice and photo are for CRs only, and only for managing class context. They are not lecture recordings; dictations run a minute or two.
- The AI organizes the input into a structured session record, maps topics to the syllabus, and generates a short summary. Summaries are stored when an entry is published, so catch-up needs no AI call per student.
- Voice transcripts and photo text are shown to the CR for review and editing before submission.
- Each entry has a `taught_on` date and a state: draft, pending, published, rejected.

### Approval workflow

- Content is approved by the **subject teacher** of that class.
- **Auto-approval switch:** the Program Admin sets a program-level default (on or off). Each subject teacher can override it for their own class. The Program Admin can lock the setting so teachers cannot change it in either direction. With no setting at all, entries wait for the teacher.
- Teacher and admin entries are trusted and skip approval.
- Pending entries are hidden from students.
- **Edits to published entries:** with auto-approval off, an edit needs approval again, and the old approved version stays visible until then. With auto-approval on, edits publish immediately, version history is kept and the teacher is notified. Minor fixes (spelling, formatting) that do not change topics are exempt.
- **If a teacher never approves:** email reminders at 24 and 48 hours, then escalation to the Program Admin after a configurable wait. An optional program setting can auto-publish as "not reviewed by teacher" after a longer wait (off by default). Bulk-approve is provided.
- Content belongs to the class, not to the person who wrote it, so it survives when a CR is replaced.

## 8. Content lifecycle (preventing stale knowledge)

A mistake and a later correction must never both reach the AI.

- Each entry has **versions**. An edit or re-upload creates a new version of the same entry.
- **One live version per entry.** PostgreSQL holds the "current approved version" pointer. Old versions stay in the database for history, audit and restore, but the AI never retrieves them.
- Publishing a new version: index the new content, switch the live pointer, then delete the old version's vectors from Qdrant.
- Retrieval re-checks every result against PostgreSQL, so a stray old vector is dropped.
- Pending edits keep the old approved version live; rejected or withdrawn versions are never indexed.
- **Duplicate detection:** a second entry for the same section, subject and date, or with overlapping topics, prompts "replace or add?" and alerts the teacher on conflict.
- **Derived content** (summaries, topic mappings, study cards, generated questions) records its source version and is regenerated or marked stale when the source changes.
- **Past answers:** chat history and saved AI answers are kept but marked "based on content later corrected". Private notes are never changed.
- At answer time the AI cites source entries with date and version, prefers the newest, and says so when it finds conflicting information.

## 9. Knowledge base

- **PostgreSQL** is the source of truth for all structured records, permissions, versions and states.
- **Qdrant** is the semantic retrieval index for published syllabus and class content (and each student's private notes in a separate private scope). Each chunk carries payload metadata: tenant, program, batch, semester, section, class, subject, source and version IDs, visibility, state, owner (for private data), and embedding model and version.
- Single collection, filtered by tenant payload. After retrieval every result is re-checked against PostgreSQL.
- Content kinds are kept distinct and labeled: **official syllabus**, **class content reported by CR/teacher**, **AI-generated enrichment** (always labeled, never presented as "what the teacher said"), and **student private data**.
- Details of the implementation are in [architecture.md](architecture.md).

## 10. AI assistant (student Q&A)

### Chat design

- One chat, no forced subject selection. A cheap router model infers the subject; the student can optionally pin a subject. Ambiguous questions prompt a clarification or check both subjects.
- Chat history is private per student; long histories are summarized to control cost.

### Date-based questions ("what was taught today?")

Not a vector search. A cheap model turns "today / yesterday / Monday to Wednesday" into a date range in the tenant's timezone; PostgreSQL returns all published entries for the student's section across all subjects in that range; the AI summarizes them.

### Catch-up

A dedicated view where an absent student picks dates and sees per-subject summaries (precomputed at publish time). Chat can follow up from there.

### Syllabus check and answer labeling

Each question is classified as:

1. **In syllabus:** full answer from class material and syllabus, with source references.
2. **Related but outside the syllabus:** **labeled answer**, which states clearly that it is a general explanation, not part of the syllabus or what was taught.
3. **Unrelated:** polite decline. This protects the product from being used as a free general chatbot.

### Model tiers

- Cheap model: routing, date parsing, language detection, syllabus classification, summaries.
- Strong model: answering real doubts and grading. Model choice per task is configuration.

### Language

- **English first.** Stored content (syllabus, summaries) is English-first.
- **Nepali is a labeled beta, pending a test.** Nepali and Romanized-Nepali questions are detected and rewritten into English for retrieval, with the answer returned in the student's language. Expected weak points: Romanized Nepali, technical terms, cross-language retrieval, and especially Nepali speech-to-text.
- **Test before committing:** about 20 real Nepali and Romanized student questions and about 10 real CR dictation clips, checking topic retrieval, answer correctness and transcript usability.

### Honesty rules

If the knowledge base does not contain the answer, say so. Always separate what was reported as taught from general explanation. In V1 students ask by text only.

## 11. Student notes

- **Subject-based notes with a general inbox.** A note belongs to a subject and optionally to a syllabus topic or class session. A note with no subject goes to the inbox; the AI can suggest a subject or topic and the student confirms.
- Students can save AI answers from chat as notes (marked AI-generated).
- **Strictly private.** Indexed in a separate private scope tied to the student's ID. Admins and teachers cannot read them. In answers, the AI shows the student's notes separately ("From your notes: ...").
- **"Check my notes":** on demand, the AI compares each claim with the syllabus and class content and marks it consistent, contradicting, not covered, or possibly incorrect from general knowledge. It never edits a note itself. Checks against syllabus and class content are reliable; general-knowledge flags are shown as suggestions with evidence.

## 12. Examinations

- Exam names and rules differ by college, so each college **names its own exams** ("First Internal", "Terminal", "Pre-board" ...). Underneath, a small fixed set of behaviours drives logic: **internal** (college-run) or **external** (university-run), and a scope mode of **full syllabus** or **selected topics**.
- Exams belong to the **whole batch**. Each exam has per-subject entries with date, marks and duration, and one **exam scope** per subject, the same for every section.
- **Setting scope:** the Program Admin (any subject in the program) or the subject teacher (own subjects) can set it. The main input is plain language such as "Unit 1 to Unit 5" or "unit one: pointers and arrays", or a checkbox selection on the published topic tree. The AI maps it to syllabus topics and shows the matched topics for confirmation; ambiguous phrases are flagged, not guessed.
- Scope is **versioned**; changes record who set them, and students are notified.
- **"What comes in the upcoming exam?"** is a database lookup that returns the exact scope and dates, citing when it was set. If no scope is published, it says so and shows the full syllabus labeled as a fallback. Any "likely questions" the AI suggests are labeled as predictions, not official.
- Past-paper upload is a V2 feature.

## 13. Exam preparation

1. **Personal study plan.** The student enters hours available per day. A scheduling algorithm spreads the scope topics across the days left, weighted by topic size and difficulty; the AI only explains the plan. Topics not yet taught according to class records are flagged, labeled "per class records". The plan updates when mastery or exam scope changes.
2. **Study cards per topic.** Summary, key concepts, definitions and examples, grounded in the syllabus and class content, labeled AI-generated. **Generated once per topic and shared by all students**, regenerated only when the source version changes.
3. **Study room.** The student picks an exam (which fills in the scope) or, with no exam, one or more subjects and topics. The AI generates questions; the student answers in free text or by pasting code. **No MCQs for now.**
   - Question types: short explanations, descriptive answers, compare-and-contrast, numerical problems, and for programming subjects code-writing, tracing and debugging.
   - Each question is created with a hidden rubric (key points and marks) and is cached and shared. The student's answer is graded against the rubric, returning correct, partly correct or incorrect, what was missed, a model answer and a link to the topic card.
   - **Code answers:** at first the AI reads and reasons about the code and says clearly that it did not run it. Running code in a locked-down sandbox against test cases may come later.
   - Student answers are treated as data; instructions inside an answer ("mark this correct") are ignored.
4. **Mastery tracking.** Per-topic mastery from the student's own marks and quiz results; private to the student. Weak areas are tentative and visible and correctable by the student.
5. **Explain mode.** A chat with a topic pinned as context.
6. **Later:** revision reminders by email and spaced repetition.

Shared (generated once): study cards, questions, rubrics. Private per student: answers, grades, mastery, plan. Teachers and admins see only aggregates.

## 14. AI usage tracking and cost

- **Usage ledger** for every AI call: tenant, user, feature, model, input and output tokens, computed cost, price snapshot, request ID.
- **Quotas and limits** per user and per tenant (monthly), with model routing to control spend. Raw audio is deleted after transcription.
- The ledger is a foundation feature, built before any AI feature ships.
- Indicative (assumption-based, unverified prices): AI cost is roughly **$0.20 to $0.90 per student per month**, dominated by Q&A and by how often the strong model is used. A 20-student college is on the order of $5 to $45 a month; a 1,000-student college $165 to $2,200 a month. The real numbers come from the ledger after a pilot. Hosting and other fixed costs are not included, so pricing needs a per-college minimum.

## 15. Security, privacy and legal notes

- Tenant, section and ownership checks on every request and every retrieval.
- Treat all retrieved text (PDFs, OCR, transcripts, CR input, student answers) strictly as data, never as instructions.
- Audit log for admin actions, approvals, takedowns, syllabus and scope changes.
- Uploaders accept terms covering copyrighted material.
- Review OpenAI's data retention and data-processing terms and Nepal's privacy law before launch. Define a retention and deletion policy.

## 16. Out of scope for now

Combined classes and shared labs; student voice, photo or file uploads; student-written shared content; Nepali (BS) dates; self-service signup and billing; assignments, quizzes and lab tracking; knowledge graphs; MCQ practice; past-paper upload; code execution sandbox; revision reminders.

## 17. Decisions and open questions

### Decided infrastructure (details in [architecture.md](architecture.md))

- Everything runs on one VPS through Coolify: web, API, worker, PostgreSQL, Qdrant and Redis.
- Background jobs: BullMQ on Redis (Redis is required).
- File storage: Cloudflare R2.
- Email: Nodemailer over a free Gmail account for now, behind a swappable interface, with throttling and abuse protections.
- AI: OpenAI. Default models: GPT-5.6 Luna (router and classification), GPT-5.4 Mini (student answers), GPT-5.6 Terra (hard questions, grading, extraction, study material, vision), text-embedding-3-small (embeddings), gpt-transcribe (dictation). All are configuration and can change. Prices and unit costs are in architecture.md.
- Build approach: backend first, one feature at a time; web screens start after backend features 0 to 9.

### Decided design details

- **Tenant isolation:** explicit tenant scoping in every query, plus Postgres row-level security as a second line of defence, plus Qdrant filters and a shared isolation test suite.
- **Semester** belongs to one batch; no reusable semester definitions. Subjects and syllabi are per batch semester.
- **Defaults (all configurable):** approval reminders at 24 and 48 hours; escalation to the Program Admin at 72 hours; optional "not reviewed by teacher" publishing after 7 days, off by default; email cap 400 per day and 20 per minute; student quota 60 chat questions per month with a warning at 80%; study-room quota 100 graded answers per month; CR quota 60 voice dictations per month. Tenant budgets come from the plan. Quotas and budgets reset on the calendar month in UTC (a later improvement: the college's own month in its timezone).
- **CRs:** up to three per section (a constant); a fourth needs the admin to pick a CR to replace.
- **Scanned syllabi** are sent to the model as a PDF (no OCR tooling on the server), at most 60 pages (configurable), and metered like every AI call.
- **Local storage:** SeaweedFS's S3 gateway stands in for R2 locally (MinIO no longer ships public images).
- **Historical semesters:** chat defaults to the active semester; a student can switch on "include my past semesters" for semesters they were enrolled in.
- **Retention (proposed, pending legal review):** raw audio deleted right after transcription; photos deleted 30 days after the entry is published; syllabus PDFs and entry versions kept for the life of the college; student private data (chat, notes, attempts, mastery) kept until the student deletes it, and deleted 90 days after the student leaves the college; AI usage and audit records kept 24 months; when a college ends its contract, data is exported and then deleted within 60 days.
- **Pricing structure (proposal, the business decision stays with the founder):** a monthly minimum fee per college to cover fixed costs, plus a per-student price, with plan tiers that set quotas. AI cost alone is roughly $0.2 to $0.9 per student per month, so the per-student price must sit well above that.

### Still open

- Confirm prices against OpenAI's official pricing page; benchmark transcription models on real CR clips. (Model names, PDF input and strict JSON output were confirmed with the real API on 2026-10-19 by `pnpm --filter @semwise/api smoke:ai`.)
- Legal review of provider terms and of the retention defaults.
- Final prices and plan tiers.
- The exact database schema (written when feature 1 starts, from data-model.md).
- Whether Postgres row-level security works cleanly with Prisma 7; if not, rely on explicit scoping and the isolation tests (see data-model.md).

## 18. Principles to preserve

1. **Institution isolation first** on every request and every retrieval.
2. **One user identity;** roles and scoped memberships decide authority.
3. **Roles are scoped** to the resource where they were granted.
4. **Academic history matters:** semester, section and syllabus changes never erase earlier records.
5. **Separate content kinds:** official, class-reported, AI-generated and private content stay distinct and labeled.
6. **PostgreSQL is the source of truth;** vector search supplements it.
7. **Retrieval is permission-aware,** with a second check against PostgreSQL.
8. **One live version:** the AI only ever sees current approved content.
9. **Provenance matters:** answers link back to syllabus and class sources.
10. **Humans approve what the AI structures:** syllabus, class content and exam scope are reviewed before they become shared knowledge.
11. **Track and cap AI cost from day one.**
12. **Privacy by default:** student data is private, and admins cannot read it.

---

## 19. Feature build order

Each feature is built fully, with permission tests, before the next. Progress is tracked in [architecture.md](architecture.md).

0. **Scaffold:** monorepo, shared package, lint, tests, CI, local Postgres and Qdrant.
1. **Foundations:** authentication, tenants, single User, scoped memberships, authorization layer, audit log, tenant-isolation test suite, minimal usage ledger.
2. **Tenant provisioning and academic structure:** Super Admin creates tenants and University Admin; programs, batches, semesters, subjects, sections.
3. **Invitations and enrollment:** email invites, verification, semester-specific section assignment with history, CR and teacher assignment.
4. **Classes:** subject x section x teacher.
5. **Syllabus ingestion:** upload per subject per batch, extraction, draft review with natural-language changes, publish, versions, copy from previous batch, chunking and embedding, job queue and file storage.
6. **Class entries (text):** CR and teacher entries, AI organization, topic mapping, `taught_on`, versions, approval workflow, reminders.
7. **CR voice and photo input** with review before submit.
8. **Student Q&A:** router, retrieval with access re-check, syllabus classification, labeled answers, source references, private chat history.
9. **Catch-up and date-based questions.**
10. **Student notes** and "Check my notes".
11. **Exams and exam scope**, plus "what comes in the exam?".
12. **Study plan.**
13. **Study cards.**
14. **Study room:** question generation, rubric grading, mastery.
15. **Usage dashboards, quotas and plan limits.**
16. **Nepali beta,** only if the language test passes.
17. **Deploy** (see [architecture.md](architecture.md)).

---

**Current status:** Product direction, roles, content flow, syllabus pipeline, content lifecycle, AI behaviour, notes, exams, exam preparation and the infrastructure choices are decided as written above. The step-by-step user flows are in [app-flows.md](app-flows.md), the tables are in [data-model.md](data-model.md), and the permission matrix is in [permissions.md](permissions.md). Next step: scaffold the repo (feature 0), backend first.
