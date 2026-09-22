// Cognitive memory spine: additive evidence, provenance, temporal belief
// lifecycle, deterministic intake gate, working set and resumable run ledger.
// This fragment intentionally has no model/provider dependency. It is the T0
// path; optional classifiers can be layered on later without changing these
// contracts.

const MEMORY_NOISE_PATTERNS = [
  /^\[llmp\]\s+provider\b/i,
  /^\[llmproxy\]/i,
  /^credit(?:o)?\s+residuo\s*:/i,
];

function isMemoryNoise(text) {
  const value = String(text || "").trim();
  return MEMORY_NOISE_PATTERNS.some((pattern) => pattern.test(value));
}

// Compact storage contract: English-first, high-signal, caveman-style prose.
// Deterministic + fast. Preserves technical tokens, dates, names, assertions.
function compactMemoryText(text) {
  let value = String(text || "").replace(/\r/g, "").trim();
  if (!value || isMemoryNoise(value)) return "";
  value = value
    .replace(/^\s*(sure|certainly|of course|okay|ok|actually|basically|just|well)[,:.!-]?\s*/i, "")
    .replace(/\b(in order to)\b/gi, "to")
    .replace(/\b(at this point in time)\b/gi, "now")
    .replace(/\b(due to the fact that)\b/gi, "because")
    .replace(/\b(it is important to note that)\b/gi, "")
    .replace(/\b(there is|there are)\b/gi, "")
    .replace(/\s+/g, " ")
    .replace(/\s*([:;,])\s*/g, "$1 ")
    .replace(/\s+([.!?])/g, "$1")
    .trim();
  const bridges = [
    [/\bè stato reinizializzato\b/gi, "was reinitialized"],
    [/\bmemoria preservata\b/gi, "memory preserved"],
    [/\bora appartengono a\b/gi, "now belong to"],
    [/\bconfigurazione\b/gi, "configuration"],
    [/\bconfermato\b/gi, "confirmed"],
    [/\brisolto\b/gi, "fixed"],
    [/\berrore\b/gi, "error"],
  ];
  for (const [pattern, replacement] of bridges) value = value.replace(pattern, replacement);
  return value.replace(/\s+/g, " ").trim();
}

function ensureColumn(d, table, column, definition) {
  try {
    const cols = new Set(allStmt(d, `PRAGMA table_info(${table})`).map((c) => c.name));
    if (!cols.has(column)) runStmt(d, `ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  } catch {}
}

function ensureCognitiveTables(d) {
  const columns = [
    ["source_type", "TEXT DEFAULT 'manual'"],
    ["observed_at", "TEXT"],
    ["occurred_at", "TEXT"],
    ["last_verified_at", "TEXT"],
    ["invalidated_at", "TEXT"],
    ["belief_status", "TEXT DEFAULT 'accepted'"],
    ["claim_type", "TEXT DEFAULT 'fact'"],
    ["scope_key", "TEXT DEFAULT ''"],
    ["importance", "REAL DEFAULT 0.5"],
    ["retrieval_strength", "REAL DEFAULT 0.0"],
    ["processing_state", "TEXT DEFAULT 'ready'"],
  ];
  for (const [name, definition] of columns) ensureColumn(d, "memory_items", name, definition);
  ensureColumn(d, "messages", "episode_id", "TEXT");

  d.exec(`
    CREATE TABLE IF NOT EXISTS memory_episodes(
      id TEXT PRIMARY KEY,
      source_type TEXT NOT NULL DEFAULT 'conversation',
      source_ref TEXT,
      content TEXT NOT NULL,
      role TEXT,
      session_id TEXT,
      observed_at TEXT,
      occurred_at TEXT,
      scope_key TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      content_hash TEXT NOT NULL,
      processing_state TEXT NOT NULL DEFAULT 'pending',
      gate_decision TEXT NOT NULL DEFAULT 'CREATE_EPISODE',
      gate_reason TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_memory_episodes_state ON memory_episodes(processing_state, created_at);
    CREATE INDEX IF NOT EXISTS idx_memory_episodes_scope ON memory_episodes(scope_key, observed_at);
    CREATE INDEX IF NOT EXISTS idx_memory_episodes_source ON memory_episodes(source_type, source_ref);

    CREATE TABLE IF NOT EXISTS memory_evidence(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_id TEXT NOT NULL,
      episode_id TEXT NOT NULL,
      relation TEXT NOT NULL,
      polarity TEXT NOT NULL DEFAULT 'positive',
      reliability REAL DEFAULT 0.5,
      observed_at TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      UNIQUE(memory_id, episode_id, relation)
    );
    CREATE INDEX IF NOT EXISTS idx_memory_evidence_memory ON memory_evidence(memory_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_memory_evidence_episode ON memory_evidence(episode_id, created_at);

    CREATE TABLE IF NOT EXISTS memory_working_set(
      task_id TEXT NOT NULL,
      session_id TEXT NOT NULL DEFAULT '',
      memory_id TEXT NOT NULL,
      episode_id TEXT,
      relevance REAL DEFAULT 0.0,
      reason_json TEXT NOT NULL DEFAULT '{}',
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(task_id, memory_id)
    );
    CREATE INDEX IF NOT EXISTS idx_memory_working_expiry ON memory_working_set(expires_at);

    CREATE TABLE IF NOT EXISTS verification_queue(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_id TEXT,
      episode_id TEXT,
      reason TEXT NOT NULL,
      priority REAL DEFAULT 0.5,
      status TEXT NOT NULL DEFAULT 'pending',
      requested_at TEXT NOT NULL,
      verified_at TEXT,
      verifier TEXT,
      result_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_verification_queue_status ON verification_queue(status, priority DESC, requested_at);

    CREATE TABLE IF NOT EXISTS reflection_items(
      id TEXT PRIMARY KEY,
      statement TEXT NOT NULL,
      claim_type TEXT NOT NULL DEFAULT 'inference',
      confidence REAL DEFAULT 0.4,
      scope_key TEXT,
      status TEXT NOT NULL DEFAULT 'candidate',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS consolidation_runs(
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      watermark TEXT,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      processed_count INTEGER DEFAULT 0,
      created_count INTEGER DEFAULT 0,
      updated_count INTEGER DEFAULT 0,
      error_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_consolidation_runs_kind ON consolidation_runs(kind, started_at);
  `);

  try {
    runStmt(d, "UPDATE memory_items SET source_type=COALESCE(NULLIF(source_type,''), source, 'manual') WHERE source_type IS NULL OR source_type=''", []);
    runStmt(d, "UPDATE memory_items SET observed_at=COALESCE(observed_at, created_at) WHERE observed_at IS NULL", []);
    runStmt(d, "UPDATE memory_items SET belief_status=CASE WHEN status='archived' THEN 'archived' WHEN status IN ('contested','corrected','obsolete') THEN status ELSE COALESCE(NULLIF(belief_status,''),'accepted') END WHERE belief_status IS NULL OR belief_status=''", []);
    runStmt(d, "UPDATE memory_items SET claim_type=CASE WHEN kind='preference' THEN 'preference' WHEN kind='procedure' THEN 'procedure' WHEN kind='decision' THEN 'decision' WHEN kind='issue' THEN 'observation' ELSE COALESCE(NULLIF(claim_type,''),'fact') END WHERE claim_type IS NULL OR claim_type=''", []);
    runStmt(d, "UPDATE memory_items SET importance=COALESCE(importance,salience,0.5), retrieval_strength=COALESCE(retrieval_strength,0.0), processing_state=COALESCE(processing_state,'ready')", []);
  } catch {}
  for (const sql of [
    "CREATE INDEX IF NOT EXISTS idx_memory_items_belief ON memory_items(status, belief_status)",
    "CREATE INDEX IF NOT EXISTS idx_memory_items_scope_validity ON memory_items(scope_key, valid_from, valid_to)",
    "CREATE INDEX IF NOT EXISTS idx_memory_items_importance ON memory_items(importance, retrieval_strength)",
  ]) { try { d.exec(sql); } catch {} }
}

function scopeKeyFor(cwd, scope = "project") {
  if (scope === "global") return "global";
  const path = canonicalPath(cwd || process.cwd());
  return `${scope}:${path}`;
}

function sourceTypeFor(source) {
  const s = String(source || "manual").toLowerCase();
  if (s.includes("conversation") || s === "hook" || s === "auto") return "conversation";
  if (s.includes("tool")) return "tool";
  if (s.includes("doc") || s.includes("markdown")) return "document";
  if (s.includes("scan") || s.includes("code")) return "code";
  if (s.includes("import")) return "import";
  return s || "manual";
}

function claimTypeFor(kind, body = "") {
  const k = String(kind || "fact").toLowerCase();
  const text = String(body || "").toLowerCase();
  if (k === "preference" || /\b(i|we)\s+(prefer|like|want)\b/.test(text)) return "preference";
  if (k === "procedure" || /\b(always|never|must|run|step|deploy|install|before commit)\b/.test(text)) return "procedure";
  if (k === "decision" || /\b(decided|decision|chose|choose|will use|adopted)\b/.test(text)) return "decision";
  if (k === "issue" || /\b(bug|error|failure|crash|broken|regression)\b/.test(text)) return "observation";
  if (/\b(yesterday|today|tomorrow|last week|occurred|happened)\b/.test(text)) return "event";
  if (k === "inference") return "inference";
  return "fact";
}

function cognitiveTokens(text) {
  return new Set(String(text || "").toLowerCase().replace(/[^a-z0-9_]+/g, " ").split(/\s+/).filter((x) => x.length > 2));
}

function gateIntake(content, role = "") {
  const text = String(content || "").replace(/\s+/g, " ").trim();
  const low = text.toLowerCase();
  const words = text ? text.split(/\s+/).length : 0;
  if (!text) return { decision: "IGNORE", reason: "empty", confidence: 1, kind: "fact" };
  if (words < 4 || /^(ok|okay|thanks|thank you|yes|no|sure|done|ping|hello|hi|ciao)[.! ]*$/i.test(text)) {
    return { decision: "KEEP_TEMPORARILY", reason: "short_ack_or_greeting", confidence: 0.95, kind: "fact" };
  }
  if (/[?]$/.test(text) || /^(how|what|why|when|where|can|could|should|is|are|do|does|come|cosa|come|perché|quando|dove|posso|devo)\b/i.test(low)) {
    return { decision: "KEEP_TEMPORARILY", reason: "question_or_request", confidence: 0.9, kind: "fact" };
  }
  const durable = /\b(decided|decision|use|uses|using|must|always|never|procedure|fixed|fix|bug|error|crash|deploy|install|configured|architecture|important|remember|prefer|chose|adopted|risolto|errore|configurato|decisione|importante|ricorda|preferisco)\b/i.test(text);
  if (durable && words >= 6) {
    const kind = /\b(prefer|preferisco|like|piace)\b/i.test(text) ? "preference" : /\b(must|always|never|procedure|deploy|install)\b/i.test(text) ? "procedure" : /\b(decided|decision|chose|adopted|decisione)\b/i.test(text) ? "decision" : "fact";
    return { decision: "CREATE_CANDIDATE", reason: "durable_signal", confidence: 0.6, kind };
  }
  return { decision: "CREATE_EPISODE", reason: role === "agent" ? "agent_context" : "unclassified_context", confidence: 0.5, kind: "fact" };
}

function recordMemoryEpisode(d, input = {}) {
  const content = String(input.content || "").replace(/\s+/g, " ").trim();
  if (!content) return null;
  const observedAt = input.observedAt || nowIso();
  const gate = input.gate || gateIntake(content, input.role || "");
  const contentHash = hashText(`${input.sourceRef || ""}|${content}|${observedAt}`);
  const existing = input.sourceRef
    ? getStmt(d, "SELECT * FROM memory_episodes WHERE source_ref=? AND content_hash=? LIMIT 1", [input.sourceRef, contentHash])
    : null;
  if (existing) return existing;
  const id = input.id || `episode_${contentHash}_${String(Date.now()).slice(-8)}`;
  runStmt(
    d,
    `INSERT OR IGNORE INTO memory_episodes(
      id,source_type,source_ref,content,role,session_id,observed_at,occurred_at,
      scope_key,metadata_json,content_hash,processing_state,gate_decision,gate_reason,created_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      input.sourceType || sourceTypeFor(input.source || "conversation"),
      input.sourceRef || null,
      content,
      input.role || null,
      input.sessionId || null,
      observedAt,
      input.occurredAt || observedAt,
      input.scopeKey || scopeKeyFor(input.cwd || process.cwd(), input.scope || "project"),
      JSON.stringify(input.metadata || {}),
      contentHash,
      input.processingState || "pending",
      gate.decision,
      gate.reason,
      nowIso(),
    ]
  );
  return getStmt(d, "SELECT * FROM memory_episodes WHERE id=?", [id]) || { id, content, gate_decision: gate.decision };
}

function recordMemoryEvidence(d, input = {}) {
  if (!input.memoryId || !input.episodeId) return null;
  try {
    runStmt(
      d,
      `INSERT OR IGNORE INTO memory_evidence(
        memory_id,episode_id,relation,polarity,reliability,observed_at,metadata_json,created_at
      ) VALUES(?,?,?,?,?,?,?,?)`,
      [
        input.memoryId,
        input.episodeId,
        input.relation || "supports",
        input.polarity || ((input.relation || "supports") === "contradicts" ? "negative" : "positive"),
        clamp01(input.reliability, 0.5),
        input.observedAt || nowIso(),
        JSON.stringify(input.metadata || {}),
        nowIso(),
      ]
    );
    return getStmt(d, "SELECT * FROM memory_evidence WHERE memory_id=? AND episode_id=? AND relation=?", [input.memoryId, input.episodeId, input.relation || "supports"]);
  } catch { return null; }
}

function queueVerification(d, input = {}) {
  if (!input.memoryId && !input.episodeId) return null;
  runStmt(
    d,
    `INSERT INTO verification_queue(memory_id,episode_id,reason,priority,status,requested_at,result_json)
     VALUES(?,?,?,?,?,?,?)`,
    [input.memoryId || null, input.episodeId || null, input.reason || "manual_review", clamp01(input.priority, 0.5), "pending", nowIso(), JSON.stringify(input.result || {})]
  );
  return getStmt(d, "SELECT * FROM verification_queue WHERE rowid=last_insert_rowid()");
}

function addGateCandidate(d, cwd, episode) {
  if (!episode || episode.gate_decision !== "CREATE_CANDIDATE") return null;
  const gate = gateIntake(episode.content, episode.role || "");
  const kind = gate.kind || "fact";
  const id = `candidate_${episode.id}`;
  const saved = upsertMemoryItem(d, {
    id,
    kind,
    layer: kind === "preference" ? "user" : "working",
    title: projectTitle(episode.content),
    body: episode.content,
    summary: summarize(episode.content),
    confidence: Math.min(0.65, gate.confidence || 0.5),
    salience: 0.5,
    importance: 0.5,
    source: "conversation-candidate",
    sourceType: "conversation",
    scopeKey: episode.scope_key || scopeKeyFor(cwd),
    observedAt: episode.observed_at,
    claimType: claimTypeFor(kind, episode.content),
    status: "candidate",
    beliefStatus: "candidate",
    processingState: "candidate_pending",
    cwd,
    tags: ["intake-candidate"],
  });
  if (saved?.id) recordMemoryEvidence(d, { memoryId: saved.id, episodeId: episode.id, relation: "supports", reliability: 0.5, observedAt: episode.observed_at });
  return saved;
}

function registerCapturedEpisode(d, cwd, input = {}) {
  const episode = recordMemoryEpisode(d, { ...input, cwd });
  if (episode && episode.gate_decision === "CREATE_CANDIDATE") {
    try { addGateCandidate(d, cwd, episode); } catch {}
  }
  return episode;
}

function updateMemoryFtsRow(d, id) {
  const row = getStmt(
    d,
    `SELECT mi.rowid,mi.id,mi.title,mi.body,mi.summary,mi.kind,COALESCE(mc.tags_json,'[]') AS tags_json
     FROM memory_items mi LEFT JOIN memory_context mc ON mc.memory_id=mi.id WHERE mi.id=?`,
    [id]
  );
  if (!row) return;
  try { runStmt(d, "DELETE FROM memory_fts WHERE rowid=?", [row.rowid]); } catch {}
  try {
    runStmt(d, "INSERT INTO memory_fts(rowid,id,title,body,summary,kind,tags) VALUES(?,?,?,?,?,?,?)", [row.rowid, row.id, row.title, row.body, row.summary || "", row.kind, row.tags_json || "[]"]);
  } catch {}
}

function removeMemoryFtsRow(d, id) {
  const row = getStmt(d, "SELECT rowid FROM memory_items WHERE id=?", [id]);
  if (!row) return;
  try { runStmt(d, "DELETE FROM memory_fts WHERE rowid=?", [row.rowid]); } catch {}
}

function currentMemoryPredicate(alias = "mi") {
  return `${alias}.status='active' AND COALESCE(${alias}.belief_status,'accepted') NOT IN ('candidate','contested','corrected','obsolete','superseded','invalidated','archived')`;
}

function validityPredicate(alias = "mi", asOf = null) {
  if (!asOf) return currentMemoryPredicate(alias);
  return `${alias}.status <> 'archived' AND ((${alias}.valid_from IS NULL OR ${alias}.valid_from <= ?) AND (${alias}.valid_to IS NULL OR ${alias}.valid_to > ?))`;
}

function closeMemoryClaim(d, oldId, nextId, relation = "supersedes", validTo = nowIso()) {
  const row = getStmt(d, "SELECT id FROM memory_items WHERE id=?", [oldId]);
  if (!row) return false;
  // Keep the legacy `status='corrected'` contract for cm replace while using
  // the richer belief_status to distinguish supersession from contestation.
  const status = relation === "contradicts" ? "contested" : "corrected";
  const beliefStatus = relation === "contradicts" ? "contested" : "superseded";
  runStmt(
    d,
    `UPDATE memory_items SET status=?,belief_status=?,valid_to=?,invalidated_at=?,supersedes_id=COALESCE(supersedes_id,?),corrected_by=?,updated_at=? WHERE id=?`,
    [status, beliefStatus, validTo, validTo, nextId || null, nextId || null, validTo, oldId]
  );
  updateMemoryFtsRow(d, oldId);
  return true;
}

function applyExplicitSupersession(d, oldId, nextId, episodeId, relation = "supersedes") {
  if (!oldId || !nextId || oldId === nextId) return false;
  const changed = closeMemoryClaim(d, oldId, nextId, relation);
  if (changed && episodeId) recordMemoryEvidence(d, { memoryId: oldId, episodeId, relation, polarity: relation === "contradicts" ? "negative" : "positive", reliability: 0.8 });
  return changed;
}

function beginConsolidationRun(d, kind = "sleep") {
  const id = `run_${kind}_${hashText(`${kind}|${nowIso()}|${Math.random()}`)}`;
  const watermark = getStmt(d, "SELECT COALESCE(MAX(created_at),'') AS v FROM memory_episodes", [])?.v || "";
  runStmt(d, "INSERT INTO consolidation_runs(id,kind,watermark,status,started_at) VALUES(?,?,?,?,?)", [id, kind, watermark, "running", nowIso()]);
  return { id, watermark };
}

function finishConsolidationRun(d, run, result = {}, error = null) {
  if (!run?.id) return;
  runStmt(
    d,
    "UPDATE consolidation_runs SET status=?,finished_at=?,processed_count=?,created_count=?,updated_count=?,error_json=? WHERE id=?",
    [error ? "failed" : "completed", nowIso(), result.processed || 0, result.created || 0, result.updated || 0, JSON.stringify(error ? { message: error.message || String(error) } : {}), run.id]
  );
}

function taskWorkingId(cwd, task) {
  return `task_${hashText(`${scopeKeyFor(cwd)}|${String(task || "").trim().toLowerCase()}`)}`;
}

function upsertWorkingMemory(d, cwd, task, row, relevance, reason = {}) {
  if (!row?.id) return;
  const taskId = taskWorkingId(cwd, task);
  const expires = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  runStmt(
    d,
    `INSERT OR REPLACE INTO memory_working_set(task_id,session_id,memory_id,episode_id,relevance,reason_json,expires_at,created_at)
     VALUES(?,?,?,?,?,?,?,?)`,
    [taskId, captureSessionId(cwd), row.id, row.episode_id || null, clamp01(relevance, 0), JSON.stringify(reason), expires, nowIso()]
  );
}

function workingMemoryRows(d, cwd, task, limit = 24) {
  try {
    runStmt(d, "DELETE FROM memory_working_set WHERE expires_at < ?", [nowIso()]);
    return listMemoryRows(
      d,
      `JOIN memory_working_set mws ON mws.memory_id=mi.id
       WHERE ${currentMemoryPredicate("mi")} AND mws.task_id=? AND mws.expires_at>=?`,
      [taskWorkingId(cwd, task), nowIso()],
      `ORDER BY mws.relevance DESC LIMIT ${Math.max(1, Math.min(100, limit))}`
    );
  } catch { return []; }
}

function memoryEvidenceFor(d, memoryId, limit = 20) {
  try {
    return allStmt(
      d,
      `SELECT me.*, ep.content, ep.source_type, ep.source_ref, ep.observed_at AS episode_observed_at
       FROM memory_evidence me LEFT JOIN memory_episodes ep ON ep.id=me.episode_id
       WHERE me.memory_id=? ORDER BY me.created_at DESC LIMIT ?`,
      [memoryId, limit]
    );
  } catch { return []; }
}

function markMemoryVerified(d, id, verifier = "manual", result = {}) {
  const t = nowIso();
  const row = getStmt(d, "SELECT id FROM memory_items WHERE id=?", [id]);
  if (!row) return false;
  runStmt(d, "UPDATE memory_items SET status='active',belief_status='accepted',last_verified_at=?,invalidated_at=NULL,updated_at=? WHERE id=?", [t, t, id]);
  runStmt(d, "UPDATE verification_queue SET status='verified',verified_at=?,verifier=?,result_json=? WHERE memory_id=? AND status='pending'", [t, verifier, JSON.stringify(result), id]);
  updateMemoryFtsRow(d, id);
  return true;
}

function contestMemory(d, id, reason = "manual_contest") {
  const t = nowIso();
  const row = getStmt(d, "SELECT id FROM memory_items WHERE id=?", [id]);
  if (!row) return false;
  runStmt(d, "UPDATE memory_items SET status='contested',belief_status='contested',updated_at=? WHERE id=?", [t, id]);
  queueVerification(d, { memoryId: id, reason, priority: 0.9 });
  updateMemoryFtsRow(d, id);
  return true;
}
