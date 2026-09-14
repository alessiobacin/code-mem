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

function archiveMemoryRow(d, id) {
  try { runStmt(d, "INSERT INTO memory_fts(memory_fts,rowid) VALUES('delete',(SELECT rowid FROM memory_items WHERE id=?))", [id]); } catch {}
  runStmt(d, "UPDATE memory_items SET status='archived', updated_at=? WHERE id=?", [nowIso(), id]);
}

function archiveAllProjectMemories(d) {
  const rows = listMemoryRows(d, "WHERE mi.status <> 'archived'", [], "ORDER BY mi.updated_at ASC");
  for (const row of rows) archiveMemoryRow(d, row.id);
  return rows.length;
}

// Update the project snapshot memory ("Project snapshot: <name>", source=scan)
// by re-scanning the repo. The previous snapshot row(s) are archived so exactly
// one active snapshot remains; the fresh body is saved with force=true to
// bypass fuzzy dedup (a changed body would otherwise create a stale duplicate).
async function refreshSnapshotMemory(d, cwd) {
  const s = await sc(cwd);
  const stale = listMemoryRows(
    d,
    "WHERE mi.status <> 'archived' AND mi.source = 'scan' AND mi.title LIKE 'Project snapshot:%'",
    [],
    "ORDER BY mi.updated_at DESC"
  );
  const freshBody = s.me || "";
  let updated = false;
  if (freshBody) {
    // Only archive old snapshot rows when the scan body actually changed, so
    // an idempotent re-run keeps the original row (its timestamps and stats).
    // Either way the surviving row is touched: the re-scan observed the repo
    // just now, so the git-staleness baseline (last memory write) advances
    // past HEAD — otherwise a later session_start would still report stale.
    const changed = !stale.length || !stale.some((row) => row.body === freshBody);
    if (!changed) {
      for (const row of stale) runStmt(d, "UPDATE memory_items SET updated_at=? WHERE id=?", [nowIso(), row.id]);
    }
    if (changed) {
      for (const row of stale) archiveMemoryRow(d, row.id);
      saveMemory(d, cwd, {
        force: true,
        kind: "fact",
        layer: "semantic",
        title: `Project snapshot: ${basename(cwd)}`,
        body: freshBody,
        summary: summarize(freshBody),
        source: "scan",
        taskKind: "update",
        tags: ["snapshot"],
      });
      updated = true;
    }
  }
  // Graph is always refreshed (nodes/edges are upserted, so this is idempotent).
  if (s.no.length) {
    for (const n of s.no) upsertGraphNode(d, n);
    for (const e of s.ed) upsertGraphEdge(d, e);
  }
  syncGraphProjection(d, cwd);
  refreshProjections(d, cwd);
  try { runStmt(d, "VACUUM"); } catch {}
  const head = getGitHead(cwd);
  if (head) setMeta(d, "git_head", head);
  return { updated, techs: s.ts.length, nodes: s.no.length };
}

// Noise cleanup: archive (a) near-duplicate clusters keeping the newest row of
// each cluster, and (b) very low-confidence facts. Dry-run lists candidates.
function cleanMemoryNoise(d, cwd, { dryRun = false } = {}) {
  const rows = listMemoryRows(d, "WHERE mi.status='active'", [], "ORDER BY mi.updated_at ASC");
  const candidates = [];
  // Near-duplicates: pairwise trigram cosine similarity over active rows.
  const seen = new Set();
  for (let i = 0; i < rows.length; i++) {
    if (seen.has(rows[i].id)) continue;
    const cluster = [];
    for (let j = i + 1; j < rows.length; j++) {
      if (seen.has(rows[j].id)) continue;
      const sim = cosineSimilarity(trigramEmbed(rows[i].body), trigramEmbed(rows[j].body));
      if (rows[i].kind === rows[j].kind && sim > 0.65) {
        cluster.push(rows[j].id);
      }
    }
    // rows are ASC by updated_at, so the LAST row of the cluster (newest) is kept.
    for (const id of cluster) { seen.add(id); candidates.push(id); }
  }
  // Low-confidence noise: active facts nobody confirmed with confidence < 0.3.
  for (const row of rows) {
    if (!candidates.includes(row.id) && row.confidence < 0.3) candidates.push(row.id);
  }
  if (!dryRun) {
    for (const id of candidates) archiveMemoryRow(d, id);
    refreshProjections(d, cwd);
    try { runStmt(d, "VACUUM"); } catch {}
  }
  return candidates;
}

// Harness hook audit: detect compatible harnesses present in the project
// (their marker/instructions file exists) whose cm hook is NOT installed, and
// install it automatically. Returns the list of harnesses that were fixed.
// Detection markers: claude=<installed always>, pi=AGENTS.md, codex=GEMINI.md,
// copilot=.github/copilot-instructions.md, cursor=.cursorrules.
function harnessHookInstalled(cwd, harness) {
  if (harness === "pi") return existsSync(join(cwd, ".pi", "extensions", "code-mem.ts"));
  if (harness === "opencode" || harness === "windsurf") return true; // covered by AGENTS.md/skill, no hook surface
  const configs = {
    claude: { path: join(cwd, ".claude", "settings.json"), marker: "cm hook --event" },
    codex: { path: join(cwd, ".codex", "hooks.json"), marker: "cm hook --event" },
    gemini: { path: join(cwd, ".gemini", "settings.json"), marker: "cm hook --event" },
    qwen: { path: join(cwd, ".qwen", "settings.json"), marker: "cm hook --event" },
    copilot: { path: join(cwd, ".github", "hooks", "code-mem.json"), marker: "cm hook --event" },
    cursor: { path: join(cwd, ".cursor", "hooks.json"), marker: "cm hook --event" },
  };
  const cfg = configs[harness];
  if (!cfg) return true;
  if (!existsSync(cfg.path)) return false;
  try { return readFileSync(cfg.path, "utf-8").includes(cfg.marker); } catch { return false; }
}

function auditHarnessHooks(cwd) {
  const markers = {
    pi: "AGENTS.md",
    codex: "GEMINI.md",
    gemini: "GEMINI.md",
    qwen: "QWEN.md",
    opencode: "AGENTS.md",
    copilot: ".github/copilot-instructions.md",
    cursor: ".cursorrules",
    windsurf: ".windsurf/rules/cm.md",
  };
  const fixed = [];
  for (const [harness, markerFile] of Object.entries(markers)) {
    if (!existsSync(join(cwd, markerFile))) continue;      // harness not used here
    if (harnessHookInstalled(cwd, harness)) continue;      // hook already there
    installHooks(cwd, harness);
    if (harnessHookInstalled(cwd, harness)) fixed.push(harness);
  }
  return fixed;
}

// Last git commit SHA (full) or "" when not a git repo / no commits.
// Compared by identity, not by timestamp: second-precision git dates race
// with millisecond memory writes when everything happens within one second.
function getGitHead(cwd) {
  try {
    return execSync("git rev-parse HEAD", {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf-8",
    }).trim();
  } catch {
    return "";
  }
}

function getMeta(d, key) {
  try {
    const row = getStmt(d, "SELECT value FROM cm_meta WHERE key = ?", [key]);
    return (row && row.value) || "";
  } catch {
    return "";
  }
}

function setMeta(d, key, value) {
  try {
    runStmt(d, "INSERT OR REPLACE INTO cm_meta(key,value) VALUES(?,?)", [key, value]);
  } catch {}
}

// Git-driven staleness sync for session_start: when HEAD moved past the last
// recorded commit, the repo evolved without any memory update (e.g. a harness
// whose hook was never installed), so refresh the snapshot automatically and
// warn the user. Returns true when refreshed.
async function refreshIfGitStale(d, cwd) {
  const head = getGitHead(cwd);
  if (!head) return false;
  const recorded = getMeta(d, "git_head");
  if (recorded === head) return false;
  const res = await refreshSnapshotMemory(d, cwd);
  setMeta(d, "git_head", head);
  if (!recorded) return false; // first observation: establish baseline silently
  console.log(`> Project memory is stale (HEAD moved ${recorded.slice(0, 8)}..${head.slice(0, 8)} since last memory refresh).`);
  console.log(`> Memory auto-refreshed (snapshot ${res.updated ? "updated" : "unchanged"}, ${res.techs} technologies, ${res.nodes} nodes).`);
  return true;
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
