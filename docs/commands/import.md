# `cm import`

Import external knowledge or a Code-Mem bundle.

```bash
cm import /path/to/wiki-or-vault
cm import /path/to/project-memory.json
cm import --graphify graph.json
cm import --claude-mem --project name
cm import --json graph.json
```

The folder importer asks only whether to delete source Markdown after a
successful import. It infers the source format and uses the configured harness
provider when available; otherwise it uses a deterministic fallback. Source is
preserved by default.
