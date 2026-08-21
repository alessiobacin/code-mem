# Scenario 06 — Proiezioni, consolidate, backup/restore, search, watch

## Obiettivo
Verificare le proiezioni markdown, il consolidamento, backup/restore, la ricerca conversazioni (FTS5), il watch daemon e il recall automatico.

## Prerequisiti
- Progetto con memorie salvate (usa scenario 02).

## Comandi

```bash
D=/tmp/cm-manual-maint; cd "$D"   # progetto con memorie attive

# 1. Rigenera proiezioni MEMORY.md / USER.md
cm project
# atteso: "ok" o breve conferma
head -20 memory/MEMORY.md
# atteso: sezioni dai dati reali

# 2. Consolidamento (promuove working/episodic -> semantic/procedural)
cm consolidate
# atteso: conferma e proiezioni aggiornate

# 3. Backup di progetto
cm backup
# atteso: > percorso del file project-memory.md (<progetto>/cm/memories/<ts>/...)

# 4. Backup globale
cm backup --global
# atteso: > cm-global-backup-<ts>.json nella cwd

# 5. Restore globale (riporta un backup)
cm restore --global cm-global-backup-*.json
# atteso: "Restored K/M global memories from ..."

# 6. Ricerca conversazioni FTS5 (se hai log)
cm sq "TypeScript"
# atteso: risultati da messages_fts o "No results."

# 7. Watch daemon (se con Ollama per gli embedding)
cm watch --daemon
# atteso: parte in background, poll ogni 30s
# (opzionale) lo ferma: pkill -f "cm watch" (o Ctrl-C se in foreground)

# 8. Recall automatico (usato dal SessionStart hook)
cm recall-auto
# atteso: mostr pubblica i recall per sessioni/branch
```

## Verifica PASS/FAIL

| # | Pass | Fail |
|---|------|------|
| 1 | La proiezione esiste, in markdown, < 2200 char | Non rigenera |
| 2 | `consolidate` completo senza errori | Crash |
| 3-4 | File creato al percorso indicato | Nessun file |
| 6 | Risultati FTS5 o messaggio chiaro "No results." | Errore |
| 7 | Watch parte (richiede Ollama per embedding) | Segnala dipendenza mancante in modo chiaro |
| 8 | Output ragionevole (o "No memories") | Crash |
