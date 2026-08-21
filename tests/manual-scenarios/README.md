# Test manuali — code-mem (`cm`)

Questa cartella contiene **scenari di test manuali**, uno per ogni feature di code-mem.
Servono per verificare che il CLI funzioni come atteso **senza leggere il codice sorgente**.

## Come si usa

1. Assicurati di avere Node.js 22+ e la CLI `cm` raggiungibile (sostituisci `cm` nei comandi con
   `node /percorso/a/bin/cm` se la usi dal sorgente).
2. Ogni file usa un **progetto temporaneo di prova** (`$WT=...` e una cartella `/tmp/...`),
   così non tocchi i tuoi progetti reali.
3. Ogni scenario è numerato: **prerequisiti → comandi → output atteso → verifica PASS/FAIL**.
4. "Copia-incolla" i comandi in un terminale e confronta l'output.

## Convenzioni usate negli esempi

```bash
# Sostituisci con il percorso reale della CLI (es. ~/.local/bin/cm)
CM="node /Users/alessiobacin/Desktop/code-mem/bin/cm"
# Progetto di prova
D=/tmp/cm-manual-test
mkdir -p "$D/src"; cd "$D"
```

Per comodità, molti esempi assumono che tu sia già dentro il progetto di prova.

## Indice degli scenari

| File | Copre |
|------|-------|
| [01-init-setup.md](01-init-setup.md) | `init`, `setup`, `version`, `help`, harness |
| [02-memorie-write.md](02-memorie-write.md) | `save` (kind/layer/global), `add`, `add-user`, `replace`, `rm`, `archive`, `touch`, `link` |
| [03-memorie-read.md](03-memorie-read.md) | `ls`, `ls-user`, `recent`, `plan`, `recall` (livelli/modi) |
| [04-grafo.md](04-grafo.md) | `ga`, `ge`, `gn`, `gp`, `gs`, `gi`, `gc`, `gx` |
| [05-esplorazione-codice.md](05-esplorazione-codice.md) | `query`, `scan --relations`, `scan --deep`, `explain`, `import` |
| [06-project-backup.md](06-project-backup.md) | `project`, `consolidate`, `backup`, `restore`, `sq`, `watch`, `recall-auto` |
| [07-entities.md](07-entities.md) | `entities` (estrazione, --apply, --msgs) — NUOVA feature |
| [08-history-digest.md](08-history-digest.md) | `history` / `digest` (timeline + sintesi) — NUOVA feature |
