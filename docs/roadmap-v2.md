# V2 roadmap (features 10 to 16)

The plan for everything after V1: student notes, exams and exam scope, study plan, study cards, study room, usage dashboards and the Nepali beta. It gathers what is already decided; anything not decided is listed under the feature's **Open questions** and must be settled with the founder before that feature is built. V1 as built is described in [architecture.md](architecture.md), [app-flows.md](app-flows.md), [data-model.md](data-model.md) and [permissions.md](permissions.md); when a V2 feature is built, its flow, tables and permission rows move into those docs and its section here shrinks to a link.

Costs use the default models and prices in [architecture.md](architecture.md) ("AI layer"): GPT-5.6 Luna $0.20 in / $1.20 out, GPT-5.4 Mini $0.75 / $4.50, GPT-5.6 Terra $2.00 / $12.00 per 1M tokens, text-embedding-3-small $0.02. Figures marked **decided** are the assumption-based unit costs already agreed in the plan; figures marked **estimate** are new, with the token counts assumed. Both need checking against the ledger after a pilot.

## Build order

The order is the one already decided, one feature at a time, each followed by its web screens:

| #   | Feature                                       | Needs from V1                                     | Needs from V2                                  |
| --- | --------------------------------------------- | ------------------------------------------------- | ---------------------------------------------- |
| 10  | Student notes and "Check my notes"            | Chat (8), knowledge index (5, 6), syllabus topics | -                                              |
| 11  | Exams and exam scope, "what comes in it?"     | Structure (2), syllabus topics (5), chat router   | -                                              |
| 12  | Study plan                                    | Class entries and topic mapping (6)               | Exam scope (11); mastery (14) once it exists   |
| 13  | Study cards                                   | Syllabus and class content, jobs, ledger          | Exam scope (11) triggers generation            |
| 14  | Study room: questions, grading, mastery       | Ledger and quotas (1), knowledge index            | Scope (11), cards (13), plan (12) gets mastery |
| 15  | Usage dashboards, quotas and plan limits      | Usage ledger, `Quota`, `TenantPlan` (1)           | Every V2 AI feature writes to the ledger       |
| 16  | Nepali beta, only if the language test passes | Chat (8), dictation (7)                           | -                                              |

Then deploy again ([deploy.md](deploy.md)).

## Shared rules for every V2 feature

These already apply in V1 and are restated here only so they are not missed; their home is the doc linked.

- **Usage ledger and quotas** ([architecture.md](architecture.md), "AI layer"): every AI call goes through `modules/ai`, which checks the user and tenant quota before the call and writes an `AiUsage` row (tenant, user, feature, model, tokens, cost, price snapshot, request ID). Calls made for no particular user (shared cards, question banks) have no `userId` and count toward the college budget only. Each V2 AI feature adds its own `AiFeature` value. Quotas and budgets reset on the UTC calendar month. Decided defaults ([Semwise_Project_Context.md](Semwise_Project_Context.md), section 17): 60 chat questions per student per month with a warning at 80%, 100 graded study-room answers per student per month (`QUOTA_STUDY_ANSWERS_PER_MONTH`, already in the environment), 60 CR dictations per month, a college budget from its plan.
- **Batch API:** study cards and question banks use OpenAI's Batch API (50% off, results within 24 hours).
- **Labels** ([Semwise_Project_Context.md](Semwise_Project_Context.md), section 9): official syllabus, class content reported by a CR or teacher, AI-generated enrichment and student private data stay distinct and labeled. AI-generated material is never presented as "what the teacher said". New labels in V2: "From your notes", "AI-generated" on cards and questions, "per class records" on topics not yet taught, "prediction, not official" on likely exam questions, and "Beta translation".
- **One live version** (section 8 of the brief): exam scope uses immutable versions plus a live pointer, like syllabus and entries. Derived content (cards, questions, rubrics, scope topics) records its source version and is regenerated or marked stale when the source changes. Topics are referenced by `stableKey`, so they survive new syllabus versions.
- **Privacy:** notes, note checks, chat, study plans, attempts, grades and mastery are readable only by the student who owns them. Nobody else, including the University Admin and the Super Admin, can read them; teachers and admins see aggregates only. There is no support override.
- **Tenant isolation:** every new tenant table has `tenantId`, forced RLS and a `tenant_isolation` policy ([architecture.md](architecture.md), "Working notes", migrations). Shared material (cards, questions) is shared **within a college only**. Tests cover cross-tenant, cross-section and cross-student access for every new route.
- **Untrusted input:** note text, scope text and student answers are passed to the model as delimited data, never as instructions ("mark this correct" inside an answer is ignored).
- **Out of scope** (brief, section 16): MCQ practice, past-paper upload, a code-execution sandbox for code answers, revision reminders by email and spaced repetition, student uploads of files, photos or voice.

---

## 10. Student notes and "Check my notes"

**Purpose.** Students keep their own notes beside the official material, and can ask the AI to check them against the syllabus and class content.

**Who uses it.** Students and CRs (a CR is also a student in their own section). Nobody else can read a note.

**Flow.**

1. The student writes a note in a subject, optionally tied to a syllabus topic or class session, or in the general **inbox** (no subject).
2. From chat, the student can save an AI answer as a note; it is marked AI-generated.
3. For an inbox note the AI suggests a subject and topic; the student accepts or ignores it.
4. Notes are embedded into the student's **private scope** in Qdrant (filtered by owner on every query).
5. **Check my notes** (on demand): the AI compares each claim with the syllabus and class content and marks it consistent, contradicting, not covered, or possibly incorrect from general knowledge, with evidence. It never edits the note. Checks against syllabus and class content are reliable; general-knowledge flags are shown as suggestions with evidence.
6. In chat, relevant notes of the subject are added to the answer context and shown separately as "From your notes: ...".
7. Notes are never changed when the content they refer to is corrected.

**Tables.**

| Table       | Key fields                                                                                                        | Notes                       |
| ----------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `Note`      | tenantId, userId, subjectId?, topicStableKey?, sessionId?, body, source (MANUAL, AI_ANSWER), state (INBOX, FILED) | Private to `userId`         |
| `NoteCheck` | tenantId, noteId, result (json), createdAt                                                                        | Private to the note's owner |

Changes to existing: `IndexedChunk` already has the `NOTE` source type and `ownerId`; chat retrieval gains an owner-filtered search over the student's notes; `Message` needs a way to save an answer as a note (a link from the note, `source = AI_ANSWER`).

**Permissions.** Notes and "Check my notes": CR and S **own** only; every other role "-" (404 for another person's note).

**AI tasks.**

| Task                         | Model tier             | Cost per use                                                            |
| ---------------------------- | ---------------------- | ----------------------------------------------------------------------- |
| Check one note               | Terra                  | **decided** $0.011 (2,000 in, 600 out)                                  |
| Subject and topic suggestion | Luna (cheap tier)      | **estimate** $0.0003 (1,000 in with the subject and unit list, 100 out) |
| Embed a note                 | text-embedding-3-small | **estimate** under $0.0001 (500 tokens)                                 |

**Risks.** A note leaking into another student's context or an admin view (owner filter on every Qdrant query plus the Postgres re-check); general-knowledge flags read as authoritative; long notes inflating check cost.

**Build order.** Tables and CRUD; embedding into the private scope; inbox suggestion; save-from-chat; notes in chat answers; Check my notes; screens (the Notes tab for students).

**Open questions.**

- Is there a monthly quota for "Check my notes", and does a check count as a chat question?
- Maximum note length, and is a long note checked in parts?
- Does editing a note mark its last check stale, or delete it?
- Do notes from past semesters join chat answers when "include my past semesters" is on?
- The model tier for the inbox suggestion (Luna is assumed).

---

## 11. Exams and exam scope

**Purpose.** Each college names its own exams; students get the exact, official scope and dates, and "what comes in the upcoming exam?" is answered from the database.

**Who uses it.** Program Admins and University Admins create exams; they and subject teachers set scope; students and CRs read it.

**Flow.**

1. The Program Admin creates an exam for a batch and semester, with the college's own name ("First Internal", "Terminal", "Pre-board" ...) and a kind: **internal** (college-run) or **external** (university-run).
2. For each subject the admin adds the date, marks and duration, and a scope mode: **full syllabus** or **selected topics**. The exam belongs to the whole batch; the scope is the same for every section.
3. **Scope:** the admin (any subject in the program) or the subject teacher (own subjects) types it in plain language ("Unit 1 to Unit 5, skip 2.4", "unit one: pointers and arrays") or ticks topics on the published topic tree. The AI maps text to syllabus topics and shows the matches for confirmation; ambiguous phrases are flagged, not guessed.
4. Publishing the scope creates a **scope version**, records who set it, writes the audit log and notifies students. A later change creates a new version.
5. **"What comes in the exam?"** (chat, where it is one of the suggestion chips, or the Exams tab): a database lookup returns the exact scope and dates and says when it was set. With no published scope it says so and shows the full syllabus, labeled as a fallback. Any "likely questions" are labeled predictions, not official.

**Tables.**

| Table              | Key fields                                                                                                            |
| ------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `Exam`             | tenantId, programId, batchId, semesterId, name, kind (INTERNAL, EXTERNAL), status                                     |
| `ExamSubject`      | tenantId, examId, subjectId, date, marks, durationMinutes, scopeMode (FULL_SYLLABUS, SELECTED), currentScopeVersionId |
| `ExamScopeVersion` | tenantId, examSubjectId, versionNo, inputText?, status, setBy, publishedAt                                            |
| `ExamScopeTopic`   | tenantId, scopeVersionId, topicStableKey                                                                              |

Changes to existing: the chat router learns an "exam scope" intent (like date questions in feature 9); audit actions for exam and scope changes; a notification email template.

**Permissions.**

| Action                                      | SA  | UA  | PA   | T            | CR        | S         |
| ------------------------------------------- | --- | --- | ---- | ------------ | --------- | --------- |
| Create and edit exams and subject schedules | -   | Y   | prog | -            | -         | -         |
| Set and publish exam scope                  | -   | Y   | prog | own subjects | -         | -         |
| Read published exam scope and dates         | -   | Y   | prog | own subjects | own batch | own batch |

**AI tasks.**

| Task                             | Model tier        | Cost per use                                                                                |
| -------------------------------- | ----------------- | ------------------------------------------------------------------------------------------- |
| Map scope text to topics         | not decided       | **estimate** Luna $0.0012 or Terra $0.012 (3,000 in with the subject's topic tree, 500 out) |
| Detect the exam question in chat | Luna (the router) | included in the router call, **decided** $0.0004                                            |
| Answer "what comes in the exam?" | none (database)   | $0                                                                                          |

**Risks.** A wrong topic match published as official scope (always confirmed by a person); two people setting scope for the same subject at once; scope pointing at topics removed by a new syllabus version; notification emails for a whole batch hitting the 400-a-day Gmail cap.

**Build order.** Exams and subject schedules; scope by ticking topics; scope versions and publish; plain-language mapping; the database answer and the chat intent; notifications; screens (admin and teacher Exams, student Exams tab, the scope screen: one text box above the topic tree, matched topics highlighted, Confirm publishes).

**Open questions.**

- Model tier for scope mapping (Luna or Terra).
- "Own subjects" for teachers: a subject can be taught by different teachers in different sections, but the scope is shared. May any of them set it, and who wins on a conflict?
- How are students notified of a new scope version: email, in-app, or both (and how does that fit the email cap)?
- What happens to a published scope when a new syllabus version drops one of its topics?
- Does "what comes in the exam?" count against the chat quota?
- Are "likely questions" part of V2, and with which model?
- The brief calls past-paper upload "a V2 feature" but also lists it as out of scope, and it is not in features 10 to 16. Is it in V2?

---

## 12. Study plan

**Purpose.** A personal day-by-day plan to cover the exam scope in the time left.

**Who uses it.** Students and CRs, for themselves only.

**Flow.**

1. The student opens exam prep, picks an exam (or subjects and topics) and enters the hours available per day.
2. A scheduling algorithm (code, not AI) spreads the scope topics over the days left, weighted by topic size and difficulty. Topics not yet taught according to class records are flagged "per class records".
3. The AI only explains the plan.
4. The plan shows a day-by-day list; the student ticks topics done.
5. The plan re-adjusts when the exam scope changes and, once feature 14 exists, when mastery changes.

**Tables.**

| Table           | Key fields                                            | Notes   |
| --------------- | ----------------------------------------------------- | ------- |
| `StudyPlan`     | tenantId, userId, examId?, hoursPerDay, status        | Private |
| `StudyPlanItem` | tenantId, planId, topicStableKey, plannedDate, status | Private |

Changes to existing: none; "taught" comes from the live entries' topics (`EntryTopic`) in the student's section.

**Permissions.** CR and S **own**; everyone else "-".

**AI tasks.**

| Task             | Model tier  | Cost per use                                                 |
| ---------------- | ----------- | ------------------------------------------------------------ |
| Explain the plan | not decided | **estimate** Luna $0.0008 or Mini $0.003 (2,000 in, 300 out) |

**Risks.** A plan that looks authoritative while class records are incomplete; frequent re-planning surprising the student.

**Build order.** Algorithm with unit tests; plan tables and routes; re-plan on scope change; explanation; screens; re-plan on mastery after feature 14.

**Open questions.**

- Where does topic **difficulty** come from (syllabus hours, AI, mastery)? Topic size can come from the syllabus hours.
- A plan with no exam: what is its end date?
- Several exams at once: one plan each or a combined plan?
- Model tier for the explanation, and which quota it counts toward.

---

## 13. Study cards

**Purpose.** One revision card per topic: summary, key concepts, definitions and examples, grounded in the syllabus and class content.

**Who uses it.** Students and CRs read cards. They are generated by the system.

**Flow.**

1. When an exam scope is published, background jobs generate a card for each topic in it, in batch, **once per topic**, shared by all students of the college. Cards are labeled AI-generated.
2. When the source version changes, the card is regenerated (or marked stale until it is).
3. The student opens a card from the plan and can ask "explain this simply" in a chat with the topic pinned (**explain mode**).

**Tables.**

| Table       | Key fields                                                            | Notes                     |
| ----------- | --------------------------------------------------------------------- | ------------------------- |
| `StudyCard` | tenantId, topicStableKey, syllabusVersionId, body, sourceHash, status | Shared within the college |

Changes to existing: `Conversation` gains a pinned topic for explain mode (today it pins a subject).

**Permissions.** Reading cards: CR and S for their own batch. Not listed for teachers and admins, so denied for now (see Open questions).

**AI tasks.**

| Task                  | Model tier | Cost per use                                                |
| --------------------- | ---------- | ----------------------------------------------------------- |
| Generate one card     | Terra      | **decided** $0.018, $0.009 with Batch (3,000 in, 1,000 out) |
| Explain mode question | as chat    | **decided** about $0.009 (an average chat question)         |

A scope of 40 topics costs about $0.36 with Batch, once per college, not per student.

**Risks.** A card presented as official content; cards waiting up to 24 hours for a batch; a card mixing class content from one section into another section's view.

**Build order.** Card generation job (Batch), staleness on source change, the trigger on scope publish, the card view, explain mode in chat, screens.

**Open questions.**

- Class content differs per section, but a card is shared by all students of the college. Which class content may a shared card use: syllabus only, or a card per section?
- What does a student see while a card is still in the batch queue: nothing, or a synchronous (full-price) generation?
- Are cards generated only for scoped topics, or for every topic of a published syllabus?
- May teachers or admins read (and review) cards? Principle 10 has humans approve syllabus, class content and scope, but not cards.

---

## 14. Study room (questions, grading, mastery)

**Purpose.** Practice with generated questions, graded against hidden rubrics, with private mastery tracking.

**Who uses it.** Students and CRs. Teachers and admins see aggregates only.

**Flow.**

1. The student picks an exam (the scope fills in) or, with no exam, subjects and topics, and a question type: short explanation, descriptive, compare and contrast, numerical, and for programming subjects code writing, tracing and debugging. **No MCQs.**
2. The system serves cached questions, each with a hidden rubric (key points and marks); for a topic with none, it generates and caches them. Questions and rubrics are shared.
3. The student answers in free text, or pastes code.
4. The AI grades against the rubric: correct, partly correct or incorrect, what was missed, a model answer, and a link to the topic card. For code it says that it read the code and did not run it.
5. Mastery per topic updates (private) and feeds the study plan. Weak areas are tentative, visible to the student and correctable by them.
6. Teachers and admins see aggregates, such as topics many students find hard.

**Tables.**

| Table      | Key fields                                                                                                       | Notes                     |
| ---------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------- |
| `Question` | tenantId, topicStableKey, syllabusVersionId, kind, prompt, rubric (json), marks, sourceHash, status, reportCount | Shared within the college |
| `Attempt`  | tenantId, userId, questionId, answerKind (TEXT, CODE), answerText, result (json), score, usageId                 | Private                   |
| `Mastery`  | tenantId, userId, topicStableKey, score, updatedAt                                                               | Private                   |

**Permissions.**

| Action                                       | SA  | UA  | PA  | T                 | CR  | S   |
| -------------------------------------------- | --- | --- | --- | ----------------- | --- | --- |
| Study plan, study cards, study room, mastery | -   | -   | -   | -                 | own | own |
| See which topics students find hard          | -   | agg | agg | agg (own classes) | -   | -   |

The rubric is never sent to the browser before the answer is graded.

**AI tasks.**

| Task                                      | Model tier | Cost per use                                                |
| ----------------------------------------- | ---------- | ----------------------------------------------------------- |
| Question bank per topic (10 with rubrics) | Terra      | **decided** $0.042, $0.021 with Batch (3,000 in, 3,000 out) |
| Grade one answer                          | Terra      | **decided** $0.009 (1,500 in, 500 out)                      |

At the quota of 100 graded answers, grading alone can reach $0.90 per student per month, the top of the brief's whole-product estimate.

**Risks.** Prompt injection inside answers; grading drift between similar answers; a bad generated question served to many students; cost of heavy users; aggregates small enough to identify one student.

**Build order.** Question generation and cache; grading with the rubric and injection tests; attempts; mastery; plan re-adjustment; aggregates; screens.

**Open questions.**

- Mastery is "from the student's own marks and quiz results": which marks (graded attempts only, or exam marks the student enters?), and what are "quiz results" when there are no quizzes?
- The smallest group an aggregate may show (so a small section does not expose one student).
- `Question.reportCount` implies students can report a bad question: what happens to a reported question, and who reviews it?
- Synchronous generation for a topic without cached questions (full price, slower) or wait for a batch?
- Is the 100-answer quota right given the cost above?

---

## 15. Usage dashboards, quotas and plan limits

**Purpose.** Show and control AI spend per college and per platform.

**Who uses it.** University Admin (own college), Program Admin (aggregates for their program), Super Admin (all colleges, plans and limits).

**Flow.**

1. Every AI call already writes a ledger row and is checked against quotas (built in feature 1).
2. The University Admin sees the college's usage and spend; the Super Admin sees all colleges and can change limits and plans.
3. Alerts fire when a college nears a limit.

**Tables.** `AiUsage`, `PriceTable`, `Quota` and `TenantPlan` exist already. No new table is decided.

**Permissions** (already in [permissions.md](permissions.md); the `usage.read` and `usage.readAggregate` actions exist in `authz`): view AI usage and cost: SA all colleges, UA own college, PA aggregates for own program; set plans and quotas: SA only.

**AI tasks.** None.

**Risks.** Showing per-student usage would reveal who uses the product how much; program aggregates need usage attributed to a program, which `AiUsage` does not record today.

**Build order.** Usage queries and routes; the University Admin page (under Settings); the Super Admin usage page (the "Usage" tab); plan and quota editing; alerts.

**Open questions.**

- Alert threshold and channel for a college nearing its budget (students already get a warning at 80% of their chat quota).
- How is a Program Admin's aggregate computed: add `programId` to `AiUsage`, or derive it from memberships?
- May the University Admin see usage per user, or only per feature and per role?
- Is the price table edited on a Super Admin screen or by migration?
- Do the decided later improvements (quotas on the college's own month, a per-CR photo-read quota) belong to this feature?
- Final plan tiers and prices (already open in the brief).

---

## 16. Nepali beta (only if the test passes)

**Purpose.** Let students ask in Nepali or Romanized Nepali, as a labeled beta, while content stays English-first.

**Who uses it.** Students and CRs.

**The test first.** About 20 real Nepali and Romanized student questions and about 10 real CR dictation clips, checking topic retrieval, answer correctness and transcript usability. Expected weak points: Romanized Nepali, technical terms, cross-language retrieval, and especially Nepali speech-to-text. If retrieval misses, try text-embedding-3-large ($0.13 per 1M tokens), which needs a full re-index.

**Flow.**

1. The language is detected as Nepali or Romanized Nepali.
2. The cheap model rewrites the question into English for retrieval.
3. The answer is generated in English from English content and translated back to the student's language; it is labeled "Beta translation".

**Tables.** Changes to existing: `Message.language` already exists. None new.

**Permissions.** As chat.

**AI tasks.**

| Task                      | Model tier        | Cost per use                                                     |
| ------------------------- | ----------------- | ---------------------------------------------------------------- |
| Detect and rewrite        | Luna (the router) | **estimate** under $0.0001 extra on the router call (200 tokens) |
| Translate the answer back | not decided       | **estimate** Luna $0.0009 (700 in, 600 out)                      |

**Risks.** Wrong technical terms in translation; Romanized spellings defeating retrieval; Nepali dictation unusable.

**Build order.** Run the test and record the results here; then detection and rewrite, translation, the label, and screens.

**Open questions.**

- Who collects the test questions and clips, and what pass mark decides "the test passes"?
- Does the beta include Nepali CR dictation, or only typed student questions?
- Translate with a separate call, or ask the answer model to reply in Nepali directly?
- Is a Nepali interface (strings) part of this beta? Strings are already kept in one place for that.
