# `cm projects`

List the global catalog of repositories managed by Code-Mem.

```bash
cm projects
cm projects --json
cm projects show <id|path|name>
cm projects recall <id|path|name> "what fixed the deploy issue?"
cm projects graph <id|path|name>
```

Every initialized project registers itself in `~/.cm/graphd/projects.json`.
The catalog is shared across projects. Memory and graph contents are accessed
only by the explicit `recall` or `graph` forms; normal recall never searches
other project stores.
