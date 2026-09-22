# `cm init`

Initialize project memory in the current directory.

```bash
cm init --deep [--no-llm] [--no-ast]
cm init [harness]
```

Creates `memory/`, scans the repository, detects harnesses, installs hooks and
the `/cm-update` skill, builds graph relations, and writes
`memory/graph-3d.html`. The deep form is the recommended one-command setup.
