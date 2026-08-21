# Piano di esecuzione: entities-digest

Una fase parte solo quando TUTTI i ruoli della fase precedente hanno
segnalato il completamento. Ruoli nella STESSA fase partono insieme.
Generato automaticamente da plan_set/plan_advance (Revisione 21) — non
modificare a mano, lo stato reale è in .plan.json accanto a questo file.

- [~] Fase 1 (sbloccata — in corso): coder, reviewer
      Implementazione di cm entities + cm history/digest, correzione test e2e/benchmark, scrittura file di scenari di test manuali. Coder e reviewer lavorano nello stesso worktree con ciclo interno di correzione.
- [ ] Fase 2 (bloccata, in attesa della fase precedente): docs-sync
      Aggiornamento della documentazione (README + docs/COMPARISON* + FILOSOFIA/PHILOSOPHY e skill) per riflettere le nuove feature e i nuovi scenari di test manuali.
