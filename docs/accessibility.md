# Accessibility pass (D-R6)

Checked on 2026-11-14 against WCAG 2.2 AA, on a local build with a class of four students on the dashboard.

How it was checked:

- **Automated:** axe-core 4.10.3 (the engine Lighthouse uses), with the `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa` and `best-practice` rules. It was run on every page in dark and in light, with each theme set the way the header toggle sets it and the page loaded fresh.
- **Keyboard:** real Tab, Shift+Tab, Enter and Escape presses, with the focus ring checked on screen.
- **200% zoom:** each page in a 640px-wide viewport, which is a 1280px window at 200%. The check looked for any sideways scroll and any element past the right edge.

## Professor pages: fixed

All four professor pages (`/prof`, `/prof/setup`, `/prof/dashboard`, `/prof/messages`) now report **no axe violations in either theme**. They have no sideways scroll at 640px.

| Problem found | Where | Fix |
| --- | --- | --- |
| White text on the primary blue was 3.58:1, below 4.5:1 | Every primary button: Save, Start session, Ask, Enter as student | `--accent` darkened in light (5.16:1), lightened with a dark label in dark (7.13:1). Set in `frontend/app/globals.css`. |
| Muted grey on the light page background was 4.43:1 | Header nav links, the home page line | Light `--muted` darkened to L 0.52: 5.07:1 on the page, 5.52:1 on cards. The dark theme keeps HeroUI's own grey. |
| Unselected radio circles and text fields had no visible edge (WCAG 1.4.11 needs 3:1) | Hint-ceiling radios and all text fields | A 1px field border: 3.65:1 on light cards, 3.80:1 on dark cards. |
| A heading level was skipped (h1 then h3) | `/prof/messages` | A screen-reader-only `h2` names the message list. |

Keyboard, done-when:

- **Setup:** the order is Course → Title → Prompt → Answer key → Lecture notes → Concepts → Hint ceiling → Save. Every stop shows a focus ring.
- **Dashboard:** one Tab from the heatmap lands on the first student's "Open transcript" button, with a ring. Enter opens the transcript and moves focus into it. Escape closes it and puts focus back on that button.

## Student side: notes for Lebyy

The colour fixes above are theme tokens, so they also fixed the student page's buttons and muted text. With them, axe reports one thing left on each student-side page, and it is the same issue on both:

1. **`frontend/app/student/assignment/[id]/page.tsx:476`**, the start card. `Card.Title` ("Welcome back" / "Start working") renders an `h3` right after the page's `h1`, so the heading list skips h2. axe flags this as `heading-order`, in both themes.
   - HeroUI's `Card.Title` is always an `h3`; its `render` prop must keep the same element.
   - Suggested fix: a screen-reader-only `h2` above the card (as on `/prof/messages`), or a plain `h2` in place of `Card.Title`.
2. **`frontend/app/page.tsx:76` and `:112`**, the home page's "Student" and "Professor" cards. This is the same `h1` then `h3` skip, with the same fix.

Also checked on the student page and found fine:

- **200% zoom:** no sideways scroll.
- **Tab order:** the question field, the "What I tried" field, Snap your work, Try a smaller problem, Try to trick it, the debug drawer, then the side panel. There is no positive `tabindex`.
- **Side-panel tabs:** these follow the standard tabs pattern. Tab reaches the selected tab, and the arrow keys move to Notes and Revise, with a visible ring.
