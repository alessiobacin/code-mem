function normalizeGraphNode(node) {
  return {
    id: String(node?.id || "").trim(),
    label: String(node?.label || node?.id || "").trim(),
    type: String(node?.type || "unknown").trim() || "unknown",
    metadata: typeof node?.metadata === "object" && node?.metadata ? node.metadata : {},
    created: String(node?.created || nowIso()),
  };
}

function normalizeGraphEdge(edge) {
  return {
    source: String(edge?.source || "").trim(),
    target: String(edge?.target || "").trim(),
    relation: String(edge?.relation || "related_to").trim() || "related_to",
    confidence: String(edge?.confidence || "EXTRACTED").trim() || "EXTRACTED",
    metadata: typeof edge?.metadata === "object" && edge?.metadata ? edge.metadata : {},
    created: String(edge?.created || nowIso()),
  };
}

function upsertGraphNode(d, node) {
  const normalized = normalizeGraphNode(node);
  if (!normalized.id || !normalized.label) return false;
  const existing = getStmt(d, "SELECT id FROM graph_nodes WHERE id = ?", [normalized.id]);
  if (existing) {
    runStmt(
      d,
      "UPDATE graph_nodes SET label=?, type=?, metadata_json=?, updated_at=? WHERE id=?",
      [normalized.label, normalized.type, JSON.stringify(normalized.metadata), nowIso(), normalized.id]
    );
    return false;
  }
  runStmt(
    d,
    "INSERT INTO graph_nodes(id,label,type,metadata_json,created_at,updated_at) VALUES(?,?,?,?,?,?)",
    [normalized.id, normalized.label, normalized.type, JSON.stringify(normalized.metadata), normalized.created, nowIso()]
  );
  return true;
}

function upsertGraphEdge(d, edge) {
  const normalized = normalizeGraphEdge(edge);
  if (!normalized.source || !normalized.target || !normalized.relation) return false;
  const existing = getStmt(
    d,
    "SELECT source_id FROM graph_edges WHERE source_id = ? AND target_id = ? AND relation = ?",
    [normalized.source, normalized.target, normalized.relation]
  );
  if (existing) return false;
  runStmt(
    d,
    "INSERT INTO graph_edges(source_id,target_id,relation,confidence,metadata_json,created_at) VALUES(?,?,?,?,?,?)",
    [
      normalized.source,
      normalized.target,
      normalized.relation,
      normalized.confidence,
      JSON.stringify(normalized.metadata),
      normalized.created,
    ]
  );
  return true;
}

function loadGraphFromStore(d) {
  const nodes = allStmt(
    d,
    "SELECT id,label,type,metadata_json,created_at FROM graph_nodes ORDER BY id"
  ).map((row) => ({
    id: row.id,
    label: row.label,
    type: row.type,
    metadata: safeJsonParse(row.metadata_json || "{}", {}),
    created: row.created_at,
  }));
  const edges = allStmt(
    d,
    "SELECT source_id,target_id,relation,confidence,metadata_json,created_at FROM graph_edges ORDER BY source_id, target_id, relation"
  ).map((row) => ({
    source: row.source_id,
    target: row.target_id,
    relation: row.relation,
    confidence: row.confidence,
    metadata: safeJsonParse(row.metadata_json || "{}", {}),
    created: row.created_at,
  }));
  return { nodes, edges };
}

function syncGraphProjection(d, cwd) {
  wg(mp(cwd, GF), loadGraphFromStore(d));
}

function importLegacyGraphFile(d, cwd) {
  const hasGraphNodes = getStmt(d, "SELECT id FROM graph_nodes LIMIT 1");
  if (hasGraphNodes) return 0;
  const graphPath = mp(cwd, GF);
  if (!existsSync(graphPath)) return 0;
  const graph = rg(graphPath);
  let imported = 0;
  for (const node of graph.nodes || []) {
    if (upsertGraphNode(d, node)) imported += 1;
  }
  for (const edge of graph.edges || []) {
    upsertGraphEdge(d, edge);
  }
  syncGraphProjection(d, cwd);
  return imported;
}

function resolveNode(g, query) {
  if (!query) return null;
  const candidates = [
    g.nodes.find((n) => n.id === query),
    g.nodes.find((n) => n.label === query),
    g.nodes.find((n) => n.id.startsWith(query) || n.id.includes(query.toLowerCase())),
    g.nodes.find((n) => String(n.label || "").toLowerCase().startsWith(query.toLowerCase()) || String(n.label || "").toLowerCase().includes(query.toLowerCase())),
  ];
  return candidates.find(Boolean) || null;
}

function importFromGraphify(d, cwd, graphPath, opts = {}) {
  // Import graphify graph.json into cm graph
  if (!existsSync(graphPath)) {
    console.log(`Graphify file not found: ${graphPath}`);
    return { nodes: 0, edges: 0 };
  }
  let raw;
  try { raw = JSON.parse(readFileSync(graphPath, "utf-8")); } catch (e) {
    console.log(`Invalid graphify file: ${e.message}`);
    return { nodes: 0, edges: 0 };
  }
  const gfyNodes = raw.nodes || [];
  const gfyEdges = [...(raw.edges || []), ...(raw.links || [])];
  const hyEdges = raw.hyperedges || [];
  if (opts.dryRun) {
    return { nodes: gfyNodes.length, edges: gfyEdges.length + hyEdges.length };
  }
  // Build ID map: track which local IDs exist for collision detection
  const existingIds = new Set();
  try {
    const rows = allStmt(d, "SELECT id FROM graph_nodes");
    for (const r of rows) existingIds.add(r.id);
  } catch {}

  let nodeCount = 0, edgeCount = 0;
  const idMap = {}; // graphify id → cm id

  for (const n of gfyNodes) {
    if (!n.id) continue;
    let cid = n.id;
    if (existingIds.has(cid)) cid = `gfy:${n.id}`;
    idMap[n.id] = cid;
    const label = n.label || n.norm_label || n.id;
    const type = (n.file_type && n.file_type !== "?" && n.file_type !== "?") ? n.file_type : "graphify";
    const metadata = {};
    for (const k of ["source_file", "source_location", "community", "norm_label", "author", "contributor", "source_url", "captured_at"]) {
      if (n[k] !== undefined && n[k] !== null) metadata[k] = n[k];
    }
    try {
      if (upsertGraphNode(d, { id: cid, label, type, metadata, created: nowIso() })) nodeCount++;
    } catch {}
  }

  // Edges
  const allEdges = [...gfyEdges];
  for (const he of hyEdges) {
    if (he.nodes && Array.isArray(he.nodes) && he.nodes.length >= 2) {
      const relation = he.relation || "related_to";
      for (let i = 0; i < he.nodes.length; i++) {
        for (let j = i + 1; j < he.nodes.length; j++) {
          allEdges.push({ source: he.nodes[i], target: he.nodes[j], relation, confidence: "INFERRED", metadata: { hyperedge: he.id || "" } });
        }
      }
    }
  }

  for (const e of allEdges) {
    const src = idMap[e.source] || `gfy:${e.source}`;
    const tgt = idMap[e.target] || `gfy:${e.target}`;
    const relation = e.relation || "related_to";
    const confidence = e.confidence || "INFERRED";
    const metadata = e.metadata || {};
    if (e.confidence_score !== undefined) metadata.confidence_score = e.confidence_score;
    if (e.weight !== undefined) metadata.weight = e.weight;
    try {
      if (upsertGraphEdge(d, { source: src, target: tgt, relation, confidence, metadata, created: nowIso() })) edgeCount++;
    } catch {}
  }

  syncGraphProjection(d, cwd);
  return { nodes: nodeCount, edges: edgeCount };
}

function importFromClaudeMem(d, cwd, projectFilter, opts = {}) {
  // Import memories from claude-mem database
  const cmemDbPath = join(process.env.HOME || "/tmp", ".claude-mem", "claude-mem.db");
  if (!existsSync(cmemDbPath)) {
    console.log(`Claude-mem database not found at ${cmemDbPath}`);
    return { memories: 0 };
  }
  try {
    const DB = require("node:sqlite").DatabaseSync;
    const cmemDb = new DB(cmemDbPath, { open: true, readOnly: true });
    let rows;
    if (projectFilter) {
      rows = cmemDb.prepare("SELECT * FROM observations WHERE project = ? ORDER BY created_at ASC").all(projectFilter);
    } else {
      rows = cmemDb.prepare("SELECT * FROM observations ORDER BY created_at ASC").all();
    }
    cmemDb.close();
    if (opts.dryRun) return { memories: rows.length };

    let memoryCount = 0;
    for (const row of rows) {
      const body = [row.text || "", row.narrative || ""].filter(Boolean).join("\n\n");
      if (!body.trim()) continue;
      const tags = ["claude-mem"];
      const summaryParts = [];
      if (row.facts) { summaryParts.push(row.facts); }
      if (row.concepts) {
        summaryParts.push(row.concepts);
        row.concepts.split(",").map(s => s.trim()).filter(Boolean).forEach(t => tags.push(t));
      }
      const files = [];
      if (row.files_read) row.files_read.split(",").map(s => s.trim()).filter(Boolean).forEach(f => { if (!files.includes(f)) files.push(f); });
      if (row.files_modified) row.files_modified.split(",").map(s => s.trim()).filter(Boolean).forEach(f => { if (!files.includes(f)) files.push(f); });

      const memoryId = `cmem:${hashText(row.text || "")}`;
      const result = upsertMemoryItem(d, {
        id: memoryId,
        kind: row.type || "fact",
        layer: "semantic",
        title: row.title || row.type || "Claude-mem observation",
        body: body.trim(),
        summary: summaryParts.join("; ").slice(0, 500),
        confidence: 0.7,
        salience: 0.5,
        source: "claude-mem",
        cwd,
        gitBranch: "",
        agent: "claude-mem",
        taskKind: "",
        files,
        tags,
        sessionId: "",
        createdAt: row.created_at || nowIso(),
        metadata: { cmem_observation_id: row.id },
      });
      if (result && result.id) memoryCount++;
    }
    refreshProjections(d, cwd);
    return { memories: memoryCount };
  } catch (e) {
    console.log(`Claude-mem import error: ${e.message}`);
    return { memories: 0 };
  }
}

function importFromJson(d, cwd, filePath, opts = {}) {
  // Import generic JSON with nodes/edges arrays
  if (!existsSync(filePath)) {
    console.log(`File not found: ${filePath}`);
    return { nodes: 0, edges: 0 };
  }
  let raw;
  try { raw = JSON.parse(readFileSync(filePath, "utf-8")); } catch (e) {
    console.log(`Invalid JSON file: ${e.message}`);
    return { nodes: 0, edges: 0 };
  }
  const nodes = raw.nodes || [];
  const edges = raw.edges || [];
  if (opts.dryRun) return { nodes: nodes.length, edges: edges.length };

  let nodeCount = 0, edgeCount = 0;
  for (const n of nodes) {
    const normalized = normalizeGraphNode({
      id: n.id,
      label: n.label || n.name || n.title || n.id,
      type: n.type || n.category || n.kind || "imported",
      metadata: n.metadata || {},
      created: n.created,
    });
    try { if (upsertGraphNode(d, normalized)) nodeCount++; } catch {}
  }
  for (const e of edges) {
    const normalized = normalizeGraphEdge({
      source: e.source || e.from || e.src,
      target: e.target || e.to || e.dst,
      relation: e.relation || e.type || e.label || "related_to",
      confidence: e.confidence || "EXTRACTED",
      metadata: e.metadata || {},
      created: e.created,
    });
    try { if (upsertGraphEdge(d, normalized)) edgeCount++; } catch {}
  }
  syncGraphProjection(d, cwd);
  return { nodes: nodeCount, edges: edgeCount };
}

function ensureGraphStoreReady(d, cwd) {
  importLegacyGraphFile(d, cwd);
  if (!existsSync(mp(cwd, GF))) {
    syncGraphProjection(d, cwd);
  }
}

function hashText(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `h_${(hash >>> 0).toString(16)}`;
}

function ensureMemoryReady(c) {
  if (!existsSync(mp(c, ""))) {
    console.log("No memory/. Run: cm init");
    process.exit(1);
  }
}

