# `cm recall`

Retrieve ranked context for the current task.

```bash
cm recall "fix flaky e2e tests" --level 2 --mode hybrid
cm recall "deploy provider" --scope project
cm recall "my general workflow" --scope global
```

Default scope is `auto`: project memories plus a bounded global-preference
slice. `--scope project` explicitly prevents global injection.
