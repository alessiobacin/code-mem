# Scenario 07 — entity extraction

```bash
cm init
cm save --kind decision "Use TypeScript and Vitest for the test pipeline."
cm save --kind fact "PostgreSQL with Drizzle handles persistence; JWT handles auth."
cm save --kind procedure "Build with npm run build; use Docker and Redis retries."
cm entities
cm entities --limit 5
cm entities --msgs
cm entities --apply
cm gs
cm gn TypeScript
```

Acceptance checks: output groups entities by category and count, `--msgs`
includes captured messages, `--apply` adds graph nodes and co-occurrence edges,
and graph commands can find the new entities.
