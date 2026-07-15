# Filosofia di code-mem

## Perché un altro strumento di memoria?

I coding agent — Claude, Codex, Cursor, Pi — stanno diventando incredibilmente capaci, ma soffrono tutti dello stesso problema strutturale: **non ricordano quello che è successo cinque minuti fa**.

La sessione successiva è una tabula rasa. Il progetto che hai spiegato ieri, la decisione architetturale presa insieme, il workaround scoperto dopo due ore di debugging — tutto evaporato. I file su disco sono l'unico deposito che sopravvive, ma sono muti: non dicono *perché* una certa scelta è stata fatta, non registrano il *ragionamento* che ci ha portato lì, non tengono traccia delle *preferenze* dell'utente.

I sistemi di memoria esistenti risolvono questo problema in modi diversi, ma spesso introducono complessità sproporzionata. code-mem nasce da una convinzione precisa:

> **La persistenza della conoscenza non dovrebbe richiedere un database esterno, un servizio cloud, o un'infrastruttura complessa. Dovrebbe essere uno o due file SQLite locali, un CLI che ci sta in un file, e nient'altro.**

## Principi fondanti

### 1. Local-first, sempre

code-mem è local-first: la memoria di progetto vive in `memory/state.db`, mentre la memoria opzionale cross-progetto vive in `~/.cm/state.db`. Non c'è un server, non c'è un cloud, non c'è un API key. Sono file SQLite locali che puoi copiare, versionare, ispezionare o portare su un'altra macchina.

Perché? Perché la memoria di progetto appartiene al progetto, mentre le procedure personali riusabili appartengono all'utente, non a un servizio esterno. Quando cloni un repository, la memoria del progetto — se versionata — viene con te. Quando lavori offline, entrambe funzionano lo stesso. Quando cambi provider AI, la memoria non cambia.

### 2. Tipi, strati, e gradazioni

Non tutta la memoria è uguale. code-mem distingue:

**Tipi di conoscenza (kind):**
- `fact` — verità oggettive sul progetto ("Usa TypeScript strict mode")
- `decision` — scelte deliberate con ragionamento ("Abbiamo scelto Vitest su Jest per la velocità")
- `procedure` — sequenze operative ("Per resettare il DB locale, esegui script/reset-db.sh")
- `issue` — problemi noti con cause e workaround ("I fake timers rompono i test in parallelo")
- `preference` — preferenze dell'utente ("Risposte concise, con riferimenti ai file")
- `artifact` — riferimenti a componenti, moduli, entità del progetto

**Strati di persistenza (layer):**
- `working` — appena scoperto, ancora da validare
- `episodic` — legato a una sessione specifica
- `semantic` — consolidato, verità duratura del progetto
- `procedural` — procedure ripetibili, indipendenti dal contesto
- `user` — preferenze personali dell'utente

**Confidenza:** ogni memoria ha un punteggio 0.0-1.0 che indica quanto è affidabile. Non tutto ciò che viene salvato è una certezza.

Questa stratificazione permette a un agente di distinguere tra "abbiamo appena scoperto questo" e "questo è un fatto consolidato del progetto" — una sfumatura che la maggior parte dei sistemi di memoria ignora.

### 3. Recupero deterministico, arricchito da embedding

Il cuore di `cm recall` è un motore di ranking deterministico che valuta le memorie su sette dimensioni contemporaneamente:

- **keyword match** — rilevanza lessicale rispetto al task
- **recency** — quanto è recente la memoria
- **access count** — quante volte è stata utile
- **context match** — stesso branch Git, stessa directory
- **kind priority** — il tipo di task (debug, feature, refactor...) dà priorità a certi tipi di memoria
- **graph score** — quante relazioni ha con altre memorie
- **trigram similarity** (sempre disponibile) — similarità morfologica via character trigram embedding, zero dipendenze
- **Ollama semantic score** (opzionale) — similarità semantica via `nomic-embed-text`

Il risultato è che una memoria può essere recuperata anche se non contiene nessuna delle parole chiave cercate, semplicemente perché è semanticamente simile. E a differenza di sistemi puramente vettoriali, cade sempre in piedi: se Ollama non è disponibile, il trigram fallback prende il suo posto — nessuna perdita di dimensione nel ranking, solo granularità diversa.

### 4. Tre formati, un database

code-mem produce più viste locali della stessa informazione:

1. **`memory/state.db`** (SQLite) — fonte di verità per la memoria del progetto
2. **`~/.cm/state.db`** (SQLite) — fonte di verità opzionale per la memoria globale cross-progetto
3. **`MEMORY.md`** — proiezione testuale per il progetto, sempre sotto ~2200 caratteri, pensata per essere caricata nel contesto di un agente
4. **`USER.md`** — proiezione delle preferenze utente, sotto ~1400 caratteri
5. **`graph.json`** — grafo leggero di nodi (progetto, moduli, tecnologie) ed archi (dipendenze, relazioni)

Le proiezioni Markdown sono *generated artifacts* — non vanno modificate a mano. Il database è l'unico source of truth.

### 5. Zero dipendenze runtime

Il CLI `cm` è un singolo file Node.js che usa `node:sqlite` (nativo in Node 22+). Quando Node non lo espone di default, si ri-esegue automaticamente con `--experimental-sqlite`. Nessuna dipendenza npm, nessun pacchetto da installare, nessun runtime esterno.

L'unica dipendenza opzionale è [Ollama](https://ollama.com) con `nomic-embed-text` (137MB) per gli embedding semantici. Se c'è, bene. Se non c'è, tutto funziona lo stesso — solo senza similarità semantica.

### 6. Per tutti gli agenti, non solo Claude

code-mem non è legato a un agente specifico. Funziona con:

- **Claude Code** — via skill + SessionStart hook
- **Codex** — via skill install
- **Cursor** — via skill install
- **Pi** — via skill install
- **Qualsiasi CLI** — è solo un comando `cm save` / `cm recall`

La skill SKILL.md è un contratto leggero: ogni agente capisce quando e come usare `cm` senza dover imparare un'API proprietaria.

## Cosa code-mem non fa (e perché)

### Non è un RAG system

code-mem non indicizza ogni file del progetto. Non fa chunking, non fa retrieval su documenti arbitrari, non cerca di rispondere a domande sul codice. Si occupa solo di **memoria di progetto e memoria operativa personale**: decisioni, fatti, procedure, issue, preferenze. Per cercare nel codice, ci sono grep, graphify, e gli strumenti nativi dell'agente.

### Non ha un server

Non c'è un processo da tenere acceso, nessuna porta da esporre, nessun health check. Il watch daemon è opzionale e fa solo embedding + consolidamento automatico.

### Non sincronizza in cloud

Non c'è sync, non c'è collaboration in real-time, non c'è backend ospitato. La memoria resta locale alla macchina: quella di progetto nel repo, quella globale in `~/.cm/`. Se vuoi condividerla, committi `memory/` per la conoscenza di progetto oppure usi `cm backup --global` / `cm restore --global` per la conoscenza personale globale.

### Non è un grafo della conoscenza

Il `graph.json` è intenzionalmente semplice: nodi con un tipo e archi con una relazione. Non fa community detection, non ha pesi dinamici, non fa inferenza. Per esplorazione architetturale, graphify è lo strumento giusto. code-mem tiene traccia di chi dipende da cosa, non di come l'architettura si evolve.

## Il workflow ideale

```
Setup una tantum:
  ollama pull nomic-embed-text   # 137MB, opzionale
  cm init                         # crea memory/
  cm setup                        # installa skill + hook

Nell'uso quotidiano:
  cm save --kind decision "..."   # dopo una decisione importante
  cm save --kind procedure --global "..."  # per workflow riusabili cross-progetto
  cm recall "task"                # prima di iniziare un task
  cm touch <id>                   # quando una memoria si rivela utile
  cm consolidate                  # dopo una sessione intensa

Automatico:
  cm watch --daemon               # embedding + consolidate in background
                                  # SessionStart hook → recall-auto a ogni sessione
                                  # recall-auto cerca sia nel progetto sia nel globale
```

## Perché la semplicità vince

La memoria di progetto è un problema di *persistenza*, non di *potenza*. Un file SQLite con FTS5, qualche embedding vettoriale, e un ranking deterministico coprono il 95% dei casi d'uso — e lo fanno senza richiedere infrastruttura, senza costi ricorrenti, senza vendor lock-in.

code-mem preferisce essere noioso e funzionare sempre piuttosto che essere intelligente ma fragile. Preferisce essere locale e portabile piuttosto che connesso e potente. Preferisce essere semplice e documentato piuttosto che astratto e flessibile.

Questa è la sua filosofia. E, crediamo, la sua forza.

---

## Vedi anche

- **[PHILOSOPHY.md](PHILOSOPHY.md)** — English version
- **[COMPARAZIONE.md](COMPARAZIONE.md)** — comparazione con altri sistemi di memoria
