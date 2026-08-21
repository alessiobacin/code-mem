# Task: entities-digest

**Task:** Chiudere i gap rimanenti di code-mem (v0.6.0) rispetto a concorrenti (Zep/Mem0/LangMem), in dettaglio:
1. **`cm entities`** — estrazione automatica di entità (tecnologie, moduli, file, componenti) dai corpi delle memorie salvate e dalle conversazioni, con creazione/link auto di nodi nel grafo. Zero dipendenze (euristiche + regex).
2. **`cm history` / `cm digest`** — sintesi dell'evoluzione della memoria: raggruppa decisioni/fatti per tema/entità, mostra linea temporale e produce riassunto evolutivo.
3. **Eseguire i test e2e/performance esistenti** (`tests/test-e2e.sh`, `tests/run-memory-benchmark.sh`) per verificare cosa funziona e cosa no; se qualcosa non va, ripararlo.
4. **Scrivere file di scenari di test manuali** per ciascuna feature (anche nuova), così l'utente può testare a mano.

**Vincoli:** mantenere la filosofia del progetto — zero dipendenze, local-first, offline, agent-agnostic, CLI unica. Nessun servizio/REST/sync cloud.

**Worktree:** `/Users/alessiobacin/Desktop/code-mem/.worktrees/entities-digest`
**Report:** `<worktree>/reports/entities-digest.md`

**Stato:** in corso

---

## Log dei round

_(appeso da planner/coder/reviewer)_
