# Margin

The product law is `.cursor/rules/project.mdc`. Follow it. The work split is `docs/BOARD.md`.

Lebyy's machine is a MacBook Air M1 (`hw.model` is `MacBookAir10,1`, the chip is Apple M1). David's machine is a ThinkPad T480. Check the hardware before editing and again before pushing. The MacBook Air does only `L-*` tasks and must not push a `D-*` commit. The ThinkPad does only `D-*` tasks and must not push an `L-*` commit. If the machine matches neither, stop. Do not force-push.

A task is done when its commit is on `main`. Then mark the box. Do not edit `docs/BOARD.md` or `docs/index.html` to record that.

```
curl -fsS -X POST https://margin-board-ochre.vercel.app/api/tasks \
  -H 'content-type: application/json' \
  -d '{"id":"L-B1","done":true}'
```

Use the task id from the board. `done` is true after the commit is on main, and false only to undo a wrong mark.
