// Unified repository-to-memory workflow.

function applyGraphCommunities(d, cwd) {
  const graph = loadGraphFromStore(d);
  const communities = detectCommunities(graph);
  const byId = new Map(communities.map((item) => [item.id, item.community]));
  for (const node of graph.nodes) {
    const metadata = { ...(node.metadata || {}), community: byId.has(node.id) ? byId.get(node.id) : -1 };
    runStmt(d, "UPDATE graph_nodes SET metadata_json=?, updated_at=? WHERE id=?", [JSON.stringify(metadata), nowIso(), node.id]);
  }
  syncGraphProjection(d, cwd);
  return { nodes: graph.nodes.length, edges: graph.edges.length, communities: new Set(communities.map((item) => item.community)).size };
}

function bridgeImportedNotes(d, cwd) {
  const graph = loadGraphFromStore(d);
  let edges = 0;
  for (const node of graph.nodes) {
    const sourcePath = node.metadata?.source_path;
    if (!sourcePath || !/^\w+-(?:note|knowledge)/i.test(node.type || "") && !/note/i.test(node.type || "")) continue;
    const fileId = `path:file:${sourcePath}`;
    if (!getStmt(d, "SELECT id FROM graph_nodes WHERE id=?", [fileId])) continue;
    if (upsertGraphEdge(d, { source: fileId, target: node.id, relation: "represents", confidence: "EXTRACTED", metadata: { source_path: sourcePath } })) edges += 1;
  }
  if (edges) syncGraphProjection(d, cwd);
  return edges;
}

function canonicalizeAstLinks(d, cwd, astResult) {
  let edges = 0;
  for (const node of astResult.nodes || []) {
    const sourcePath = node.metadata?.source_path;
    if (!sourcePath || node.type !== "file") continue;
    const canonical = `path:file:${sourcePath}`;
    if (!getStmt(d, "SELECT id FROM graph_nodes WHERE id=?", [canonical])) continue;
    if (upsertGraphEdge(d, { source: canonical, target: node.id, relation: "parsed_as", confidence: "EXTRACTED", metadata: { source_path: sourcePath } })) edges += 1;
  }
  return edges;
}

function chooseHarness(harnesses) {
  const forced = String(process.env.CM_LLM_HARNESS || "").trim().toLowerCase();
  if (forced === "none" || forced === "off") return null;
  if (forced) return harnesses.find((harness) => harness.name === forced && harness.available) || null;
  const preferred = ["claude", "pi", "codex", "opencode", "gemini", "qwen", "copilot"];
  for (const name of preferred) {
    const found = harnesses.find((harness) => harness.name === name && harness.available);
    if (found) return found;
  }
  return harnesses.find((harness) => harness.available) || null;
}

async function runDeepProjectUpdate(d, cwd, opts = {}) {
  const harnesses = detectHarnesses(cwd);
  console.log(`Detected harnesses: ${describeHarnesses(harnesses)}`);
  const integration = await installDetectedHarnessIntegrations(cwd, harnesses);
  console.log(`Harness integration: ${integration.hooks} hook target(s), ${integration.skills} skill/command file(s).`);
  const llmHarness = opts.noLlm ? null : chooseHarness(harnesses);
  if (llmHarness) {
    console.log(`Semantic LLM: ${llmHarness.name} (${llmHarness.model}) via its configured settings.`);
  } else {
    console.log("Semantic LLM: unavailable or disabled; deterministic extraction remains enabled.");
  }

  const inventory = scanRepositoryInventory(cwd, opts);
  let inventoryNodes = 0, inventoryEdges = 0;
  for (const node of inventory.nodes) {
    try { if (upsertGraphNode(d, node)) inventoryNodes += 1; } catch {}
  }
  for (const edge of inventory.edges) {
    try { if (upsertGraphEdge(d, edge)) inventoryEdges += 1; } catch {}
  }
  console.log(`Full repository index: ${inventory.files.length} files, ${inventory.nodes.length} structural nodes, ${inventory.edges.length} structural relations.`);

  try { if (!checkAcorn()) installAcornDeps(); } catch {}
  const ast = scanASTDeep(cwd, Boolean(opts.noAst));
  let astNodes = 0, astEdges = 0;
  for (const node of ast.nodes) {
    try { if (upsertGraphNode(d, node)) astNodes += 1; } catch {}
  }
  for (const edge of ast.edges) {
    try { if (upsertGraphEdge(d, edge)) astEdges += 1; } catch {}
  }
  const astLinks = canonicalizeAstLinks(d, cwd, ast);
  console.log(`Code structure: ${ast.files} source files, ${astNodes} new symbols, ${astEdges + astLinks} relations.`);

  const imported = await importFromWiki(d, cwd, cwd, "knowledge", {
    cwd,
    harness: llmHarness,
    disableLlm: !llmHarness,
    llmLimit: Number(process.env.CM_DEEP_LLM_LIMIT || 20),
    llmBatchSize: Number(process.env.CM_DEEP_LLM_BATCH || 20),
    llmTimeout: Number(process.env.CM_LLM_TIMEOUT_MS || 45000),
  });
  const represented = bridgeImportedNotes(d, cwd);
  const deepMedia = imported.media?.converted ? ` + ${imported.media.converted} media` : "";
  console.log(`Knowledge files: ${imported.files} Markdown files${deepMedia}, ${imported.memories} memories, ${imported.edges + represented} document relations.`);
  if (imported.llm?.attempted) {
    const skipped = imported.llm.skipped ? `; ${imported.llm.skipped} deterministic fallback note(s)` : "";
    console.log(`Knowledge normalization: ${imported.llm.normalized}/${imported.llm.attempted} notes normalized${skipped}${imported.llm.model ? ` via ${imported.llm.model}` : ""}.`);
  }

  try { cmdEntities(d, cwd, ["--apply", "--limit", "80"]); } catch {}
  const semantic = runHarnessSemanticPass(d, cwd, llmHarness, { ...inventory, nodes: loadGraphFromStore(d).nodes });
  if (semantic.attempted) console.log(`Semantic relations: ${semantic.added} evidence-bound relation(s) added${semantic.model ? ` via ${semantic.model}` : ""}.`);
  const communities = applyGraphCommunities(d, cwd);
  const logic = refreshLogicMap(d, cwd, llmHarness, loadGraphFromStore(d));
  console.log(logicStatusLine(logic));
  const docMap = await refreshDocMap(d, cwd, llmHarness, loadGraphFromStore(d));
  console.log(docStatusLine(docMap));
  const snapshot = await refreshSnapshotMemory(d, cwd);
  refreshProjections(d, cwd);
  syncGraphProjection(d, cwd);
  const graph = loadGraphFromStore(d);
  const html2d = exportHTML(graph, cwd);
  const html3d = export3DHTML(graph, cwd, logic.map, docMap.map);
  const report = writeGraphReport(graph, cwd);
  const visual = graphForVisualization(graph);
  console.log(`Graph complete: ${graph.nodes.length} evidence nodes, ${graph.edges.length} evidence relations, ${communities.communities} communities.`);
  console.log(`Graph view (${visual.mode}): ${visual.nodes.length} nodes, ${visual.edges.length} relations.`);
  console.log(`3D graph: ${html3d}`);
  console.log(`Graph report: ${report.outPath}`);
  console.log(`Graph URL: ${graphProjectUrl(cwd)}`);
  // Token-reduction metric (graphify parity): corpus words vs graph bytes.
  let corpusWords = 0, graphBytes = 0;
  try {
    for (const file of inventory.files || []) {
      if (file.size <= 256 * 1024 && /\.(?:md|markdown|txt|json|ya?ml|toml|js|jsx|mjs|cjs|ts|tsx|py|go|rs|java|rb|php)$/i.test(file.relative || "")) {
        try { corpusWords += String(readFileSync(file.full, "utf8")).split(/\s+/).filter(Boolean).length; } catch {}
      }
    }
  } catch {}
  try { graphBytes = Buffer.byteLength(JSON.stringify(graph)); } catch {}
  // Honest per-query efficiency (same definition as graphify `benchmark`):
  // answer tokens vs naive full-corpus tokens. The old storage-ratio field
  // is dropped — on small corpora it went negative and meant nothing.
  let efficiency = null;
  try { efficiency = queryEfficiency(graph, cwd); } catch {}
  const costPath = recordRunCost(cwd, {
    workflow: "deep", files: inventory.files.length, corpus_words: corpusWords, graph_bytes: graphBytes,
    naive_tokens: efficiency?.naive_tokens ?? null,
    answer_tokens: efficiency?.answer_tokens ?? null,
    reduction_x: efficiency?.reduction_x ?? null,
    llm_calls: (imported.llm?.attempted || 0) + (semantic.attempted ? 1 : 0),
    llm_normalized: imported.llm?.normalized || 0, semantic_added: semantic.added || 0,
    media: imported.media?.converted || 0, nodes: graph.nodes.length, edges: graph.edges.length,
    model: semantic.model || imported.llm?.model || "",
  });
  console.log(`Cost ledger: ${costPath}`);
  if (efficiency) console.log(`Token efficiency: ${efficiency.reduction_x}x fewer tokens per query (~${efficiency.answer_tokens} vs ~${efficiency.naive_tokens}).`);
  return { harnesses, inventory, ast, imported, semantic, graph, html2d, html3d, snapshot, report };
}
