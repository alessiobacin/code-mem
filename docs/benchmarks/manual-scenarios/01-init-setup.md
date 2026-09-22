# Scenario 01 — initialization and setup

Goal: verify that `cm` initializes project memory and exposes the public CLI.

```bash
WORK=$(mktemp -d)
cd "$WORK"
cm --version
cm help
cm help --full
cm init
ls memory
cm definitely-not-a-command
```

Acceptance checks:

- version matches `x.y.z`;
- help lists core commands and `--full` lists import/graph/search surfaces;
- initialization creates `MEMORY.md`, `USER.md`, `graph.json` and `state.db`;
- an unknown command prints a clear diagnostic without crashing.
