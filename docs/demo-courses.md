# Demo click path: courses and slides

This is the course-portal path. The two-minute demo script in `.cursor/rules/project.mdc` is unchanged, and `/prof/dashboard` and `/prof/messages` still work at the same URLs.

## Before the demo, once, through the UI

Do these steps through the UI only. No script.

1. **Set up the class.** As the professor, open `/prof/courses`, then Undergraduate Electrostatics 101, then Overview. Set the code (`PHYS 101`) and the term, then Save.
2. **Upload the deck.** Open Slides and upload the team's Lecture 3 PDF. Set the lecture number to 3 and give it a title.
3. **Link the deck to the assignment.** Open Assignments, then Edit on Problem Set 3. Tick Lecture 3 under "Lectures this assignment covers", set a due date, and Save.
4. **Run real sessions.** Have real students do sessions, so the dashboard and the Thursday card have something to show.

## Student

1. Open `/` (My courses). The class card shows "N due this week", and Due soon lists Problem Set 3.
2. Open Undergraduate Electrostatics 101, then Assignments, then Problem Set 3.
3. Write a wrong first step, such as V = C / Q, and press Check my work. Margin's hint names `[Lecture 3, slide n]`.
4. Click the citation. The class's Lecture slides tab opens at that slide.

## Professor

1. Open `/prof/courses`. The class card shows the weakest concept from the newest Thursday card.
2. Open the class, then Dashboard. It shows the weakest concept, and Problem Set 3 opens `/prof/dashboard` for that assignment.
3. Go to Generate the card, then Messages.

## Lecture decks

The decks the three classes use are in `docs/lectures/`, as `.pptx` to edit and `.pdf` to upload under Slides. They hold the lectures only. The answer keys are not in the repo: they are entered through the assignment form and stay in the database.

| Class | Lecture | File |
|---|---|---|
| Undergraduate Electrostatics 101 | Lecture 3, Electric Charge, Field, and Potential | `physics200-lecture3-electrostatics` |
| ME 201: Engineering Statics | Lecture 4, Equilibrium, Trusses, and Friction | `me201-lecture4-equilibrium` |
| CS 251: Data Structures and Algorithms | Lecture 5, Complexity, Sorting, Trees, and Graphs | `cs251-lecture5-core-structures` |

The worked examples on the slides use different numbers from the problem sets, so a slide cited at hint level 2 teaches the method without showing an answer.
