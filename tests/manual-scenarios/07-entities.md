# Scenario 07 — `cm entities` (estrazione automatica di entita')

> **Feature nuova.** Estrae entita' (tecnologie, file/moduli, simboli) dal testo delle memorie
> e (con `--msgs`) dalle conversazioni, e —con `--apply`— le scrive nel grafo
> per arricchire recall/query/explain.

## Obiettivo
Verificare estrazione, filtri, `--apply` e arricchimento del grafo.

## Prerequisiti
- Progetto con `cm init` e alcune memorie (usa scenario 02).

## Comandi

```bash
D=/tmp/cm-manual-entities; cd "$D"; cm init >/dev/null 2>&1

# 1. Salva memorie ricche di riferimenti
cm save --kind decision "Usiamo TypeScript per il type-safety e Vitest per i test." >/dev/null
cm save --kind fact "PostgreSQL con Drizzle; auth JWT; deploy su Vercel con Vite." >/dev/null
cm save --kind procedure "Build con npm run build; container Docker; retry Redis." >/dev/null

# 2. Estrai entita'
cm entities
# atteso: elenco top con categoria e conteggio, es.
#   TypeScript [tech] xN  (mem_...)
#   PostgreSQL [tech] xN  (mem_...)
#   ...
mon con riga: "N entity types (tech:.., file:.., ...)"

# 3. Filtro sul numero di risultati
cm entities --limit 5
# atteso: solo le prime 5

# 4. Flag --msgs (include conversazioni, se presenti nel DB)
cm entities --msgs --limit 10
# atteso: include entita' estratte anche da `messages` se esistenti

# 5. APPLICA al grafo
cm entities --apply
# atteso: "Entities applied: +N nodes, M co-occurrence edges written to graph."

# 6. Verifica l'arricchimento del grafo
cm gs
# atteso: piu' nodi archi di prima (nodi type=tech, edge co_occurs)

# 7. Il grafo risponde a query su entita'
cm query "vite deploy"
# atteso: trovino nodi/archi relativi a Vite/Deploy
cm gn Drizzle
# atteso: vicini (es. PostgreSQL, JWT) [co_occurs, INFERRED]

# 8. hints
cm help | grep -A3 Semantic
# atteso: sezione Semantic con cm entities e cm history
```

## Verifica PASS/FAIL

| # | Pass | Fail |
|---|------|------|
| 2 | Elenco con categoria + conteggio, riga riepilogo | Nessun output |
| 5 | Messaggio "Entities applied: +N nodes, M ..." | Errori o nessuna scritta |
| 6 | `gs` mostra un aumento di nodi/archi | Grafo invariato |
| 7 | `query`/`gn` trovano le entita' | "No nodes matched" |
| 8 | Help mostra la sezione Semantic | Sezione assente |
