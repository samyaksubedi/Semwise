# Build prompt for Claude Code

Paste the text between the lines into Claude Code, opened in the Semwise folder. It pushes the planning commit, then builds V1 (features 0 to 9) one at a time, backend first and then the web screens.

---

You are building Semwise. First read `CLAUDE.md`, then every file in `docs/`. Follow them strictly.

**Step 0: push the planning.** Run `git status` and `git log --oneline -3`. The planning docs were committed locally; push them with `git push -u origin main`. If the push fails (authentication or remote problems), stop, explain what failed and what I should do, and do not continue.

**Step 1: backend, one feature at a time.** Implement features 0 to 9 from the build list in `docs/architecture.md`, in order:
0 scaffold, 1 foundations, 2 tenant provisioning and academic structure, 3 invitations and enrollment, 4 classes, 5 syllabus ingestion, 6 class entries and approvals, 7 CR voice and photo input, 8 student Q&A, 9 catch-up and date-based questions.

For each feature:
1. Read its flow in `docs/app-flows.md`, its tables in `docs/data-model.md`, and its rows in `docs/permissions.md`. Make a short task list with TaskCreate.
2. Implement the API module(s), worker jobs, shared Zod schemas, Prisma migration, and audit entries, following the module pattern in `docs/architecture.md`.
3. Write tests: happy path, validation, permission denials, and cross-tenant, cross-section and cross-student isolation. Mock OpenAI, R2 and email.
4. Run lint, format check, typecheck, tests and build until all pass.
5. Tick the feature in the build checklist, update `docs/local-setup.md` and any doc whose decision changed.
6. Commit with a conventional message (`feat(<module>): ...`), then continue to the next feature without waiting for me, unless you are blocked.

**Step 2: web, after feature 9 is done.** Build the web screens for features 1 to 9 in the order of the flows (login, admin structure, invitations, syllabus review, CR entry, approvals, student chat, catch-up). Follow `docs/ui-ux.md`: mobile first, clean, with the shared components, and check each screen at 360, 768 and 1280 px in light and dark. Before each screen, look at two or three live examples of the pattern online and note in one or two lines what you borrow. Commit after each screen group.

**Rules while working**
- Do not skip tenant isolation, authz or the usage ledger to go faster.
- If a doc is ambiguous or contradicts the code, stop and ask me.
- Ask me for real keys (OpenAI, R2, Gmail app password) only when a manual end-to-end check truly needs them; everything else must work with mocks, MinIO and Mailpit.
- Never commit secrets or `.env` files.
- If your context gets long, finish the current commit and write `docs/HANDOFF.md` with what is done, what is next, and open questions, then tell me to start a fresh session with this same prompt (it resumes from the checklist and `HANDOFF.md`).
- At the end, give me a short summary: what works, what is mocked, how to run it, and what is left.

---
