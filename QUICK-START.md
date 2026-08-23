# code-mem — QUICK START

Persistent project memory for coding agents and developers. One CLI, local files
only, no services, no external database. Requires **Node.js 22+**.

```bash
# install (single-file bundle, no dependencies)
curl -fsSL https://raw.githubusercontent.com/alessiobacin/code-mem/main/install.sh | bash
export PATH="$PATH:$HOME/.local/bin"
```

## 1. Init memory in your repo

```bash
cd your-project
cm init
```

This creates `memory/` with `MEMORY.md`, `USER.md`, `graph.json` and `state.db`.

## 2. Save a durable fact

```bash
cm save --kind fact "The API uses signed webhook verification."
# → Saved: mem_fact_h_53f1c7bf
```

## 3. Recall it for a task

```bash
cm recall "fix flaky e2e tests" --level 2
```

## 4. Capture a conversation row (and search it back)

```bash
cm save --auto --role dev "git worktree flow explained to agent"
# → Saved: mem_fact_h_2121cbe1
# → Captured dev message (session ...)
cm sq "worktree flow"
# → 1 results for "worktree flow":
#     [dev] git worktree flow explained to agent
```

## Full semantic search (optional)

Ollama with `nomic-embed-text` improves matching; **without it everything still
works** via a zero-dependency trigram fallback:

```bash
ollama pull nomic-embed-text
cm setup        # installs skill + SessionStart hook into .claude/settings.json
cm watch --daemon   # background daemon: embed + consolidate + project
```

## Developer note

`bin/cm` is a **generated single-file bundle**. Edit fragments under `src/`
(né edit `bin/cm` directly), then:

```bash
node build/bundle.mjs
```

`cm help` is deliberately lean — corollary graph/scan/query/entities/history
commands show only with `cm help --full` or `cm --full`.
