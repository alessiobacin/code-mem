# CodeMem documentation

This directory is organized by purpose. The repository version currently tested is `0.8.1` (`node bin/cm version`).

## Start here

- [Project README](../README.md) — installation, CLI reference and runtime behavior.
- [Philosophy](design/philosophy.md) — local-first design constraints.
- [Global graph service](architecture/graph-service.md) — one loopback service with project-scoped graph/chat access.
- [Cognitive memory design](design/cognitive-memory.md) — shipped episodes, evidence, belief state, candidates and verification.
- [Memory model and scope](design/memory-model.md) — kinds, layers, global preferences and explicit cross-project access.
- [Command cheat sheets](commands/README.md) — one short English reference per `cm` command.
- [3D memory graph](visualization/cognitive-memory-3d.html) — interactive scope/episode/memory/evidence/verification view.

## Folders

| Folder | Contents |
|---|---|
| `architecture/` | Focused runtime references: database schema, graph service and recall flow. |
| `commands/` | One cheat sheet per supported command or command family. |
| `benchmarks/` | Reproducible benchmark methodology, manual scenarios and machine-readable results. |
| `comparisons/` | Graphify, Graphiti/Zep and other memory-system comparisons, including E2E reports. |
| `design/` | Product philosophy, shipped cognitive-memory contract and forward roadmap. |
| `visualization/` | Standalone interactive HTML views. |
| `reports/` | Current cleanup and validation reports, including translated historical summaries. |

## Latest evidence

- [Graphify vs CodeMem E2E](comparisons/graphify-vs-codemem-e2e.md)
- [Graphiti vs CodeMem E2E](comparisons/graphiti-vs-codemem-e2e.md)
- [Cognitive capability results](benchmarks/cognitive-capabilities-e2e-results.json)
- [Graphify comparison results](comparisons/graphify-vs-codemem-e2e-results.csv)
- [Graphiti comparison results](comparisons/graphiti-vs-codemem-e2e-results.json)
- [Manual benchmark scenarios](benchmarks/manual-scenarios/)

Obsolete Italian audit dumps were removed during the 2026-09-21 documentation cleanup. The remaining reports are concise English summaries; current product guidance lives in the folders above.
