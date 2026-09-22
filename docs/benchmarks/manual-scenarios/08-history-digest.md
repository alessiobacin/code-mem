# Scenario 08 — history and digest

```bash
cm init
cm save --kind fact "Redis caches sessions."
cm save --kind decision "Use PostgreSQL for durable user data."
cm save --kind procedure "Run migrations before deployment."
cm history
cm history --limit 3
cm history --kind fact
cm history --entity redis
cm digest
```

Acceptance checks: output contains a newest-first timeline and grouped digest;
kind/entity filters work; `--limit` caps the timeline; `digest` matches the
history alias; invalid filters return an empty result without a crash.
