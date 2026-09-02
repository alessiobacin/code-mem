function loadMemoryRow(d, id) {
  return listMemoryRows(d, "WHERE mi.id = ?", [id])[0] || null;
}

function printRows(rows) {
  if (!rows.length) {
    console.log("(empty)");
    return;
  }
  rows.forEach((row, i) => {
    console.log(`${i + 1}. [${row.id}] [${row.kind}] ${row.title}`);
    console.log(`   ${row.summary || summarize(row.body)}`);
  });
}

function replaceMemory(d, cwd, match, nextText, kindFilter) {
  const rows = listMemoryRows(
    d,
    `WHERE mi.status <> 'archived' ${kindFilter ? "AND mi.kind = ?" : ""}`,
    kindFilter ? [kindFilter] : [],
    "ORDER BY mi.updated_at DESC"
  );
  const matches = rows.filter(
    (row) =>
      row.id === match ||
      row.title.toLowerCase().includes(match.toLowerCase()) ||
      row.body.toLowerCase().includes(match.toLowerCase())
  );
  if (!matches.length) {
    console.log(`No match "${match}"`);
    process.exit(1);
  }
  if (matches.length > 1) {
    console.log(`"${match}" matches ${matches.length}. Be specific.`);
    process.exit(1);
  }
  const row = matches[0];
  // A replace is a correction: the referenced memory is marked corrected.
  runStmt(
    d,
    "UPDATE memory_items SET body=?, title=?, summary=?, status='corrected', corrected_by=?, updated_at=? WHERE id=?",
    [nextText, projectTitle(nextText), summarize(nextText), inferAgent(), nowIso(), row.id]
  );
  const updated = loadMemoryRow(d, row.id);
  updateFtsRow(d, updated);
  refreshProjections(d, cwd);
  console.log(`Replaced ${row.id}.`);
}

function removeMemory(d, cwd, match, kindFilter) {
  const rows = listMemoryRows(
    d,
    `WHERE mi.status='active' ${kindFilter ? "AND mi.kind = ?" : ""}`,
    kindFilter ? [kindFilter] : [],
    "ORDER BY mi.updated_at DESC"
  );
  const matches = rows.filter(
    (row) =>
      row.id === match ||
      row.title.toLowerCase().includes(match.toLowerCase()) ||
      row.body.toLowerCase().includes(match.toLowerCase())
  );
  if (!matches.length) {
    console.log(`No match "${match}"`);
    process.exit(1);
  }
  if (matches.length > 1) {
    console.log(`"${match}" matches ${matches.length}. Be specific.`);
    process.exit(1);
  }
  const row = matches[0];
  // Remove from FTS index and archive
  try { runStmt(d, "INSERT INTO memory_fts(memory_fts,rowid) VALUES('delete',(SELECT rowid FROM memory_items WHERE id=?))", [row.id]); } catch {}
  runStmt(d, "UPDATE memory_items SET status='archived', updated_at=? WHERE id=?", [nowIso(), row.id]);
  refreshProjections(d, cwd);
  console.log(`Removed ${row.id}.`);
}

async function consolidateMemories(d, cwd) {
  const rows = listMemoryRows(
    d,
    "WHERE mi.status='active' AND mi.layer IN ('working','episodic')",
    [],
    "ORDER BY mi.updated_at DESC"
  );
  let promoted = 0;
  for (const row of rows) {
    let nextLayer = row.layer;
    let nextKind = row.kind;
    if (row.kind === "fact" || row.kind === "artifact" || row.kind === "issue") nextLayer = "semantic";
    if (row.kind === "procedure") nextLayer = "procedural";
    if (row.kind === "decision") nextLayer = "semantic";
    if (row.summary !== summarize(row.body) || row.layer !== nextLayer || row.kind !== nextKind) {
      runStmt(
        d,
        "UPDATE memory_items SET summary=?, layer=?, kind=?, updated_at=? WHERE id=?",
        [summarize(row.body), nextLayer, nextKind, nowIso(), row.id]
      );
      promoted += 1;
    }
  }
  // Vectorize new memories — prefer Ollama when available, fallback to trigram
  const unembedded = listUnembeddedMemories(d);
  const useOllama = checkOllama();
  for (const row of unembedded) {
    const text = `${row.title} ${row.body} ${row.summary || ""}`;
    if (useOllama) {
      await embedText(d, row.id, null, text).catch(() => saveTrigramVector(d, row.id, text));
    } else {
      saveTrigramVector(d, row.id, text);
    }
  }
  const vecInfo = unembedded.length ? `, ${unembedded.length} vectorized${useOllama ? " (ollama)" : ""}` : "";
  refreshProjections(d, cwd);
  // VACUUM to reclaim space after consolidation
  try { runStmt(d, "VACUUM"); } catch {}
  console.log(`Consolidated ${promoted} item(s).${vecInfo}`);
}

function pruneMemories(d) {
  const rows = listMemoryRows(
    d,
    "WHERE mi.status='active' AND mi.confidence < 0.3 AND julianday('now') - julianday(mi.updated_at) > 90",
    [],
    "ORDER BY mi.updated_at ASC"
  );
  for (const row of rows) {
    try { runStmt(d, "INSERT INTO memory_fts(memory_fts,rowid) VALUES('delete',(SELECT rowid FROM memory_items WHERE id=?))", [row.id]); } catch {}
    runStmt(d, "UPDATE memory_items SET status='archived', updated_at=? WHERE id=?", [nowIso(), row.id]);
  }
  try { runStmt(d, "VACUUM"); } catch {}
  return rows.length;
}

function isProcessAlive(pid) {
  const p = Number.parseInt(pid, 10);
  if (!Number.isInteger(p) || p <= 0) return false; // malformed pid → treat as stale
  if (p === process.pid) return true; // our own pid is trivially alive
  try {
    process.kill(p, 0); // signal 0 = existence probe
    return true;
  } catch (e) {
    // ESRCH → no such process; EPERM → exists but owned by someone else.
    return e && e.code === "EPERM";
  }
}

function acquireLock(cwd) {
  const lockPath = mp(cwd, ".watch.lock");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(lockPath, "wx");
      writeSync(fd, String(process.pid));
      closeSync(fd);
      return () => { try { unlinkSync(lockPath); } catch {} };
    } catch (e) {
      if (attempt > 0) return null; // second attempt failed too → a live holder
      // Lock file exists. Stale-lock recovery: read the PID, and only when
      // the recorded process is confirmed dead (or the pid is unreadable)
      // remove the lock and retry once. A live watcher still reports busy.
      let recordedPid = "";
      try { recordedPid = rd(lockPath).trim(); } catch {}
      if (isProcessAlive(recordedPid)) return null;
      try {
        unlinkSync(lockPath);
        console.log(`[watch] Stale lock removed (dead pid ${recordedPid || "unknown"}).`);
      } catch {
        return null; // could not remove it either → treat as busy
      }
    }
  }
  return null;
}

function watchLoop(d, cwd, intervalSec, cleanup) {
  let running = true;
  const handler = () => { running = false; cleanup(); process.exit(0); };
  process.on("SIGINT", handler);
  process.on("SIGTERM", handler);
  function tick() {
    if (!running) return;
    try {
      // Capture layer: daemon heartbeat leaves a trace in the messages log.
      captureDaemonHeartbeat(d, cwd, `unembedded=${listUnembeddedMemories(d).length} tick`);
      const unembedded = listUnembeddedMemories(d);
      if (unembedded.length > 0) {
        const useOllama = checkOllama();
        for (const row of unembedded) {
          const text = `${row.title} ${row.body} ${row.summary || ""}`;
          if (useOllama) {
            embedText(d, row.id, null, text).catch(() => {});
          } else {
            saveTrigramVector(d, row.id, text);
          }
        }
        console.log(`[watch] vectorized ${unembedded.length} memory item(s)${useOllama ? " (ollama)" : " (trigram)"}`);
      }
      consolidateMemories(d, cwd);
    } catch (e) {
      console.error(`[watch] Error: ${e.message}`);
    }
    setTimeout(tick, intervalSec * 1000);
  }
  tick();
}

// ─── Community detection (Louvain) ──────────────────────────────────────────
