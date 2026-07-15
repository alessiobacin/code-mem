# The Philosophy of code-mem

## Why Yet Another Memory Tool?

Coding agents — Claude, Codex, Cursor, Pi — are becoming incredibly capable, but they all share the same structural flaw: **they don't remember what happened five minutes ago**.

Every new session is a blank slate. The project you explained yesterday, the architectural decision you made together, the workaround discovered after two hours of debugging — all gone. Files on disk are the only thing that survives, but they're mute: they don't say *why* a certain choice was made, they don't record the *reasoning* that led there, they don't track the user's *preferences*.

Existing memory systems solve this problem in different ways, but they often introduce disproportionate complexity. code-mem was born from a precise conviction:

> **Knowledge persistence shouldn't need an external database, a cloud service, or complex infrastructure. It should be one or two local SQLite files, a single-file CLI, and nothing else.**

## Founding Principles

### 1. Local-first, always

code-mem is local-first: project memory lives in `memory/state.db`, and optional cross-project memory lives in `~/.cm/state.db`. No server, no cloud, no API key. Both are plain SQLite files you can copy, back up, inspect, or move between machines.

Why? Because project memory belongs to the project, and reusable personal procedures belong to the user, not to an external service. When you clone a repository, the project memory — if versioned — comes with you. When you work offline, both stores still work. When you switch AI providers, the memory stays.

### 2. Kinds, layers, and gradations

Not all memory is equal. code-mem distinguishes:

**Knowledge kinds:**
- `fact` — objective truths about the project ("Uses TypeScript strict mode")
- `decision` — deliberate choices with reasoning ("Chose Vitest over Jest for speed")
- `procedure` — operational sequences ("To reset the local DB, run scripts/reset-db.sh")
- `issue` — known problems with causes and workarounds ("Fake timers break tests in parallel")
- `preference` — user preferences ("Concise answers with file references")
- `artifact` — references to components, modules, project entities

**Persistence layers:**
- `working` — freshly discovered, still needs validation
- `episodic` — tied to a specific session
- `semantic` — consolidated, enduring project truth
- `procedural` — repeatable procedures, context-independent
- `user` — personal user preferences

**Confidence:** every memory has a 0.0–1.0 score indicating reliability. Not everything saved is a certainty.

This layering lets an agent distinguish between "we just discovered this" and "this is a consolidated project fact" — a nuance most memory systems ignore.

### 3. Deterministic retrieval, enriched by embeddings

The heart of `cm recall` is a deterministic ranking engine that evaluates memories across eight dimensions simultaneously:

- **keyword match** — lexical relevance to the task
- **recency** — how fresh the memory is
- **access count** — how often it's been useful
- **context match** — same Git branch, same directory
- **kind priority** — the task type (debug, feature, refactor…) gives priority to certain memory kinds
- **graph score** — how many relationships it has with other memories
- **trigram similarity** (always available) — morphological similarity via character trigram embedding, zero dependencies
- **Ollama semantic score** (optional) — semantic similarity via `nomic-embed-text`

The result is that a memory can be retrieved even if it contains none of the searched keywords, simply because it's semantically similar. And unlike purely vector-based systems, it always falls back gracefully: if Ollama isn't available, the trigram fallback takes over — no loss of ranking dimensions, just different granularity.

### 4. Three formats, one database

code-mem produces multiple local views of the same information:

1. **`memory/state.db`** (SQLite) — source of truth for project memory
2. **`~/.cm/state.db`** (SQLite) — optional source of truth for global cross-project memory
3. **`MEMORY.md`** — a text projection for the project, always under ~2200 characters, designed to fit in an agent's context window
4. **`USER.md`** — a projection of user preferences, under ~1400 characters
5. **`graph.json`** — a lightweight graph of nodes (project, modules, technologies) and edges (dependencies, relationships)

The Markdown projections are *generated artifacts* — don't edit them by hand. The database is the sole source of truth.

### 5. Zero runtime dependencies

The `cm` CLI is a single Node.js file using `node:sqlite` (native in Node 22+). If your Node build only exposes it behind `--experimental-sqlite`, `cm` re-execs itself with that flag automatically. No npm dependencies, no packages to install, no external runtime.

The only optional dependency is [Ollama](https://ollama.com) with `nomic-embed-text` (137 MB) for semantic embeddings. If it's there, great. If it's not, everything works the same — just without semantic similarity.

### 6. For every agent, not just Claude

code-mem isn't tied to a specific agent. It works with:

- **Claude Code** — via skill + SessionStart hook
- **Codex** — via skill install
- **Cursor** — via skill install
- **Pi** — via skill install
- **Any CLI** — it's just `cm save` / `cm recall`

The SKILL.md is a lightweight contract: every agent understands when and how to use `cm` without learning a proprietary API.

## What code-mem doesn't do (and why)

### It's not a RAG system

code-mem doesn't index every file in the project. No chunking, no retrieval over arbitrary documents, no trying to answer questions about the code. It only deals with **project and operator memory**: decisions, facts, procedures, issues, preferences. For code search, there's grep, graphify, and the agent's own tools.

### It has no server

No daemon to keep running, no ports to expose, no health checks. The watch daemon is optional and only does embedding + auto-consolidation.

### It doesn't sync to the cloud

No sync, no real-time collaboration, no hosted backend. Memory is still local to your machine: project memories live in the repo, global memories live in `~/.cm/`. If you want to share them, commit `memory/` for project knowledge or use `cm backup --global` / `cm restore --global` for personal global knowledge.

### It's not a knowledge graph

`graph.json` is intentionally simple: typed nodes and related edges. No community detection, no dynamic weights, no inference. For architectural exploration, graphify is the right tool. code-mem tracks who depends on what, not how the architecture evolves.

## The Ideal Workflow

```
One-time setup:
  ollama pull nomic-embed-text   # 137 MB, optional
  cm init                         # creates memory/
  cm setup                        # installs skill + hook

Daily use:
  cm save --kind decision "..."   # after an important decision
  cm save --kind procedure --global "..."  # for reusable cross-project workflows
  cm recall "task"                # before starting a task
  cm touch <id>                   # when a memory proves useful
  cm consolidate                  # after an intense session

Automatic:
  cm watch --daemon               # background embedding + consolidation
                                  # SessionStart hook → recall-auto per session
                                  # recall-auto searches project + global memory
```

## Why Simplicity Wins

Project memory is a problem of *persistence*, not *power*. An SQLite file with FTS5, some vector embeddings, and a deterministic ranking engine cover 95% of use cases — and they do it without requiring infrastructure, recurring costs, or vendor lock-in.

code-mem would rather be boring and always work than smart and fragile. It would rather be local and portable than connected and powerful. It would rather be simple and documented than abstract and flexible.

This is its philosophy. And, we believe, its strength.

---

## See Also

- **[COMPARISON.md](COMPARISON.md)** — detailed comparison with other memory systems
- **[FILOSOFIA.md](FILOSOFIA.md)** — Italian version
