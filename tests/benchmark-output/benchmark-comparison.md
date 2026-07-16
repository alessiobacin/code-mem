# Memory Benchmark: cm vs graphify

Risultati dei benchmark eseguiti il 2026-07-16 20:01:30.

| # | Sistema | Operazione | Tempo (s) | Esito | Dettaglio |
|---|---------|------------|-----------|-------|-----------|
| 1 | cm | init | .208s | ✅ | ok |
| 2 | graphify | pipeline | .108s | ❌ | graph.json found |
| 3 | cm | save_batch_10 | .623s | ✅ | saved 9 entries |
| 4 | graphify | update | .215s | ✅ | graph.json updated |
| 5 | cm | recall_exact | .083s | ✅ | TypeScript found |
| 6 | graphify | query_exact | .153s | ✅ | graph contains TypeScript |
| 7 | cm | recall_fuzzy | .080s | ✅ | trigram match |
| 8 | graphify | explain | .155s | ❌ | explain output |
| 9 | graphify | path | .149s | ✅ | path query |
| 10 | cm | plan | .072s | ✅ | taskKind found |
| 11 | cm | graph_build | .411s | ✅ | 4 nodes |
| 12 | graphify | path_structural | .147s | ✅ | path query |
| 13 | graphify | community_detection | .072s | ✅ | communities: 4 |
| 14 | cm | fts5_search | .067s | ✅ | FTS5 results |
| 15 | graphify | query_multi | .174s | ✅ | multi-concept query |
| 16 | cm | consolidate | .403s | ✅ | consolidate OK |
| 17 | cm | project | .068s | ✅ | MEMORY.md/USER.md |
| 18 | graphify | wiki | .078s | ❌ | wiki not generated |
| 19 | cm | disk_usage | N/As | ✅ | storage: 52KB |
| 20 | graphify | disk_usage | N/As | ✅ | storage: 52KB |

## Storage

| Sistema | Dimensione |
|---------|-----------|
| cm | 52KB |
| graphify | 52KB |
