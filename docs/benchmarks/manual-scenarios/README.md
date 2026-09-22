# Manual scenario index

These scenarios exercise the public `cm` CLI without reading source code.
Use a temporary project so the commands cannot alter a real repository.

Prerequisites: Node.js 22+, a built or installed `cm`, and a shell.

| Scenario | Coverage |
|---|---|
| [01-init-setup.md](01-init-setup.md) | initialization and help |
| [02-memory-write.md](02-memory-write.md) | typed writes, correction and lifecycle |
| [03-memory-read.md](03-memory-read.md) | listing, planning and recall |
| [04-graph.md](04-graph.md) | graph nodes, edges, paths and exports |
| [05-code-exploration.md](05-code-exploration.md) | query, scans and imports |
| [06-project-backup.md](06-project-backup.md) | projections, backups, search and watch |
| [07-entities.md](07-entities.md) | entity extraction and graph application |
| [08-history-digest.md](08-history-digest.md) | timeline and evolution digest |
| [09-wiki-import.md](09-wiki-import.md) | Obsidian and Markdown wiki import |

For each scenario, run the commands in a temporary project and compare the
observed output with the acceptance checks.
