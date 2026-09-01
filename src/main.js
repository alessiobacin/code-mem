async function main() {
  const a = process.argv.slice(2);
  if (a[0] === "--version" || a[0] === "-v") {
    console.log(VERSION);
    return;
  }
  const c = process.cwd();
  // Help dispatch — obscured corollary surfaces are shown only with --full.
  // Accepted forms: `cm help`, `cm help --full`, `cm -h`, `cm --full help`,
  // `cm --full` (bare). Bare/cm help without --full stays lean (API unchanged).
  const first = a[0];
  const wantFull = a.includes("--full");
  if (!a.length || first === "help" || first === "-h" || first === "--full" || (first === "--" && a.includes("--full"))) {
    console.log(wantFull ? glFull() : gl());
    return;
  }
  const cmd = a[0];
  const { flags: earlyFlags } = parseArgs(a.slice(1));

  if (cmd === "setup") {
    await setupHarness();
    return;
  }

  if (cmd === "update") {
    const { flags } = parseArgs(a.slice(1));
    runUpdate(Boolean(flags.force));
    return;
  }

  if (cmd === "version") {
    console.log(VERSION);
    return;
  }

  if (cmd === "init") {
    const harnessArg = a[1];
    const dr = mp(c, "");
    mkdirSync(dr, { recursive: true });
    if (!existsSync(mp(c, MF))) wr(mp(c, MF), "# Project Memory\n");
    if (!existsSync(mp(c, UF))) wr(mp(c, UF), "# User Profile\n");
    if (!existsSync(mp(c, GF))) wg(mp(c, GF), { nodes: [], edges: [] });
    const nd = od(mp(c, SF));
    eg(c);
    const imported = importLegacyMarkdown(nd, c);
    const importedGraph = importLegacyGraphFile(nd, c);
    console.log("Scanning repo...");
    const s = await sc(c);
    if (s.me) {
      saveMemory(nd, c, {
        kind: "fact",
        layer: "semantic",
        title: `Project snapshot: ${basename(c)}`,
        body: s.me,
        summary: summarize(s.me),
        source: "scan",
        taskKind: "init",
        tags: ["snapshot"],
      });
    }
    if (s.no.length) {
      for (const n of s.no) upsertGraphNode(nd, n);
      for (const e of s.ed) upsertGraphEdge(nd, e);
    }
    syncGraphProjection(nd, c);
    refreshProjections(nd, c);
    try { runStmt(nd, "VACUUM"); } catch {}
    nd.close();
    // Install optional AST parser deps (non-blocking, best-effort)
    try { installAcornDeps(); } catch {}
    await installHooks(c, harnessArg && harnessArg[0] !== "-" ? harnessArg.toLowerCase() : "claude");
    let msg = `Memory initialized at ${resolve(dr)}/\n${s.ts.length} technologies, ${s.no.length} nodes${imported ? `, ${imported} imported entries` : ""}${importedGraph ? `, ${importedGraph} imported graph nodes` : ""}`;
    if (harnessArg && harnessArg[0] !== "-") {
      const harness = harnessArg.toLowerCase();
      const hc = HARNESS_CONFIGS[harness];
      if (hc) {
        const configPath = harness === "pi"
          ? join(c, ".pi", "skills", "cm", "SKILL.md")
          : join(c, hc.file);
        const existing = existsSync(configPath);
        if (existing) {
          msg += `\nSkipped ${harness === "pi" ? ".pi/skills/cm/SKILL.md" : hc.file} (already exists)`;
        } else {
          mkdirSync(dirname(configPath), { recursive: true });
          const content = harness === "pi"
            ? setupSkillText()
            : `${harnessComment(harness)}\n\n${CM_HARNESS_SNIPPET}\n`;
          wr(configPath, content);
          msg += `\n${harness === "pi" ? ".pi/skills/cm/SKILL.md" : hc.file} written — ${harness} will load cm instructions on start`;
        }
      } else {
        const valid = Object.keys(HARNESS_CONFIGS).join(", ");
        msg += `\nUnknown harness "${harnessArg}". Valid: ${valid}`;
      }
    }
    console.log(msg);
    return;
  }

  const needsProjectMemory = !(
    (cmd === "save" && earlyFlags.global) ||
    (cmd === "backup" && earlyFlags.global) ||
    (cmd === "restore" && earlyFlags.global)
  );
  if (needsProjectMemory) ensureMemoryReady(c);
  const d = needsProjectMemory ? od(mp(c, SF)) : null;
  if (d) ensureGraphStoreReady(d, c);

  if (cmd === "watch") {
    const { flags } = parseArgs(a.slice(1));
    const interval = Math.max(10, Number.parseInt(flags.interval || "30", 10));
    if (flags.daemon) {
      const child = spawn(process.execPath, [
        ...(process.execArgv.includes("--experimental-sqlite") ? ["--experimental-sqlite"] : []),
        process.argv[1], "watch", "--interval", String(interval)
      ], { detached: true, stdio: "ignore" });
      child.unref();
      console.log(`Watch daemon started (pid ${child.pid}).`);
      process.exit(0);
    }
    if (!checkOllama()) {
      console.log("[watch] Ollama not available — will use trigram embedding.");
    }
    const cleanup = acquireLock(c);
    if (!cleanup) { console.log("[watch] Already running."); process.exit(0); }
    console.log(`[watch] Started (interval=${interval}s). Ctrl+C to stop.`);
    watchLoop(d, c, interval, cleanup);
    return;
  }

  if (cmd === "recall-auto") {
    const q = buildAutoQuery(c);
    // Capture layer: record this SessionStart context in the messages log.
    captureAutoRecall(d, c);
    recallMemories(d, c, q, 1, 8, "hybrid").then((recalled) => {
      console.log("## Contextual Memory (auto-recall)");
      if (!recalled.ranked.length) {
        console.log("No relevant memories from current context.");
      }
      for (const e of recalled.ranked) {
        const row = e.row;
        console.log(`- [${row.kind}] [${row._scope === "global" ? "global" : "project"}] ${row.title}`);
        console.log(`  ${row.summary || summarize(row.body)}`);
      }
      refreshProjections(d, c);
      d.close();
    });
    return;
  }

  if (cmd === "hook") {
    const { flags } = parseArgs(a.slice(1));
    const event = String(flags.event || "").toLowerCase();
    let input = "";
    try { input = readFileSync(0, "utf8"); } catch {}
    let payload = {};
    try { payload = JSON.parse(input || "{}"); } catch {}
    if (event === "session_start" || event === "sessionstart") {
      const q = buildAutoQuery(c);
      captureAutoRecall(d, c);
      console.log(`## Contextual Memory (auto-recall)`);
      const recalled = await recallMemories(d, c, q, 1, 8, "hybrid");
      if (!recalled.ranked.length) console.log("No relevant memories from current context.");
      for (const e of recalled.ranked) {
        const row = e.row;
        console.log(`- [${row.kind}] [${row._scope === "global" ? "global" : "project"}] ${row.title}`);
        console.log(`  ${row.summary || summarize(row.body)}`);
      }
    } else {
      const prompt = payload.prompt || payload.user_prompt || payload.userPrompt || payload.input?.prompt;
      const response = payload.last_assistant_message || payload.assistant_message || payload.response || payload.message;
      if (typeof prompt === "string") captureAuto(d, c, { role: "dev", content: prompt });
      if (typeof response === "string") captureAuto(d, c, { role: "agent", content: response });
    }
    d.close();
    return;
  }

  if (cmd === "save") {
    const { flags, rest } = parseArgs(a.slice(1));
    const text = rest.join(" ").trim();
    const payload = {
      body: text,
      kind: flags.kind || "fact",
      layer: flags.layer || (flags.kind === "preference" ? "user" : "semantic"),
      title: flags.title || "",
      summary: flags.summary || "",
      confidence: flags.confidence || DEFAULT_CONFIDENCE,
      taskKind: flags.task || "",
      tags: flags.tag ? String(flags.tag).split(",").map((t) => t.trim()).filter(Boolean) : [],
      files: flags.file ? String(flags.file).split(",").map((t) => t.trim()).filter(Boolean) : [],
      source: "manual",
      force: Boolean(flags.force),
    };
    // Capture layer: `cm save --auto` also records a conversation row (messages)
    // for whatever dev/agent just wrote, without needing an explicit capture cmd.
    const autoRole = flags.auto ? (flags.role || "dev") : null;
    if (flags.global) {
      const gd = od(globalDbPath());
      const result = saveMemorySemanticDedup(gd, c, payload);
      if (result.duplicate) {
        console.log(`Duplicate (similar to [${result.existing.id}] "${result.existing.title}"). Use --force to save anyway.`);
      } else {
        const snapshot = saveGlobalSnapshot(gd, result.id);
        console.log(`${result.created ? "Saved" : "Already exists"} globally: ${result.id} (${snapshot})`);
      }
      if (autoRole) {
        const cap = captureAuto(gd, c, { role: autoRole, content: text });
        if (cap) console.log(`Captured ${cap.role} message (session ${cap.session_id})`);
      }
      gd.close();
    } else {
      const result = saveMemorySemanticDedup(d, c, payload);
      if (result.duplicate) {
        console.log(`Duplicate (similar to [${result.existing.id}] "${result.existing.title}"). Use --force to save anyway.`);
      } else {
        console.log(`${result.created ? "Saved" : "Already exists"}: ${result.id}`);
      }
      if (autoRole) {
        const cap = captureAuto(d, c, { role: autoRole, content: text });
        if (cap) console.log(`Captured ${cap.role} message (session ${cap.session_id})`);
      }
      d.close();
    }
    return;
  }

  if (cmd === "backup") {
    const { flags } = parseArgs(a.slice(1));
    if (flags.global) {
      const gd = od(globalDbPath());
      const out = backupGlobalMemories(gd, c);
      gd.close();
      console.log(`Global backup written to ${out}`);
    } else {
      const out = backupProjectMemories(d, c);
      console.log(`Project backup written to ${out}`);
      d.close();
    }
    return;
  }

  if (cmd === "restore") {
    const { flags, rest } = parseArgs(a.slice(1));
    if (!flags.global) {
      console.log("Usage: cm restore --global [file]");
      process.exit(1);
    }
    const gd = od(globalDbPath());
    const result = restoreGlobalMemories(gd, c, rest[0]);
    gd.close();
    console.log(`Restored ${result.imported}/${result.total} global memories from ${result.resolved}`);
    return;
  }

  if (cmd === "export") {
    // Deterministic state.db bundle export (Task B merge)
    const { flags } = parseArgs(a.slice(1));
    const outName = String(flags.o || flags.output || flags.out || "export.json");
    const out = exportMemoryBundle(d, c, outName);
    console.log(`Exported bundle to ${out}`);
    d.close();
    return;
  }

  if (cmd === "stats") {
    const { flags } = parseArgs(a.slice(1));
    cmdStats(d, c);
    d.close();
    return;
  }

  if (cmd === "add" || cmd === "add-user") {
    const text = a.slice(1).join(" ").trim();
    const result = saveMemory(d, c, {
      body: text,
      kind: cmd === "add-user" ? "preference" : "fact",
      layer: cmd === "add-user" ? "user" : "semantic",
      source: "legacy-cli",
    });
    console.log(`${result.created ? "Added" : "Already exists"}: ${result.id}`);
    d.close();
    return;
  }

  if (cmd === "ls" || cmd === "ls-user") {
    const rows = listMemoryRows(
      d,
      `WHERE mi.status='active' ${cmd === "ls-user" ? "AND mi.kind='preference'" : "AND mi.kind <> 'preference'"}`,
      [],
      "ORDER BY mi.updated_at DESC"
    );
    printRows(rows);
    d.close();
    return;
  }

  if (cmd === "recent") {
    const limit = Number.parseInt(a[1], 10) || 10;
    const rows = listMemoryRows(d, "WHERE mi.status='active'", [], `ORDER BY mi.updated_at DESC LIMIT ${limit}`);
    printRows(rows);
    d.close();
    return;
  }

  if (cmd === "replace") {
    const oldText = a[1];
    const nextText = a.slice(2).join(" ").trim();
    if (!oldText || !nextText) {
      console.log("Usage: cm replace <old> <new>");
      process.exit(1);
    }
    replaceMemory(d, c, oldText, nextText, null);
    d.close();
    return;
  }

  if (cmd === "rm") {
    const text = a.slice(1).join(" ").trim();
    if (!text) {
      console.log("text required");
      process.exit(1);
    }
    removeMemory(d, c, text, null);
    d.close();
    return;
  }

  if (cmd === "archive") {
    const id = a[1];
    if (!id) {
      console.log("Usage: cm archive <id>");
      process.exit(1);
    }
    try { runStmt(d, "INSERT INTO memory_fts(memory_fts,rowid) VALUES('delete',(SELECT rowid FROM memory_items WHERE id=?))", [id]); } catch {}
    runStmt(d, "UPDATE memory_items SET status='archived', updated_at=? WHERE id=?", [nowIso(), id]);
    refreshProjections(d, c);
    console.log(`Archived ${id}.`);
    d.close();
    return;
  }

  if (cmd === "touch") {
    const id = a[1];
    if (!id) {
      console.log("Usage: cm touch <id>");
      process.exit(1);
    }
    runStmt(
      d,
      "UPDATE memory_items SET last_accessed_at=?, access_count=COALESCE(access_count,0)+1, updated_at=? WHERE id=?",
      [nowIso(), nowIso(), id]
    );
    console.log(`Touched ${id}.`);
    d.close();
    return;
  }

  if (cmd === "link") {
    const source = a[1];
    const target = a[2];
    const relation = a[3];
    const weight = Number.parseFloat(a[4] || "1");
    if (!source || !target || !relation) {
      console.log("Usage: cm link <source> <target> <relation> [weight]");
      process.exit(1);
    }
    runStmt(
      d,
      "INSERT OR REPLACE INTO memory_links(source_id,target_id,relation,weight,created_at) VALUES(?,?,?,?,?)",
      [source, target, relation, Number.isNaN(weight) ? 1 : weight, nowIso()]
    );
    console.log(`${source} --[${relation}]--> ${target}`);
    d.close();
    return;
  }

  if (cmd === "plan") {
    const task = a.slice(1).join(" ").trim();
    if (!task) {
      console.log("Usage: cm plan <task>");
      process.exit(1);
    }
    console.log(JSON.stringify(makePlan(task, c), null, 2));
    d.close();
    return;
  }

  if (cmd === "recall") {
    const { flags, rest } = parseArgs(a.slice(1));
    const task = rest.join(" ").trim();
    if (!task) {
      console.log("Usage: cm recall <task> [--level 1|2|3] [--limit n] [--mode keyword|hybrid|semantic]");
      process.exit(1);
    }
    const level = Math.max(1, Math.min(3, Number.parseInt(flags.level || "2", 10) || 2));
    const limit = Math.max(1, Number.parseInt(flags.limit || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT);
    const mode = flags.mode || "hybrid";
    if (!["keyword", "hybrid", "semantic", "explore"].includes(mode)) {
      console.log("--mode must be: keyword, hybrid, semantic, or explore");
      process.exit(1);
    }
    recallMemories(d, c, task, level, limit, mode).then((recalled) => {
      console.log(renderRecall(task, level, recalled));
      refreshProjections(d, c);
      d.close();
    });
    return;
  }

  if (cmd === "explain") {
    const { flags, rest } = parseArgs(a.slice(1));
    const task = rest.join(" ").trim();
    if (!task) {
      console.log("Usage: cm explain <task> [--limit n] [--mode keyword|hybrid|semantic]");
      process.exit(1);
    }
    const limit = Math.max(1, Number.parseInt(flags.limit || "5", 10) || 5);
    const mode = flags.mode || "hybrid";
    if (!["keyword", "hybrid", "semantic"].includes(mode)) {
      console.log("--mode must be: keyword, hybrid, or semantic");
      process.exit(1);
    }
    recallMemories(d, c, task, 3, limit, mode, { explain: true }).then((recalled) => {
      console.log(renderRecall(task, 3, recalled));
      d.close();
    });
    return;
  }

  if (cmd === "project") {
    const { flags } = parseArgs(a.slice(1));
    refreshProjections(d, c, Boolean(flags.compact));
    console.log("Regenerated MEMORY.md and USER.md." + (flags.compact ? " (compact)" : ""));
    d.close();
    return;
  }

  if (cmd === "consolidate") {
    const { flags } = parseArgs(a.slice(1));
    if (flags.prune) {
      const pruned = pruneMemories(d);
      if (pruned > 0) refreshProjections(d, c);
      console.log(`Pruned ${pruned} item(s) (confidence<0.3, age>90d).`);
      d.close();
      return;
    }
    consolidateMemories(d, c).then(() => { d.close(); });
    return;
  }

  if (cmd.startsWith("g")) {
    const { flags } = parseArgs(a.slice(1));
    if (!["ga", "ge", "gn", "gp", "gs", "gi", "gc", "gx"].includes(cmd)) {
      console.log("Unknown graph command");
      d.close();
      return;
    }
    // gc --vacuum reclaims graph space (VACUUM on state.db)
    if (cmd === "gc" && flags.vacuum) {
      try {
        runStmt(d, "DELETE FROM graph_nodes WHERE id NOT IN (SELECT DISTINCT source_id FROM graph_edges UNION SELECT DISTINCT target_id FROM graph_edges)");
        runStmt(d, "VACUUM");
        console.log("Graph vacuumed: orphan nodes removed, space reclaimed.");
      } catch (e) { console.log(`Vacuum error: ${e.message}`); }
      d.close();
      return;
    }
    const g = loadGraphFromStore(d);
    const nw = nowIso();
    if (cmd === "ga" && a[1] && a[2] && a[3]) {
      const id = a[1];
      const lb = a[2];
      const tp = a[3];
      if (getStmt(d, "SELECT id FROM graph_nodes WHERE id = ?", [id])) {
        console.log(`"${id}" exists.`);
        d.close();
        return;
      }
      upsertGraphNode(d, { id, label: lb, type: tp, metadata: {}, created: nw });
      syncGraphProjection(d, c);
      const counts = getStmt(d, "SELECT (SELECT COUNT(*) FROM graph_nodes) AS nodes, (SELECT COUNT(*) FROM graph_edges) AS edges");
      console.log(`Added: ${id} (${lb}) [${tp}]\n${counts.nodes} nodes, ${counts.edges} edges`);
      d.close();
      return;
    }
    if (cmd === "ge" && a[1] && a[2] && a[3]) {
      const sr = a[1];
      const tg = a[2];
      const rl = a[3];
      const cf = a[4] || "EXTRACTED";
      const VALID_CONFIDENCE = new Set(["EXTRACTED", "INFERRED", "AMBIGUOUS"]);
      if (!VALID_CONFIDENCE.has(cf)) {
        console.log(`Invalid confidence "${cf}". Use EXTRACTED, INFERRED, or AMBIGUOUS.`);
        d.close();
        return;
      }
      if (!getStmt(d, "SELECT id FROM graph_nodes WHERE id = ?", [sr])) {
        console.log(`Source "${sr}" not found.`);
        d.close();
        return;
      }
      if (!getStmt(d, "SELECT id FROM graph_nodes WHERE id = ?", [tg])) {
        console.log(`Target "${tg}" not found.`);
        d.close();
        return;
      }
      if (getStmt(
        d,
        "SELECT source_id FROM graph_edges WHERE source_id = ? AND target_id = ? AND relation = ?",
        [sr, tg, rl]
      )) {
        console.log("Edge exists.");
        d.close();
        return;
      }
      upsertGraphEdge(d, { source: sr, target: tg, relation: rl, confidence: cf, created: nw });
      syncGraphProjection(d, c);
      const counts = getStmt(d, "SELECT (SELECT COUNT(*) FROM graph_nodes) AS nodes, (SELECT COUNT(*) FROM graph_edges) AS edges");
      console.log(`${sr} --[${rl}]--> ${tg} [${cf}]\n${counts.nodes} nodes, ${counts.edges} edges`);
      d.close();
      return;
    }
    if (cmd === "gn") {
      const query = a[1];
      if (!query) {
        console.log("id or label required");
        process.exit(1);
      }
      const nd = resolveNode(g, query);
      if (!nd) {
        const candidates = g.nodes.filter(n => n.label?.toLowerCase().includes(query.toLowerCase()));
        console.log(`"${query}" not found.${candidates.length ? ` Did you mean: ${candidates.slice(0, 5).map(n => n.label).join(", ")}?` : ""}`);
        d.close();
        return;
      }
      const id = nd.id;
      const cn = g.edges.filter((e) => e.source === id || e.target === id);
      if (!cn.length) {
        console.log(`${nd.label} no connections.`);
        d.close();
        return;
      }
      console.log(`${nd.label} (${nd.type}) ${cn.length}:`);
      for (const e of cn) {
        const nid = e.source === id ? e.target : e.source;
        const n = g.nodes.find((x) => x.id === nid);
        console.log(`  ${e.source === id ? "->" : "<-"} ${n?.label || nid} (${n?.type || "?"}) [${e.relation}, ${e.confidence}]`);
      }
      d.close();
      return;
    }
    if (cmd === "gp") {
      const frRaw = a[1];
      const toRaw = a[2];
      if (!frRaw || !toRaw) {
        console.log("Usage: cm gp <from> <to>");
        process.exit(1);
      }
      const fr = resolveNode(g, frRaw)?.id || frRaw;
      const to = resolveNode(g, toRaw)?.id || toRaw;
      const weighted = a.includes("--dijkstra");
      const adj = {};
      for (const n of g.nodes) adj[n.id] = [];
      for (const e of g.edges) {
        const w = typeof e.weight === "number" ? e.weight : 1;
        if (adj[e.source]) adj[e.source].push({ node: e.target, edge: e, weight: w });
        if (adj[e.target]) adj[e.target].push({ node: e.source, edge: e, weight: w });
      }
      if (!adj[fr] || !adj[to]) {
        console.log(`"${adj[fr] ? toRaw : frRaw}" not found.`);
        d.close();
        return;
      }
      const st = g.nodes.find((x) => x.id === fr);
      const en = g.nodes.find((x) => x.id === to);

      if (weighted) {
        // Dijkstra weighted shortest path
        const dist = {}; const prev = {}; const visited = new Set();
        for (const n of g.nodes) dist[n.id] = Infinity;
        dist[fr] = 0;
        while (visited.size < g.nodes.length) {
          let current = null; let minD = Infinity;
          for (const n of g.nodes) {
            if (!visited.has(n.id) && dist[n.id] < minD) { minD = dist[n.id]; current = n.id; }
          }
          if (!current || current === to) break;
          visited.add(current);
          for (const nb of adj[current] || []) {
            if (!visited.has(nb.node)) {
              const alt = dist[current] + (1 / (nb.weight || 1));
              if (alt < dist[nb.node]) { dist[nb.node] = alt; prev[nb.node] = { node: current, edge: nb.edge }; }
            }
          }
        }
        if (dist[to] === Infinity) {
          console.log(`No path "${st?.label || fr}" -> "${en?.label || to}".`);
          d.close(); return;
        }
        const path = []; let cur = to;
        while (cur && prev[cur]) { path.unshift({ label: g.nodes.find(x => x.id === cur)?.label || cur, edge: prev[cur].edge.relation }); cur = prev[cur].node; }
        console.log(`${st?.label || fr} -> ${en?.label || to} (weighted, cost=${dist[to].toFixed(2)}):`);
        for (const p of path) console.log(`  --${p.edge}--> ${p.label}`);
      } else {
        // BFS (original)
        const vs = new Set([fr]);
        const qq = [{ node: fr, path: [] }];
        let fd = null;
        while (qq.length) {
          const cr = qq.shift();
          if (cr.node === to) { fd = cr.path; break; }
          for (const nb of adj[cr.node] || []) {
            if (!vs.has(nb.node)) {
              vs.add(nb.node);
              const n = g.nodes.find((x) => x.id === nb.node);
              qq.push({ node: nb.node, path: [...cr.path, { label: n?.label || nb.node, edge: nb.edge.relation }] });
            }
          }
        }
        if (!fd) { console.log(`No path "${fr}" -> "${to}".`); d.close(); return; }
        console.log(`${st?.label || fr} -> ${fd.length} hops:`);
        for (const p of fd) console.log(`  --${p.edge}--> ${p.label}`);
      }
      d.close();
      return;
    }
    if (cmd === "gc") {
      // Graph communities
      const communities = detectCommunities(g);
      const commMap = {};
      for (const ci of communities) {
        if (!commMap[ci.community]) commMap[ci.community] = [];
        commMap[ci.community].push(ci.label);
      }
      console.log(`${Object.keys(commMap).length} communities:`);
      let singletonCount = 0;
      for (const [cid, members] of Object.entries(commMap)) {
        const size = members.length;
        if (size <= 1) { singletonCount++; continue; }
        const names = size <= 5 ? members.join(", ") : members.slice(0, 4).join(", ") + `, ... (${size} total)`;
        console.log(`  Community ${cid}: [${size}] ${names}`);
      }
      if (singletonCount > 0) {
        console.log(`  ... +${singletonCount} singleton communities (isolated nodes)`);
      }
      // Store communities in graph.json metadata
      const nodeComm = {};
      for (const ci of communities) nodeComm[ci.id] = ci.community;
      const updatedNodes = (g.nodes || []).map(n => ({
        ...n,
        metadata: { ...n.metadata, community: nodeComm[n.id] !== undefined ? nodeComm[n.id] : -1 }
      }));
      wg(mp(c, GF), { nodes: updatedNodes, edges: g.edges || [] });
      syncGraphProjection(d, c);
      d.close();
      return;
    }
    if (cmd === "gx") {
      // Graph export: default GraphML, or --format graphml|neo4j|csv|html|svg
      const { flags } = parseArgs(a.slice(1));
      const format = flags.format || "graphml";
      if (format === "graphml") {
        const out = exportGraphML(g, c);
        console.log(`Exported GraphML to ${out}`);
      } else if (format === "neo4j" || format === "csv") {
        const { nodesPath, edgesPath } = exportNeo4jCSV(g, c);
        console.log(`Exported Neo4j CSV:\n  nodes: ${nodesPath}\n  edges: ${edgesPath}`);
      } else if (format === "html") {
        const out = exportHTML(g, c);
        console.log(`Exported interactive HTML to ${out}`);
      } else if (format === "svg") {
        const out = exportSVG(g, c);
        console.log(`Exported SVG to ${out}`);
      } else {
        console.log(`Unknown format "${format}". Options: graphml, neo4j, csv, html, svg`);
      }
      d.close();
      return;
    }
    if (cmd === "gs") console.log(`${g.nodes.length} nodes, ${g.edges.length} edges`);
    if (cmd === "gi") console.log(gh(g));
    if (cmd === "gs" || cmd === "gi") syncGraphProjection(d, c);
    d.close();
    return;
  }

  if (cmd === "query") {
    const question = a.slice(1).join(" ");
    if (!question) {
      console.log("Usage: cm query <question>");
      process.exit(1);
    }
    // BFS from nodes matching keywords in the question
    const keywords = question.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const matchedNodes = new Map();
    for (const kw of keywords) {
      const like = `%${kw}%`;
      const rows = allStmt(d,
        "SELECT id,label,type FROM graph_nodes WHERE lower(label) LIKE ? OR lower(id) LIKE ? LIMIT 16",
        [like, like]
      );
      for (const row of rows) matchedNodes.set(row.id, row);
    }
    if (!matchedNodes.size) {
      console.log("No nodes matched the query.");
      d.close();
      return;
    }
    // Load full graph for BFS
    const g = loadGraphFromStore(d);
    const adj = {};
    for (const n of g.nodes) adj[n.id] = [];
    for (const e of g.edges) {
      if (adj[e.source]) adj[e.source].push({ node: e.target, edge: e });
      if (adj[e.target]) adj[e.target].push({ node: e.source, edge: e });
    }
    const MAX_DEPTH = 3;
    const visited = new Set();
    const results = [];
    const queue = [...matchedNodes.keys()].map(id => ({ id, depth: 0 }));
    for (const { id, depth } of queue) {
      if (visited.has(id)) continue;
      visited.add(id);
      const nd = g.nodes.find(n => n.id === id);
      results.push({ node: nd?.label || id, type: nd?.type || "?", depth, relation: depth === 0 ? "seed" : "" });
      if (depth < MAX_DEPTH) {
        for (const nb of adj[id] || []) {
          if (!visited.has(nb.node)) {
            queue.push({ id: nb.node, depth: depth + 1 });
            const nbn = g.nodes.find(n => n.id === nb.node);
            results.push({ node: nbn?.label || nb.node, type: nbn?.type || "?", depth: depth + 1, relation: nb.edge.relation });
          }
        }
      }
    }
    if (results.length <= matchedNodes.size) {
      console.log(`Seed: ${[...matchedNodes.values()].map(n => n.label).join(", ")} — no further connections found.`);
    } else {
      console.log(`Query: "${question}"\n  ${matchedNodes.size} seed nodes, ${results.length - matchedNodes.size} related nodes (BFS depth ${MAX_DEPTH}):`);
      for (const r of results) {
        const indent = "  ".repeat(r.depth + 1);
        console.log(`${indent}${r.depth === 0 ? "*" : "-"} ${r.node} (${r.type})${r.relation ? ` [${r.relation}]` : ""}`);
      }
    }
    d.close();
    return;
  }

  if (cmd === "scan") {
    const { flags } = parseArgs(a.slice(1));
    if (flags.deep) {
      if (flags.relations === false || flags.relations === undefined) {
        // --deep implies full AST scan
        const noAst = flags["no-ast"] === true;
        const result = scanASTDeep(c, noAst);
        // Upsert all extracted nodes and edges
        let nodeCount = 0, edgeCount = 0;
        for (const n of result.nodes) { try { upsertGraphNode(d, n); nodeCount++; } catch {} }
        for (const e of result.edges) { try { upsertGraphEdge(d, e); edgeCount++; } catch {} }
        syncGraphProjection(d, c);
        console.log(`AST deep scan: ${result.files} files, ${nodeCount} nodes, ${edgeCount} edges`);
        console.log(`  ${result.hasAcorn ? "acorn" : "regex"} parser (${result.nodes.filter(n => n.type !== "file").length} symbols)`);
        console.log("Run: cm gc for community detection on enriched graph.");
        d.close();
        return;
      }
      // Fall through to --relations processing below with --apply
    }
    if (flags.relations) {
      const applyEdges = flags.apply === true;
      const suggestions = scanCodeRelations(c, applyEdges ? d : null);
      if (!suggestions.length) {
        console.log("No relation suggestions found.");
      } else {
        console.log(`Found ${suggestions.length} relation suggestion(s):`);
        for (const s of suggestions) {
          if (s.file && !s.source_id) {
            const arrow = s.confidence === "INFERRED" ? "~~>" : s.confidence === "AMBIGUOUS" ? "..>" : "-->";
            console.log(`  ${s.source} ${arrow} ${s.target} [${s.relation}, ${s.confidence || "INFERRED"}] (${s.file})`);
          } else {
            console.log(`  ${s.source} --[${s.relation}]--> ${s.target}`);
          }
        }
        if (applyEdges && suggestions._meta) {
          console.log(`Auto-upserted: ${suggestions._meta.upserted.edges} edges, ${suggestions._meta.upserted.nodes} nodes`);
        } else {
          console.log("Run: cm ge <source> <target> <relation> to add any.");
        }
      }
      d.close();
      return;
    }
    console.log("Usage: cm scan --relations [--apply] | cm scan --deep [--no-ast]");
    d.close();
    return;
  }

  if (cmd === "import") {
    const { flags } = parseArgs(a.slice(1));
    const dryRun = flags["dry-run"] === true;
    const opts = { dryRun };

    if (flags.graphify) {
      const src = flags.graphify === true ? (a[2] || "") : flags.graphify;
      if (!src || !existsSync(src)) { console.log(`Graphify file not found: ${src}`); d.close(); return; }
      if (!dryRun && flags.replace) { runStmt(d, "DELETE FROM graph_nodes"); runStmt(d, "DELETE FROM graph_edges"); }
      const result = importFromGraphify(d, c, src, opts);
      console.log(`Imported: ${result.nodes} nodes, ${result.edges} edges`);
      d.close(); return;
    }

    if (flags["claude-mem"]) {
      const proj = flags.project || null;
      if (!dryRun && flags.replace) { runStmt(d, "DELETE FROM memory_items WHERE source = 'claude-mem'"); }
      const result = importFromClaudeMem(d, c, proj, opts);
      console.log(`Imported: ${result.memories} memories from claude-mem`);
      d.close(); return;
    }

    if (flags.json) {
      const src = flags.json === true ? (a[2] || "") : flags.json;
      if (!src || !existsSync(src)) { console.log(`JSON file not found: ${src}`); d.close(); return; }
      if (!dryRun && flags.replace) { runStmt(d, "DELETE FROM graph_nodes"); runStmt(d, "DELETE FROM graph_edges"); }
      const result = importFromJson(d, c, src, opts);
      console.log(`Imported: ${result.nodes} nodes, ${result.edges} edges`);
      d.close(); return;
    }

    // Task B: deterministic bundle merge — `cm import <export.json>`. A plain
    // positional file (not one of the typed graph/memory imports) is treated as
    // a merge bundle from `cm export`.
    const bundle = a.slice(1).find((x) => x && !x.startsWith("-"));
    if (bundle) {
      if (!existsSync(bundle)) { console.log(`Bundle file not found: ${bundle}`); d.close(); return; }
      const result = importMemoryBundle(d, c, bundle);
      console.log(`Imported ${result.created} new, ${result.merged} merged, ${result.skipped} unchanged (total ${result.total})`);
      d.close();
      return;
    }

    console.log("Usage: cm import --graphify <path> | cm import --claude-mem [--project NAME] | cm import --json <path> | cm import <bundle.json>");
    console.log("Options: --dry-run, --replace");
    d.close();
    return;
  }

  if (cmd === "entities") {
    cmdEntities(d, c, a.slice(1));
    d.close();
    return;
  }

  if (cmd === "history" || cmd === "digest") {
    cmdHistory(d, c, a.slice(1));
    d.close();
    return;
  }

  if (cmd === "sq") {
    const q = a[1];
    const mx = Number.parseInt(a[2], 10) || 5;
    if (!q) {
      console.log("query required");
      process.exit(1);
    }
    const r = sd(d, q, mx);
    if (!r.length) {
      console.log("No results.");
      d.close();
      return;
    }
    console.log(`${r.length} results for "${q}":`);
    for (const re of r) console.log(`  [${re.role}] ${re.content.slice(0, 200)}`);
    d.close();
    return;
  }

  console.log(`Unknown "${cmd}". Run: cm help`);
  d.close();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
