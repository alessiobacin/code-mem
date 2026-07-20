# Memory Benchmark: cm vs graphify

Risultati dei benchmark eseguiti il 2026-07-20 22:36:05.

| # | Sistema | Operazione | Tempo (s) | Esito | Dettaglio |
|---|---------|------------|-----------|-------|-----------|
| 1 | cm | init | .216s | ✅ | ok |
| 2 | graphify | pipeline | .100s | ❌ | graph.json found |
| 3 | cm | save_batch_10 | .671s | ✅ | saved 4 entries |
| 4 | graphify | update | .472s | ✅ | graph.json updated |
| 5 | cm | recall_exact | .096s | ✅ | TypeScript found |
| 6 | graphify | query_exact | .245s | ✅ | graph contains TypeScript |
| 7 | cm | recall_fuzzy | .103s | ✅ | trigram match |
| 8 | graphify | explain | .218s | ❌ | explain output |
| 9 | graphify | path | .202s | ✅ | path query |
| 10 | cm | plan | .088s | ✅ | taskKind found |
| 11 | cm | graph_build | .551s | ✅ | 4 nodes |
| 12 | graphify | path_structural | .182s | ✅ | path query |
| 13 | graphify | community_detection | .086s | ✅ | communities: 4 |
| 14 | cm | fts5_search | .074s | ✅ | FTS5 results |
| 15 | graphify | query_multi | .175s | ✅ | multi-concept query |
| 16 | cm | consolidate | 1.401s | ✅ | consolidate OK |
| 17 | cm | project | .077s | ✅ | MEMORY.md/USER.md |
| 18 | graphify | wiki | .081s | ❌ | wiki not generated |
| 19 | cm | disk_usage | N/As | ✅ | storage: 44KB |
| 20 | graphify | disk_usage | N/As | ✅ | storage: 52KB |

## Storage

| Sistema | Dimensione |
|---------|-----------|
| cm | 44KB |
| graphify | 52KB |
