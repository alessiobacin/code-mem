# 🧠 code-mem — Project Memory Tool

One binary, zero dependencies. Persistent project memory for **any** coding agent (pi, Claude Code, Codex, Cursor, Copilot).

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/alessiobacin/code-mem/main/install.sh | bash
```

Or manually:

```bash
mkdir -p ~/.local/bin
curl -fsSL https://raw.githubusercontent.com/alessiobacin/code-mem/main/bin/cm -o ~/.local/bin/cm
chmod +x ~/.local/bin/cm
export PATH="$PATH:$HOME/.local/bin"
```

Requires Node.js 22+.

## Usage

```bash
cm init              # Initialize memory in current project
cm add "text"        # Save fact to MEMORY.md
cm add-user "text"   # Save preference to USER.md
cm replace "old" "new"  # Update fact
cm rm "text"         # Remove fact
cm ls                # List MEMORY.md entries
cm ga <id> <label> <type>  # graph add_node
cm ge <src> <tgt> <rel>    # graph add_edge
cm gn <id>           # graph neighbors
cm gp <from> <to>    # graph path (BFS)
cm gs                # graph stats
cm gi                # graph insights (hub nodes, cross-type)
cm sq "query"        # FTS5 search past conversations
cm help              # Show help
```

## Setup for coding agents

```bash
# Auto-detect installed harnesses
cm setup
```

Or manually:
- `~/.pi/agent/skills/cm/SKILL.md`
- `~/.claude/skills/cm/SKILL.md`
- `~/.codex/skills/cm/SKILL.md`
- `~/.cursor/skills/cm/SKILL.md`

## What it creates

```
your-project/
└── memory/
    ├── MEMORY.md         # Agent notes (always in context)
    ├── USER.md           # User preferences (always in context)
    ├── graph.json        # Knowledge graph (on-demand)
    └── state.db          # SQLite FTS5 (auto-log conversations)
```

## How it works

| File | Cost | Purpose |
|---|---|---|
| MEMORY.md | ~800 tokens fixed | Project facts, conventions, workarounds |
| USER.md | ~500 tokens fixed | Your preferences, communication style |
| graph.json | 0 tokens | Entity relationships — query on demand |
| state.db | 0 tokens | FTS5 — all conversations searchable |

## License

MIT