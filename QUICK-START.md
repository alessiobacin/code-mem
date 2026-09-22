# code-mem — QUICK START

Persistent project memory for coding agents and developers. One CLI, local files
only, one optional per-user loopback graph service, and no external database. Requires **Node.js 22+**.

```bash
# install (single-file bundle, no dependencies)
curl -fsSL https://raw.githubusercontent.com/alessiobacin/code-mem/main/install.sh | bash
export PATH="$PATH:$HOME/.local/bin"
```

## 1. Init memory in your repo

```bash
cd your-project
cm init --deep
```

This creates `memory/` with `MEMORY.md`, `USER.md`, `graph.json`, `state.db`,
and `graph-3d.html`. It detects installed harnesses, installs project-local
hooks and the `/cm-update` command, indexes the complete repository, and uses
the selected harness CLI/settings for a read-only semantic relation pass.

After repository changes, run:

```bash
cm update --memory --deep
```

The lower-level `cm scan`, `cm entities`, and `cm gc` commands remain available
for diagnostics and compatibility; they are not required for a complete index.

See [`docs/commands/README.md`](docs/commands/README.md) for one cheat sheet
per command. Use `cm projects` to list every Code-Mem-managed repository known
to this user installation. Other project memory is accessed only with an
explicit selector: `cm projects recall <id> "query"` or `cm projects graph <id>`.

To import Markdown knowledge from any external folder, use the generic importer:

```bash
cm import /path/to/source-folder
```

It infers the source structure, uses the configured harness LLM (or a local
LLM) when available and asks whether imported Markdown files should be deleted after success. The
default keeps the source unchanged. Set `CM_IMPORT_MODEL` to choose the local
model; unavailable models trigger a deterministic fallback.

### Media and images

`cm import` also ingests non-Markdown media in the same folder:

- **PDF / Office / HTML / CSV / EPUB** → markitdown (offline), extracted to text.
- **Images** → a vision-capable harness reads them natively (diagram layout,
  chart metrics, component labels, visible connections). Every label becomes a
  `vision-element` graph node and every visible link an edge, so diagrams are
  queryable via `cm query`. Labels are cross-checked against OCR text to reject
  hallucinations. With no reachable vision harness the deterministic
  `tesseract` OCR path is used instead.
- **Audio / video** → `whisper` transcription when present, otherwise an
  `ffmpeg` metadata stub noting the asset.

Set `CM_IMPORT_NO_MEDIA=1` to skip media entirely, or `CM_NO_LLM=1` to force the
deterministic OCR-only path. `CM_VISION_DEBUG=1` prints vision-stage timing.

## 2. Save a durable fact

```bash
cm save --kind fact "The API uses signed webhook verification."
# → Saved: mem_fact_h_53f1c7bf
```

## 3. Recall it for a task

```bash
cm recall "fix flaky e2e tests" --level 2
```

## 3b. Navigate the code graph (with line numbers) and read the report

```bash
cm query "login"
# * handleLogin (function) [seed] @ src/api.js L3
#   - login (function) [calls] @ src/auth.js L1
cm report   # god nodes, cross-community surprises, questions -> memory/GRAPH_REPORT.md
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

# general preference, available as context in every project
cm save --global --kind preference --layer user \
  "I generally prefer Next.js, but project facts decide the active stack."
```

## Developer note

`bin/cm` is a **generated single-file bundle**. Edit fragments under `src/`
(never edit `bin/cm` directly), then:

```bash
node build/bundle.mjs
```

`cm help` is deliberately lean — corollary graph/scan/query/entities/history
commands show only with `cm help --full` or `cm --full`.
