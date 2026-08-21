# Scenario 02 — Scrittura memoria

## Obiettivo
Verificare l'intero ciclo di scrittura/modifica delle memorie.

## Prerequisiti
- Progetto con `cm init` già eseguito (vedi scenario 01).

## Comandi

```bash
D=/tmp/cm-manual-write
rm -rf "$D"; mkdir -p "$D/src"; cd "$D"
cm init >/dev/null 2>&1

# 1. Save tipizzata
cm save --kind decision --title "Vitest vs Jest" \
  "Abbiamo scelto Vitest su Jest per test 3x piu veloci in parallelo."
# atteso: "Saved: mem_decision_..."
# 2. Fact + layer
cm save --kind fact --layer semantic "PostgreSQL con Drizzle ORM e multi-tenancy."
# 3. Preferenza utente (global layer user)
cm save --kind preference --layer user "Preferisci patch su rewrite."
# 4. Procedure
cm save --kind procedure --title "Deploy" \
  "docker compose up e npm run build su vercel."
# 5. Issue
cm save --kind issue "Redis cluster retry flaky nei test paralleli."
# 6. Comando legacy add
cm add "Il progetto usa React Router."            # = save fact semantic
# 7. Legacy add-user
cm add-user "Risposte preferite in italiano."     # = preference user

# 8. Duplicato (deve essere rifiutato senza --force)
cm save --kind decision --title "Vitest vs Jest" \
  "Abbiamo scelto Vitest su Jest per test 3x piu veloci in parallelo."
# atteso: "Duplicate (similar to ...)". Con --force salva comunque.

# 9. Conferma metadati
cm ls
# atteso: compare tutte le memorie non-preference
cm ls-user
# atteso: le 2 preferenze utente
```

## Modifica / rimozione

```bash
# 10. Replace (per match sul titolo/testo)
cm replace "Vitest" "Vitest e il default; Playwright solo per e2e."
# atteso: "Replaced ..."

# 11. rm per match
mem=$(cm ls | grep -i "Redis" | grep -o 'mem_[a-z0-9_]*' | head -1)
echo "Memory id: $mem"
cm rm "$mem"
# atteso: "Removed ..."

# 12. Archive per id
ID=$(cm ls | grep -i "React Router" | grep -o 'mem_[a-z0-9_]*' | head -1)
cm archive "$ID"
# atteso: archiviato, sparisce da cm ls

# 13. touch / link
# Commenta che una memoria e' stata utile
ID2=$(cm ls | grep -i "Deploy" | grep -o 'mem_[a-z0-9_]*' | head -1)
cm touch "$ID2"
cm link "$(cm ls | grep -i Postgres | grep -o 'mem_[a-z0-9_]*' | head -1)" \
     "$(cm ls | grep -i Drizzle | grep -o 'mem_[a-z0-9_]*' | head -1)" "depends_on"
```

## Salvata globale (cross-progetto)

```bash
# 14. --global salva in ~/.cm/state.db e in snapshot
cm save --kind procedure --global "Deploy: chiedi conferma, poi Docker sul server."
# atteso: "Saved globally: ..."
cm ls 2>&1 | head
```

## Verifica PASS/FAIL

| # | Pass | Fail |
|---|------|------|
| 1-7 | Ogni comando risponde `Saved`/`Added` | Crash o nessun output |
| 8 | Blocca il duplicato senza `--force` | Lo salva comunque |
| 10 | `Replaced` e il testo nuovo e' in `cm ls` | Non trova match |
| 12 | Non compare piu' in `cm ls` | Compare ancora |
| 14 | Risponde "Saved globally" | Errore |
