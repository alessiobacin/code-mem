# Memory Benchmark: cm vs graphify

Risultati dei benchmark eseguiti il 2026-07-20 10:43:20.

| # | Sistema | Operazione | Tempo (s) | Esito | Dettaglio |
|---|---------|------------|-----------|-------|-----------|
| 1 | cm | init | .459s | ✅ | ok |
| 2 | graphify | pipeline | .106s | ❌ | graph.json found |
| 3 | cm | save_batch_10 | .630s | ✅ | saved 4 entries |
| 4 | graphify | update | .266s | ✅ | graph.json updated |
| 5 | cm | recall_exact | .091s | ✅ | TypeScript found |
| 6 | graphify | query_exact | .166s | ✅ | graph contains TypeScript |
| 7 | cm | recall_fuzzy | .088s | ✅ | trigram match |
| 8 | graphify | explain | .164s | ❌ | explain output |
| 9 | graphify | path | .163s | ✅ | path query |
| 10 | cm | plan | .087s | ✅ | taskKind found |
| 11 | cm | graph_build | .476s | ✅ | 4 nodes |
| 12 | graphify | path_structural | .162s | ✅ | path query |
| 13 | graphify | community_detection | .076s | ✅ | communities: 4 |
| 14 | cm | fts5_search | .072s | ✅ | FTS5 results |
| 15 | graphify | query_multi | .158s | ✅ | multi-concept query |
| 16 | cm | consolidate | .407s | ✅ | consolidate OK |
| 17 | cm | project | .071s | ✅ | MEMORY.md/USER.md |
| 18 | graphify | wiki | .081s | ❌ | wiki not generated |
| 19 | cm | disk_usage | N/As | ✅ | storage: 44KB |
| 20 | graphify | disk_usage | N/As | ✅ | storage: 52KB |

## Storage

| Sistema | Dimensione |
|---------|-----------|
| cm | 44KB |
| graphify | 52KB |
