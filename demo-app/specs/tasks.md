# Add a task

Route: /

A user types a description into the new-task input and submits the form.
The task appears at the bottom of the task list. Submitting an empty
description must be rejected with a validation message rather than creating
a blank row.

# Mark a task complete

Route: /

A user ticks the checkbox beside a task. The task text is struck through, and
the completed state survives a page reload — completion is persisted, not just
a client-side style change.

# Delete a task

Route: /

A user clicks Delete beside a task. That specific task is removed from the
list, including when several tasks share identical text. No other task is
affected.

# View task statistics

Route: /stats

The stats screen reports total tasks, completed count, open count, and a
completion percentage. The numbers agree with the contents of the task list.
