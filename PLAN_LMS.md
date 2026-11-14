# Course portal plan

Margin gets a course-portal layout: course cards, course pages with lecture slides and dated assignments, and Margin inside each assignment. This file is the short plan. Work is done in the milestones below, one commit each, with the backend suite and the red-team run after each.

## What already exists

Classes already work (Lebyy, `63dca46`):

- A `Course` has a name, description, a professor label, and notes. `CourseMaterial` keeps text only; an uploaded file is discarded.
- The pages are `/course/[id]` and `/prof/courses/[id]`.
- The tutor reads a class's notes through `classNotes()` in `backend/src/routes.ts`.
- The level-2 citation comes from `searchNotes` in `backend/src/notes.ts`.

## What is added

- **Course fields:** `code`, `term`, `accent`. The accent is one of six theme tokens.
- **Assignment fields:** `due_at`, `margin_enabled` (default on, so every saved assignment behaves as before), and `lecture_ids`.
- **Enrollments:**
  - A student joins a class with a button.
  - Starting a session in a class also enrolls them.
  - No student is enrolled by a script.
- **Lecture slides:**
  - A professor uploads a PDF (PDF only, 20 MB at most). The file must begin with `%PDF-`, whatever its name says.
  - The file is stored in MongoDB GridFS under a random id. It never goes to the disk, so a redeploy cannot lose it, and no seed step is needed.
  - Text is read per page with pdf.js into `slide_pages`. A page with no text is stored empty and flagged to the professor. There is no OCR.
- **Slides and the tutor:**
  - An assignment can name the lectures it covers. Level-2 hints then search those slides, labelled "Lecture n, slide p".
  - The tutor writes `[Lecture n, slide p]`, and the student page turns that into a link that opens the viewer at that page.
- **Submission status:** read from sessions. No session is not started, a session is in progress, and Finish (now Submit) is submitted.
- **Margin off:** an assignment with Margin off shows its prompt and due date and the line "Margin isn't enabled for this assignment by your professor." Every tutor route refuses it before any model call.

## What is not added, and why

- **No seeded courses, students, slides, or assignments, and no re-seed on startup.**
  - The product rule (`.cursor/rules/project.mdc`, real MVP) forbids invented records.
  - The other courses are the ones professors have saved through the UI.
  - A professor can turn Margin off on a real assignment to show that state.
- **No real course or real professor.** The live course is the team's own "Undergraduate Electrostatics 101", and its deck was written by the team.
- **No Blackboard name, logo, colours, or copied screens.** Only the general layout is borrowed.

## Rule change

project.mdc said a class file "is stored as text… The file itself is not kept." Lecture slides are now kept as the PDF so students can view them, and are read into text per page. That line is updated in milestone 4. Other class materials still keep only their text.

## Milestones

1. Models, enrollment, new fields on the routes.
2. Student: My courses, course Overview and Assignments.
3. Assignment page: breadcrumbs, due date, Submit, the Margin-off state, the chat as a bottom drawer on narrow screens.
4. Slides: upload, storage, per-page text, viewer, and the professor's Slides tab.
5. Slides in Margin: lectures linked per assignment, slide context at level 2, clickable citations.
6. Professor: course cards, course tabs, dashboard link per course. The old URLs keep working.
7. Polish: due soon, status chips, empty states, 360px check, README.
