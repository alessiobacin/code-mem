function od(p) {
  if (!DB) {
    console.log("Requires Node 22+");
    process.exit(1);
  }
  mkdirSync(dirname(p), { recursive: true });
  const d = new DB(p);
  d.exec("PRAGMA page_size=512; PRAGMA journal_mode=DELETE; PRAGMA synchronous=NORMAL");
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
  ensureMemorySearchTable(d);
  d.exec(`
    CREATE TABLE IF NOT EXISTS memory_vectors(
      memory_id TEXT PRIMARY KEY REFERENCES memory_items(id) ON DELETE CASCADE,
      vector BLOB NOT NULL,
      model TEXT NOT NULL DEFAULT '${EMBED_MODEL}',
      created_at TEXT NOT NULL
    );
  `);
  ensureGraphTables(d);
  ensureMessagesSearchTables(d);
  ensureMigrationColumns(d);
  ensureRecallIndexes(d);
  return d;
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
  // Content-sync FTS5: references memory_items without duplicating content text
  try {
    d.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
      id UNINDEXED, title, body, summary, tags, kind,
      content=memory_items, content_rowid=_rowid_
    )`);
    d.exec(`CREATE TRIGGER IF NOT EXISTS memory_fts_bd BEFORE DELETE ON memory_items BEGIN
      INSERT INTO memory_fts(memory_fts,rowid,id,title,body,summary,tags,kind) VALUES('delete',old.rowid,old.id,old.title,old.body,old.summary,'','');
    END`);
    // Rebuild index for existing content
    try { d.exec("INSERT INTO memory_fts(memory_fts) VALUES('rebuild')"); } catch {}
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

function runStmt(d, sql, params = []) {
  return d.prepare(sql).run(...params);
}


function allStmt(d, sql, params = []) {
  return d.prepare(sql).all(...params);
}

function getStmt(d, sql, params = []) {
  return d.prepare(sql).get(...params);
}

