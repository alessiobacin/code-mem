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
  const globalMemoryRequested = Boolean(earlyFlags.global || earlyFlags.scope === "global");

  if (cmd === "setup") {
    await setupHarness();
    return;
  }

  if (cmd === "update") {
    const { flags } = parseArgs(a.slice(1));
    // `cm update --memory` refreshes the project memory (snapshot + graph),
    // with optional noise cleanup (--clean) or full reset (--reset). Without
    // --memory the command remains the binary self-update.
    if (flags.memory || flags.deep) {
      const cwd2 = process.cwd();
      if (!existsSync(mp(cwd2, SF))) {
        console.error("No memory/. Run: cm init --deep");
        process.exit(1);
      }
      const d2 = od(mp(cwd2, SF));
      // Every successful memory update (re)registers the project in the
      // global catalog, so managed repos are never invisible to cm projects.
      try { registerGraphProject(cwd2); } catch {}
      if (flags.deep) {
        try {
          await runDeepProjectUpdate(d2, cwd2, { noLlm: Boolean(flags["no-llm"]), noAst: Boolean(flags["no-ast"]) });
        } finally {
          d2.close();
          if (flags["hook-refresh"]) releaseGraphRefreshLock(cwd2);
        }
        return;
      }
      // Hook audit: harnesses whose marker file exists but whose hook was
      // never installed get it automatically (fixes cross-harness staleness).
      const hookFixed = auditHarnessHooks(cwd2);
      for (const h of hookFixed) console.log(`${h} hook installed (marker file present, hook was missing).`);
      if (flags.reset) {
        const n = archiveAllProjectMemories(d2);
        console.log(`Memory reset: ${n} item(s) archived.`);
        const res = await refreshSnapshotMemory(d2, cwd2);
        console.log(res.updated ? `Snapshot updated (${res.techs} technologies, ${res.nodes} nodes).` : "Snapshot unchanged.");
        d2.close();
        return;
      }
      if (flags.clean) {
        const cands = cleanMemoryNoise(d2, cwd2, { dryRun: Boolean(flags["dry-run"]) });
        if (flags["dry-run"]) {
          console.log(`dry-run: ${cands.length} noise candidate(s):`);
          for (const id of cands) console.log(`  - ${id}`);
          d2.close();
          return;
        }
        console.log(`Memory cleaned: ${cands.length} item(s) archived.`);
        d2.close();
        return;
      }
      const res = await refreshSnapshotMemory(d2, cwd2);
      console.log("Memory refreshed.");
      console.log(res.updated ? `Snapshot updated (${res.techs} technologies, ${res.nodes} nodes).` : "Snapshot unchanged.");
      d2.close();
      return;
    }
    await runUpdate(Boolean(flags.force));
    return;
  }
  if (cmd === "version") {
    console.log(VERSION);
    return;
  }

  if (cmd === "projects") {
    const subcommand = String(a[1] || "list").toLowerCase();
    const { flags } = parseArgs(a.slice(subcommand === "--json" ? 1 : 2));
    const json = Boolean(flags.json || subcommand === "--json");
    const projects = managedProjectEntries().map((project) => ({
      id: project.id,
      name: project.name,
      root: project.root,
      memory: existsSync(mp(project.root, SF)),
      registeredAt: project.registeredAt,
      updatedAt: project.updatedAt,
    }));
    if (subcommand === "list" || subcommand === "ls" || subcommand === "--json") {
      if (json) console.log(JSON.stringify({ projects }, null, 2));
      else if (!projects.length) console.log("No Code-Mem projects registered.");
      else for (const project of projects) console.log(`${project.id}\t${project.name}\t${project.root}${project.memory ? "" : "\t(memory unavailable)"}`);
      return;
    }
    const selector = a[2];
    const project = resolveManagedProject(selector);
    if (!project) {
      console.error(`Unknown or ambiguous Code-Mem project: ${selector || "(missing selector)"}`);
      process.exit(1);
    }
    if (subcommand === "show") {
      console.log(JSON.stringify({ ...project, memory: existsSync(mp(project.root, SF)), graph: mp(project.root, GF), graphHtml: mp(project.root, "graph-3d.html") }, null, 2));
      return;
    }
    if (subcommand === "graph" || subcommand === "open") {
      if (!existsSync(mp(project.root, SF))) {
        console.error(`Project memory is unavailable: ${project.root}`);
        process.exit(1);
      }
      const port = Number.parseInt(flags.port || String(graphServicePort()), 10);
      const status = await graphServiceStatus(port);
      if (!status.running) graphServiceStart(port);
      console.log(graphProjectUrl(project.root, port));
      return;
    }
    if (subcommand === "recall") {
      if (!existsSync(mp(project.root, SF))) {
        console.error(`Project memory is unavailable: ${project.root}`);
        process.exit(1);
      }
      const { flags: recallFlags, rest } = parseArgs(a.slice(3));
      const task = rest.join(" ").trim();
      if (!task) {
        console.error("Usage: cm projects recall <project-id|path|name> <task> [--level n] [--limit n] [--mode mode]");
        process.exit(1);
      }
      const target = od(mp(project.root, SF));
      ensureGraphStoreReady(target, project.root);
      const level = Math.max(1, Math.min(3, Number.parseInt(recallFlags.level || "2", 10) || 2));
      const limit = Math.max(1, Number.parseInt(recallFlags.limit || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT);
      const mode = recallFlags.mode || "hybrid";
      if (!["keyword", "hybrid", "semantic", "explore"].includes(mode)) {
        target.close();
        console.error("--mode must be: keyword, hybrid, semantic, or explore");
        process.exit(1);
      }
      const recalled = await recallMemories(target, project.root, task, level, limit, mode, { scope: "project" });
      console.log(`Project: ${project.name} (${project.root})`);
      console.log(renderRecall(task, level, recalled));
      target.close();
      return;
    }
    console.error("Usage: cm projects [list|show|recall|graph] [selector] [query]");
    process.exit(1);
  }

  if (cmd === "service") {
    const subcommand = String(a[1] || "status").toLowerCase();
    const { flags } = parseArgs(a.slice(2));
    const port = Number.parseInt(flags.port || String(graphServicePort()), 10);
    if (subcommand === "run" || subcommand === "foreground") {
      await runGraphServiceServer(port);
      return;
    }
    if (subcommand === "install") {
      const projectMemory = existsSync(mp(c, SF));
      if (projectMemory) registerGraphProject(c);
      const installed = graphServiceInstall(port);
      console.log(`Global graph service installed: ${installed.path}`);
      console.log(`Service scope: one local process, project-isolated memory (${graphServiceUrl(port)}).`);
      if (!flags["no-start"] && !installed.started) graphServiceStart(port);
      return;
    }
    if (subcommand === "start") {
      const projectMemory = existsSync(mp(c, SF));
      if (projectMemory) registerGraphProject(c);
      graphServiceStart(port);
      console.log(`Global graph service requested at ${graphServiceUrl(port)}.`);
      return;
    }
    if (subcommand === "stop") {
      console.log(graphServiceStop() ? "Global graph service stopped." : "Global graph service was not running.");
      return;
    }
    if (subcommand === "restart") {
      graphServiceStop();
      graphServiceStart(port);
      console.log(`Global graph service restarted at ${graphServiceUrl(port)}.`);
      return;
    }
    if (subcommand === "status") {
      const status = await graphServiceStatus(port);
      console.log(JSON.stringify({ ...status, manager: graphServiceManager(), unit: graphServiceUnitPath() }, null, 2));
      return;
    }
    console.error("Usage: cm service install|start|run|status|restart|stop [--port N]");
    process.exit(1);
  }

  if (cmd === "serve" || (cmd === "graph" && a[1] === "serve")) {
    const offset = cmd === "graph" ? 2 : 1;
    const { flags } = parseArgs(a.slice(offset));
    if (!existsSync(mp(c, SF))) {
      console.error("No memory/. Run: cm init --deep");
      process.exit(1);
    }
    registerGraphProject(c);
    if (flags.foreground) {
      const port = Number.parseInt(flags.port || String(graphBridgePort(c)), 10);
      await runGraphServer(c, port);
      return;
    }
    const port = Number.parseInt(flags.port || String(graphServicePort()), 10);
    const status = await graphServiceStatus(port);
    if (!status.running) graphServiceStart(port);
    console.log(`Graph: ${graphProjectUrl(c, port)}`);
    console.log("Using the global per-user Code-Mem graph service; project memory remains isolated.");
    return;
  }

  if (cmd === "init") {
    const { flags: initFlags, rest: initRest } = parseArgs(a.slice(1));
    const harnessArg = initRest[0];
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
    try { const h = getGitHead(c); if (h) setMeta(nd, "git_head", h); } catch {}
    if (initFlags.deep) {
      await runDeepProjectUpdate(nd, c, { noLlm: Boolean(initFlags["no-llm"]), noAst: Boolean(initFlags["no-ast"]) });
      registerGraphProject(c);
      nd.close();
      console.log(`Memory initialized at ${resolve(dr)}/`);
      return;
    }
    nd.close();
    registerGraphProject(c);
    // Install optional AST parser deps (non-blocking, best-effort)
    try { installAcornDeps(); } catch {}
    // Selective harness wiring: an explicit `cm init <harness>` wins; otherwise
    // install hooks/skill only for the harness actually present in this
    // project (marker or settings). Never create folders for other harnesses.
    let initHarness = harnessArg && harnessArg[0] !== "-" ? harnessArg.toLowerCase() : "";
    if (!initHarness) {
      const present = collapseAmbiguousAgentHarnesses(c, detectHarnesses(c, { projectOnly: true }));
      initHarness = present[0]?.name || "";
    }
    if (initHarness && HARNESS_BINARIES[initHarness]) {
      await installHooks(c, initHarness);
      // With an explicit `cm init <harness>` the skill write + message stay
      // in the legacy block below (stable `written`/`Skipped` messages).
      // Auto-detected harnesses get the skill here instead.
      if (!harnessArg || harnessArg[0] === "-") installHarnessSkill(c, initHarness);
    } else if (!initHarness) {
      console.log("No harness marker detected — hooks/skills skipped. Re-run `cm init <harness>` (claude|pi|codex|opencode|gemini|qwen|copilot|cursor|windsurf) to wire one.");
    }
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
    (cmd === "save" && globalMemoryRequested) ||
    (cmd === "backup" && earlyFlags.global) ||
    (cmd === "restore" && earlyFlags.global)
  );
  if (needsProjectMemory) ensureMemoryReady(c);
  const d = needsProjectMemory ? od(mp(c, SF)) : null;
  if (d) ensureGraphStoreReady(d, c);

  if (cmd === "mcp") {
    // MCP stdio server (IMP-01): JSON-RPC over stdio, project memory tools.
    await runMcpServer(d, c);
    d.close();
    return;
  }

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
      // A1: successive re-ranking rounds weigh signals with rising severity
      // (temperature falls each round) before the context block is rendered.
      recalled.ranked = temperatureRerank(recalled.ranked, { rounds: TEMPERATURE_RERANK_DEFAULT_ROUNDS });
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
    let refreshAfterClose = false;
    let input = "";
    try { input = readFileSync(0, "utf8"); } catch {}
    let payload = {};
    try { payload = JSON.parse(input || "{}"); } catch {}
    if (event === "session_start" || event === "sessionstart") {
      // Staleness sync: if the repo has unregistered commits (memory never
      // updated since, e.g. another harness without an installed hook), the
      // snapshot is refreshed automatically before recall.
      try { await refreshIfGitStale(d, c); } catch {}
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
      refreshAfterClose = event === "response" || event === "turn_end";
    }
    d.close();
    if (refreshAfterClose) scheduleGraphRefresh(c);
    return;
  }

  if (cmd === "save") {
    const { flags, rest } = parseArgs(a.slice(1));
    let text = rest.join(" ").trim();
    const globalSave = Boolean(flags.global || flags.scope === "global");
    // Every preference passes through an LLM that interprets it, shortens
    // it (caveman-style) and translates it to English. Deterministic
    // fallback keeps the save working when no LLM is reachable.
    let preferenceVia = "";
    if ((flags.kind || "fact") === "preference" && text && !flags["no-normalize"]) {
      const normalized = normalizePreferenceText(c, text);
      if (normalized.text) {
        text = normalized.text;
        preferenceVia = normalized.via;
      }
    }
    const payload = {
      body: text,
      kind: flags.kind || "fact",
      layer: flags.layer || (flags.kind === "preference" ? "user" : "semantic"),
      title: flags.title || "",
      summary: flags.summary || "",
      confidence: flags.confidence || DEFAULT_CONFIDENCE,
      importance: flags.importance || flags.salience || DEFAULT_SALIENCE,
      taskKind: flags.task || "",
      tags: flags.tag ? String(flags.tag).split(",").map((t) => t.trim()).filter(Boolean) : [],
      files: flags.file ? String(flags.file).split(",").map((t) => t.trim()).filter(Boolean) : [],
      source: "manual",
      sourceType: flags.source || "manual",
      scope: globalSave ? "global" : (flags.scope || "project"),
      observedAt: flags["observed-at"] || flags.observedAt || "",
      occurredAt: flags["occurred-at"] || flags.occurredAt || "",
      validFrom: flags["valid-from"] || flags.validFrom || "",
      validTo: flags["valid-to"] || flags.validTo || "",
      supersedesId: flags.supersedes || "",
      force: Boolean(flags.force),
    };
    // Capture layer: `cm save --auto` also records a conversation row (messages)
    // for whatever dev/agent just wrote, without needing an explicit capture cmd.
    const autoRole = flags.auto ? (flags.role || "dev") : null;
    if (globalSave) {
      const gd = od(globalDbPath());
      const result = saveMemorySemanticDedup(gd, c, payload);
      if (result.ignored) {
        console.log(`Ignored memory noise: ${result.reason}`);
      } else if (result.duplicate) {
        console.log(`Duplicate (similar to [${result.existing.id}] "${result.existing.title}"). Use --force to save anyway.`);
      } else {
        const snapshot = saveGlobalSnapshot(gd, result.id);
        console.log(`${result.created ? "Saved" : "Already exists"} globally: ${result.id} (${snapshot})${preferenceVia ? ` [preference via ${preferenceVia}]` : ""}`);
      }
      if (autoRole && !result.ignored) {
        const cap = captureAuto(gd, c, { role: autoRole, content: text });
        if (cap) console.log(`Captured ${cap.role} message (session ${cap.session_id})`);
      }
      gd.close();
    } else {
      const result = saveMemorySemanticDedup(d, c, payload);
      if (result.ignored) {
        console.log(`Ignored memory noise: ${result.reason}`);
      } else if (result.duplicate) {
        console.log(`Duplicate (similar to [${result.existing.id}] "${result.existing.title}"). Use --force to save anyway.`);
      } else {
        console.log(`${result.created ? "Saved" : "Already exists"}: ${result.id}${preferenceVia ? ` [preference via ${preferenceVia}]` : ""}`);
      }
      if (autoRole && !result.ignored) {
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
    let text = a.slice(1).join(" ").trim();
    let via = "";
    if (cmd === "add-user" && text) {
      const normalized = normalizePreferenceText(c, text);
      if (normalized.text) { text = normalized.text; via = ` [preference via ${normalized.via}]`; }
    }
    const result = saveMemory(d, c, {
      body: text,
      kind: cmd === "add-user" ? "preference" : "fact",
      layer: cmd === "add-user" ? "user" : "semantic",
      source: "legacy-cli",
    });
    console.log(result.ignored ? `Ignored memory noise: ${result.reason}` : `${result.created ? "Added" : "Already exists"}: ${result.id}${via}`);
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
    const limit = Math.max(1, Math.min(200, Number.parseInt(a[1], 10) || 10));
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
    removeMemoryFtsRow(d, id);
    runStmt(d, "UPDATE memory_items SET status='archived',belief_status='archived',invalidated_at=?,updated_at=? WHERE id=?", [nowIso(), nowIso(), id]);
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
      "UPDATE memory_items SET last_accessed_at=?, access_count=COALESCE(access_count,0)+1, retrieval_strength=MIN(1,COALESCE(retrieval_strength,0)+0.05) WHERE id=?",
      [nowIso(), id]
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
    recallMemories(d, c, task, level, limit, mode, { scope: flags.scope || "auto", asOf: flags["as-of"] || flags.asOf || null }).then((recalled) => {
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
    if (!["keyword", "hybrid", "semantic", "explore"].includes(mode)) {
      console.log("--mode must be: keyword, hybrid, semantic, or explore");
      process.exit(1);
    }
    recallMemories(d, c, task, 3, limit, mode, { explain: true, scope: flags.scope || "auto", asOf: flags["as-of"] || flags.asOf || null }).then((recalled) => {
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
    consolidateMemories(d, c, { acceptCandidates: Boolean(flags["accept-candidates"] || flags.accept) }).then(() => { d.close(); });
    return;
  }

  if (cmd === "verify") {
    const id = a[1];
    if (!id) { console.log("Usage: cm verify <id> [--by verifier]"); process.exit(1); }
    const { flags } = parseArgs(a.slice(2));
    if (!markMemoryVerified(d, id, String(flags.by || "manual"), { command: "verify" })) {
      console.log(`Memory not found: ${id}`);
      d.close();
      process.exit(1);
    }
    refreshProjections(d, c);
    console.log(`Verified ${id}.`);
    d.close();
    return;
  }

  if (cmd === "contest") {
    const id = a[1];
    if (!id) { console.log("Usage: cm contest <id> [reason]"); process.exit(1); }
    const reason = a.slice(2).join(" ").trim() || "manual_contest";
    if (!contestMemory(d, id, reason)) {
      console.log(`Memory not found: ${id}`);
      d.close();
      process.exit(1);
    }
    refreshProjections(d, c);
    console.log(`Contested ${id}; verification queued.`);
    d.close();
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
        const loc = graphNodeLocation(n);
        console.log(`  ${e.source === id ? "->" : "<-"} ${n?.label || nid} (${n?.type || "?"}) [${e.relation}, ${e.confidence}]${loc ? ` @ ${loc}` : ""}`);
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
      // Graph export: default GraphML, or --format graphml|neo4j|csv|cypher|html|html3d|3d|svg|obsidian
      const { flags } = parseArgs(a.slice(1));
      const format = flags.format || "graphml";
      if (format === "graphml") {
        const out = exportGraphML(g, c);
        console.log(`Exported GraphML to ${out}`);
      } else if (format === "neo4j" || format === "csv") {
        const { nodesPath, edgesPath } = exportNeo4jCSV(g, c);
        console.log(`Exported Neo4j CSV:\n  nodes: ${nodesPath}\n  edges: ${edgesPath}`);
      } else if (format === "cypher") {
        const out = exportCypher(g, c);
        console.log(`Exported Cypher to ${out} (import with: cypher-shell < ${out})`);
      } else if (format === "html") {
        const out = exportHTML(g, c);
        const view = graphForVisualization(g);
        console.log(`Exported interactive HTML to ${out} (${view.mode} view: ${view.nodes.length} nodes, ${view.edges.length} relations)`);
      } else if (format === "html3d" || format === "3d") {
        const out = export3DHTML(g, c);
        const view = graphForVisualization(g);
        console.log(`Exported interactive 3D HTML to ${out} (${view.mode} view: ${view.nodes.length} nodes, ${view.edges.length} relations)`);
      } else if (format === "svg") {
        const out = exportSVG(g, c);
        console.log(`Exported SVG to ${out}`);
      } else if (format === "obsidian") {
        const res = exportObsidian(g, c);
        console.log(`Exported Obsidian vault to ${res.dir} (${res.notes} notes, ${res.communities} communities)`);
      } else {
        console.log(`Unknown format "${format}". Options: graphml, neo4j, csv, cypher, html, html3d, svg, obsidian`);
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

  if (cmd === "report") {
    const g = loadGraphFromStore(d);
    const { text, outPath } = writeGraphReport(g, c);
    console.log(text);
    console.log(`\nReport saved: ${outPath}`);
    d.close();
    return;
  }

  if (cmd === "query") {
    const { flags: qflags, rest: qrest } = parseArgs(a.slice(1));
    const question = qrest.join(" ");
    if (!question) {
      console.log("Usage: cm query [--dfs] [--budget N] <question>");
      process.exit(1);
    }
    const useDfs = qflags.dfs === true;
    const budget = Math.max(100, Number.parseInt(qflags.budget || "2000", 10) || 2000);
    // BFS (default) or DFS (--dfs) from nodes matching keywords in the question
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
    const pushNode = (id, depth, relation) => {
      if (visited.has(id)) return null;
      visited.add(id);
      const nd = g.nodes.find(n => n.id === id);
      const entry = { node: nd?.label || id, type: nd?.type || "?", depth, relation, loc: graphNodeLocation(nd) };
      results.push(entry);
      return entry;
    };
    if (useDfs) {
      // DFS: follow one chain as deep as possible before backtracking.
      const visit = (id, depth, relation) => {
        if (visited.has(id) || depth > MAX_DEPTH) return;
        pushNode(id, depth, relation);
        if (depth < MAX_DEPTH) for (const nb of adj[id] || []) visit(nb.node, depth + 1, nb.edge.relation);
      };
      for (const id of matchedNodes.keys()) visit(id, 0, "seed");
    } else {
      const queue = [...matchedNodes.keys()].map(id => ({ id, depth: 0, relation: "seed" }));
      for (const { id, depth, relation } of queue) {
        if (visited.has(id)) continue;
        pushNode(id, depth, relation);
        if (depth < MAX_DEPTH) {
          for (const nb of adj[id] || []) {
            if (!visited.has(nb.node)) queue.push({ id: nb.node, depth: depth + 1, relation: nb.edge.relation });
          }
        }
      }
    }
    if (results.length <= matchedNodes.size) {
      console.log(`Seed: ${[...matchedNodes.values()].map(n => n.label).join(", ")} — no further connections found.`);
    } else {
      const mode = useDfs ? "DFS" : "BFS";
      const head = `Query: "${question}"\n  ${matchedNodes.size} seed nodes, ${results.length - matchedNodes.size} related nodes (${mode} depth ${MAX_DEPTH}):`;
      const body = [];
      for (const r of results) {
        const indent = "  ".repeat(r.depth + 1);
        body.push(`${indent}${r.depth === 0 ? "*" : "-"} ${r.node} (${r.type})${r.relation ? ` [${r.relation}]` : ""}${r.loc ? ` @ ${r.loc}` : ""}`);
      }
      // Token budget (graphify --budget parity): ~4 chars/token, truncate.
      const charBudget = budget * 4;
      let out = `${head}\n${body.join("\n")}`;
      if (out.length > charBudget) out = `${out.slice(0, charBudget)}\n... (truncated at ~${budget} token budget — use --budget N for more)`;
      console.log(out);
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
        if (!noAst && !checkAcorn()) {
          // One-time optional install (announced, IMP-04); offline failure
          // falls back to the regex parser transparently.
          installAcornDeps();
        }
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
    const { flags, rest } = parseArgs(a.slice(1));
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

    // Generic knowledge import. The source may be any Markdown folder or file,
    // including one outside the project where cm is installed. Structure is
    // inferred from content; no source application flag is required.
    const sourceArg = rest.find((value) => value && !value.startsWith("-"));
    if (sourceArg) {
      const sourcePath = resolve(sourceArg);
      let sourceInfo = null;
      try { sourceInfo = statSync(sourcePath); } catch {}
      const isMarkdownSource = Boolean(sourceInfo && (sourceInfo.isDirectory() || (sourceInfo.isFile() && /\.(?:md|markdown)$/i.test(sourcePath))));
      if (isMarkdownSource) {
        let destructive = Boolean(flags["delete-source"]);
        if (!dryRun && !destructive && process.stdin.isTTY) {
          destructive = await askYesNo("Delete imported source Markdown files after a successful import? [y/N] ");
        }
        if (destructive && !importSourceDeletionAllowed(sourcePath, c)) {
          console.log("Source deletion refused: the source overlaps the destination project. Source preserved.");
          destructive = false;
        }
        const importHarnesses = detectHarnesses(c);
        const importHarness = chooseHarness(importHarnesses);
        if (importHarness) console.log(`Import LLM: ${importHarness.name} (${importHarness.model}) via its configured settings.`);
        const result = await importFromWiki(d, c, sourcePath, "knowledge", {
          ...opts,
          cwd: c,
          harness: importHarness,
          llmLimit: Number(process.env.CM_IMPORT_LLM_LIMIT || 60),
          llmBatchSize: Number(process.env.CM_IMPORT_LLM_BATCH || 20),
          llmTimeout: Number(process.env.CM_LLM_TIMEOUT_MS || 45000),
          replace: Boolean(flags.replace),
        });
        if (destructive && result.files > 0) {
          const deletion = deleteImportedSourceFiles(result.sourceFiles, sourcePath, c);
          console.log(deletion.deleted === result.files
            ? `Deleted ${deletion.deleted} imported source file(s).`
            : `Deleted ${deletion.deleted}/${result.files} imported source file(s); remaining files were preserved.`);
        } else if (!dryRun) {
          console.log(`Source preserved: ${sourcePath}`);
        }
        const llm = result.llm?.normalized ? `${result.llm.normalized}/${result.llm.attempted} notes via ${result.llm.model}` : "deterministic fallback (LLM unavailable)";
        const action = dryRun ? "Would import" : "Imported";
        const mediaInfo = result.media?.converted ? ` + ${result.media.converted} media (${result.media.failed || 0} failed)` : "";
        console.log(`${action} ${result.memories} memories, ${result.nodes} nodes, ${result.edges} links from ${sourcePath} (${result.files} Markdown files${mediaInfo}). LLM normalization: ${llm}.`);
        d.close(); return;
      }
    }

    if (flags.obsidian || flags.wiki) {
      const format = flags.obsidian ? "obsidian" : "wiki";
      const value = flags.obsidian || flags.wiki;
      const src = value === true ? (a[2] || "") : value;
      if (!src || !existsSync(src)) {
        console.log(`Wiki path not found: ${src}`);
        d.close(); return;
      }
      const result = await importFromWiki(d, c, src, format, { ...opts, replace: Boolean(flags.replace) });
      console.log(`Imported ${result.memories} memories, ${result.nodes} nodes, ${result.edges} links from ${format} (${result.files} Markdown files)`);
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

    console.log("Usage: cm import <source-folder-or-file> | cm import <bundle.json> | cm import --graphify <path> | cm import --claude-mem [--project NAME] | cm import --json <path>");
    console.log("Options: --dry-run, --replace, --delete-source");
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
