# Task cm-bench-hardening


## Recovery — watchdog planner (02/09, post-restart)

- Watchdog/turno recovery su run 01M1ECE0PJGHRW6QE064T91ZNZ (marcato `failed` per l'incidente di orchestrazione del 01/09, non per difetti del lavoro): tutti i ticket operativi sono ora chiusi — T1 originale failed (budget recovery esaurito, documentato), review ricalco done, ticket successore docs-sync 01M1FA0BDTYCJMZQWQ404860HM marcato **done** dal planner (il lavoro reale era completato da docs-sync-01 con commit f74037d, test 17/17 + e2e 94/94, ma il ticket era rimasto `running` 938min senza report di chiusura → stall watch).
- Verificato che il lavoro A1/A2+benchmark+docs (punta `f74037d`) NON era in main (main a 12ee326, merge-base bc4f96a): il run era `failed` per l'incidente e il merge non era mai avvenuto.

## Recovery completato — merge in main + chiusura (planner-01, 02/09)

- `worktree_finalize` → conflitto su README.md/bin/cm/skill/SKILL.md/src/storage.js: risolto manualmente mantenendo **entrambe** le evoluzioni (trigram deterministico sincrono di cm-merge-vector + transazione A2a `withTransaction`), `bin/cm` rigenerato da `build/bundle.mjs`.
- Verifiche post-merge su main: A1/A2 `node --test` 17/17, e2e 94/94, non-regression 27/28 (1 fail pre-esistente: `session_start on an up-to-date project`, verificato identico su b428baf checkout pre-merge — appartiene alla logica cm update --memory/12ee326, non al merge).
- Merge commit `58b2969`, push origin/main (`b428baf..58b2969`) riuscito; branch `task/cm-bench-hardening` eliminata; worktree chiuso via `worktree_abandon` (Revisione 24).
- Nota: il run resta `failed`/`not_applicable` nel layer ticket per il ticket T1 originale (override del 01/09, budget recovery esaurito): il lavoro di ogni fase è comunque in main. L'osservazione watchdog residua su 01M0R6HQZBCRNXRMEFVEEDCR3C (cm-merge-vector) è falso positivo già documentato nel relativo report (lavoro in main da ccbea5e, 01/09).
