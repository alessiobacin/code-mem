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
          "UPDATE memory_items SET status='active', updated_at=?, summary=COALESCE(summary, ?), confidence=?, salience=? WHERE id=?",
          [updatedAt, item.summary || null, item.confidence, item.salience, existing.id]
        );
      }
      return { id: existing.id, created: false };
    }
    runStmt(
      d,
      `INSERT INTO memory_items(
        id, kind, layer, title, body, summary, confidence, salience, source, status,
        created_at, updated_at, last_accessed_at, access_count, valid_from, valid_to, supersedes_id, hash
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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
      ]
    );
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
    // Content-sync FTS5 automatically indexes via source table
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
  const body = String(input.body || "").trim();
  if (!body) {
    console.log("text required");
    process.exit(1);
  }
  // Fuzzy dedup unless --force
  if (!input.force) {
    const dup = findNearDuplicate(d, body, input.kind);
    if (dup) {
      return { id: dup.id, created: false, duplicate: true, existing: dup };
    }
  }
  const title = String(input.title || projectTitle(body)).trim();
  // A2a: dedupe-check + item/context upsert happen in one transaction —
  // a concurrent writer or a crash between the two can no longer produce a
  // duplicate that slipped past the fuzzy check, or a half-written memory.
  const row = withTransaction(d, () => upsertMemoryItem(d, {
    kind: input.kind || "fact",
    layer: input.layer || "semantic",
    title,
    body,
    summary: input.summary || summarize(body),
    confidence: clamp01(input.confidence, DEFAULT_CONFIDENCE),
    salience: clamp01(input.salience, DEFAULT_SALIENCE),
    source: input.source || "manual",
    cwd,
    gitBranch: getGitBranch(cwd),
    agent: input.agent || inferAgent(),
    taskKind: input.taskKind || "",
    files: input.files || [],
    tags: input.tags || [],
    sessionId: input.sessionId || "",
  }));
  refreshProjections(d, cwd);
  return row;
}

function saveMemorySemanticDedup(d, cwd, input) {
  // Full semantic dedup via embedding + cosine similarity
  // Used by save commands; triggers embedding if not already stored
  const body = String(input.body || "").trim();
  if (!body) throw new Error("text required");
  const existing = findNearDuplicate(d, body, input.kind);
  if (existing && !input.force) return { id: existing.id, created: false, duplicate: true, existing };
  // A2a: memory row + its trigram vector (if we are the one writing it)
  // commit together or not at all.
  const result = withTransaction(d, () => {
    const saved = saveMemory(d, cwd, input);
    // Trigger vectorization for future semantic matching
    const text = `${saved.title || ""} ${body} ${input.summary || ""}`.trim();
    if (!checkOllama()) saveTrigramVector(d, saved.id, text);
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
  const body = String(input.body || "").trim();
  if (!body) {
    console.log("text required");
    process.exit(1);
  }
  const title = String(input.title || projectTitle(body)).trim();
  return upsertMemoryItem(d, {
    kind: input.kind || "fact",
    layer: input.layer || "semantic",
    title,
    body,
    summary: input.summary || summarize(body),
    confidence: clamp01(input.confidence, DEFAULT_CONFIDENCE),
    salience: clamp01(input.salience, DEFAULT_SALIENCE),
    source: input.source || "manual",
    cwd,
    gitBranch: input.gitBranch || getGitBranch(cwd),
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
  // Content-sync FTS: delete old index entry, rebuild will pick up new content
  try { runStmt(d, "INSERT INTO memory_fts(memory_fts,rowid) VALUES('delete',(SELECT rowid FROM memory_items WHERE id=?))", [row.id]); } catch {}
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
    status: row.status,
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
    const result = saveMemoryToStore(d, item.cwd || cwd, item);
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

