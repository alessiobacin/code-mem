---
description: Restores the work created with `/continua`
---

Execute these steps:

STEP 1 — CHECK FILE
If this file does NOT exist:
.claude/handoff/current.json

Reply:
"No handoff found."
and stop.

---

STEP 2 — LOAD HANDOFF
Read:
.claude/handoff/current.json

---

STEP 3 — RESTORE CONTEXT
Reconstruct the context using:
- project
- phase
- goal
- state
- next_steps
- files
- decisions

---

STEP 4 — EXECUTION
Start directly from:
next_steps

DO NOT repeat analysis that has already been completed.

---

STEP 5 — CLEANUP
Delete:
.claude/handoff/current.json

---

STEP 6 — OUTPUT
Write:
"Restore completed. Resuming from the next steps."