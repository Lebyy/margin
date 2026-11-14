# Margin

The AI tutor your professor approves of.

This repository was created during HackPrinceton Fall 2026.

## Install

From the repository root:

```bash
npm install
npm install --prefix frontend
npm install --prefix backend
```

The API listens on port 4000 without a local env file. Copy the example if you want to change that port or set a model key:

```bash
cp .env.example .env
```

`.env` stays untracked. Do not commit secrets.

## Run

Both apps:

```bash
npm run dev
```

One at a time:

```bash
npm run dev:web
npm run dev:api
```

- Web: http://localhost:3000
- API health: http://localhost:4000/health

## Screens

- `/` picks a side. The two sign-ins are the words `student` and `prof`. There is no password.
- `/prof/setup` saves the assignment. The answer key is sent once, in the request body, and is never sent back.
- `/student/assignment/:id` is the chat on paper: the hint level always in view, a separate "what I tried" box, and a red mark in the margin beside the student's own line. `Ctrl` + `.` opens the demo-only debug drawer, which shows the scribe, policy, tutor, and guard steps for each turn.
- `/prof/dashboard` shows the Thursday card and the concept heatmap first, then three lines per student and a transcript drill-down. Every number is the one the API returned.
- `/prof/messages` lists the professor message written with each Thursday card.

The UI is HeroUI v3, Animate UI, and shadcn only, in dark and light. The rule is `.cursor/rules/ui.mdc`.

## Guard

Fifteen attacks and five benign controls, printed pass or fail by class:

```bash
npm run redteam
```

The run does not call the model. An attack passes when a draft that contains the solution is held and the reply is the fallback question. A benign control passes when the hint comes back as itself.

## Team board

Lebyy and David (GitHub WobbbleFoot) split the work on a two-column board. The shareable page is https://margin-board-ochre.vercel.app . The same brief is [docs/BOARD.md](docs/BOARD.md). Read it before writing code. Do the backend row first.
