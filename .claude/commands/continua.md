---
description: Performs a handoff and `/clear` so the context can later be resumed with `/ripristina`
---

Execute these steps:

STEP 1 — CREATE HANDOFF
Analyze the current context and save the state to:
.claude/handoff/current.json

Required JSON format:

{
  "project": "",
  "phase": "",
  "goal": "",
  "state": {
    "completed": [],
    "working": [],
    "issues": []
  },
  "next_steps": [],
  "files": [],
  "decisions": [],
  "notes": ""
}

Rules:
- `next_steps` must be sequential and operational
- no vague text
- include ONLY what is needed to resume

---

STEP 2 — CONFIRM
Write: "Handoff saved."

---

STEP 3 — CLEAR
Run the command:
/clear