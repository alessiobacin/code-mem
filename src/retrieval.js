function scoreMemory(row, plan, task, cwd, level, semanticScore) {
  const text = `${row.title} ${row.body} ${row.summary || ""}`.toLowerCase();
  const queryWords = tokenizeQuery(task).filter((word) => word.length > 2);
  let keywordHits = 0;
  for (const word of queryWords) if (text.includes(word)) keywordHits += 1;
  const keywordScore = queryWords.length ? keywordHits / queryWords.length : 0;
  const conceptScore = scoreConceptCoverage(row, queryWords);
  const graphConceptScore = scoreConceptCoverage(row, plan.graphTerms || []);
  const queryEntry = plan.queries.find((q) => q.kind === row.kind);
  const kindPriorityScore = queryEntry ? 1 / queryEntry.priority : 0.05;
  const curationScore =
    row.kind === "decision" ? 1 :
    row.kind === "procedure" ? 0.9 :
    row.kind === "issue" ? 0.8 :
    row.kind === "artifact" ? 0.7 :
    row.kind === "fact" ? 0.5 :
    row.kind === "preference" ? 0.3 : 0.4;
  const sourceScore = row.source === "scan" ? 0.15 : row.source === "legacy-import" ? 0.5 : 1;
  const branchScore = row.git_branch && row.git_branch === plan.contextFrame.gitBranch ? 1 : 0;
  const cwdScore = row.cwd && row.cwd === cwd ? 1 : 0;
  const contextScore = branchScore * 0.6 + cwdScore * 0.4;
  const ageHours = row.updated_at ? Math.max(1, (Date.now() - Date.parse(row.updated_at)) / 3600000) : 999;
  const recencyScore = Math.max(0, 1 - ageHours / (24 * 30));
  const accessScore = Math.min(1, (row.access_count || 0) / 8);
  const confidenceScore = clamp01(row.confidence, DEFAULT_CONFIDENCE);
  const importanceScore = clamp01(row.importance, clamp01(row.salience, DEFAULT_SALIENCE));
  const retrievalStrengthScore = clamp01(row.retrieval_strength, Math.min(1, (row.access_count || 0) / 8));
  const graphDb = plan.dbByScope?.[row._scope || "project"] || plan.db;
  const graphScore = countLinksForMemory(graphDb, row.id);
  const scopeKey = `${row._scope || "project"}:${row.id}`;
  const linkInfo = plan.linkExpansion?.[scopeKey] || null;
  const linkDistanceScore = linkInfo && linkInfo.distance > 0 ? Math.max(0, 1 - (linkInfo.distance - 1) * 0.35) : 0;
  let score;
  const mode = plan.mode || "hybrid";
  const hasSemantic = semanticScore !== undefined && semanticScore >= 0;
  const semanticDriven = hasSemantic && keywordScore < 0.05 && conceptScore < 0.05;
  if (mode === "semantic" && hasSemantic) {
    score =
      0.55 * semanticScore +
      0.1 * recencyScore +
      0.04 * graphScore +
      0.1 * conceptScore +
      0.05 * graphConceptScore +
      0.1 * sourceScore +
      0.04 * linkDistanceScore +
      0.04 * confidenceScore +
      0.04 * importanceScore;
  } else if (mode === "hybrid" && hasSemantic) {
    if (semanticDriven) {
      score =
        0.35 * semanticScore +
        0.15 * recencyScore +
        0.1 * accessScore +
        0.05 * contextScore +
        0.04 * graphScore +
        0.15 * curationScore +
        0.1 * sourceScore +
        0.04 * linkDistanceScore +
        0.06 * confidenceScore +
        0.06 * importanceScore +
        0.04 * retrievalStrengthScore;
    } else {
      score =
        0.10 * keywordScore +
        0.18 * recencyScore +
        0.10 * accessScore +
        0.08 * contextScore +
        0.05 * kindPriorityScore +
        0.10 * graphScore +
        0.16 * conceptScore +
        0.08 * graphConceptScore +
        0.10 * semanticScore +
        0.03 * sourceScore +
        0.02 * linkDistanceScore +
        0.04 * confidenceScore +
        0.04 * importanceScore +
        0.03 * retrievalStrengthScore;
    }
  } else {
    score =
      0.22 * keywordScore +
      0.18 * recencyScore +
      0.15 * accessScore +
      0.10 * contextScore +
      0.1 * kindPriorityScore +
      0.1 * graphScore +
      0.1 * conceptScore +
      0.05 * graphConceptScore +
      0.03 * sourceScore +
      0.02 * linkDistanceScore +
      0.04 * confidenceScore +
      0.04 * importanceScore +
      0.03 * retrievalStrengthScore;
  }
  return {
    score,
    level,
    keywordScore,
    conceptScore,
    graphConceptScore,
    sourceScore,
    curationScore,
    linkDistanceScore,
    linkInfo,
    recencyScore,
    accessScore,
    contextScore,
    kindPriorityScore,
    graphScore,
    semanticScore,
    confidenceScore,
    importanceScore,
    retrievalStrengthScore,
  };
}

// ─── A1: multi-round temperature re-ranking (recall-auto) ──────────────────
//
// Behavioural pattern reimplemented ex-novo in JS (no GPL code copied):
// like an EM loop that grows more confident at every round, successive
// re-ranking rounds weigh retrieval signals with rising severity. Round r
// runs a temperature-controlled softmax over the composite signal score:
//
//   T(r) = T0 / r                      → colder (more decisive) each round
//   p_i(r) = exp(score_i / T(r))       → normalized over candidates
//   consensus_i = Σ_r p_i(r)           → accumulated EM-like consensus
//
// Round 1 (T = T0 = 1) is strictly monotonic in the base score, so ranking
// order is identical to the single-pass baseline — other recall modes and
// `cm recall` are untouched. Later rounds re-concentrate confidence on the
// candidates whose mixed signals (keyword, concept, semantic, recency, …)
// hold up under scrutiny, promoting stable all-round matches and demoting
// borderline ones. Output scores are re-scaled back to [0,1] so callers and
// renderers keep their existing semantics.

const TEMPERATURE_RERANK_DEFAULT_ROUNDS = 3;
const TEMPERATURE_RERANK_TEMPERATURE = 1.0;

function temperatureRerank(ranked, options = {}) {
  const rounds = Math.max(1, Math.min(8, Number.parseInt(options.rounds, 10) || TEMPERATURE_RERANK_DEFAULT_ROUNDS));
  const temperature = options.temperature !== undefined && options.temperature > 0 ? options.temperature : TEMPERATURE_RERANK_TEMPERATURE;
  if (!Array.isArray(ranked) || ranked.length <= 1 || rounds === 1 && temperature === 1) {
    return ranked || [];
  }
  const n = ranked.length;
  const consensus = new Array(n).fill(0);
  let maxConsensus = 0;
  for (let r = 1; r <= rounds; r += 1) {
    const temp = temperature / r;
    const logits = ranked.map((entry) => (entry.score || 0) / temp);
    const maxLogit = Math.max(...logits);
    let sumExp = 0;
    const probs = logits.map((z) => {
      const p = Math.exp(z - maxLogit); // shifted for numerical stability
      sumExp += p;
      return p;
    });
    for (let i = 0; i < n; i += 1) {
      const p = probs[i] / (sumExp || 1);
      consensus[i] += p;
    }
  }
  for (let i = 0; i < n; i += 1) maxConsensus = Math.max(maxConsensus, consensus[i]);
  return ranked
    .map((entry, i) => ({
      ...entry,
      // Re-scale to [0,1]: preserves renderer/limit expectations while the
      // ORDER reflects accumulated cross-round consensus, not just round 1.
      score: maxConsensus > 0 ? consensus[i] / maxConsensus : entry.score,
      rerankConsensus: consensus[i],
    }))
    .sort((a, b) => b.score - a.score);
}

function countLinksForMemory(d, id) {
  const row = getStmt(
    d,
    "SELECT COUNT(*) AS count FROM memory_links WHERE source_id = ? OR target_id = ?",
    [id, id]
  );
  return Math.min(1, (row?.count || 0) / 5);
}

function tokenizeQuery(task) {
  return String(task || "")
    .toLowerCase()
    .replace(/['"]/g, " ")
    .split(/[^a-z0-9_]+/)
    .filter((word) => word.length > 1);
}

function buildFtsQuery(words) {
  return words
    .filter((word) => word.length > 1)
    .map((word) => `"${word}"*`)
    .join(" OR ");
}

function queryMemoryCandidates(d, words, limit) {
  const normalized = Array.from(new Set(words.filter((word) => word.length > 1)));
  if (!normalized.length) return [];
  // Use FTS5 full-text search (10-100x faster than LIKE)
  const ftsQuery = normalized.map(w => `"${w}"*`).join(" OR ");
  try {
    return allStmt(
      d,
      `SELECT id FROM memory_fts WHERE memory_fts MATCH ? ORDER BY rank LIMIT ?`,
      [ftsQuery, limit]
    ).map((row) => row.id);
  } catch {}
  // Fallback: LIKE-based search
  const clauses = [];
  const params = [];
  for (const word of normalized) {
    const like = `%${word}%`;
    clauses.push("(lower(mi.title) LIKE ? OR lower(mi.body) LIKE ? OR lower(coalesce(mi.summary, '')) LIKE ?)");
    params.push(like, like, like);
  }
  return allStmt(
    d,
    `SELECT mi.id FROM memory_items mi WHERE mi.status='active' AND (${clauses.join(" OR ")}) ORDER BY mi.updated_at DESC LIMIT ?`,
    params.concat([limit])
  ).map((row) => row.id);
}

function uniqueRowsById(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    if (!row?.id || seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}

function rowIsRetrievable(row, asOf = null) {
  if (!row || row.status === "archived") return false;
  const belief = row.belief_status || (row.status === "active" ? "accepted" : row.status);
  if (!asOf && (row.status !== "active" || ["candidate", "contested", "corrected", "obsolete", "superseded", "invalidated", "archived"].includes(belief))) return false;
  if (asOf) {
    const t = Date.parse(asOf);
    if (!Number.isNaN(t)) {
      const from = row.valid_from ? Date.parse(row.valid_from) : Number.NEGATIVE_INFINITY;
      const to = row.valid_to ? Date.parse(row.valid_to) : Number.POSITIVE_INFINITY;
      if (t < from || t >= to) return false;
    }
  }
  return true;
}

function loadCandidateRows(d, words, scope, limit, asOf = null) {
  const ids = queryMemoryCandidates(d, words, limit);
  const effectiveLimit = Math.max(limit, 40);
  let candidates = [];
  if (ids.length) {
    const placeholders = ids.map(() => '?').join(',');
    candidates = listMemoryRows(d, `WHERE mi.id IN (${placeholders})`, ids, "").filter((row) => rowIsRetrievable(row, asOf)).map((row) => ({ ...row, _scope: scope }));
  }
  const candidateIds = new Set(candidates.map(r => r.id));
  const fallbackRows = listMemoryRows(
    d, "WHERE mi.status='active'", [],
    `ORDER BY mi.updated_at DESC LIMIT ${effectiveLimit}`
  ).filter((r) => !candidateIds.has(r.id) && rowIsRetrievable(r, asOf)).map((row) => ({ ...row, _scope: scope }));
  return uniqueRowsById(candidates.concat(fallbackRows)).slice(0, effectiveLimit);
}

function expandGraphTerms(d, words, limit = 12) {
  if (!words.length) return [];
  const matched = new Map();
  for (const word of words) {
    const like = `%${word}%`;
    const nodes = allStmt(
      d,
      "SELECT id,label,type FROM graph_nodes WHERE lower(label) LIKE ? OR lower(type) LIKE ? OR lower(id) LIKE ? LIMIT 8",
      [like, like, like]
    );
    for (const node of nodes) matched.set(node.id, node);
  }
  if (!matched.size) return [];
  const expanded = new Set();
  for (const node of matched.values()) {
    expanded.add(String(node.label || "").toLowerCase());
    const neighbors = allStmt(
      d,
      `SELECT n.label
       FROM graph_edges e
       JOIN graph_nodes n ON n.id = CASE WHEN e.source_id = ? THEN e.target_id ELSE e.source_id END
       WHERE e.source_id = ? OR e.target_id = ?
       LIMIT 8`,
      [node.id, node.id, node.id]
    );
    for (const neighbor of neighbors) {
      const label = String(neighbor.label || "").toLowerCase().trim();
      if (label) expanded.add(label);
    }
  }
  return Array.from(expanded).slice(0, limit);
}

function scoreConceptCoverage(row, terms) {
  if (!terms.length) return 0;
  const text = `${row.title} ${row.body} ${row.summary || ""} ${(tagsForRow(row) || []).join(" ")} ${(filesForRow(row) || []).join(" ")}`
    .toLowerCase();
  let matches = 0;
  for (const term of terms) {
    if (term && text.includes(term)) matches += 1;
  }
  return matches / terms.length;
}

function loadRowsByIds(d, ids, scope, asOf = null) {
  if (!ids.length) return [];
  const idList = ids.filter(Boolean);
  if (!idList.length) return [];
  const placeholders = idList.map(() => '?').join(',');
  return listMemoryRows(d, `WHERE mi.id IN (${placeholders})`, idList, "").filter((row) => rowIsRetrievable(row, asOf)).map((row) => ({ ...row, _scope: scope }));
}

function loadGlobalPreferenceRows(d, limit = 24, asOf = null) {
  return listMemoryRows(
    d,
    "WHERE mi.status='active' AND mi.kind='preference' AND mi.scope_key='global'",
    [],
    `ORDER BY mi.importance DESC, mi.updated_at DESC LIMIT ${Math.max(1, limit)}`
  )
    .filter((row) => rowIsRetrievable(row, asOf))
    .map((row) => ({ ...row, _scope: "global", _globalPreference: true }));
}

function expandLinkedCandidateMap(d, seedIds, maxDepth = 2, maxTotal = 48) {
  const visited = new Map();
  const queue = [];
  for (const id of seedIds) {
    if (!id) continue;
    visited.set(id, { distance: 0, via: null, relation: null });
    queue.push(id);
  }
  while (queue.length && visited.size < maxTotal) {
    const current = queue.shift();
    const currentInfo = visited.get(current);
    if (!currentInfo || currentInfo.distance >= maxDepth) continue;
    const neighbors = allStmt(
      d,
      `SELECT
         CASE WHEN source_id = ? THEN target_id ELSE source_id END AS id,
         relation
       FROM memory_links
       WHERE source_id = ? OR target_id = ?
       LIMIT 16`,
      [current, current, current]
    );
    for (const neighbor of neighbors) {
      if (!neighbor?.id || visited.has(neighbor.id)) continue;
      visited.set(neighbor.id, {
        distance: currentInfo.distance + 1,
        via: current,
        relation: neighbor.relation,
      });
      queue.push(neighbor.id);
      if (visited.size >= maxTotal) break;
    }
  }
  return visited;
}

function materializeLinkPath(linkMap, id) {
  const info = linkMap.get(id);
  if (!info || info.distance <= 0) return [];
  const path = [];
  let currentId = id;
  let current = info;
  while (current && current.via) {
    path.push({ from: current.via, to: currentId, relation: current.relation, distance: current.distance });
    currentId = current.via;
    current = linkMap.get(currentId);
  }
  return path.reverse();
}

async function recallMemories(d, cwd, task, level, limit, mode, options = {}) {
  const plan = makePlan(task, cwd);
  plan.db = d;
  plan.mode = mode || "hybrid";
  plan.explain = Boolean(options.explain);
  plan.scope = options.scope || "auto";
  plan.asOf = options.asOf || null;
  const queryWords = tokenizeQuery(task);
  const isExplore = mode === "explore";
  // Explore mode: expand graph terms more aggressively
  const exploreDepth = isExplore ? 3 : level;
  const projectGraphTerms = exploreDepth <= 1 ? [] : expandGraphTerms(d, queryWords);
  plan.graphTerms = projectGraphTerms;
  const projectSeedIds = queryMemoryCandidates(d, queryWords.concat(projectGraphTerms), 32);
  const linkDepth = isExplore ? 3 : (level <= 1 ? 2 : 2);
  const linkMax = isExplore ? 80 : 48;
  const projectLinkMap = exploreDepth <= 1 ? new Map() : expandLinkedCandidateMap(d, projectSeedIds, linkDepth, linkMax);
  const projectRows = plan.scope === "global" ? [] : uniqueRowsById(
    loadRowsByIds(d, Array.from(projectLinkMap.keys()), "project", plan.asOf)
      .concat(loadCandidateRows(d, queryWords.concat(projectGraphTerms), "project", 80, plan.asOf))
      .concat(workingMemoryRows(d, cwd, task, 24).filter((row) => rowIsRetrievable(row, plan.asOf)).map((row) => ({ ...row, _scope: "project" })))
  );
  // Default/auto recall may use the global store; project-only diagnostics do
  // not. The global store is opened once and closed after scoring.
  let globalDb = null;
  let globalRows = [];
  let globalLinkMap = new Map();
  // Global preferences are user-level policy, not project facts. They are
  // deliberately injected into the default project context so an agent can
  // remember how the user generally works without changing the current
  // repository's detected stack. `--scope project` remains an explicit,
  // project-only diagnostic mode.
  if (plan.scope !== "project") {
    globalDb = od(globalDbPath());
    const globalGraphTerms = exploreDepth <= 1 ? [] : expandGraphTerms(globalDb, queryWords);
    const mergedTerms = Array.from(new Set(projectGraphTerms.concat(globalGraphTerms))).slice(0, 20);
    if (mergedTerms.length > (plan.graphTerms || []).length) plan.graphTerms = mergedTerms;
    const globalSeedIds = queryMemoryCandidates(globalDb, queryWords.concat(globalGraphTerms), 32);
    globalLinkMap = exploreDepth <= 1 ? new Map() : expandLinkedCandidateMap(globalDb, globalSeedIds, linkDepth, linkMax);
    globalRows = uniqueRowsById(
      loadRowsByIds(globalDb, Array.from(globalLinkMap.keys()), "global", plan.asOf)
        .concat(loadCandidateRows(globalDb, queryWords.concat(globalGraphTerms), "global", 80, plan.asOf))
        .concat(loadGlobalPreferenceRows(globalDb, 24, plan.asOf))
    ).map((row) => row.kind === "preference" && row.scope_key === "global"
      ? { ...row, _globalPreference: true }
      : row);
  }
  plan.dbByScope = { project: d, global: globalDb || d };
  plan.linkExpansion = {};
  for (const [id, info] of projectLinkMap.entries()) plan.linkExpansion[`project:${id}`] = info;
  for (const [id, info] of globalLinkMap.entries()) plan.linkExpansion[`global:${id}`] = info;
  const rows = uniqueRowsById(projectRows.concat(globalRows)).filter((row) => rowIsRetrievable(row, plan.asOf));
  const useSemantic = plan.mode !== "keyword" && task && task.trim().length > 0;
  let taskEmbedding = null;
  let taskEmbeddingSpace = "trigram";
  if (useSemantic) {
    // Ollama embeddings whenever reachable (any level): synonym-level
    // semantics. Trigram stays the deterministic fallback, never a blocker.
    if (checkOllama() && !isExplore) {
      const ollamaVec = await computeEmbedding(task).catch(() => null);
      if (ollamaVec) { taskEmbedding = ollamaVec; taskEmbeddingSpace = "ollama"; }
      else taskEmbedding = trigramEmbed(task);
    } else {
      taskEmbedding = trigramEmbed(task);
    }
  }
  const ranked = [];
  // Dual-vector contract: cosine only within one space. When Ollama is up
  // the task embedding is semantic and rows score from their stored Ollama
  // vector; rows without one yet skip semantic (upgrade via consolidate).
  // When Ollama is down everything scores in trigram space (stored or
  // computed on the fly — same space, always comparable).
  const taskSpace = taskEmbeddingSpace || "trigram";
  for (const row of rows) {
    let semanticScore;
    if (taskEmbedding) {
      const storeDb = plan.dbByScope[row._scope || "project"] || d;
      if (taskSpace === "ollama") {
        const memBuf = getOllamaVector(storeDb, row.id);
        if (memBuf) semanticScore = cosineSimilarity(taskEmbedding, bufferToVector(memBuf));
      } else {
        const vecRow = getStmt(storeDb, "SELECT vector FROM memory_vectors WHERE memory_id = ?", [row.id]);
        if (vecRow) {
          semanticScore = cosineSimilarity(taskEmbedding, bufferToVector(vecRow.vector));
        } else {
          const text = `${row.title} ${row.body} ${row.summary || ""}`;
          semanticScore = cosineSimilarity(taskEmbedding, trigramEmbed(text));
        }
      }
    }
    const scores = scoreMemory(row, plan, task, cwd, level, semanticScore);
    if (row._globalPreference) {
      // Keep a small, bounded preference slice in every normal context even
      // when the task is unrelated to the preference wording.
      scores.score = Math.max(scores.score, 0.18 + (Number(row.importance) || 0) * 0.12);
      scores.globalPreference = true;
    }
    if (plan.asOf) scores.score *= 0.98;
    const linkMap = row._scope === "global" ? globalLinkMap : projectLinkMap;
    const linkPath = materializeLinkPath(linkMap, row.id);
    // Explore mode: boost graph link proximity and concept coverage
    if (isExplore) {
      const conceptBoost = scores.conceptScore > 0.2 ? 0.15 : 0;
      const linkBoost = linkPath ? Math.min(0.2, (linkPath.length || 0) * 0.05) : 0;
      const graphBoost = plan.graphTerms?.length ? scores.graphConceptScore * 0.2 : 0;
      scores.score += conceptBoost + linkBoost + graphBoost;
    }
    ranked.push({ row, ...scores });
    ranked[ranked.length - 1].linkPath = linkPath;
    ranked[ranked.length - 1].evidence = memoryEvidenceFor(plan.dbByScope[row._scope || "project"] || d, row.id, 3);
  }
  const rankedByScore = ranked
    .filter((entry) => entry.score > 0.05)
    .sort((a, b) => b.score - a.score);
  const injectedPreferences = rankedByScore.filter((entry) => entry.row._globalPreference).slice(0, Math.min(4, limit));
  const selected = injectedPreferences.concat(rankedByScore.filter((entry) => !entry.row._globalPreference));
  const seenSelected = new Set();
  const filtered = selected.filter((entry) => {
    const key = `${entry.row._scope || "project"}:${entry.row.id}`;
    if (seenSelected.has(key)) return false;
    seenSelected.add(key);
    return true;
  }).slice(0, limit);
  const timestamp = nowIso();
  for (const entry of filtered) {
    const storeDb = plan.dbByScope[entry.row._scope || "project"] || d;
    runStmt(
      storeDb,
      "UPDATE memory_items SET last_accessed_at=?, access_count=COALESCE(access_count,0)+1, retrieval_strength=MIN(1,COALESCE(retrieval_strength,0)+0.03) WHERE id=?",
      [timestamp, entry.row.id]
    );
    if (!plan.asOf && entry.row._scope === "project") {
      upsertWorkingMemory(d, cwd, task, entry.row, entry.score, {
        mode: plan.mode,
        keyword: entry.keywordScore,
        semantic: entry.semanticScore,
        confidence: entry.confidenceScore,
      });
    }
  }
  if (globalDb) globalDb.close();
  // Noise gate: when the best non-preference result shares zero ground
  // with the query on every lexical axis (keyword + concept + graph
  // expansion), downstream agents get an explicit low-confidence signal
  // instead of silent noise. Deliberately excludes the dense axis:
  // embeddings score ~0.4 even on unrelated text, so semantics cannot
  // serve as a noise detector. Graph expansion counts — a paraphrase the
  // graph supports is a legit match, not noise.
  const bestFactual = filtered.find((entry) => !entry.row._globalPreference);
  const factualMatch = bestFactual ? Math.max(bestFactual.keywordScore || 0, bestFactual.conceptScore || 0, bestFactual.graphConceptScore || 0) : 0;
  const lowConfidence = !bestFactual || factualMatch < 0.05;
  return { plan, ranked: filtered, lowConfidence, bestFactualScore: bestFactual ? bestFactual.score : 0 };
}

function renderRecall(task, level, recalled) {
  const lines = [];
  lines.push(`Task: ${task}`);
  lines.push(`Plan: ${recalled.plan.taskKind} / ${recalled.plan.strategy} / mode=${recalled.plan.mode}`);
  if (recalled.lowConfidence) lines.push(`Confidence: low (no lexical match) — treat results as context, not answers.`);
  if (recalled.plan.graphTerms?.length) lines.push(`Graph terms: ${recalled.plan.graphTerms.join(", ")}`);
  lines.push(`Level: ${level}`);
  lines.push("");
  if (!recalled.ranked.length) {
    lines.push("No relevant memories.");
    return lines.join("\n");
  }
  for (const entry of recalled.ranked) {
    const row = entry.row;
    const sem = entry.semanticScore !== undefined && entry.semanticScore >= 0 ? ` sem=${entry.semanticScore.toFixed(3)}` : "";
    const concept = entry.conceptScore !== undefined ? ` concept=${entry.conceptScore.toFixed(2)}` : "";
    const graphConcept = entry.graphConceptScore ? ` graph=${entry.graphConceptScore.toFixed(2)}` : "";
    const scope = row._scope === "global" ? "global" : "project";
    const scopeLabel = row._globalPreference ? "global-preference" : scope;
    const prefix = `[${row.id}] [${row.kind}] [${scopeLabel}] score=${entry.score.toFixed(2)}${sem}${concept}${graphConcept}`;
    if (level === 1) {
      lines.push(`${prefix} ${row.title}`);
      continue;
    }
    if (level === 2) {
      const files = filesForRow(row);
      const extra = [];
      if (files.length) extra.push(`files=${files.join(",")}`);
      if (row.git_branch) extra.push(`branch=${row.git_branch}`);
      if (recalled.plan.explain && entry.linkPath?.length) {
        const pathText = entry.linkPath.map((step) => `${step.from} -[${step.relation}]-> ${step.to}`).join(" | ");
        extra.push(`linkPath=${pathText}`);
      }
      lines.push(`${prefix} ${row.title}`);
      lines.push(`  ${row.summary || summarize(row.body)}${extra.length ? ` (${extra.join(" · ")})` : ""}`);
      continue;
    }
    lines.push(`${prefix} ${row.title}`);
    lines.push(`  Summary: ${row.summary || summarize(row.body)}`);
    lines.push(`  Body: ${row.body}`);
    const tags = tagsForRow(row);
    if (tags.length) lines.push(`  Tags: ${tags.join(", ")}`);
    const files = filesForRow(row);
    if (files.length) lines.push(`  Files: ${files.join(", ")}`);
    if (recalled.plan.explain) {
      lines.push(
        `  Explain: keyword=${entry.keywordScore.toFixed(2)} concept=${entry.conceptScore.toFixed(2)} graphTerms=${entry.graphConceptScore.toFixed(2)} links=${entry.linkDistanceScore.toFixed(2)} recency=${entry.recencyScore.toFixed(2)} confidence=${entry.confidenceScore.toFixed(2)} importance=${entry.importanceScore.toFixed(2)} source=${entry.sourceScore.toFixed(2)}`
      );
      if (row.belief_status || row.valid_from || row.valid_to) {
        lines.push(`  Belief: status=${row.belief_status || row.status} confidence=${Number(row.confidence || 0).toFixed(2)} valid=${row.valid_from || "?"}..${row.valid_to || "∞"}`);
      }
      if (entry.evidence?.length) lines.push(`  Evidence: ${entry.evidence.map((e) => `${e.relation}:${e.episode_id}`).join(", ")}`);
      if (entry.linkPath?.length) {
        lines.push(`  Link Path: ${entry.linkPath.map((step) => `${step.from} -[${step.relation}]-> ${step.to}`).join(" | ")}`);
      }
    }
  }
  return lines.join("\n");
}
