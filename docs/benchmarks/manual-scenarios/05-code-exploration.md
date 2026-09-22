# Scenario 05 — full repository exploration and typed imports

Initialize a small JavaScript or TypeScript project, then run:

```bash
cm init --deep
cm query "auth database"
cm gx --format 3d
cm explain "auth database"
cm import --graphify /path/to/graph.json
cm import --json /tmp/import.json --dry-run
cm import --claude-mem --project project-name
```

Acceptance checks: the unified command reports harness detection, indexes
documents and source files, writes `memory/graph-3d.html`, and query returns
graph matches or a clear empty result. The lower-level scan commands remain
available for diagnostics; imports report counts, and `--dry-run` leaves the
graph unchanged.
