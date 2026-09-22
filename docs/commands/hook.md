# `cm hook`

Handle a harness lifecycle event.

```bash
cm hook --event session_start
cm hook --event prompt < payload.json
cm hook --event response < payload.json
```

Hooks are installed by the deep workflow and remain best-effort so harness
operation is not blocked by memory failures.
