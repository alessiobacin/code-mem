# Scenario 08 — `cm history` / `cm digest` (sintesi dell'evoluzione)

> **Feature nuova.** Mostra una linea temporale delle memorie e produce un riassunto
> (digest) dell'evoluzione: conteggi per kind, per mese e top entita'.

## Obiettivo
Verificare timeline, filtri per kind/entita', limite e l'alias `digest`.

## Prerequisiti
- Progetto con piu' memorie di kind diversi (usa scenario 02).

## Comandi

```bash
D=/tmp/cm-manual-history; cd "$D"; cm init >/dev/null 2>&1
cm save --kind decision "Vitest over Jest." >/dev/null
cm save --kind fact "PostgreSQL + Drizzle, JWT, Vercel." >/dev/null
cm save --kind issue "Redis retry flaky nei test." >/dev/null
cm save --kind procedure "Deploy: docker + npm build su vercel." >/dev/null

# 1. History completa
cm history
# atteso:
#   Memory history — N active item(s):
#   Timeline (newest first):
#     <timestamp>  [kind] <titolo o riassunto> ...
#   Digest:
#     by kind: ...
#     by month: ...
#     top entities: ...

# 2. Limite
cm history --limit 3
# atteso: al massimo le ultime 3 righe di timeline

# 3. Filtro per kind
cm history --kind fact
# atteso: solo item [fact]

# 4. Filtro per entita'
cm history --entity redis
# atteso: solo memorie che contengono "redis" (case-insensitive)

# 5. Alias digest
cm digest --limit 5
# atteso: stesso output di cm history

# 6. Modalita' errore (kind non valido -> nessuna riga, ma no crash)
cm history --kind tizio
# atteso: timeline vuota ma comando termina senza errore
```

## Verifica PASS/FAIL

| # | Pass | Fail |
|---|------|------|
| 1 | Contiene sezioni "Timeline" e "Digest"; kind/mese/entita' coerenti | Manca una sezione |
| 3 | Compare solo il kind scelto | Compaiono tutti |
| 4 | Solo le memorie che citano quella entita' | Filtro ignorato |
| 5 | Identico a `history` | Output diverso / comando sconosciuto |
| 6 | Termina senza crash | Errore non gestito |
