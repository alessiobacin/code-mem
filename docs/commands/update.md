# `cm update`

Update the installed bundle, or refresh project memory.

```bash
cm update                         # update the CLI bundle
cm update --memory                # refresh snapshot and projections
cm update --memory --deep         # full repository index and graph rebuild
cm update --memory --clean        # archive duplicate/low-confidence noise
cm update --memory --clean --dry-run
cm update --memory --reset        # archive project memories, then rescan
```

Use `--no-llm` or `--no-ast` with the deep workflow when a deterministic
fallback is required.
