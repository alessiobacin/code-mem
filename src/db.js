function od(p) {
  if (!DB) {
    console.log("Requires Node 22+");
    process.exit(1);
  }
  mkdirSync(dirname(p), { recursive: true });
  const d = new DB(p);
  // Hooks can launch a deep graph refresh while a user command consolidates
  // the same project. Wait for the short writer transaction instead of
  // failing with SQLITE_BUSY; the explicit graph-refresh lock coordinates the
  // normal path, while busy_timeout covers unavoidable process scheduling
  // races.
  d.exec("PRAGMA page_size=512; PRAGMA journal_mode=DELETE; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=30000");
  d.exec(`
    CREATE TABLE IF NOT EXISTS messages(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp TEXT NOT NULL
    );
  `);
  d.exec(`
    CREATE TABLE IF NOT EXISTS memory_items(
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      layer TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      summary TEXT,
      confidence REAL DEFAULT 0.7,
      salience REAL DEFAULT 0.5,
      source TEXT DEFAULT 'manual',
      status TEXT DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_accessed_at TEXT,
      access_count INTEGER DEFAULT 0,
      valid_from TEXT,
      valid_to TEXT,
      supersedes_id TEXT,
      hash TEXT UNIQUE
    );
  `);
  d.exec(`
    CREATE TABLE IF NOT EXISTS memory_context(
      memory_id TEXT PRIMARY KEY,
      cwd TEXT,
      git_branch TEXT,
      task_kind TEXT,
      files_json TEXT,
      tags_json TEXT
    );
  `);
  d.exec(`
    CREATE TABLE IF NOT EXISTS memory_links(
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      relation TEXT NOT NULL,
      weight REAL DEFAULT 1.0,
      created_at TEXT NOT NULL,
      PRIMARY KEY (source_id,target_id,relation)
    );
  `);
  try { d.exec(`CREATE TABLE IF NOT EXISTS cm_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '')`); } catch {}
  ensureMigrationColumns(d);
  ensureCognitiveTables(d);
  ensureGlobalStoreScope(d, p);
  ensureMemorySearchTable(d);
  d.exec(`
    CREATE TABLE IF NOT EXISTS memory_vectors(
      memory_id TEXT PRIMARY KEY REFERENCES memory_items(id) ON DELETE CASCADE,
      vector BLOB NOT NULL,
      model TEXT NOT NULL DEFAULT '${EMBED_MODEL}',
      created_at TEXT NOT NULL
    );
  `);
  // Dual-vector contract: trigram vectors live in memory_vectors (always
  // present, deterministic), Ollama semantic vectors live here (upgrade when
  // reachable). Never mix spaces in one cosine comparison.
  d.exec(`
    CREATE TABLE IF NOT EXISTS memory_ollama_vectors(
      memory_id TEXT PRIMARY KEY REFERENCES memory_items(id) ON DELETE CASCADE,
      vector BLOB NOT NULL,
      model TEXT NOT NULL DEFAULT '${EMBED_MODEL}',
      created_at TEXT NOT NULL
    );
  `);
  ensureGraphTables(d);
  ensureMessagesSearchTables(d);
  ensureRecallIndexes(d);
  return d;
}

function ensureGlobalStoreScope(d, dbPath) {
  // Before scope_key was explicit, global rows could inherit the cwd from the
  // project that created them. The global database is an unambiguous boundary:
  // normalize every legacy row to global scope and remove project affinity.
  try {
    if (canonicalPath(dbPath) !== canonicalPath(globalDbPath())) return;
    runStmt(d, "UPDATE memory_items SET scope_key='global' WHERE scope_key IS NULL OR scope_key=''", []);
    runStmt(d, "UPDATE memory_context SET cwd='',git_branch='' WHERE memory_id IN (SELECT id FROM memory_items WHERE scope_key='global')", []);
  } catch {}
}

function ensureMigrationColumns(d) {
  // Lifecycle migration (Task B, Phase 3) — additive and idempotent so it never
  // breaks pre-existing installations. Adds lightweight provenance columns the
  // correction lifecycle writes; failures degrade gracefully (column simply
  // isn't present, status tracking still works).
  try {
    const cols = new Set(
      allStmt(d, "PRAGMA table_info(memory_items)").map((c) => c.name)
    );
    if (!cols.has("corrected_by")) {
      runStmt(d, "ALTER TABLE memory_items ADD COLUMN corrected_by TEXT");
    }
  } catch { /* non-fatal: ignore migration errors on legacy DBs */ }
}

function ensureMessagesSearchTables(d) {
  try {
    d.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts
      USING fts5(role,content,session_id,timestamp,content=messages,content_rowid=id);
    `);
    d.exec(`
      CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
        INSERT INTO messages_fts(rowid,role,content,session_id,timestamp)
        VALUES(new.id,new.role,new.content,new.session_id,new.timestamp);
      END;
    `);
    d.exec(`
      CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts,rowid,role,content,session_id,timestamp)
        VALUES('delete',old.id,old.role,old.content,old.session_id,old.timestamp);
      END;
    `);
  } catch {
    d.exec(`
      CREATE TABLE IF NOT EXISTS messages_fts(
        rowid INTEGER PRIMARY KEY,
        role TEXT,
        content TEXT,
        session_id TEXT,
        timestamp TEXT
      );
    `);
    d.exec(`
      CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
        INSERT OR REPLACE INTO messages_fts(rowid,role,content,session_id,timestamp)
        VALUES(new.id,new.role,new.content,new.session_id,new.timestamp);
      END;
    `);
    d.exec(`
      CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
        DELETE FROM messages_fts WHERE rowid = old.id;
      END;
    `);
  }
}

function ensureMemorySearchTable(d) {
  // Standalone FTS5 is deliberate here. The former content-sync table named
  // `tags` although memory_items has no such column, so every MATCH could
  // fail and silently fall back to LIKE. Tags live in memory_context and are
  // copied into this derived index on insert/update.
  let schema = "";
  try { schema = String(getStmt(d, "SELECT sql FROM sqlite_master WHERE name='memory_fts'")?.sql || ""); } catch {}
  // Legacy installations used both `content=memory_items` and quoted
  // `content='memory_items'`; some SQLite builds materialize a contentless
  // FTS table as `content=''`. Both forms cannot accept ordinary DELETEs,
  // while the cognitive/retrieval path intentionally updates rows directly.
  if (schema && /content\s*=\s*(?:['"]?memory_items['"]?|['"]{2})/i.test(schema)) {
    for (const trigger of ["memory_fts_ai", "memory_fts_au", "memory_fts_ad", "memory_fts_bd"]) {
      try { d.exec(`DROP TRIGGER IF EXISTS ${trigger}`); } catch {}
    }
    try { d.exec("DROP TABLE IF EXISTS memory_fts"); } catch {}
  }
  try {
    d.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
      id UNINDEXED, title, body, summary, kind, tags
    )`);
    for (const trigger of ["memory_fts_ai", "memory_fts_au", "memory_fts_ad", "memory_fts_bd"]) {
      try { d.exec(`DROP TRIGGER IF EXISTS ${trigger}`); } catch {}
    }
    d.exec(`CREATE TRIGGER memory_fts_ai AFTER INSERT ON memory_items BEGIN
      INSERT INTO memory_fts(rowid,id,title,body,summary,kind,tags)
      VALUES(new.rowid,new.id,new.title,new.body,COALESCE(new.summary,''),new.kind,'[]');
    END`);
    d.exec(`CREATE TRIGGER memory_fts_au AFTER UPDATE ON memory_items BEGIN
      DELETE FROM memory_fts WHERE rowid=old.rowid;
      INSERT INTO memory_fts(rowid,id,title,body,summary,kind,tags)
      VALUES(new.rowid,new.id,new.title,new.body,COALESCE(new.summary,''),new.kind,'[]');
    END`);
    d.exec(`CREATE TRIGGER memory_fts_ad AFTER DELETE ON memory_items BEGIN
      DELETE FROM memory_fts WHERE rowid=old.rowid;
    END`);
    try {
      d.exec("DELETE FROM memory_fts");
      d.exec(`INSERT INTO memory_fts(rowid,id,title,body,summary,kind,tags)
        SELECT mi.rowid,mi.id,mi.title,mi.body,COALESCE(mi.summary,''),mi.kind,COALESCE(mc.tags_json,'[]')
        FROM memory_items mi LEFT JOIN memory_context mc ON mc.memory_id=mi.id`);
    } catch {}
  } catch {
    try { d.exec("CREATE TABLE IF NOT EXISTS memory_fts(id TEXT PRIMARY KEY,title TEXT,body TEXT,summary TEXT,tags TEXT,kind TEXT)"); } catch {}
  }
}

function ensureGraphTables(d) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS graph_nodes(
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      type TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  d.exec(`
    CREATE TABLE IF NOT EXISTS graph_edges(
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      relation TEXT NOT NULL,
      confidence TEXT NOT NULL DEFAULT 'EXTRACTED',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      PRIMARY KEY(source_id,target_id,relation)
    );
  `);
  d.exec("CREATE INDEX IF NOT EXISTS idx_graph_nodes_type ON graph_nodes(type);");
  d.exec("CREATE INDEX IF NOT EXISTS idx_graph_edges_source ON graph_edges(source_id);");
  d.exec("CREATE INDEX IF NOT EXISTS idx_graph_edges_target ON graph_edges(target_id);");
  d.exec("CREATE INDEX IF NOT EXISTS idx_graph_edges_relation ON graph_edges(relation);");
}

function ensureRecallIndexes(d) {
  // Performance indexes for recall queries
  const indexes = [
    "CREATE INDEX IF NOT EXISTS idx_memory_items_status_kind ON memory_items(status, kind)",
    "CREATE INDEX IF NOT EXISTS idx_memory_items_belief_status ON memory_items(belief_status, status)",
    "CREATE INDEX IF NOT EXISTS idx_memory_items_validity ON memory_items(valid_from, valid_to)",
    "CREATE INDEX IF NOT EXISTS idx_memory_items_status_updated ON memory_items(status, updated_at)",
    "CREATE INDEX IF NOT EXISTS idx_memory_items_kind_layer ON memory_items(kind, layer)",
    "CREATE INDEX IF NOT EXISTS idx_memory_items_hash ON memory_items(hash)",
    "CREATE INDEX IF NOT EXISTS idx_memory_context_memory_id ON memory_context(memory_id)",
    "CREATE INDEX IF NOT EXISTS idx_memory_vectors_memory_id ON memory_vectors(memory_id)",
    "CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, timestamp)",
  ];
  for (const sql of indexes) {
    try { d.exec(sql); } catch {}
  }
  // VACUUM periodically to reclaim space
  try { d.exec("PRAGMA auto_vacuum=FULL"); } catch {}
}

// A2a: wrap a multi-statement sequence in an explicit SQLite transaction.
// BEGIN IMMEDIATE takes the write lock up front (no busy surprise mid-way),
// fn() runs, COMMIT persists; any throw triggers ROLLBACK so dependent rows
// (memory_items + memory_context, items + vectors, …) are never half-written
// if the process dies or a statement fails. Nesting is collapsed: SQLite has
// no native nested BEGIN, so the inner call joins the outer transaction.
function withTransaction(d, fn) {
  if (!d || d.__cmInTransaction) return fn();
  d.exec("BEGIN IMMEDIATE");
  d.__cmInTransaction = true;
  try {
    const out = fn();
    d.exec("COMMIT");
    return out;
  } catch (e) {
    try { d.exec("ROLLBACK"); } catch {}
    throw e;
  } finally {
    d.__cmInTransaction = false;
  }
}

function runStmt(d, sql, params = []) {
  return d.prepare(sql).run(...params);
}


function allStmt(d, sql, params = []) {
  return d.prepare(sql).all(...params);
}

function getStmt(d, sql, params = []) {
  return d.prepare(sql).get(...params);
}
