# Scenario 03 — Lettura e recupero memoria

## Obiettivo
Verificare `ls`, `recent`, `plan` e `recall` (con livelli e modi di ricerca).

## Prerequisiti
- Un progetto con diverse memorie salvate (usa lo scenario 02).

## Comandi

```bash
D=/tmp/cm-manual-read; cd "$D"  # progetto con memorie

# 1. Lista completa
cm ls
# atteso: tutte le memorie attive (no preference)

# 2. Preferenze utente
cm ls-user
# 3. Recenti (default e con N)
cm recent
cm recent 5

# 4. Piano di recupero
cm plan "fix Redis flaky test"
# atteso: JSON con taskKind "debug", kinds prioritized (issue, procedure, ...)

# 5. Recall livello 1 (solo titoli)
cm recall "vitest jest scelta" --level 1
# atteso: riga con [decision]/Vitest, solo titolo

# 6. Recall livello 2 (titolo+summary)
cm recall "postgresql orm" --level 2
# atteso: titolo + summary + Light context

# 7. Recall livello 3 (body completo)
cm recall "deploy vercel" --level 3 --limit 3
# atteso: body e metadati completi (tags/branch se presenti)

# 8. Recall fuzzy/trigram (parola sbagliata)
cm recall "postgrsql diazeta" --level 1
# atteso: trova comunque PostgreSQL/Drizzle (trigram) con punteggio >0

# 9. Modalita' keyword (solo parole esatte)
cm recall "contenitore" --mode keyword --level 1
# probabilmente nessun risultato se non c'e' proprio la parola

# 10. Modalita' hybrid (trigram + eventuale embedding)
cm recall "database relazionale" --mode hybrid --level 1
# atteso: risultati anche con parole diverse

# 11. explain (vista con punteggi per componente)
cm explain "flaky redis" --level 3
# atteso: "Task:", piano, e "Explain: keyword=... concept=... graphTerms=..."
```

## Verifica PASS/FAIL

| # | Pass | Fail |
|---|------|------|
| 4 | Mostra `taskKind` e priorita' e corrette (debug per "fix...") | Errore/JSON malformato |
| 5 | Solo il titolo, non il body | Output troppo lungo |
| 8 | Trova con typo (punteggio su trigram) | Nessun risultato |
| 10 | Risultati anche con sinonimi/parole diverse | Nessun risultato |
| 11 | Presente la riga `Explain:` con i punteggi | Manca la riga |
