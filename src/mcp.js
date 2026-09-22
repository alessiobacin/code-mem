// ─── MCP server (IMP-01, stdio JSON-RPC) ────────────────────────────────────
// `cm mcp` exposes the recall pipeline over the Model Context Protocol so any
// MCP-compatible harness can search project memory without shelling out.
// Zero dependencies: minimal JSON-RPC 2.0 over stdio (initialize,
// tools/list, tools/call, ping). Tools are read-mostly and reuse
// recallMemories / listMemoryRows directly; search returns titles+summaries
// (progressive disclosure), memory_get returns the full row.

const MCP_TOOL_DEFS = [
  {
    name: "memory_search",
    description: "Search project + global memories for a task or question. Returns ranked titles with summaries and scores.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Task or question to recall memory for" },
        limit: { type: "number", description: "Max results (default 5, max 20)" },
        mode: { type: "string", enum: ["keyword", "hybrid", "semantic"], description: "Ranking mode (default hybrid)" },
        scope: { type: "string", enum: ["auto", "project", "global"], description: "Memory scope (default auto)" },
        as_of: { type: "string", description: "ISO timestamp for historical validity lookup" },
        explain: { type: "boolean", description: "Include ranking/evidence reasons" },
      },
      required: ["query"],
    },
  },
  {
    name: "memory_timeline",
    description: "List recent memories newest-first, optionally filtered by kind.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max rows (default 10, max 50)" },
        kind: { type: "string", description: "Filter by kind: fact, decision, procedure, issue, artifact, preference" },
        as_of: { type: "string", description: "ISO timestamp for historical validity lookup" },
      },
    },
  },
  {
    name: "memory_get",
    description: "Fetch one memory by id with full body, tags and files.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Memory id (e.g. mem_fact_h_1a2b3c)" },
      },
      required: ["id"],
    },
  },
  {
    name: "graph_query",
    description: "Traverse the project knowledge graph from keyword-matched nodes (BFS default). Returns seeds + related nodes with relations and source locations.",
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string", description: "Question or keywords to match graph nodes" },
        dfs: { type: "boolean", description: "Use depth-first traversal instead of BFS" },
        depth: { type: "number", description: "Max traversal depth (default 3, max 6)" },
        budget: { type: "number", description: "Cap output at N tokens, ~4 chars/token (default 2000)" },
      },
      required: ["question"],
    },
  },
  {
    name: "graph_node",
    description: "Explain one graph node: label, type, source location, and all connected relations.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Node id or label" },
      },
      required: ["id"],
    },
  },
  {
    name: "graph_path",
    description: "Shortest path between two graph concepts (BFS).",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Source node id or label" },
        to: { type: "string", description: "Target node id or label" },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "graph_stats",
    description: "Graph summary: node/edge counts, god nodes (highest degree), community count, provenance breakdown.",
    inputSchema: { type: "object", properties: {} },
  },
];

// Shared BFS/DFS traversal for the graph_query MCP tool (mirrors `cm query`).
function mcpGraphTraverse(d, question, opts = {}) {
  const g = loadGraphFromStore(d);
  const keywords = String(question || "").toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const matched = new Map();
  for (const kw of keywords) {
    const like = `%${kw}%`;
    for (const row of allStmt(d, "SELECT id,label,type FROM graph_nodes WHERE lower(label) LIKE ? OR lower(id) LIKE ? LIMIT 16", [like, like])) matched.set(row.id, row);
  }
  if (!matched.size) return { seeds: [], results: [], note: "No nodes matched the query." };
  const adj = {};
  for (const n of g.nodes) adj[n.id] = [];
  for (const e of g.edges) {
    if (adj[e.source]) adj[e.source].push({ node: e.target, edge: e });
    if (adj[e.target]) adj[e.target].push({ node: e.source, edge: e });
  }
  const depth = Math.max(1, Math.min(6, opts.depth || 3));
  const visited = new Set();
  const results = [];
  const push = (id, dpt, relation) => {
    if (visited.has(id)) return;
    visited.add(id);
    const nd = g.nodes.find((n) => n.id === id);
    results.push({ label: nd?.label || id, type: nd?.type || "?", depth: dpt, relation, location: graphNodeLocation(nd) });
  };
  if (opts.dfs) {
    const visit = (id, dpt, relation) => {
      if (visited.has(id) || dpt > depth) return;
      push(id, dpt, relation);
      if (dpt < depth) for (const nb of adj[id] || []) visit(nb.node, dpt + 1, nb.edge.relation);
    };
    for (const id of matched.keys()) visit(id, 0, "seed");
  } else {
    const queue = [...matched.keys()].map((id) => ({ id, depth: 0, relation: "seed" }));
    for (const step of queue) {
      if (visited.has(step.id)) continue;
      push(step.id, step.depth, step.relation);
      if (step.depth < depth) for (const nb of adj[step.id] || []) if (!visited.has(nb.node)) queue.push({ id: nb.node, depth: step.depth + 1, relation: nb.edge.relation });
    }
  }
  const budget = Math.max(100, opts.budget || 2000);
  let truncated = false;
  let out = results;
  const size = JSON.stringify(results).length;
  if (size > budget * 4) {
    const keep = [];
    let chars = 0;
    for (const r of results) {
      chars += JSON.stringify(r).length;
      if (chars > budget * 4) { truncated = true; break; }
      keep.push(r);
    }
    out = keep;
  }
  return { seeds: [...matched.values()].map((n) => n.label), mode: opts.dfs ? "dfs" : "bfs", depth, results: out, truncated };
}

function mcpText(obj) {
  return { content: [{ type: "text", text: JSON.stringify(obj, null, 2) }] };
}

function mcpError(id, code, message) {
  return { jsonrpc: "2.0", id: id === undefined ? null : id, error: { code, message } };
}

async function mcpCallTool(d, cwd, name, args) {
  const a = args && typeof args === "object" ? args : {};
  if (name === "memory_search") {
    const query = String(a.query || "").trim();
    if (!query) return { content: [{ type: "text", text: "query required" }], isError: true };
    const limit = Math.max(1, Math.min(20, Number.parseInt(a.limit, 10) || 5));
    const mode = ["keyword", "hybrid", "semantic"].includes(a.mode) ? a.mode : "hybrid";
    const recalled = await recallMemories(d, cwd, query, 2, limit, mode, { scope: a.scope || "auto", asOf: a.as_of || null, explain: Boolean(a.explain) });
    return mcpText(recalled.ranked.map((e) => ({
      id: e.row.id,
      kind: e.row.kind,
      scope: e.row._scope || "project",
      title: e.row.title,
      summary: e.row.summary || summarize(e.row.body),
      score: Number(e.score.toFixed(3)),
      belief_status: e.row.belief_status || e.row.status,
      confidence: e.row.confidence,
      reasons: a.explain ? {
        keyword: e.keywordScore,
        semantic: e.semanticScore,
        confidence: e.confidenceScore,
        importance: e.importanceScore,
        evidence: e.evidence?.map((x) => ({ relation: x.relation, episode_id: x.episode_id })) || [],
      } : undefined,
    })));
  }
  if (name === "memory_timeline") {
    const limit = Math.max(1, Math.min(50, Number.parseInt(a.limit, 10) || 10));
    const kind = a.kind ? String(a.kind) : null;
    const asOf = a.as_of || null;
    const rows = listMemoryRows(
      d,
      kind ? "WHERE mi.kind = ?" : "",
      kind ? [kind] : [],
      "ORDER BY mi.created_at DESC"
    ).filter((row) => rowIsRetrievable(row, asOf)).slice(0, limit);
    return mcpText(rows.map((r) => ({
      id: r.id, kind: r.kind, title: r.title,
      summary: r.summary || summarize(r.body), created_at: r.created_at,
    })));
  }
  if (name === "memory_get") {
    const id = String(a.id || "").trim();
    if (!id) return { content: [{ type: "text", text: "id required" }], isError: true };
    const row = loadMemoryRow(d, id);
    if (!row) return { content: [{ type: "text", text: `not found: ${id}` }], isError: true };
    return mcpText({ ...serializeMemoryRow(row), tags: tagsForRow(row), files: filesForRow(row), evidence: memoryEvidenceFor(d, id) });
  }
  if (name === "graph_query") {
    const question = String(a.question || "").trim();
    if (!question) return { content: [{ type: "text", text: "question required" }], isError: true };
    return mcpText(mcpGraphTraverse(d, question, { dfs: a.dfs === true, depth: Math.max(1, Math.min(6, Number.parseInt(a.depth, 10) || 3)), budget: Math.max(100, Number.parseInt(a.budget, 10) || 2000) }));
  }
  if (name === "graph_node") {
    const node = resolveNode(loadGraphFromStore(d), String(a.id || "").trim());
    if (!node) return { content: [{ type: "text", text: `not found: ${a.id}` }], isError: true };
    const g = loadGraphFromStore(d);
    const edges = g.edges.filter((e) => e.source === node.id || e.target === node.id);
    return mcpText({
      id: node.id, label: node.label, type: node.type,
      location: graphNodeLocation(node),
      degree: edges.length,
      connections: edges.slice(0, 40).map((e) => {
        const other = g.nodes.find((n) => n.id === (e.source === node.id ? e.target : e.source));
        return { direction: e.source === node.id ? "out" : "in", label: other?.label || "?", type: other?.type || "?", relation: e.relation, confidence: e.confidence, location: graphNodeLocation(other) };
      }),
    });
  }
  if (name === "graph_path") {
    const g = loadGraphFromStore(d);
    const fr = resolveNode(g, String(a.from || "").trim())?.id;
    const to = resolveNode(g, String(a.to || "").trim())?.id;
    if (!fr || !to) return { content: [{ type: "text", text: "from/to not found" }], isError: true };
    const adj = {};
    for (const n of g.nodes) adj[n.id] = [];
    for (const e of g.edges) {
      if (adj[e.source]) adj[e.source].push({ to: e.target, edge: e });
      if (adj[e.target]) adj[e.target].push({ to: e.source, edge: e });
    }
    const prev = { [fr]: null };
    const queue = [fr];
    while (queue.length && !(to in prev)) {
      const cur = queue.shift();
      for (const nb of adj[cur] || []) {
        if (!(nb.to in prev)) { prev[nb.to] = { from: cur, edge: nb.edge }; queue.push(nb.to); }
      }
    }
    if (!(to in prev)) return mcpText({ path: [], hops: -1 });
    const hops = [];
    let cur = to;
    while (cur !== fr) {
      const step = prev[cur];
      const n = g.nodes.find((x) => x.id === cur);
      hops.unshift({ node: n?.label || cur, relation: step.edge.relation, confidence: step.edge.confidence });
      cur = step.from;
    }
    const start = g.nodes.find((x) => x.id === fr);
    return mcpText({ path: [{ node: start?.label || fr }, ...hops], hops: hops.length });
  }
  if (name === "graph_stats") {
    const g = loadGraphFromStore(d);
    const deg = new Map(g.nodes.map((n) => [n.id, 0]));
    for (const e of g.edges) {
      if (deg.has(e.source)) deg.set(e.source, deg.get(e.source) + 1);
      if (deg.has(e.target)) deg.set(e.target, deg.get(e.target) + 1);
    }
    const gods = [...g.nodes].map((n) => ({ label: n.label, type: n.type, degree: deg.get(n.id) || 0, location: graphNodeLocation(n) })).sort((x, y) => y.degree - x.degree).slice(0, 5);
    const prov = {};
    for (const e of g.edges) prov[e.confidence || "EXTRACTED"] = (prov[e.confidence || "EXTRACTED"] || 0) + 1;
    let communities = 0;
    try { communities = new Set(detectCommunities(g).map((x) => x.community)).size; } catch {}
    return mcpText({ nodes: g.nodes.length, edges: g.edges.length, communities, gods, provenance: prov });
  }
  return { content: [{ type: "text", text: `unknown tool: ${name}` }], isError: true };
}

async function runMcpServer(d, cwd) {
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  const send = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);
  for await (const line of rl) {
    const raw = String(line || "").trim();
    if (!raw) continue;
    let msg;
    try { msg = JSON.parse(raw); } catch { send(mcpError(undefined, -32700, "parse error")); continue; }
    const id = msg.id;
    try {
      if (msg.method === "initialize") {
        send({
          jsonrpc: "2.0", id,
          result: {
            protocolVersion: (msg.params && msg.params.protocolVersion) || "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "cm", version: VERSION },
          },
        });
      } else if (msg.method === "notifications/initialized") {
        continue; // notification, no response
      } else if (msg.method === "ping") {
        send({ jsonrpc: "2.0", id, result: {} });
      } else if (msg.method === "tools/list") {
        send({ jsonrpc: "2.0", id, result: { tools: MCP_TOOL_DEFS } });
      } else if (msg.method === "tools/call") {
        const result = await mcpCallTool(d, cwd, msg.params && msg.params.name, msg.params && msg.params.arguments);
        send({ jsonrpc: "2.0", id, result });
      } else {
        send(mcpError(id, -32601, `method not found: ${msg.method}`));
      }
    } catch (e) {
      send(mcpError(id, -32603, `internal error: ${e.message}`));
    }
  }
}
