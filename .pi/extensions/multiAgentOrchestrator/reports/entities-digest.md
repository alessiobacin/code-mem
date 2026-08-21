# Report: entities-digest

- Task: Chiudere i gap di code-mem (v0.6.0) rispetto ai concorrenti aggiungendo `cm entities` + `cm history`/`digest`, verificare e2e/performance, correggere i bug trovati e scrivere scenari di test manuali.
- Stato: in corso (fase 1 completata dal planner).

## Round 1 — planner (agente effettivo: nessun coder peer disponibile)

A causa dell'assenza di peer agenti (ambiente single-agent), il planner ha eseguito direttamente il lavoro nel worktree.

**Implementato:**
- `bin/cm`: nuovi comandi `cm entities` e `cm history`/`cm digest`.
  - `entities`: estrazione euristica zero-dipendenze (tech via alias map, file/moduli via regex estensioni, simboli PascalCase/CamelCase, kebab) dai corpi `memory_items` e opzionalmente da `messages` (`--msgs`). Filtro `--limit`, `--apply` (upsert nodi + edge `co_occurs`, solo tra nodi esistenti per evitare archi pendenti), `--source`.
  - `history`/`digest`: timeline (newest first) + digest (by kind, by month, top entities); filtri `--kind`, `--entity`, `--limit`.
  - Registrati in `gl()` help sotto sezione `Semantic`.
- **Fix bug preesistente:** `bin/cm` non si avviava se invocato da un repo con `package.json` `"type":"module"` (Node 26 caricava il file extensionless come ESM e `require()` falliva). Fix: aggiunto `bin/package.json` con `"type":"commonjs"`. Verificato: ora funziona anche dalla root del repo.
- **Correzioni durante sviluppo:** nidificazione template literal rotta su console.log (riscritta con string concatenation); co-occorrence edge ora solo tra nodi entita' realmente presenti (prima generava edge verso nodi inesistenti, "dangling").

**Test e2e:** `tests/test-e2e.sh` → **94 passed / 0 failed** (era 85; aggiunti TEST 43 entities e TEST 44 history).
**Benchmark:** `tests/run-memory-benchmark.sh --cm-path <worktree cm> --from-scratch` → **15 passed / 0 failed** (i 3 fallimenti marcati sono di graphify, invariati). Storage cm 44KB vs graphify 52KB.
**File scenari manuali:** `tests/manual-scenarios/README.md` + 8 file (01 init/setup, 02 write, 03 read, 04 grafico, 05 codice/import, 06 project/backup/watch, 07 entities, 08 history).

> _[evento] piano: fase 1 completata da `planner-01`, fase 2 ora sbloccata (docs-sync) — alle 2026-08-21T18:38:02.050Z_

## Round 2 — docs-sync (planner)

- Aggiornato `README.md`: nuova sezione "Semantic Commands" (entities + history/digest) con usage/examples.
- Aggiornati `docs/COMPARISON.md` e `docs/COMPARAZIONE.md`: sezione "2026/Aggiornamento — gap ormai chiusi" (entities, history, grafo) e chiarimento che sync/REST restano fuori scope per filosofia.
- Aggiornati `docs/FILOSOFIA.md` e `skill/SKILL.md`: documentate le nuove comandi (entities, history, digest, scan/query/gx).
- `tests/test-e2e.sh` ri-eseguito dopo i cambi docs: **94 passed / 0 failed**.
- Worktree pronto per finalizzazione.

> _[evento] report_append di `planner-01` (`planner`) alle 2026-08-21T18:38:27.806Z — stato team: planner-01(planner)=idle·io[0/1]_
