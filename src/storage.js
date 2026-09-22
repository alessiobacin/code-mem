function listMemoryRows(d, whereSql, params, orderSql = "") {
  return allStmt(
    d,
    `
      SELECT
        mi.*,
        mc.cwd,
        mc.git_branch,
        mc.task_kind,
        mc.files_json,
        mc.tags_json
      FROM memory_items mi
      LEFT JOIN memory_context mc ON mc.memory_id = mi.id
      ${whereSql}
      ${orderSql}
    `,
    params
  );
}

function tagsForRow(row) {
  return safeJsonParse(row.tags_json || "[]", []);
}

function filesForRow(row) {
  return safeJsonParse(row.files_json || "[]", []);
}

function projectTitle(text) {
  const cleaned = String(text || "").trim();
  if (!cleaned) return "Untitled memory";
  return cleaned.length > 72 ? `${cleaned.slice(0, 69)}...` : cleaned;
}

function normalizeLegacyEntry(entry) {
  const lines = entry
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter(
      (line) =>
        !line.startsWith("#") &&
        line !== "---" &&
        !line.startsWith("Separate entries") &&
        !line.startsWith("Char limit:")
    );
  return lines.join(" ").trim();
}

function upsertMemoryItem(d, item) {
  const compactBody = compactMemoryText(item.body);
  if (!compactBody) return { id: `ignored_${hashText(String(item.body || ""))}`, created: false, ignored: true, reason: "transport_or_model_noise" };
  item = { ...item, body: compactBody, title: item.title ? compactMemoryText(item.title) : item.title, summary: item.summary ? compactMemoryText(item.summary) : item.summary };
  const createdAt = item.createdAt || nowIso();
  const updatedAt = nowIso();
  const id = item.id || `mem_${slug(item.kind)}_${hashText(`${item.kind}|${item.body}|${item.title}`)}`;
  const hash = item.hash || hashText(`${item.kind}|${item.layer}|${item.body}`);
  // A2a: the multi-statement write sequence (existing-row update OR the
  // memory_items INSERT + memory_context INSERT pair) runs atomically, so a
  // crash or failed statement can never leave a memory_items row without its
  // memory_context counterpart (or vice versa).
  return withTransaction(d, () => {
    const existing = getStmt(d, "SELECT id,status FROM memory_items WHERE hash = ?", [hash]);
    if (existing) {
      if (existing.status !== "active") {
        runStmt(
          d,
          "UPDATE memory_items SET status=?, belief_status=?, processing_state=?, updated_at=?, summary=COALESCE(summary, ?), confidence=?, salience=?, importance=COALESCE(importance,?) WHERE id=?",
          [item.status || "active", item.beliefStatus || (item.status === "candidate" ? "candidate" : "accepted"), item.processingState || "ready", updatedAt, item.summary || null, item.confidence, item.salience, item.importance ?? item.salience ?? DEFAULT_SALIENCE, existing.id]
        );
      }
      try { updateMemoryFtsRow(d, existing.id); } catch {}
      return { id: existing.id, created: false };
    }
    runStmt(
      d,
      `INSERT INTO memory_items(
        id, kind, layer, title, body, summary, confidence, salience, source, status,
        created_at, updated_at, last_accessed_at, access_count, valid_from, valid_to, supersedes_id, hash,
        source_type, observed_at, occurred_at, last_verified_at, invalidated_at, belief_status,
        claim_type, scope_key, importance, retrieval_strength, processing_state
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id,
        item.kind,
        item.layer,
        item.title,
        item.body,
        item.summary || null,
        item.confidence,
        item.salience,
        item.source || "manual",
        item.status || "active",
        createdAt,
        updatedAt,
        item.lastAccessedAt || null,
        item.accessCount || 0,
        item.validFrom || null,
        item.validTo || null,
        item.supersedesId || null,
        hash,
        item.sourceType || sourceTypeFor(item.source || "manual"),
        item.observedAt || createdAt,
        item.occurredAt || item.observedAt || createdAt,
        item.lastVerifiedAt || null,
        item.invalidatedAt || null,
        item.beliefStatus || (item.status === "candidate" ? "candidate" : item.status === "archived" ? "archived" : "accepted"),
        item.claimType || claimTypeFor(item.kind, item.body),
        item.scopeKey || scopeKeyFor(item.cwd || process.cwd(), item.scope || "project"),
        item.importance ?? item.salience ?? DEFAULT_SALIENCE,
        item.retrievalStrength ?? 0,
        item.processingState || "ready",
      ]
    );
    try { updateMemoryFtsRow(d, id); } catch {}
    runStmt(
      d,
      "INSERT INTO memory_context(memory_id,cwd,git_branch,task_kind,files_json,tags_json) VALUES(?,?,?,?,?,?)",
      [
        id,
        item.cwd || "",
        item.gitBranch || "",
        item.taskKind || "",
        JSON.stringify(item.files || []),
        JSON.stringify(item.tags || []),
      ]
    );
    // Tags live in memory_context, so refresh the standalone derived FTS row
    // after the context row exists.
    try { updateMemoryFtsRow(d, id); } catch {}
    return { id, created: true };
  });
}

function findNearDuplicate(d, body, kind) {
  // Fuzzy match: check body similarity via trigram cosine similarity
  if (!body) return null;
  const newVec = trigramEmbed(body);
  const rows = listMemoryRows(d, "WHERE mi.status='active'", [], "ORDER BY mi.updated_at DESC LIMIT 50");
  for (const row of rows) {
    if (kind && row.kind !== kind) continue;
    let existingVec = null;
    const existingRow = getStmt(d, "SELECT vector FROM memory_vectors WHERE memory_id=? AND model='trigram'", [row.id]);
    if (existingRow && existingRow.vector) {
      existingVec = bufferToVector(existingRow.vector);
    } else {
      // Compute on the fly if no stored vector
      const text = `${row.title} ${row.body} ${row.summary || ""}`.toLowerCase();
      existingVec = trigramEmbed(text);
    }
    const sim = cosineSimilarity(newVec, existingVec);
    if (sim > 0.65) return row;
  }
  return null;
}

function saveMemory(d, cwd, input) {
  const rawBody = String(input.body || "").trim();
  if (isMemoryNoise(rawBody)) return { id: `ignored_${hashText(rawBody)}`, created: false, ignored: true, reason: "transport_or_model_noise" };
  const body = compactMemoryText(rawBody);
  if (!body) {
    console.log("text required");
    process.exit(1);
  }
  const inputKind = input.kind || "fact";
  const isGlobal = input.scope === "global" || input.scopeKey === "global";
  const memoryCwd = isGlobal ? "" : cwd;
  const episode = recordMemoryEpisode(d, {
    cwd: memoryCwd,
    source: input.source || "manual",
    sourceType: input.sourceType || sourceTypeFor(input.source || "manual"),
    sourceRef: input.sourceRef || `save:${hashText(`${inputKind}|${body}|${nowIso()}`)}`,
    content: body,
    role: input.role || "user",
    sessionId: input.sessionId || captureSessionId(cwd),
    observedAt: input.observedAt || nowIso(),
    occurredAt: input.occurredAt,
    scope: isGlobal ? "global" : "project",
    metadata: { explicit: true, taskKind: input.taskKind || "" },
    gate: { decision: "CREATE_MEMORY", reason: "explicit_save", confidence: 1, kind: inputKind },
    processingState: "processed",
  });
  // Fuzzy dedup unless --force
  if (!input.force) {
    const dup = findNearDuplicate(d, body, input.kind);
    if (dup) {
      if (episode?.id) recordMemoryEvidence(d, { memoryId: dup.id, episodeId: episode.id, relation: "duplicates", reliability: 0.8, observedAt: episode.observed_at });
      return { id: dup.id, created: false, duplicate: true, existing: dup };
    }
  }
  const title = String(input.title || projectTitle(body)).trim();
  // A2a: dedupe-check + item/context upsert happen in one transaction —
  // a concurrent writer or a crash between the two can no longer produce a
  // duplicate that slipped past the fuzzy check, or a half-written memory.
  const row = withTransaction(d, () => upsertMemoryItem(d, {
    kind: inputKind,
    layer: input.layer || "semantic",
    title,
    body,
    summary: input.summary || summarize(body),
    confidence: clamp01(input.confidence, DEFAULT_CONFIDENCE),
    salience: clamp01(input.salience, DEFAULT_SALIENCE),
    sourceType: input.sourceType || sourceTypeFor(input.source || "manual"),
    scopeKey: input.scopeKey || scopeKeyFor(memoryCwd, isGlobal ? "global" : "project"),
    observedAt: input.observedAt || episode?.observed_at || nowIso(),
    occurredAt: input.occurredAt || input.observedAt || episode?.observed_at || nowIso(),
    claimType: input.claimType || claimTypeFor(inputKind, body),
    importance: clamp01(input.importance, input.salience ?? DEFAULT_SALIENCE),
    beliefStatus: input.beliefStatus || (input.status === "candidate" ? "candidate" : "accepted"),
    processingState: input.processingState || "ready",
    status: input.status || "active",
    supersedesId: input.supersedesId || null,
    validFrom: input.validFrom || null,
    validTo: input.validTo || null,
    cwd: memoryCwd,
    gitBranch: isGlobal ? "" : getGitBranch(cwd),
    agent: input.agent || inferAgent(),
    taskKind: input.taskKind || "",
    files: input.files || [],
    tags: input.tags || [],
    sessionId: input.sessionId || "",
  }));
  if (row?.id && episode?.id) recordMemoryEvidence(d, { memoryId: row.id, episodeId: episode.id, relation: input.supersedesId ? "supersedes" : "supports", reliability: input.source === "scan" ? 0.7 : 0.9, observedAt: episode.observed_at });
  refreshProjections(d, cwd);
  return row;
}

function correctionPatternStatus(body) {
  const m = /^(contested|corrected|obsolete)\s*:\s*(.+)$/i.exec(String(body || "").trim());
  return m ? { status: m[1].toLowerCase(), ref: String(m[2] || "").trim() } : null;
}

function applyCorrectionStatus(d, body) {
  // A save that starts with "contested:" / "corrected:" / "obsolete:" names a
  // prior memory (by title or body, appearing in the remainder). That referenced
  // memory transitions to the named status so it stops serving as an active
  // recall candidate. Returns how many memories were marked.
  const c = correctionPatternStatus(body);
  if (!c || !c.ref) return 0;
  const rows = listMemoryRows(d, "WHERE mi.status='active'", [], "ORDER BY mi.updated_at DESC");
  let marked = 0;
  for (const row of rows) {
    const bodyLow = String(row.body || "").trim().toLowerCase();
    const titleLow = String(row.title || "").trim().toLowerCase();
    const hits = (bodyLow && c.ref.toLowerCase().includes(bodyLow)) || (titleLow && c.ref.toLowerCase().includes(titleLow));
    if (!hits) continue;
    runStmt(d, "UPDATE memory_items SET status=?, belief_status=?, invalidated_at=?, corrected_by=?, updated_at=? WHERE id=?", [c.status, c.status, nowIso(), inferAgent(), nowIso(), row.id]);
    updateFtsRow(d, row);
    marked += 1;
  }
  return marked;
}

function saveMemorySemanticDedup(d, cwd, input) {
  // Full semantic dedup via embedding + cosine similarity
  // Used by save commands; triggers embedding if not already stored
  const rawBody = String(input.body || "").trim();
  if (isMemoryNoise(rawBody)) return { id: `ignored_${hashText(rawBody)}`, created: false, ignored: true, reason: "transport_or_model_noise" };
  const body = compactMemoryText(rawBody);
  if (!body) throw new Error("text required");
  // Correction lifecycle: a "contested:/corrected:/obsolete:" save names and
  // transitions a prior memory. The correction persists as a status change on
  // the referenced memory rather than a near-duplicate new entry.
  if (correctionPatternStatus(body)) {
    applyCorrectionStatus(d, body);
    return { id: `correction:${hashText(body)}`, created: false, correction: true };
  }
  const existing = findNearDuplicate(d, body, input.kind);
  if (existing && !input.force) return { id: existing.id, created: false, duplicate: true, existing };
  // A2a (transactional write) + deterministic trigram vector: the memory row
  // and its trigram vector commit together or not at all, and the trigram is
  // ALWAYS persisted synchronously so the memory is immediately recallable
  // regardless of Ollama availability. When Ollama is reachable we additionally
  // trigger an asynchronous model upgrade, but never await it (the db may be
  // closed by the caller first), so the trigram vector is the deterministic
  // guarantee.
  const result = withTransaction(d, () => {
    const saved = saveMemory(d, cwd, { ...input, body });
    const text = `${saved.title || ""} ${body} ${input.summary || ""}`.trim();
    saveTrigramVector(d, saved.id, text);
    return saved;
  });
  if (checkOllama()) {
    // Ollama embedding is an external async call — it cannot join the
    // transaction; failures leave the trigram path to fill in later.
    embedText(d, result.id, null, `${result.title || ""} ${body} ${input.summary || ""}`.trim()).catch(() => {});
  }
  return result;
}

function saveMemoryToStore(d, cwd, input) {
  const body = compactMemoryText(input.body);
  if (!body) {
    console.log("text required");
    process.exit(1);
  }
  const isGlobal = input.scope === "global" || input.scopeKey === "global";
  const memoryCwd = isGlobal ? "" : cwd;
  const title = String(input.title || projectTitle(body)).trim();
  return upsertMemoryItem(d, {
    kind: input.kind || "fact",
    layer: input.layer || "semantic",
    title,
    body,
    summary: input.summary || summarize(body),
    confidence: clamp01(input.confidence, DEFAULT_CONFIDENCE),
    salience: clamp01(input.salience, DEFAULT_SALIENCE),
    importance: clamp01(input.importance, input.salience ?? DEFAULT_SALIENCE),
    source: input.source || "manual",
    sourceType: input.sourceType || sourceTypeFor(input.source || "manual"),
    scopeKey: input.scopeKey || scopeKeyFor(memoryCwd, isGlobal ? "global" : "project"),
    observedAt: input.observedAt,
    occurredAt: input.occurredAt,
    lastVerifiedAt: input.lastVerifiedAt,
    invalidatedAt: input.invalidatedAt,
    beliefStatus: input.beliefStatus,
    claimType: input.claimType || claimTypeFor(input.kind || "fact", input.body || ""),
    processingState: input.processingState,
    cwd: memoryCwd,
    gitBranch: isGlobal ? "" : (input.gitBranch || getGitBranch(cwd)),
    agent: input.agent || inferAgent(),
    taskKind: input.taskKind || "",
    files: input.files || [],
    tags: input.tags || [],
    sessionId: input.sessionId || "",
    status: input.status || "active",
    createdAt: input.createdAt,
    lastAccessedAt: input.lastAccessedAt,
    accessCount: input.accessCount,
    validFrom: input.validFrom,
    validTo: input.validTo,
    supersedesId: input.supersedesId,
    hash: input.hash,
  });
}

function inferAgent() {
  if (process.env.CODEX) return "codex";
  if (process.env.CLAUDECODE || process.env.CLAUDE) return "claude";
  if (process.env.CURSOR_TRACE_ID) return "cursor";
  return "cli";
}

function summarize(text) {
  const cleaned = String(text || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  return cleaned.length > 140 ? `${cleaned.slice(0, 137)}...` : cleaned;
}

function renderMemoryEntry(row) {
  const lines = [
    `- id: ${row.id}`,
    `  kind: ${row.kind}`,
    `  layer: ${row.layer}`,
    `  title: ${row.title}`,
    `  summary: ${row.summary || summarize(row.body)}`,
    `  body: ${row.body}`,
  ];
  const tags = tagsForRow(row);
  if (tags.length) lines.push(`  tags: ${tags.join(", ")}`);
  if (row.git_branch) lines.push(`  branch: ${row.git_branch}`);
  if (row.cwd) lines.push(`  cwd: ${row.cwd}`);
  return lines.join("\n");
}

function renderMemorySnapshot(title, rows) {
  const lines = [`# ${title}`, "", `Exported: ${nowIso()}`, ""];
  if (!rows.length) {
    lines.push("_No memories._");
    return lines.join("\n") + "\n";
  }
  for (const row of rows) {
    lines.push(renderMemoryEntry(row));
    lines.push("");
  }
  return lines.join("\n");
}

function updateFtsRow(d, row) {
  try { updateMemoryFtsRow(d, row?.id); } catch {}
}

function refreshProjections(d, cwd, compact) {
  const filterAge = compact ? ` AND julianday('now') - julianday(mi.updated_at) < 30` : "";
  const filterConf = compact ? ' AND mi.confidence >= 0.7' : "";
  const sections = [];
  for (const section of SECTION_CONFIG) {
    const placeholders = section.kinds.map(() => "?").join(",");
    const rows = listMemoryRows(
      d,
      `WHERE mi.status='active' AND mi.kind IN (${placeholders}) AND mi.layer <> 'user'${filterAge}${filterConf}`,
      section.kinds,
      "ORDER BY mi.salience DESC, mi.updated_at DESC LIMIT " + (compact ? Math.min(section.limit, 4) : section.limit)
    );
    if (!rows.length) continue;
    sections.push(`## ${section.title}`);
    for (const row of rows) {
      const contextBits = [];
      if (row.git_branch) contextBits.push(`branch: ${row.git_branch}`);
      const files = filesForRow(row);
      if (files.length) contextBits.push(`files: ${files.slice(0, 2).join(", ")}`);
      const tail = contextBits.length ? ` (${contextBits.join(" · ")})` : "";
      sections.push(`- [${row.id}] ${row.title}: ${row.summary || summarize(row.body)}${tail}`);
    }
    sections.push("");
  }
  const memoryDoc =
    "# Project Memory\n\n" +
    "Projection generated from `state.db`. Edit with `cm save`, `cm archive`, `cm consolidate`, or `cm project`." +
    (compact ? " (compact view, confidence>=0.7, recency<30d)\n\n" : "\n\n") +
    (sections.length ? sections.join("\n") : "_No project memories yet._\n");
  wr(mp(cwd, MF), trimDoc(memoryDoc, ML));

  const prefs = listMemoryRows(
    d,
    "WHERE mi.status='active' AND mi.kind='preference'",
    [],
    "ORDER BY mi.salience DESC, mi.updated_at DESC LIMIT " + (compact ? "6" : "12")
  );
  const userDoc =
    "# User Profile\n\n" +
    "Projection generated from `state.db`.\n\n" +
    (prefs.length
      ? prefs
          .map((row) => `- [${row.id}] ${row.title}: ${row.summary || summarize(row.body)}`)
          .join("\n")
      : "_No user preferences yet._");
  wr(mp(cwd, UF), trimDoc(userDoc, UL));
}

function trimDoc(doc, limit) {
  if (doc.length <= limit) return doc;
  return `${doc.slice(0, limit - 18)}\n\n... (truncated)\n`;
}

function importLegacyFile(d, cwd, file, kind, layer) {
  const path = mp(cwd, file);
  if (!existsSync(path)) return 0;
  const entries = pe(rd(path))
    .map(normalizeLegacyEntry)
    .filter(Boolean);
  let count = 0;
  for (const entry of entries) {
    const result = upsertMemoryItem(d, {
      kind,
      layer,
      title: projectTitle(entry),
      body: entry,
      summary: summarize(entry),
      confidence: DEFAULT_CONFIDENCE,
      salience: DEFAULT_SALIENCE,
      source: "legacy-import",
      cwd,
      gitBranch: getGitBranch(cwd),
      agent: "legacy",
      taskKind: "",
      files: [],
      tags: ["legacy"],
      sessionId: "",
      hash: hashText(`${file}|${entry}`),
    });
    if (result.created) count += 1;
  }
  return count;
}

function importLegacyMarkdown(d, cwd) {
  const hasAny = getStmt(d, "SELECT id FROM memory_items LIMIT 1");
  if (hasAny) return 0;
  let count = 0;
  count += importLegacyFile(d, cwd, MF, "fact", "semantic");
  count += importLegacyFile(d, cwd, UF, "preference", "user");
  return count;
}

function backupProjectMemories(d, cwd) {
  const stamp = timestampSlug();
  const rows = listMemoryRows(d, "WHERE mi.status='active'", [], "ORDER BY mi.updated_at DESC");
  const out = projectMemorySnapshotPath(cwd, stamp);
  wr(out, renderMemorySnapshot("Project Memory Backup", rows));
  return out;
}

function serializeMemoryRow(row) {
  return {
    id: row.id,
    kind: row.kind,
    layer: row.layer,
    title: row.title,
    body: row.body,
    summary: row.summary || "",
    confidence: row.confidence,
    salience: row.salience,
    source: row.source,
    sourceType: row.source_type || sourceTypeFor(row.source),
    status: row.status,
    beliefStatus: row.belief_status || row.status,
    claimType: row.claim_type || claimTypeFor(row.kind, row.body),
    scope: row.scope_key === "global" ? "global" : "project",
    scopeKey: row.scope_key || "",
    importance: row.importance ?? row.salience,
    retrievalStrength: row.retrieval_strength ?? 0,
    observedAt: row.observed_at || row.created_at,
    occurredAt: row.occurred_at || row.observed_at || row.created_at,
    lastVerifiedAt: row.last_verified_at || null,
    invalidatedAt: row.invalidated_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastAccessedAt: row.last_accessed_at,
    accessCount: row.access_count,
    validFrom: row.valid_from,
    validTo: row.valid_to,
    supersedesId: row.supersedes_id,
    hash: row.hash,
    cwd: row.cwd || "",
    gitBranch: row.git_branch || "",
    taskKind: row.task_kind || "",
    files: filesForRow(row),
    tags: tagsForRow(row),
  };
}

function backupGlobalMemories(d, cwd) {
  const stamp = timestampSlug();
  const rows = listMemoryRows(d, "WHERE mi.status='active'", [], "ORDER BY mi.updated_at DESC");
  const out = globalBackupFilePath(cwd, stamp);
  wr(
    out,
    JSON.stringify(
      {
        version: VERSION,
        scope: "global",
        exportedAt: nowIso(),
        items: rows.map(serializeMemoryRow),
      },
      null,
      2
    ) + "\n"
  );
  return out;
}

function exportMemoryBundle(d, cwd, outName = "export.json") {
  const rows = listMemoryRows(d, "", [], "ORDER BY mi.updated_at DESC");
  const out = join(cwd, outName);
  wr(
    out,
    JSON.stringify(
      {
        version: VERSION,
        scope: "project",
        exportedAt: nowIso(),
        items: rows.map(serializeMemoryRow),
      },
      null,
      2
    ) + "\n"
  );
  return out;
}

function mergeMemoryItem(d, cwd, item) {
  if (!item || !item.id) return { created: false, merged: false, skipped: true };
  const existing = getStmt(d, "SELECT id, updated_at FROM memory_items WHERE id = ?", [item.id]);
  if (!existing) {
    const res = saveMemoryToStore(d, cwd, item);
    if (res && res.id) {
      const text = `${item.title || ""} ${item.body || ""} ${item.summary || ""}`.trim();
      try { saveTrigramVector(d, res.id, text); } catch {}
      return { created: Boolean(res.created), id: res.id };
    }
    return { skipped: true };
  }
  // Deterministic merge: last-write-wins by ISO timestamp, keeping the newer body.
  const incoming = String(item.updatedAt || "");
  const current = String(existing.updated_at || "");
  if (incoming > current) {
    const isGlobal = item.scope === "global" || item.scopeKey === "global";
    const memoryCwd = isGlobal ? "" : cwd;
    runStmt(
      d,
      "UPDATE memory_items SET kind=?,layer=?,title=?,body=?,summary=?,confidence=?,salience=?,source=?,source_type=?,status=?,belief_status=?,claim_type=?,scope_key=?,importance=?,retrieval_strength=?,observed_at=?,occurred_at=?,valid_from=?,valid_to=?,supersedes_id=?,updated_at=? WHERE id=?",
      [
        item.kind, item.layer, item.title, item.body, item.summary || null,
        item.confidence, item.salience, item.source || "manual", item.sourceType || sourceTypeFor(item.source || "manual"), item.status || "active",
        item.beliefStatus || item.status || "accepted", item.claimType || claimTypeFor(item.kind, item.body), item.scopeKey || scopeKeyFor(memoryCwd, isGlobal ? "global" : "project"), item.importance ?? item.salience ?? DEFAULT_SALIENCE, item.retrievalStrength ?? 0,
        item.observedAt || item.createdAt || incoming || nowIso(), item.occurredAt || item.observedAt || item.createdAt || incoming || nowIso(),
        item.validFrom || null, item.validTo || null, item.supersedesId || null,
        incoming || nowIso(), item.id,
      ]
    );
    runStmt(
      d,
      "INSERT OR REPLACE INTO memory_context(memory_id,cwd,git_branch,task_kind,files_json,tags_json) VALUES(?,?,?,?,?,?)",
      [item.id, memoryCwd, isGlobal ? "" : (item.gitBranch || ""), item.taskKind || "", JSON.stringify(item.files || []), JSON.stringify(item.tags || [])]
    );
    const updated = loadMemoryRow(d, item.id);
    updateFtsRow(d, updated);
    try { saveTrigramVector(d, item.id, `${item.title || ""} ${item.body || ""} ${item.summary || ""}`.trim()); } catch {}
    return { merged: true, id: item.id };
  }
  // Re-import of the same bundle is a no-op (idempotent diff).
  return { skipped: true, id: item.id };
}

function importMemoryBundle(d, cwd, file) {
  const payload = safeJsonParse(rd(file), null);
  if (!payload || !Array.isArray(payload.items)) {
    console.log("Invalid bundle file (expected { items: [...] }).");
    process.exit(1);
  }
  let created = 0, merged = 0, skipped = 0;
  for (const item of payload.items) {
    const r = mergeMemoryItem(d, cwd, item);
    if (r.created) created += 1;
    else if (r.merged) merged += 1;
    else skipped += 1;
  }
  refreshProjections(d, cwd);
  return { created, merged, skipped, total: payload.items.length };
}

function cmdStats(d, cwd) {
  const mem = getStmt(d, "SELECT COUNT(*) AS c FROM memory_items WHERE status='active'") || { c: 0 };
  const memories = Number(mem.c) || 0;
  const acc = getStmt(d, "SELECT COALESCE(SUM(access_count),0) AS s FROM memory_items WHERE status='active'") || { s: 0 };
  const recalls = Number(acc.s) || 0;
  const MIN_PER_RECALL = 3;
  const timeSavedMin = recalls * MIN_PER_RECALL;
  // Deterministic value metric from real data: memories retained + conserved
  // actions (touch/recall access_count) + estimated time saved.
  const value = Math.round(memories + recalls * 2 + timeSavedMin);
  console.log(`cm stats`);
  console.log(`memories: ${memories}`);
  const episodes = Number(getStmt(d, "SELECT COUNT(*) AS c FROM memory_episodes")?.c || 0);
  const candidates = Number(getStmt(d, "SELECT COUNT(*) AS c FROM memory_items WHERE status='candidate'")?.c || 0);
  const pendingVerification = Number(getStmt(d, "SELECT COUNT(*) AS c FROM verification_queue WHERE status='pending'")?.c || 0);
  console.log(`episodes: ${episodes}`);
  console.log(`candidates: ${candidates}`);
  console.log(`verification queue: ${pendingVerification}`);
  console.log(`recalls (actions conserved): ${recalls}`);
  console.log(`time saved estimate: ${timeSavedMin} min`);
  console.log(`value: ${value}`);
  return { memories, recalls, timeSavedMin, value };
}

function resolveRestorePath(cwd, maybePath) {
  if (maybePath) return resolve(cwd, maybePath);
  const entries = readdirSync(cwd)
    .filter((name) => /^cm-global-backup-.*\.json$/.test(name))
    .sort()
    .reverse();
  if (!entries.length) {
    console.log("No global backup file found in current directory.");
    process.exit(1);
  }
  return join(cwd, entries[0]);
}

function restoreGlobalMemories(d, cwd, filePath) {
  const resolved = resolveRestorePath(cwd, filePath);
  const payload = safeJsonParse(rd(resolved), null);
  if (!payload || payload.scope !== "global" || !Array.isArray(payload.items)) {
    console.log("Invalid global backup file.");
    process.exit(1);
  }
  let imported = 0;
  for (const item of payload.items) {
    const result = saveMemoryToStore(d, item.scope === "global" || item.scopeKey === "global" ? "" : (item.cwd || cwd), { ...item, scope: "global", scopeKey: "global" });
    if (result.created) imported += 1;
  }
  return { resolved, imported, total: payload.items.length };
}

function saveGlobalSnapshot(d, id) {
  const stamp = timestampSlug();
  const stored = loadMemoryRow(d, id);
  const out = globalMemorySnapshotPath(stamp);
  wr(out, renderMemorySnapshot("Global Memory", stored ? [stored] : []));
  return out;
}
