# Margin

The product law is `.cursor/rules/project.mdc`. Follow it. The work split is `docs/BOARD.md`.

A task is done when its commit is on `main`. Then mark the box. Do not edit `docs/BOARD.md` or `docs/index.html` to record that.

```
curl -fsS -X POST https://margin-board-ochre.vercel.app/api/tasks \
  -H 'content-type: application/json' \
  -d '{"id":"L-B1","done":true}'
```

Use the task id from the board. `done` is true after the commit is on main, and false only to undo a wrong mark.
