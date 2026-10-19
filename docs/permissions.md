# Permission matrix

Who may do what, and where. This is the reference for the `authz` module and its tests. Product rules are in [Semwise_Project_Context.md](Semwise_Project_Context.md).

Legend: **Y** allowed everywhere in the role's scope; **own** only on the user's own records or classes; **prog** only inside the user's own program; **sec** only for the user's own section; **agg** aggregated figures only; **-** not allowed.

How the scoped cells are checked (as built in `modules/authz`):

- **own classes** (Teacher): for class-level records (entries, approvals), the teacher is assigned to that class. For structure and syllabus reads, the record sits on the path of a class they teach: its program, batch, semester, section or subject.
- **own batch** (Student): a batch they are enrolled in, or the program above it; that covers every semester and section of the batch.
- **sec** (CR, Student): the section they represent (CR) or are or were enrolled in (Student).
- A record in another college answers 404. A record the person may read but not change answers 403; one they may not read at all answers 404, so its existence does not leak.

Roles: **SA** Super Admin, **UA** University Admin, **PA** Program Admin, **T** Teacher, **CR** Class Representative (also a student), **S** Student.

## General rules

1. **Deny by default.** Anything not listed here is not allowed.
2. A user's rights in a college are the union of their memberships in that college; rights never carry across colleges.
3. The scope is always checked against the target record on the server, together with the role.
4. **Nobody, including SA and UA, can read a student's private notes, chat history, practice answers or mastery.** There is no support override in V1.
5. Teachers and admins see only aggregated study data.
6. Every create, update, approval, rejection, takedown and permission change is written to the audit log.

## Platform and tenant

| Action                                 | SA               | UA              | PA                | T   | CR  | S   |
| -------------------------------------- | ---------------- | --------------- | ----------------- | --- | --- | --- |
| Create, suspend and configure colleges | Y                | -               | -                 | -   | -   | -   |
| Create the first University Admin      | Y                | -               | -                 | -   | -   | -   |
| College settings (name, timezone)      | -                | Y               | -                 | -   | -   | -   |
| View AI usage and cost                 | Y (all colleges) | Y (own college) | agg (own program) | -   | -   | -   |
| Set plans and quotas                   | Y                | -               | -                 | -   | -   | -   |
| View audit log                         | Y                | Y               | prog              | -   | -   | -   |

## Academic structure and people

| Action                                              | SA  | UA  | PA   | T           | CR  | S         |
| --------------------------------------------------- | --- | --- | ---- | ----------- | --- | --------- |
| Create programs, assign Program Admins              | -   | Y   | -    | -           | -   | -         |
| Create batches, semesters, sections, subjects       | -   | Y   | prog | -           | -   | -         |
| View structure                                      | -   | Y   | prog | own classes | sec | own batch |
| Invite, resend, revoke, deactivate students         | -   | Y   | prog | -           | -   | -         |
| Assign sections and move students between semesters | -   | Y   | prog | -           | -   | -         |
| Grant or remove CR                                  | -   | Y   | prog | -           | -   | -         |
| Create classes and assign teachers                  | -   | Y   | prog | -           | -   | -         |

## Syllabus

| Action                                       | SA  | UA  | PA   | T           | CR  | S         |
| -------------------------------------------- | --- | --- | ---- | ----------- | --- | --------- |
| Upload, edit, request changes, publish, copy | -   | Y   | prog | -           | -   | -         |
| Read published syllabus                      | -   | Y   | prog | own classes | sec | own batch |
| Read draft syllabus                          | -   | Y   | prog | -           | -   | -         |

## Class content

| Action                                  | SA  | UA  | PA   | T                           | CR  | S   |
| --------------------------------------- | --- | --- | ---- | --------------------------- | --- | --- |
| Create an entry (text)                  | -   | -   | -    | own classes                 | sec | -   |
| Use voice or photo input                | -   | -   | -    | -                           | sec | -   |
| Edit own entries                        | -   | -   | -    | own                         | own | -   |
| Approve, edit or reject pending entries | -   | -   | prog | own classes                 | -   | -   |
| Take down or restore a published entry  | -   | Y   | prog | own classes                 | -   | -   |
| Read published entries                  | -   | Y   | prog | own classes                 | sec | sec |
| Read pending or rejected entries        | -   | -   | prog | own classes                 | own | -   |
| Set auto-approval default and lock it   | -   | Y   | prog | -                           | -   | -   |
| Override auto-approval for a class      | -   | -   | prog | own classes (unless locked) | -   | -   |

## Student features

| Action                              | SA  | UA  | PA  | T   | CR  | S   |
| ----------------------------------- | --- | --- | --- | --- | --- | --- |
| Ask questions in chat, use catch-up | -   | -   | -   | -   | own | own |
| Read or delete a chat conversation  | -   | -   | -   | -   | own | own |

CR rows for student features show **own** because a CR is also a student in their own section.

The rows for V2 features (notes, exams and exam scope, study plan, cards, study room, mastery, aggregates of hard topics) are in [roadmap-v2.md](roadmap-v2.md); they move here when each feature is built, and until then the rule of deny by default applies.

## Files

| Action                                       | Who                                                    |
| -------------------------------------------- | ------------------------------------------------------ |
| Get a signed upload URL for a syllabus PDF   | UA, PA (own program)                                   |
| Get a signed upload URL for audio or a photo | CR (own section)                                       |
| Transcribe audio or read a photo             | CR (own section), own uploads only                     |
| See a transcription or photo reading         | Only the person who uploaded the file                  |
| Get a signed download URL                    | Only users who may read the record the file belongs to |

## Required tests

For each row, the test suite must prove the "-" cells really fail with 403 or 404, and that crossing any boundary (another college, program, section, or student) fails. This isolation kit is built in feature 1 and extended by every later feature.
