# Comparison: code-mem vs Other Memory Systems

> This document compares code-mem with the major memory systems for AI agents, analyzing the strengths and weaknesses of each across various use cases.

## System Overview

| System | Description | Author | License |
|--------|-------------|--------|---------|
| **code-mem** | Persistent, local, agent-agnostic project memory with optional global memory | Alessio Bacín | MIT |
| **claude-mem** | Cross-session memory for Claude Code, MCP cloud-based | (Community) | Apache-2.0 |
| **graphify** | Knowledge graph from codebase with AST + semantic extraction, community detection | Safi Shamsi | MIT |
| **Claude Code file memories** | Native Claude Code memory system based on Markdown files | Anthropic | Proprietary |
| **Mem0** | LLM memory platform, cloud-first with API | mem0.ai | Apache-2.0 |
| **Zep** | Long-term memory for AI assistants with entity analysis | Zep AI | Apache-2.0 |
| **LangMem** | LangChain memory SDK for AI agents | LangChain | MIT |
| **Letta (MemGPT)** | Agent with hierarchical virtual memory (core + archival) | Letta AI | Apache-2.0 |

---

## code-mem vs claude-mem

claude-mem is an MCP server offering persistent, cross-project memory with semantic search via remote API.

| Dimension | code-mem | claude-mem |
|-----------|----------|------------|
| **Where it lives** | `memory/state.db` + optional `~/.cm/state.db` | Remote API (cloud MCP) |
| **Search** | Local FTS5 + optional semantic embedding (Ollama) | Semantic search via remote MCP API |
| **Dependencies** | Zero (Node 22+ built-in) | npm + MCP plugin + remote server |
| **Agent support** | Claude, Codex, Cursor, Pi, CLI | Claude Code only (MCP-based) |
| **Cost** | Zero | API calls to remote server |
| **Offline** | Fully offline | Requires connection |
| **Privacy** | Data never leaves the machine | Data passes through remote server |
| **Memory types** | 6 kinds, 5 layers, confidence, salience | Simple (title + text) |
| **Graph** | Lightweight JSON graph | None |
| **Context cost** | Fixed ~1300 tokens (MEMORY.md + USER.md) | Variable, depends on recall |
| **Install** | `curl ... \| bash` | `npm install -g claude-mem` + MCP config |
| **Auto-recall** | SessionStart hook with `cm recall-auto` | MCP tool invoked by agent |

### code-mem advantages

- **Zero recurring costs** — no API server to maintain
- **100% offline** — perfect for planes, trains, or restrictive corporate networks
- **Total privacy** — memories never leave your machine
- **Agent-agnostic** — works with any coding agent, not just Claude Code
- **Kinds and layers** — semantic distinction between fact, decision, procedure, issue

### code-mem disadvantages

- **No hosted cross-project persistence** — global memory is local to one machine unless you back it up and restore it elsewhere
- **No cloud sync** — no way to share memory across machines
- **Weaker semantic search** — based on local Ollama, not specialized cloud models
- **No sharing** — can't share memories with the team in real time

### When to choose code-mem

- You work alone or in a small team on local projects
- You have privacy requirements (sensitive data, IP that mustn't leave the machine)
- You want zero setup and zero costs
- You often work offline

### When to choose claude-mem

- You use Claude Code and want memory that persists across different projects
- You need powerful semantic search without configuring Ollama
- You can afford an external MCP server and the required connectivity

---

## code-mem vs graphify

graphify builds a navigable knowledge graph from a codebase, with AST extraction, agent-based semantic extraction, community detection, and interactive HTML visualization.

| Dimension | code-mem | graphify |
|-----------|----------|----------|
| **Purpose** | Persistent project memory | Codebase exploration and mapping |
| **Main output** | `state.db` + `MEMORY.md` + `graph.json` | `graph.html` + `GRAPH_REPORT.md` + Obsidian wiki |
| **Data source** | User-saved decisions, facts, procedures | All project files (code, docs, images) |
| **Extracts from** | Manual input (`cm save`) | AST (code) + LLM agents (docs, papers, images) |
| **Search** | FTS5 + embedding + deterministic ranking | BFS/DFS graph traversal + query |
| **Persistence** | Per-session and cross-session (DB) | Per-run or incremental; no persistent "memory layer" |
| **AST extraction** | Initial scan only (technologies, dirs) | Full AST on .py, .ts, .js, .go, .rs files |
| **Community detection** | No | Yes — finds latent thematic clusters |
| **Visualization** | Markdown | Interactive HTML, SVG, Obsidian vault, wiki, GraphML, Neo4j |
| **Token cost** | Fixed ~1300 per projection | Variable — can be high (LLM calls for semantic extraction) |
| **LLM dependency** | Optional (only Ollama embeddings) | Required for semantic extraction (Claude subagents) |
| **Use cases** | Remembering decisions during daily development | Understanding unfamiliar code, archaeology |
| **Install** | `curl \| bash` | `pip install graphifyy` |

### code-mem advantages

- **Active, persistent memory** — not a static map, but memory that grows with daily use
- **Low cost** — no LLM calls needed for basic operation
- **Built-in retrieval** — `cm recall` gives immediate results, no graph exploration needed
- **Temporal layers** — distinguishes fresh knowledge from consolidated facts

### code-mem disadvantages

- **No automatic discovery** — doesn't find connections in code on its own; you save manually
- **Can't answer architectural questions** — can't explain how two modules interact
- **No visualization** — no interactive graphs, no visual exploration

### When to choose code-mem

- You need a memory system you use every day during development
- You want to remember decisions, bugs, and procedures across sessions
- You work on projects you already know

### When to choose graphify

- You're new to a codebase and want to understand its architecture
- You have a corpus of documents, papers, notes whose connections to explore
- You want a visual, navigable map of the codebase
- The project has thousands of files and you need orientation

---

## code-mem vs Claude Code file memories

Claude Code offers a native memory system based on Markdown files with YAML frontmatter (`CLAUDE.md`, files in `.claude/projects/`, and the project `memory/` folder).

| Dimension | code-mem | Claude Code file memories |
|-----------|----------|---------------------------|
| **Storage** | SQLite (structured DB) | Flat Markdown files |
| **Types** | 6 kinds, 5 layers, confidence, salience | No types — all Markdown |
| **Search** | FTS5 + optional embedding + multi-dimension ranking | Manual (grep on files) |
| **Context cost** | Fixed ~1300 tokens (projections) | Proportional to files loaded in context |
| **Versionable** | Yes (DB can be committed) | Yes (text files) |
| **CLI** | `cm` — full CLI for CRUD, recall, watch, graph | None — manual editing only |
| **Automation** | Watch daemon, consolidate, recall-auto, SessionStart hook | None — manual updates only |
| **Graph** | Yes (lightweight JSON graph) | No |
| **Conversation search** | Yes (FTS5 over messages) | No |
| **Offline** | Yes | Yes |
| **Portability** | Any agent (Claude, Codex, Cursor, Pi, CLI) | Claude Code only |
| **Embedding** | Optional (Ollama, nomic-embed-text) | None |
| **Legacy compat** | Imports legacy MEMORY.md/USER.md | N/A |

### code-mem advantages

- **Powerful search** — FTS5 full-text + semantic embedding + deterministic ranking
- **Automation** — watch daemon, auto-consolidation, recall-auto per session
- **Structured types** — not everything is a text blob; fact, decision, procedure have different meanings
- **Graph** — relationships between memories and project elements
- **Full CLI** — never need to edit files by hand
- **Minimal context** — projections always under 2200/1400 characters

### code-mem disadvantages

- **Depends on node:sqlite** — requires Node 22+
- **Not "native"** — requires separate installation
- **More complex** — if you just want to "jot down two lines", Markdown files are simpler

### When to choose code-mem

- You need structured search across memories
- You want automation (consolidation, watch, automatic recall)
- You work across multiple different agents
- You need to track decisions, procedures, and issues with metadata

### When to choose Claude Code file memories

- You only use Claude Code and don't want to install anything
- You have very simple, few annotations
- You prefer editing Markdown files by hand
- You don't have Node 22+ available

---

## code-mem vs Mem0

Mem0 is an LLM memory platform with REST API, automatic embedding, and historical summarization.

| Dimension | code-mem | Mem0 |
|-----------|----------|------|
| **Architecture** | Local, file-based | Cloud, REST API |
| **Setup** | `curl \| bash`, `cm init` | `pip install mem0ai` + API key |
| **Storage** | Local SQLite | Remote database (MongoDB + vector) |
| **Embedding** | Optional (local Ollama) | Automatic, multi-model (OpenAI, Claude, Ollama) |
| **Search** | Deterministic + hybrid semantic | Pure vector semantic |
| **Cost** | Zero | Paid (free tier limited, pro, enterprise) |
| **Offline** | Yes | No |
| **Privacy** | Total (local) | Data resides on Mem0 servers |
| **Types** | 6 kinds, 5 layers | Generic — text + metadata |
| **History** | Hash-based versions | Full modification history |
| **Integration** | Any agent (skill install) | Python SDK + REST API |
| **Auto-consolidation** | `cm consolidate`, watch daemon | Automatic history summarization |
| **Multi-user** | No (single-user local stores) | Yes (native multi-user) |

### code-mem advantages

- **Zero cost** — no plans, no limits, no billing surprises
- **Absolute privacy** — no data leaves your computer
- **Works offline** — train, plane, locked-down corporate networks
- **Install in 3 seconds** — one curl command, no API key to configure
- **Agent-agnostic** — no need to rewrite integrations for each agent

### code-mem disadvantages

- **No multi-user** — can't share memory with the team
- **No automatic embedding** — requires Ollama and isn't as sophisticated
- **No history summarization** — doesn't auto-generate evolution summaries
- **Not organization-level** — global memory is still personal, local, and manual to move between machines

### When to choose code-mem

- You work alone or in a small team
- You have privacy and security requirements
- You don't want recurring costs
- You prefer everything to work offline

### When to choose Mem0

- You need shared memory across users and sessions
- You want automatic embedding without configuration
- You need analytics and history tracking on memories
- You work in an organization that can afford the cost

---

## code-mem vs Zep

Zep is a persistent memory platform for AI assistants, with entity analysis, summarization, and REST API.

| Dimension | code-mem | Zep |
|-----------|----------|-----|
| **NLP** | Basic embedding (Ollama) | Entity extraction, summarization, sentiment analysis |
| **Architecture** | Local | Cloud or self-hosted (Docker) |
| **Memory types** | 6 kinds + 5 layers | Session memory, entity memory, summary memory |
| **Graph** | Lightweight JSON graph | Knowledge graph with entities and relationships |
| **Search** | FTS5 + deterministic ranking + optional embedding | Semantic + keyword + graph traversal |
| **Setup** | `curl \| bash` | Docker compose + API key |
| **Persistence** | Per-project SQLite + optional local global SQLite | Cloud or self-hosted PostgreSQL |
| **Classification** | Manual (kind + layer) | Automatic (entities, themes, classes) |
| **API** | Local CLI | REST API (REST + WebSocket) |
| **Offline** | Yes | No (only self-hosted) |
| **Cost** | Zero | Open source (self-host) or paid cloud |

### code-mem advantages

- **Zero setup** — no Docker, no external database
- **Lightweight** — one Node.js file, one SQLite file
- **Fully offline**
- **Typed memory** — not just "text", but fact, decision, procedure, issue
- **Immediate integration** — skill install works in 5 different harnesses without modifications

### code-mem disadvantages

- **No automatic entity extraction** — Zep extracts entities, code-mem doesn't
- **No NLP analysis** — no automatic summarization beyond truncation
- **No REST API** — doesn't expose services, only CLI
- **No scalable self-hosting** — designed for personal and project memory, not clusters

### When to choose code-mem

- You want something that works immediately, without Docker
- You need contextual memory for development agents
- You work on projects with simplicity requirements

### When to choose Zep

- You need entity extraction and automatic knowledge graphs
- You can or want to manage Docker for self-hosting
- You work on AI applications that interact with end users, not just software development
- You need REST APIs for custom integrations

---

## code-mem vs LangMem (LangChain)

LangMem is the memory SDK for LangChain/LangGraph agents, with configurable stores and management patterns.

| Dimension | code-mem | LangMem |
|-----------|----------|---------|
| **Framework** | Standalone (no dependencies) | LangChain / LangGraph |
| **Store** | SQLite (node:sqlite) | PostgreSQL, SQLite, InMemory (via LangGraph store) |
| **Pattern** | Kinds + layers + deterministic ranking | Summarization, reflection, core/recency window |
| **Search** | FTS5 + embedding + hybrid scoring | Basic (store search) + summarization |
| **Setup** | `curl \| bash` | `pip install langmem` + LangChain setup |
| **Configuration** | Immediate (`cm init`) | Requires store config, tool definitions |
| **Runtime** | Node.js 22+ | Python 3.10+ |
| **Language** | TypeScript (Node.js) | Python |
| **Integration** | Skill for any agent | LangChain/LangGraph native agents |
| **Community** | New, growing | Large (LangChain ecosystem) |
| **Abstraction** | CLI + skill | Python SDK with declarative patterns |

### code-mem advantages

- **No framework lock-in** — you don't need LangChain to have memory
- **Zero dependencies** — doesn't install half a Python library
- **Ease of use** — `curl | bash && cm init` and you have working memory
- **Agent-agnostic** — not tied to a specific ecosystem

### code-mem disadvantages

- **Less flexible** — LangMem allows custom stores, code-mem only has SQLite
- **No advanced memory management patterns** — summarization, reflection, core window don't exist
- **TypeScript only** — LangMem is Python, code-mem is Node.js
- **No automatic tool integration** — LangMem integrates natively with LangGraph

### When to choose code-mem

- You don't use LangChain/LangGraph
- You want memory in Node.js/TypeScript projects
- You prefer a simple, direct approach

### When to choose LangMem

- You already use LangChain/LangGraph
- You need advanced patterns like summarization and reflection
- You work in a Python ecosystem
- You want customizable stores (PostgreSQL, custom)

---

## code-mem vs Letta (MemGPT)

Letta implements an agent with hierarchical memory (core block + archival memory + recall memory), inspired by operating system memory management.

| Dimension | code-mem | Letta (MemGPT) |
|-----------|----------|----------------|
| **Architecture** | Memory tool for agents | Full agent with internal memory |
| **Memory model** | SQLite + Markdown projections | Core block (always in context) + archival (vector DB) + recall (conversation history) |
| **Embedding** | Optional (Ollama) | Built-in (OpenAI, Azure, Ollama) |
| **Storage** | Local SQLite | PostgreSQL + pgvector (or SQLite + chroma) |
| **Server** | None (except optional watch) | Letta server (REST + WebSocket) |
| **CLI** | `cm` — full CLI | `letta` — agent management CLI |
| **Runtime** | Node.js 22+ | Python 3.10+ |
| **Auto-management** | consolidate, watch daemon | Automatic core memory eviction |
| **Multi-agent** | No (single-user memory tool) | Yes (manages multiple agents with separate memories) |
| **Tool use** | Requires skill install | Native in agent runtime |
| **Setup weight** | Light (~57 KB CLI) | Heavy (server, DB, embedding models, Python deps) |
| **Offline** | Yes | Partial (depends on model) |

### code-mem advantages

- **Extremely lightweight** — the CLI is 57 KB. Letta requires server, DB, embedding model, Python dependencies
- **Zero components** — no server, no database to administer
- **No vendor lock-in** — you don't need to use the Letta agent to have persistent memory
- **Part of your existing stack** — complements your agent, doesn't replace it
- **Design memory** — not just conversations, but project decisions and procedures

### code-mem disadvantages

- **Not an agent** — code-mem doesn't execute tasks, has no reasoning loop
- **No automatic memory management** — Letta decides what to keep in core vs archive
- **No full recall history** — Letta records all conversation history
- **No multi-agent** — Letta manages multiple agents with separate memories

### When to choose code-mem

- You already have an agent (Claude, Codex, Cursor, Pi) and want to add persistent memory
- You want something simple and lightweight
- You don't need a full agent runtime
- You work on software development (not general conversational AI)

### When to choose Letta

- You want a complete agent with autonomous memory
- You need advanced memory management (core eviction, archival)
- You work in Python and can manage a more complex infrastructure
- You need memory for multiple different agents

---

## Summary Table

| Criterion | code-mem | claude-mem | graphify | Claude files | Mem0 | Zep | LangMem | Letta |
|-----------|----------|------------|----------|-------------|------|-----|---------|-------|
| **Install ease** | ⭐⭐⭐ | ⭐⭐ | ⭐⭐ | ⭐⭐⭐ | ⭐⭐ | ⭐ | ⭐ | ⭐ |
| **Offline** | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ | ✅ | ⚠️ |
| **Privacy** | ✅✅ | ❌ | ✅✅ | ✅✅ | ❌ | ⚠️ | ✅ | ⚠️ |
| **Cost** | Zero | API | Zero | Zero | € | € | Zero | Zero |
| **Multi-agent** | ✅ | ❌ | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ |
| **Search** | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ | ⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐ |
| **Memory types** | 6 kinds | 1 | N/A | 1 | 1 | 3 | 1 | 3 |
| **Auto-mgmt** | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅✅ |
| **API** | CLI | MCP | CLI/MCP | File | REST | REST | Python SDK | REST/WS |
| **Graph** | ✅ | ❌ | ✅✅ | ❌ | ❌ | ✅ | ❌ | ❌ |
| **Ecosystem** | New | New | Mature | Native | Mature | Mature | Large | Medium |
| **Ideal for** | Daily dev, project memory + personal global habits | Cross-project Claude Code users | Codebase exploration, archaeology | Simple dev, Claude users | Team, multi-user, orgs | AI apps, entity extraction | LangChain users, Python stack | Autonomous agents, AI research |

**Legend:**
- ⭐⭐⭐ = Excellent / ⭐⭐ = Good / ⭐ = Basic
- ✅✅ = Excellent / ✅ = Good / ❌ = Missing / ⚠️ = Partial

---

## Conclusion: Which One to Choose?

**Choose code-mem when:**
- You want persistent memory with zero infrastructure
- You work alone or in a small team
- Data privacy matters
- You use multiple agents (Claude, Codex, Cursor, Pi) and want unified memory
- You don't want recurring costs

**Don't choose code-mem when:**
- You need team-shared memory (use Mem0 or Zep)
- You want to explore an unfamiliar codebase (use graphify)
- You only use Claude Code and don't want to install anything (use Claude file memories)
- You need an agent with autonomous memory (use Letta)
- You work in a Python/LangChain ecosystem (use LangMem)
- You need advanced NLP like automatic entity extraction (use Zep)

The beauty of code-mem is that it doesn't lock you out: it's simple enough to try in 10 seconds, yet powerful enough to become part of your daily flow. If one day you need something more complex, your data is in SQLite — exportable, portable, yours.

---

## See Also

- **[PHILOSOPHY.md](PHILOSOPHY.md)** — the full philosophy behind code-mem: local-first, kinds and layers, deterministic retrieval, zero dependencies, why simplicity wins
- **(IT) [COMPARAZIONE.md](COMPARAZIONE.md)** — Italian version
