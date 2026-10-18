# UI/UX plan (web)

How the Semwise web app should look and behave. Used by every web feature. The goal: **clean, calm, fast, mobile-first**, so a student on a phone, a CR typing between classes, and a Program Admin on a laptop all feel at home. Screens per feature are listed in [app-flows.md](app-flows.md); the code structure is in [architecture.md](architecture.md).

## Principles

1. **Mobile first.** Design at 360 px wide first, then enlarge. Most students and CRs will use phones. No horizontal scrolling at 360 px, ever.
2. **One job per screen.** Each screen has one clear primary action. Details go behind a tap, not on the page.
3. **Show only what the role needs.** Students, CRs, teachers and admins see different navigation; nobody sees controls they cannot use.
4. **Honest AI.** Every AI answer shows where it came from and what kind of content it is (see labels below). Uncertainty and refusals are shown plainly, never hidden.
5. **Fast and forgiving.** Skeletons instead of spinners, optimistic updates where safe, clear errors with a retry, drafts that survive a refresh.
6. **Accessible by default.** Keyboard operable, readable contrast, never colour alone.
7. **Calm visual style.** Lots of whitespace, one accent colour, soft borders, restrained motion.

## Design tokens

Defined once in `styles/tokens.css` as CSS variables (same approach as the blog), consumed through Tailwind.

- **Colour:** neutral greys for surfaces and text, **one accent** (a calm blue or indigo) for primary actions and links. Semantic colours for status: success (published), warning (pending), danger (rejected, errors), info (AI-generated). Light and dark themes, following the system setting with a manual toggle.
- **Type:** one clean sans-serif family (for example Inter) with a small scale: 12, 14 (body on mobile 16), 18, 20, 24, 30. Line height 1.5 for text.
- **Spacing:** 4 px base scale (4, 8, 12, 16, 24, 32, 48). 16 px page gutters on mobile.
- **Shape:** 8 px radius for controls, 12 px for cards and sheets; 1 px borders; very light shadows.
- **Motion:** 150 to 200 ms ease-out; respect `prefers-reduced-motion`.

## Layout and navigation

| Screen width       | Navigation                                                                                     |
| ------------------ | ---------------------------------------------------------------------------------------------- |
| Phone (under 768)  | Top bar (college name, profile) + **bottom tab bar** with at most 5 items, labels always shown |
| Tablet and desktop | Left **sidebar** with the same items, collapsible; content centred with a readable max width   |

- Tabs per role (V1):
  - **Student:** Chat, Catch-up, Exams (later), Notes (later), Profile.
  - **CR:** Today (new entry), My entries, plus the student tabs.
  - **Teacher:** Approvals, My classes, Exams (later).
  - **Program and University Admin:** Overview, Structure, Syllabus, Students, Classes, Settings; usage under Settings.
  - **Super Admin:** Colleges, Usage.
- Users with several roles get a **role switcher** in the profile menu; users in several colleges get a **college switcher** at login and in the top bar.
- Touch targets are at least 44 by 44 px on mobile (WCAG's own minimum is smaller; 44 is the common platform guideline).
- Wide tables become **card lists** on mobile; filters move into a bottom sheet.

## Key screens

**Chat (student).** Full-height conversation. Message input fixed at the bottom with the on-screen keyboard handled correctly. A **subject chip** above the input shows "All subjects" and can be tapped to pin one. Suggestion chips: "What was taught today?", "Explain the last topic", "What's in the next exam?". Answers stream in. Under each answer, **source chips** (date or syllabus unit) open a bottom sheet with the original entry. A small **label** marks the kind of content: _From syllabus_, _Reported in class_, _General explanation_, _Beta translation_. "Unrelated question" and "no answer found" have their own calm message styles. A quota meter appears only when close to the limit.

**Catch-up (student).** A horizontal date strip (swipeable) with a range picker; below, one card per subject with the stored summary and the topics, plus "Ask a follow-up" that opens chat with that context.

**Today / New entry (CR).** The fastest screen in the product. Subject chips (the section's subjects), the date defaulting to today, a large text area for topics, then the microphone and camera buttons. Voice and photo results appear as editable text before submitting. A duplicate warning offers "Replace or add". After submit: status chip (Published or Waiting for teacher).

**Approvals (teacher).** A list of pending entries as cards (subject, date, author, topics). Tap to open; **Approve**, **Edit**, **Reject** with a short reason. Bulk-select for approve-all. A badge on the tab shows the count.

**Syllabus review (admin).** Desktop: three columns, topic tree | source PDF page | proposed changes (diff). Mobile: the same as tabs. Low-confidence items have a warning mark. A box at the top takes plain-language change requests; proposed changes appear as before/after rows with Accept and Reject.

**Student invites (admin).** Add one or paste/upload a CSV; a preview table shows errors per row; sending shows progress ("120 of 400 sent today") and per-row status with resend and fix actions.

**Exam scope (later).** One text box ("Unit 1 to Unit 5, skip 2.4") above the topic tree; matched topics highlight; Confirm publishes.

## Shared components

Build once in `components/ui` and reuse: Button, IconButton, Input, Textarea, Select, Checkbox, Switch, Tabs, Badge and StatusPill, Card, List item, **Bottom sheet / Drawer**, Dialog, Toast, Skeleton, EmptyState, ErrorState, Avatar, DatePicker and DateStrip, Stepper, Tree, DiffView, **SourceChip**, **ContentLabel**, FileDropzone, ProgressBar, Tooltip.

## States and feedback

- Every screen designs four states: **loading** (skeleton), **empty** (what this is, one action), **error** (plain words, retry), **success**.
- Long jobs (syllabus extraction, transcription) show a progress state with the job status from the API, and the user can leave and return.
- Forms validate with the shared Zod schemas, show errors beside the field, and keep typed text on failure.
- Offline or flaky network: keep drafts locally and say so; never lose a CR's entry.
- Destructive actions ask once, with specific wording ("Reject this entry?").

## Accessibility

- Text contrast meets WCAG AA; focus rings are visible; everything works with a keyboard; sheets and dialogs trap and restore focus.
- Icons have labels; status is shown by text and icon, not colour alone; form fields have visible labels.
- Respect reduced motion and text-size changes.

## Performance

- Server Components by default; client components only where interaction needs them.
- Route-level code splitting; images through `next/image`; no heavy editors (the blog's Monaco is not needed here).
- Dates shown in the college's timezone, using the API's ISO values.

## References and what we take from them

These are for inspiration on patterns, not to copy designs.

- **AI chat patterns** (suggestion chips, visible sources, a context area, recovery actions instead of thumbs up/down, graceful failure): [Parallel HQ on LLM chat UX](https://www.parallelhq.com/blog/llm-chat-ux-patterns), [UXMagic on AI chat design patterns](https://uxmagic.ai/blog/ai-chat-interface-design-patterns), [The Front Kit on AI chat UI in 2026](https://thefrontkit.com/blogs/ai-chat-ui-best-practices).
- **Mobile navigation** (bottom tab bar with few labelled destinations, reachable by thumb): [Bottom tab bar best practices](https://bootcamp.uxdesign.cc/bottom-tab-bar-design-best-practices-navigating-user-experience-with-finesse-4dc63420f35d), [Uxcel mobile design course](https://app.uxcel.com/courses/mobile-design/mobile-navigation--input-components-693).
- **Product feel:** the clarity of class-card layouts in classroom tools, the quiet writing surface of Notion, the dense but calm admin tables of Linear, and the answer-plus-sources layout of Perplexity-style assistants.
- Before building each screen, the builder should look at two or three live examples of that pattern, note what to borrow in one or two lines, and then design the screen to our tokens.

## Checking the work

- Build every screen mobile first, then widen.
- Check each screen at **360, 768 and 1280 px** (screenshots with Playwright), light and dark, and confirm there is no horizontal scroll at 360 px.
- Run the keyboard through the main flow; check focus order.
- Strings live in one place (English only for now) so Nepali can be added later.
