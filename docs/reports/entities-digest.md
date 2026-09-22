# Entities and digest report

Status: historical summary, translated to English on 2026-09-21.

The `cm entities` surface extracts technologies, modules, files and symbols
from memories and optional captured messages. With `--apply`, it creates graph
nodes and co-occurrence links. `cm history` and `cm digest` provide a
newest-first timeline plus grouped evolution summaries.

The implementation preserves CodeMem constraints: local SQLite, zero runtime
service dependencies, deterministic heuristics and one CLI surface. Manual
scenarios are maintained in English under
[`../benchmarks/manual-comparative-tests.md`](../benchmarks/manual-comparative-tests.md).
