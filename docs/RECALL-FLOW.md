# Flusso di `cm recall` (recupero ibrido)

> Dettaglio della logica di retrieval. Fonte: [`docs/RECALL-FLOW.mmd`](RECALL-FLOW.mmd).
> Code path: `bin/cm` dispatch → `src/retrieval.js` (`recallMemories()` → `scoreMemory()` → `renderRecall()`); `recall-auto`/`captureAutoRecall` vivono in `src/capture.js`.

Obiettivo: trovare le memorie piu' rilevanti per un task combinando **ricerca deterministica + grafo + embedding opzionale**, con fallback sempre disponibile.

## Diagramma di flusso

```mermaid
flowchart TD
    Start(["cm recall <task> --level L --limit N --mode M"]) --> Parse[parseArgs: level, limit, mode]
    Parse --> Plan[makePlan: inferTaskKind + prioritized kinds]
    Plan --> Depth{mode == explore?}
    Depth -->|No| Level["depth = level (1/2/3)"]
    Depth -->|Yes| Lvl3["depth = 3"]
    Level --> GraphTerms[expandGraphTerms: match task words vs graph node labels]
    Lvl3 --> GraphTerms
    GraphTerms --> Candidates[queryMemoryCandidates: FTS5 + trigram score]

    Candidates --> NeedGlobal{project rows < limit || explore?}
    NeedGlobal -->|No| Proj[Keep project candidates]
    NeedGlobal -->|Yes| Glob[Open ~/.cm/state.db + merge global + graph terms]
    Glob --> LinkMap
    Proj --> LinkMap[expandLinkedCandidateMap: BFS over memory_links depth 2]

    LinkMap --> ChooseEmbed{keyword mode?}
    ChooseEmbed -->|Yes| NoEmb[No embedding]
    ChooseEmbed -->|No| TryOll{.lvl>2 && Ollama?}
    TryOll -->|Yes| Oll[computeEmbedding + cosine]
    TryOll -->|No| Trig[trigramEmbed]
    Oll --> Score
    Trig --> Score
    NoEmb --> Score

    Score[scoreMemory: keyword, recency, access, context, kind-priority, graph, concept, source, link-distance]
    Score --> ExploreBoost{explore?}
    ExploreBoost -->|Yes| Boost[+ concept + link-path + graphConcept boost]
    ExploreBoost -->|No| Plain
    Boost --> Sort[filter score>0.05 → sort desc → limit]
    Plain --> Sort
    Sort --> Bump[UPDATE access_count + last_accessed_at]
    Bump --> Render["renderRecall: level 1 = titles, 2 = +summary, 3 = full body + explain"]
```

## Fasi principali

1. **Piano** — `makePlan()` classifica il task (debug/feature/refactor/review/docs/deploy) e fa prioritizzare certi `kind`.
2. **Scoping multi-store** — raccoglie candidati dal progetto e, se servono piu' risultati (o in modalita' explore), anche dalla memoria globale `~/.cm/state.db`.
3. **Espansione** — termini di grafo (etichette nodi) + BFS sui `memory_links` per trovare memorie collegate.
4. **Embedding (opzionale)** — Ollama se `level>2` e disponibile, altrimenti trigram; mai richiesto per il funzionamento base.
5. **Score a 8+ dimensioni** — `scoreMemory()` combina keyword, recency, access, context (branch/cwd), kind-priority, grafo, concept, source, distanza di link.
6. **Selezione** — filtro `score>0.05`, ordinamento desc, slice su `limit`; i risultati aggiornano `access_count`.
7. **Rendering** — `--level` decide quanto mostrare (titoli → +summary → body completo con `Explain:`).

## Re-ranking a temperatura multi-round (solo `recall-auto`)

Prima del rendering, `cm recall-auto` applica un re-ranking EM-like a 3 round sulla lista candidata (A1, `temperatureRerank()` in `src/retrieval.js`):

- il round *r* esegue una softmax a temperatura `T0/r` (T0 = 1.0) sullo score composito — piu' fredda (piu' decisiva) ad ogni round;
- le probabilita' dei round si accumulano in un consenso `consensus_i = Σ_r p_i(r)`;
- il round 1 (T = T0) è strettamente monotono nello score base: l'ordine è identico al ranking a singolo passaggio, quindi `cm recall` e gli altri modi non sono toccati;
- i round successivi riconcentrano la confidenza sui candidati i cui segnali misti (keyword, concept, semantic, recency, …) reggono all'esame, promuovendo i match stabili e declassando quelli borderline;
- gli score finali vengono riscalati in `[0,1]` (con `rerankConsensus` come metadato) e l'esito è deterministico tra run ripetuti.
