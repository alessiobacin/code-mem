# Scenario 06 — projections, backup and capture

```bash
cm init
cm save --kind fact "The API verifies signed webhooks."
cm project
cm consolidate
cm backup
cm backup --global
cm sq "webhooks"
cm recall-auto
cm watch --interval 30
```

Stop the watch process after observing one cycle. Acceptance checks: generated
projections contain current data, backups are written to documented paths,
`sq` searches captured messages, and watch/auto-recall fail softly when Ollama
is unavailable.
