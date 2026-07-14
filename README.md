# 🧠 mc — Project Memory Tool

One binary, zero dependencies. Persistent project memory for **any** coding agent (pi, Claude Code, Codex, Cursor, Copilot).

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/alessiobacin/mc/main/install.sh | bash
```

Or manually:

```bash
mkdir -p ~/.local/bin
curl -fsSL https://raw.githubusercontent.com/alessiobacin/mc/main/bin/mc -o ~/.local/bin/mc
chmod +x ~/.local/bin/mc
export PATH="$PATH:$HOME/.local/bin"
```

Requires Node.js 22+.

## Usage

```bash
mc init              # Initialize memory in current project
mc add "text"        # Save fact to MEMORY.md
mc add-user "text"   # Save preference to USER.md
mc replace "old" "new"  # Update fact
mc rm "text"         # Remove fact
mc ls                # List MEMORY.md entries
mc ga <id> <label> <type>  # graph add_node
mc ge <src> <tgt> <rel>    # graph add_edge
mc gn <id>           # graph neighbors
mc gp <from> <to>    # graph path (BFS)
mc gs                # graph stats
mc gi                # graph insights (hub nodes, cross-type)
mc sq "query"        # FTS5 search past conversations
mc help              # Show help
```

## Setup for coding agents

```bash
# Auto-detect installed harnesses
mc setup
```

Or manually:
- `~/.pi/agent/skills/mc/SKILL.md`
- `~/.claude/skills/mc/SKILL.md`
- `~/.codex/skills/mc/SKILL.md`
- `~/.cursor/skills/mc/SKILL.md`

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
