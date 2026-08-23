// ─── Capture layer (messages writer) ──────────────────────────────────────
// The SQLite `messages` table already exists (od() creates it) with FTS5 +
// triggers in ensureMessagesSearchTables. Historically NOTHING ever INSERTed
// rows into it: this module is the actual writer. It records conversation
// rows (role/content/session_id/timestamp) so the recall/search surfaces
// (cm sq, cm entities --msgs) read a living log instead of an empty table.

// Stable per-project session id, overridable via CM_SESSION_ID.
function captureSessionId(cwd) {
  const e = process.env.CM_SESSION_ID;
  if (e) return e;
  try {
    const branch = getGitBranch(cwd);
    const day = new Date().toISOString().slice(0, 10);
    return `${basename(cwd)}::${branch || "main"}::${day}`;
  } catch {
    return `session::${new Date().toISOString()}`;
  }
}

// Core writer: INSERT a single messages row (FTS trigger indexes it).
// Returns the inserted {id, session_id, role, content, timestamp} or null.
function captureMessage(d, msg) {
  const content = String(msg.content || "").trim();
  if (!content) return null;
  const ts = msg.timestamp || nowIso();
  const session_id = msg.session_id || captureSessionId(process.cwd());
  const role = msg.role || "system";
  try {
    runStmt(
      d,
      "INSERT INTO messages(session_id,role,content,timestamp) VALUES(?,?,?,?)",
      [session_id, role, content, ts]
    );
    return { session_id, role, content, timestamp: ts };
  } catch (e) {
    return null;
  }
}

// High-frequency hook used by `cm save --auto`: records what dev/agent just
// wrote (a task, a correction, a note) as a conversation row, no explicit
// `cm save` needed elsewhere. Delegates to the writer above.
function captureAuto(d, cwd, opts) {
  const o = opts || {};
  const role = o.role || "dev";
  const content = (o.content || "").trim();
  if (!content) return null;
  return captureMessage(d, {
    session_id: o.session_id || captureSessionId(cwd),
    role,
    content,
    timestamp: o.timestamp || nowIso(),
  });
}

// SessionStart / recall-auto hook: records the auto-built context (cwd,
// branch, recent git log) as a system message so each session leaves a trace.
function captureAutoRecall(d, cwd) {
  const q = buildAutoQuery(cwd);
  return captureMessage(d, {
    session_id: captureSessionId(cwd),
    role: "system",
    content: `SessionStart recall context: ${q}`,
    timestamp: nowIso(),
  });
}

// Daemon heartbeat: the watch loop records a periodic tick so the messages
// log shows the daemon was alive and what it observed.
function captureDaemonHeartbeat(d, cwd, note) {
  const n = (note || "").trim();
  return captureMessage(d, {
    session_id: captureSessionId(cwd),
    role: "system",
    content: n ? `[watch] ${n}` : `[watch] tick ${new Date().toISOString()}`,
    timestamp: nowIso(),
  });
}
