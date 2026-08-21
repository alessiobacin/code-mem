# Scenario 01 — Inizializzazione e setup

## Obiettivo
Verificare che `cm` si installi/avvii e inizializzi la memoria di progetto.

## Prerequisiti
- Node.js 22+ (con `node:sqlite`)
- La CLI `cm` raggiungibile da terminale

## Comandi

```bash
# 1. Versione
cm version
# atteso: un numero di versione, es. 0.6.0

# 2. Help
cm help
# atteso: elenco di tutti i comandi, incluse le sezioni Semantic (entities/history)

# 3. Help in breve
cm --help

# 4. Inizializza un progetto di prova
D=/tmp/cm-manual-init
rm -rf "$D"; mkdir -p "$D/src"; cd "$D"
echo '{"name":"demo","dependencies":{"typescript":"^5","react":"^18"}}' > package.json
touch src/index.ts src/App.tsx

cm init
# atteso: "Memory initialized at <percorso>/memory/"
#         "+ N technologies, N nodes"

# 5. Verifica cosa ha creato
ls -la memory/
# atteso: MEMORY.md, USER.md, state.db, graph.json

# 6. Comando sconosciuto
cm nonesiste
# atteso: "Unknown "nonesiste". Run: cm help"
```

## Verifica PASS/FAIL

| # | Pass | Fail |
|---|------|------|
| 1 | Stampa una versione 0.x.y | Errore o nessun output |
| 2 | Help contiene `cm init`, `cm save`, `cm recall`, `entities`, `history` | Manca qualche comando |
| 4 | `memory/` creato in `<progetto>` | Errore "cannot find" o crash |
| 5 | Presenti i 4 file `memory/*` | Manca stato.db o graph.json |
| 6 | Messaggio "Unknown ..." | Comando eseguito o crash |
