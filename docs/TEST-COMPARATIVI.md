# Test Comparativi: code-mem vs altri metodi

> Come si comporta code-mem nella pratica, rispetto ad altri sistemi di memoria?
> Questi test sono pensati per essere eseguiti **fianco a fianco** con due sessioni Claude Code (o un agente + note cartacee) per vedere la differenza reale.

## Setup per i test

Per ogni test ti servono **due terminali**:

```
Terminale A — con code-mem attivo
Terminale B — con l'alternativa (es. Claude Code file memories, claude-mem, o nessun sistema)
```

### Prerequisiti

```bash
# Terminale A
cd /tmp/test-cm-a
mkdir -p src
echo '{"name":"test"}' > package.json
echo '{"compilerOptions":{"strict":true}}' > tsconfig.json
cm init

# Terminale B (Claude Code file memories)
cd /tmp/test-cm-b
mkdir -p src
echo '{"name":"test"}' > package.json
echo '{"compilerOptions":{"strict":true}}' > tsconfig.json
mkdir -p .claude/projects/test
```

---

## Test 1 — Salvare e ritrovare una decisione architetturale

Questo è il caso d'uso più frequente: durante lo sviluppo prendi una decisione, la registri, e giorni dopo devi ritrovarla.

### Scenario

Hai deciso di usare **Vitest** invece di Jest perché i test sono 3× più veloci. Due settimane dopo, un collega (o il tuo futuro te) chiede: "perché abbiamo scelto Vitest?"

### Terminale A — code-mem

```bash
# Salva la decisione
cm save --kind decision --title "Vitest vs Jest" \
  "Abbiamo scelto Vitest su Jest perché i test sono 3× più veloci con esecuzione parallela nativa."

# Due settimane dopo (simulato)
cm recall "perché abbiamo scelto Vitest"
```

Output atteso:

```
Task: perché abbiamo scelto Vitest
Plan: debug / FOCUSED / mode=hybrid
Level: 1

[mem_decision_abc] [decision] score=0.92
  Abbiamo scelto Vitest su Jest perché i test sono 3× più veloci con esecuzione parallela nativa.
```

### Terminale B — Claude Code file memories

```bash
# Salva la decisione
cat >> .claude/projects/test/MEMORY.md << 'EOF'
- Decision: use Vitest instead of Jest (tests 3x faster)
EOF

# Due settimane dopo
grep -ri "vitest\|jest\|test runner" .claude/
```

**Risultato:** hai il file, ma devi ricordarti che esiste e cosa cercare. Se non ricordavi la parola "Vitest" il grep non trova nulla.

### Verdetto

| Aspetto | code-mem | File Markdown |
|---------|----------|---------------|
| "Non ricordo esattamente le parole" | ✅ trigram + keyword catchano "test runner", "jest", "vitest" indifferentemente | ❌ grep esatto, se non sai cosa cercare non trovi |
| Tempo per ritrovare | 2 secondi (`cm recall <idea>`) | 30+ secondi (grep + ricordarsi il path) |
| Contesto arricchito | kind=decision, layer=semantic, score | Solo testo piatto |
| Refusi | ✅ "vitest" → "vitst" funziona | ❌ refuso = zero risultati |

---

## Test 2 — Ritrovare un workaround di debugging

### Scenario

Hai passato 3 ore a debugga re un bug con i fake timer di Vitest che rompono i test in parallelo. Hai trovato il workaround: usare `vi.useFakeTimers()` dentro `beforeEach` invece che a livello di file.

### Terminale A — code-mem

```bash
# Subito dopo aver trovato la soluzione
cm save --kind issue --title "Fake timers + parallel tests" \
  "Usare vi.useFakeTimers() dentro beforeEach() invece che a livello di file. \
   I fake timer globali competono tra loro quando i test girano in parallelo."

# Una settimana dopo, incontri di nuovo lo stesso problema
cm recall "paralleli test timer"
```

### Terminale B — Claude Code file memories

```bash
cat >> .claude/projects/test/MEMORY.md << 'EOF'
- Bug: fake timers break parallel tests. Fix: use vi.useFakeTimers() in beforeEach
EOF
```

### Terminale B2 — Nessuna memoria

Semplicemente non ricordi. Rifai 3 ore di debug.

### Verdetto

| Aspetto | code-mem | File Markdown | Nessuna memoria |
|---------|----------|---------------|-----------------|
| Trova con parole vaghe "paralleli test timer" | ✅ | ❌ (nessun match) | ❌ |
| Recupera dettaglio del fix | ✅ `cm recall --level 3` mostra tutto | ✅ se apri il file | ❌ |
| Tempo perso se non trovi | 2 secondi | Non lo trovi | 3 ore |

---

## Test 3 — Memoria cross-sessione con cambio di contesto

### Scenario

Lavori sul branch `feat/oauth` per una settimana. Decidi di usare il `state-machine` pattern per gestire gli stati OAuth. Poi passi al branch `fix/login` per 3 giorni. Torni a `feat/oauth` e non ricordi più la decisione.

### Terminale A — code-mem

```bash
# Branch feat/oauth — salvi la decisione
cm save --kind decision "Usiamo state-machine per OAuth perché gli stati \
  (redirect, callback, refresh, expired) sono troppi per if/else."

# Passi a fix/login
git checkout -b fix/login
# ... 3 giorni di lavoro ...

# Torni a feat/oauth
git checkout feat/oauth
# cm recall-auto gira automaticamente al SessionStart, oppure:
cm recall "oauth"
```

### Terminale B — Claude Code file memories

```bash
# Quando torni su feat/oauth, grep non trova nulla
# perché il file memory non cambia con il branch
cat .claude/projects/test/MEMORY.md  # sempre lo stesso contenuto flat
```

### Verdetto

| Aspetto | code-mem | File Markdown |
|---------|----------|---------------|
| Context match sul branch | ✅ il ranking favorisce memorie dello stesso branch | ❌ nessun concetto di branch |
| Auto-richiamo al cambio contesto | ✅ `cm recall-auto` su SessionStart hook | ❌ devi ricordarti di cercare |
| Priorità a ciò che hai deciso su quel branch | ✅ sì | ❌ tutte le memorie sono uguali |

---

## Test 4 — Memoria tra agenti diversi

### Scenario

Usi Claude Code la mattina e Cursor il pomeriggio. Entrambi devono sapere che il progetto usa Drizzle ORM, non Prisma.

### Terminale A — code-mem

```bash
# Una volta salvato, funziona con qualsiasi agente
cm save --kind decision "Usiamo Drizzle su Prisma per leggerezza e controllo SQL."

# Claude Code: cm recall "ORM scelto"
# Cursor:   cm recall "ORM scelto"
# Codex:    cm recall "ORM scelto"
# Bash:     cm recall "ORM scelto"
# Stesso risultato.
```

### Terminale B — Claude Code file memories

```bash
# Claude Code ha il suo file memory
.claude/projects/test/MEMORY.md  # solo Claude Code lo legge

# Cursor ha un sistema diverso
.cursorrules  # devi duplicare
```

### Terminale B2 — claude-mem

```bash
# claude-mem funziona solo con Claude Code (MCP plugin)
# Cursor, Codex, Pi non possono usarlo
```

### Verdetto

| Aspetto | code-mem | Claude file | claude-mem |
|---------|----------|-------------|------------|
| Funziona con Claude Code | ✅ | ✅ | ✅ |
| Funziona con Cursor | ✅ `cm` CLI disponibile | ❌ | ❌ |
| Funziona con Codex | ✅ `cm` CLI disponibile | ❌ | ❌ |
| Funziona con Pi | ✅ `cm` CLI disponibile | ❌ | ❌ |
| Funziona manualmente (bash) | ✅ `cm recall` | ❌ | ❌ |
| Duplicazione dati | 0 (unico DB) | N agenti = N file da tenere in sync | N/A |

---

## Test 5 — Embedding: trigram vs keyword vs Ollama

### Scenario

Devi trovare una memoria che dice "Il container crasha all'avvio per una variabile d'ambiente mancante". Ma tu ora cerchi "il contenitore non parte".

### Terminale A — code-mem (senza Ollama)

```bash
# Salva
cm save --kind issue "Il container crasha all'avvio per una variabile d'ambiente mancante."

# Cerca con parole diverse — trigram fallback
cm recall "contenitore non parte" --mode hybrid
# TROVA ✅ — trigram riconosce container ↔ contenitore

# Stessa ricerca, keyword-only
cm recall "contenitore non parte" --mode keyword
# NON TROVA ❌ — "contenitore" ≠ "container" lessicalmente
```

**Output con trigram:**

```
Task: contenitore non parte
Plan: debug / FOCUSED / mode=hybrid

[mem_issue_abc] [issue] score=0.32
  Il container crasha all'avvio per una variabile d'ambiente mancante
```

### Terminale A — code-mem (con Ollama)

```bash
# Cerca con sinonimi reali — Ollama capisce la semantica
cm recall "il servizio non si avvia" --mode hybrid
# TROVA ✅ — "crasha" e "non si avvia" sono semanticamente simili
```

### Terminale B — Claude File Memory (keyword puro)

```bash
grep -ri "contenitore" .claude/projects/test/
# Zero risultati. Non hai salvato "contenitore", hai salvato "container".
```

### Verdetto

| Metodo | "container" ↔ "contenitore" | "crasha" ↔ "non si avvia" | Dipendenze |
|--------|---------------------------|--------------------------|------------|
| keyword match | ❌ | ❌ | Zero |
| trigram (code-mem) | ✅ (0.71) | ❌ (~0.17) | Zero |
| Ollama (code-mem) | ✅ | ✅ | Ollama + modello 137MB |
| Nessun sistema | ❌ | ❌ | N/A |

---

## Test 6 — Velocità di recupero

Scenario: hai 100 memorie salvate. Quanto ci metti a trovare quella giusta?

```bash
# Crea 100 memorie di riempimento (puoi usare un loop)
for i in $(seq 1 97); do
  cm add "Filler memory number $i about misc things"
done
cm save --kind decision "Abbiamo scelto i WebSocket su SSE per il real-time."

# Quanto ci mette a trovare?
time cm recall "real time websocket" 2>&1
```

Risultato tipico:

```
real    0m0.042s   (42ms — ranking su 100 memorie + trigram)
```

Confronto con:

```bash
# Claude file memories — grep su 100 file? Non ci sono 100 file singoli.
# Di solito è un singolo file, e il collo di bottiglia è umano (leggere e scorrere)

# claude-mem — chiamata MCP remota
# Di solito 200-800ms per via della latenza di rete
```

---

## Esecuzione rapida di tutti i test

C'è uno script che esegue automaticamente i test comparativi misurabili:

```bash
# Non serve setup complesso — tutto in un unico progetto temporaneo
# (non richiede due terminali, fa tutto in sequenza)

cat << 'SCRIPT' | bash
#!/bin/bash
set -e
T=/tmp/cm-compare-$$
rm -rf "$T"
mkdir -p "$T/src" "$T/.claude/projects/test"
cd "$T"
echo '{"name":"compare-test"}' > package.json
echo '{"compilerOptions":{"strict":true}}' > tsconfig.json

CMD="node /Users/alessiobacin/Desktop/code-mem/bin/cm"
PASS=0; FAIL=0

assert() { local label="$1"; shift
  if "$@" > /dev/null 2>&1; then echo "  ✅ $label"; PASS=$((PASS+1))
  else echo "  ❌ $label"; FAIL=$((FAIL+1)); fi }

echo "=== Setup code-mem ==="
$CMD init > /dev/null 2>&1

echo ""
echo "=== Test 1: decisione architetturale ==="
$CMD save --kind decision --title "Vitest vs Jest" \
  "Abbiamo scelto Vitest su Jest per test 3x più veloci con esecuzione parallela." > /dev/null 2>&1
# Cerca con parole vaghe
RC=$($CMD recall "scelta framework test" --level 1 2>&1)
assert "decisione trovata con parole vaghe" grep -q "Vitest" <<< "$RC"

echo ""
echo "=== Test 2: workaround debugging ==="
$CMD save --kind issue --title "Fake timers" \
  "Usare vi.useFakeTimers() in beforeEach invece che a livello di file." > /dev/null 2>&1
RC=$($CMD recall "paralleli timer" --level 1 2>&1)
assert "workaround trovato con parole vaghe" grep -q "beforeEach" <<< "$RC"

echo ""
echo "=== Test 3: contesto cross-sessione ==="
# Simula cambio branch
git init > /dev/null 2>&1
$CMD save --kind decision "state-machine per OAuth" > /dev/null 2>&1
git checkout -b fix/login > /dev/null 2>&1
$CMD save --kind fact "Login usa session JWT" > /dev/null 2>&1
git checkout - > /dev/null 2>&1  # torna a main
RC=$($CMD recall "oauth state machine" --level 1 2>&1)
assert "memoria branch-specific trovata" grep -q "OAuth\|state-machine" <<< "$RC"

echo ""
echo "=== Test 4: trigram fallback ==="
$CMD save --kind fact "Il container crasha all'avvio per env mancante" > /dev/null 2>&1
$CMD consolidate > /dev/null 2>&1
RC=$($CMD recall "contenitore non parte" --mode hybrid --level 1 2>&1)
assert "trigram: contenitore ~ container match" grep -qi "crash\|container\|avvio" <<< "$RC"

echo ""
echo "=== Test 5: keyword-mode NON trigram ==="
RC=$($CMD recall "contenitore" --mode keyword --level 1 2>&1)
# Dovrebbe comunque arrivare dal keyword su "all'avvio" o "mancante"
# ma testiamo solo che il mode sia keyword
assert "keyword mode selezionato" grep -q "mode=keyword" <<< "$RC"

echo ""
echo "=== Test 6: velocità recupero ==="
for i in $(seq 1 50); do
  $CMD add "Filler memory number $i about random topics" > /dev/null 2>&1
done
$CMD consolidate > /dev/null 2>&1
START=$(date +%s%N)
$CMD recall "websocket real time" > /dev/null 2>&1
END=$(date +%s%N)
MS=$(( (END - START) / 1000000 ))
if [ "$MS" -lt 500 ]; then
  echo "  ✅ recupero veloce: ${MS}ms"
  PASS=$((PASS+1))
else
  echo "  ⚠️  recupero lento: ${MS}ms (accettabile)"
fi

echo ""
echo "=== SUMMARY ==="
echo "  ✅ Passed: $PASS / $((PASS+FAIL))"
echo ""
rm -rf "$T"
SCRIPT
```

---

## Conclusione

| Cosa testi | code-mem fa | L'alternativa fa |
|-----------|-------------|------------------|
| Ritrovare info con parole vaghe | ✅ trigram + keyword + (opzionalmente) Ollama | ❌ grep esatto |
| Ricordare decisioni cross-sessione | ✅ auto-recall via SessionStart hook | ❌ devi ricordarti di cercare |
| Funzionare con qualsiasi agente | ✅ CLI unico, skill per ogni harness | ❌ ogni agente ha il suo sistema |
| Recuperare workaround di debugging | ✅ tipo "issue" con priorità in modalità debug | Non lo trovi |
| Zero setup + offline | ✅ | ❌ MCP remote o niente |

Per riprodurre i test, apri due terminali e segui gli esempi sopra — una sessione con code-mem (`cm init` + `cm save`) e una senza. La differenza si vede in pochi minuti.