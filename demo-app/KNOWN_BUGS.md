# Known bugs in the Tasker demo app

**This file is intentionally not linked from the main README.** It exists so
you can verify Argus actually catches real defects, rather than printing
"5/5 passed" against an app with nothing wrong with it.

All three bugs are deliberate. Do not fix them.

---

### BUG-1 — Delete removes the wrong task when two tasks share the same text

**Where:** `demo-app/src/server.ts`, `POST /tasks/delete`

The handler resolves the task to delete by matching on `text` instead of the
`id` that the form already submits:

```ts
const index = tasks.findIndex((t) => t.text === text);
```

The seed data contains two tasks both called *"Review pull request"*. Clicking
Delete on the **second** one removes the **first** one.

**Expected:** the clicked task is removed.
**Actual:** the first task with matching text is removed.
**Severity:** high — silent data loss, user deletes work they meant to keep.

---

### BUG-2 — "Mark complete" does not persist across a refresh

**Where:** `demo-app/src/server.ts`, the inline `<script>` in `tasksView()`

The checkbox handler updates the DOM optimistically and never posts to the
server. There is no persistence path at all for the completed state.

**Expected:** toggling a task complete, then reloading, keeps it complete.
**Actual:** the state resets on reload.
**Severity:** high — the core action of the app does not stick.

---

### BUG-3 — The add-task form accepts an empty string

**Where:** `demo-app/src/server.ts`, `POST /tasks/add`

No validation on either the client or the server. Submitting the form with an
empty input creates a blank task row.

**Expected:** empty submissions are rejected with a validation message.
**Actual:** a blank task is created and rendered.
**Severity:** medium — data quality issue, not data loss.

---

## Selector-drift rehearsal

`demo-app/src/server.ts` also serves as the fixture for the self-healing demo.
To produce a `selector_drift` verdict on demand, rename a button label — e.g.
change `Add task` to `Create task` in `tasksView()` — and re-run Argus against
tests generated **before** the rename. The tests will fail on a stale selector
while the app itself still behaves correctly, which is exactly the distinction
the triage stage is supposed to make.
