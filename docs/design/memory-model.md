# Code-Mem memory model

Code-Mem has two independent stores:

- Project store: `<project>/memory/state.db`, containing facts about the current repository.
- Global store: `~/.cm/state.db`, containing reusable user knowledge and preferences.

The global store is not a second project. It is a user context layer. Default
recall may add a bounded set of global preferences to the current project
context, but it never changes the project snapshot, graph, detected stack, or
implementation decisions.

## Memory kinds

| Kind | Meaning | Typical source | Update rule |
|---|---|---|---|
| `fact` | Stable observed knowledge | scan, import, explicit save | Replace or supersede when evidence changes |
| `decision` | Choice plus reason and consequence | user or agent outcome | Save after a decision; correct when reversed |
| `procedure` | Repeatable workflow | runbook, successful fix | Save after a repeatable path is confirmed |
| `issue` | Failure, cause, fix, or next check | debugging session | Save when the symptom or resolution is durable |
| `artifact` | Useful file, command, endpoint, report, or output | scan or explicit save | Update when the artifact changes |
| `preference` | How the user generally wants work done | explicit user instruction | Global for cross-project preference; project for local constraint |
| `event` | Dated occurrence or change | temporal import or explicit save | Keep history; supersede only when the event was wrong |
| `inference` | Derived, lower-authority claim | semantic pass | Keep confidence/provenance visible; verify before promotion |

## Lifecycle layers

Layers describe the maturity of a memory, not its scope.

- `working`: temporary task context and active working-set items.
- `episodic`: captured conversation or event intake before consolidation.
- `semantic`: durable facts, decisions, issues, and artifacts.
- `procedural`: durable repeatable instructions.
- `user`: user preferences and profile information.

Messages, episodes, evidence, belief state, verification queue entries, links,
and vectors are supporting records. They provide provenance and retrieval
signals; they are not automatically equivalent to a verified fact.

## When to write

Use the smallest durable kind that preserves the useful result:

```bash
cm save --kind fact "The API verifies webhook signatures before parsing the body."
cm save --kind decision --title "Use Vitest" "Vitest is the project test runner because it matches the Vite toolchain."
cm save --kind procedure "Run cm update --memory --deep after a large repository change."
cm save --kind issue "Duplicate webhook deliveries were fixed with idempotency keys."
```

Do not save transport metadata, provider/model banners, secrets, guesses, or
short-lived progress. Conversation capture (`cm save --auto`) is an intake
record; consolidate or save a concise durable outcome separately.

## Global preferences and project context

Save a general preference explicitly in the global store:

```bash
cm save --global --kind preference --layer user \
  "I generally prefer Next.js, but project facts decide the active stack."
```

In a Python repository, recall may show this as `[global-preference]`. It is a
working-style hint, not a claim that the Python project uses Next.js. A
project-specific constraint belongs in the project store:

```bash
cm save --kind preference --layer user --tag project \
  "This repository must use Python 3.12 and FastAPI."
```

Default recall combines current-project results with relevant global memories
and injects a bounded preference slice. Use `--scope project` to diagnose only
the current repository, or `--scope global` to inspect the global store.

## Managed projects and explicit reuse

Every initialized project is registered in the per-user catalog at
`~/.cm/graphd/projects.json`:

```bash
cm projects
cm projects --json
cm projects show <project-id|path|name>
cm projects recall <project-id|path|name> "what fixed the deploy issue?"
cm projects graph <project-id|path|name>
```

The catalog is visible from every project, but another project's memory and
graph are never injected into normal recall. The `recall` and `graph` forms are
explicit boundary crossings.

## Maintenance

Run `cm consolidate` after a meaningful implementation/debugging cycle. Use
`cm project` to regenerate the human-readable `MEMORY.md` and `USER.md`
projections. The SQLite database remains the source of truth.
