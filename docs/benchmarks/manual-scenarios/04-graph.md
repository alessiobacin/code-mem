# Scenario 04 — graph operations

```bash
cm init
cm ga api_gateway "API gateway" service
cm ga auth_module "Auth module" module
cm ga cache "Redis cache" technology
cm ge api_gateway auth_module routes_to EXTRACTED
cm ge auth_module cache depends_on INFERRED
cm gs
cm gn auth_module
cm gp api_gateway cache
cm gi
cm gc
cm gx html
cm gx graphml
cm gx neo4j
```

Acceptance checks: duplicate edges are rejected, neighbors and paths are
readable, graph statistics report nodes/edges, community detection completes,
and each requested export is written to `memory/`.
