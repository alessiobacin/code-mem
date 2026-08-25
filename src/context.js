async function sc(c) {
  const rn = c.split("/").pop() || "";
  const no = [];
  const ed = [];
  const nw = nowIso();
  const ts = [];
  const tl = [];
  let tt = "";
  let bt = "";
  let pm = "";
  let hd = false;
  let hc = false;
  const pp = join(c, "package.json");
  if (existsSync(pp)) {
    try {
      const pk = JSON.parse(readFileSync(pp, "utf-8"));
      const dn = Object.keys({ ...pk.dependencies, ...pk.devDependencies } || {});
      if (dn.some((d) => d.startsWith("typescript"))) ts.push("TypeScript");
      const fw = {
        react: "React",
        next: "Next.js",
        "@angular/core": "Angular",
        express: "Express",
        "@nestjs/core": "NestJS",
        vue: "Vue",
        svelte: "Svelte",
        hono: "Hono",
      };
      for (const [k, v] of Object.entries(fw)) {
        if (dn.some((d) => d === k || d.startsWith(`${k}/`))) {
          if (!ts.includes(v)) ts.push(v);
        }
      }
      const tm = {
        vitest: "Vitest",
        jest: "Jest",
        "@playwright/test": "Playwright",
        cypress: "Cypress",
      };
      for (const [k, v] of Object.entries(tm)) {
        if (dn.some((d) => d.startsWith(k))) {
          tt = v;
          break;
        }
      }
      const bm = {
        vite: "Vite",
        next: "Next.js",
        tsc: "tsc",
        webpack: "Webpack",
        esbuild: "esbuild",
      };
      for (const [k, v] of Object.entries(bm)) {
        if (dn.some((d) => d.startsWith(k))) {
          bt = v;
          break;
        }
      }
      const pm_ = pk.packageManager || "";
      if (pm_.startsWith("pnpm")) pm = "pnpm";
      else if (pm_.startsWith("yarn")) pm = "Yarn";
      else if (pm_.startsWith("bun")) pm = "Bun";
      else if (pm_.startsWith("npm")) pm = "npm";
      else {
        if (existsSync(join(c, "pnpm-lock.yaml"))) pm = "pnpm";
        else if (existsSync(join(c, "yarn.lock"))) pm = "Yarn";
        else if (existsSync(join(c, "bun.lockb"))) pm = "Bun";
        else if (existsSync(join(c, "package-lock.json"))) pm = "npm";
      }
      if (dn.some((d) => d.startsWith("eslint"))) ts.push("ESLint");
      if (dn.some((d) => d.startsWith("prettier"))) ts.push("Prettier");
      if (dn.some((d) => d.startsWith("tailwindcss"))) ts.push("Tailwind CSS");
      if (dn.some((d) => d.startsWith("prisma"))) ts.push("Prisma");
      if (dn.some((d) => d.startsWith("pg") || d === "postgres")) ts.push("PostgreSQL");
      const sc_ = pk.scripts || {};
      if (sc_.build) tl.push(`build: ${sc_.build.slice(0, 40)}`);
      if (sc_.test) tl.push(`test: ${sc_.test.slice(0, 40)}`);
      if (sc_.lint) tl.push(`lint: ${sc_.lint.slice(0, 40)}`);
      if (sc_.dev || sc_.start) tl.push(`dev: ${(sc_.dev || sc_.start).slice(0, 40)}`);
      if (pk.name) no.push({ id: "project_root", label: pk.name, type: "project", metadata: { path: c }, created: nw });
    } catch {}
  }
  const tp = join(c, "tsconfig.json");
  if (existsSync(tp)) {
    try {
      const t = JSON.parse(readFileSync(tp, "utf-8"));
      if (t.compilerOptions?.strict) ts.push("strict mode");
    } catch {}
  }
  if (existsSync(join(c, "Dockerfile"))) {
    hd = true;
    tl.push("Docker");
  }
  if (existsSync(join(c, ".github/workflows"))) {
    hc = true;
    tl.push("GitHub Actions");
  }
  const le = {
    ts: "TypeScript",
    tsx: "TSX",
    js: "JavaScript",
    jsx: "JSX",
    rs: "Rust",
    go: "Go",
    py: "Python",
    rb: "Ruby",
    java: "Java",
    swift: "Swift",
    c: "C",
    cpp: "C++",
    cs: "C#",
    sql: "SQL",
    svelte: "Svelte",
    vue: "Vue",
    css: "CSS",
    html: "HTML",
  };
  const fl = new Set();
  const ds = [];
  function wd(dp, dth) {
    if (dth > 3) return;
    let e = [];
    try {
      e = readdirSync(dp);
    } catch {
      return;
    }
    for (const en of e) {
      if (en.startsWith(".") || ["node_modules", "dist", "build", "memory"].includes(en)) continue;
      const fu = join(dp, en);
      try {
        const s = statSync(fu);
        if (s.isDirectory()) {
          if (dth === 0 && !ds.includes(en)) ds.push(en);
          wd(fu, dth + 1);
        } else if (s.isFile()) {
          const ex = en.split(".").pop()?.toLowerCase() || "";
          if (ex && le[ex]) fl.add(le[ex]);
        }
      } catch {}
    }
  }
  wd(c, 0);
  for (const l of fl) if (!ts.includes(l)) ts.push(l);
  const me = [
    `Project: ${rn}`,
    `Tech stack: ${ts.join(", ")}`,
    pm ? `PM: ${pm}` : null,
    tt ? `Test: ${tt}` : null,
    bt ? `Build: ${bt}` : null,
    hd ? "Docker: Yes" : null,
    hc ? "CI: GitHub Actions" : null,
    `Dirs: ${ds.slice(0, 6).join(", ")}`,
  ]
    .filter(Boolean)
    .join("\n");
  if (!no.some((n) => n.id === "project_root")) {
    no.push({ id: "project_root", label: rn || c.split("/").pop(), type: "project", metadata: { path: c }, created: nw });
  }
  for (const d of ds) {
    const ni = `dir_${d.replace(/[^a-z0-9_]/g, "_")}`;
    if (!no.some((n) => n.id === ni)) {
      no.push({ id: ni, label: `${d}/`, type: "directory", metadata: {}, created: nw });
      ed.push({ source: "project_root", target: ni, relation: "contains", confidence: "EXTRACTED", created: nw });
    }
  }
  const st = new Set();
  for (const t of ts) {
    const ti = t.toLowerCase().replace(/[^a-z0-9_]/g, "_");
    if (st.has(ti)) continue;
    st.add(ti);
    if (!no.some((n) => n.id === ti)) {
      no.push({ id: ti, label: t, type: "technology", metadata: {}, created: nw });
      ed.push({ source: "project_root", target: ti, relation: "uses", confidence: "EXTRACTED", created: nw });
    }
  }
  for (const t of [pm, tt, bt].filter(Boolean)) {
    const ti = t.toLowerCase().replace(/[^a-z0-9_]/g, "_");
    if (!no.some((n) => n.id === ti) && !st.has(ti)) {
      no.push({ id: ti, label: t, type: "tool", metadata: {}, created: nw });
      ed.push({ source: "project_root", target: ti, relation: "uses", confidence: "EXTRACTED", created: nw });
    }
  }
  return { me, no, ed, ts };
}

function scanCodeRelations(cwd, d) {
  // Scan .ts/.tsx/.js/.jsx files for import/dependency relationships
  // If d is provided, auto-upsert graph edges with INFERRED confidence
  const suggestions = [];
  const files = [];
  function crawl(dir, depth) {
    if (depth > 4) return;
    let entries;
    try { entries = readdirSync(dir); } catch { return; }
    for (const en of entries) {
      if (en.startsWith(".") || en === "node_modules" || en === "dist" || en === "build" || en === "memory") continue;
      const full = join(dir, en);
      let s;
      try { s = statSync(full); } catch { continue; }
      if (s.isDirectory()) crawl(full, depth + 1);
      else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(en)) files.push(full);
    }
  }
  crawl(cwd, 0);
  const importRe = /(?:from\s+["']([^"']+)["']|require\(["']([^"']+)["']\)|import\s+["']([^"']+)["'])/g;
  const seenEdges = new Set();
  const upserted = { edges: 0, nodes: 0 };
  for (const file of files) {
    let content;
    try { content = readFileSync(file, "utf-8"); } catch { continue; }
    const fileBase = basename(file).replace(/\.[^.]+$/, "");
    let match;
    importRe.lastIndex = 0;
    let matchCount = 0;
    while ((match = importRe.exec(content)) !== null) {
      matchCount++;
      const target = (match[1] || match[2] || match[3] || "").split("/")[0];
      if (!target || target === "." || target.startsWith(".") || target.length < 2) continue;
      const edgeKey = `${fileBase}|${target}`;
      if (!seenEdges.has(edgeKey)) {
        seenEdges.add(edgeKey);
        const confidence = matchCount > 3 ? "INFERRED" : "AMBIGUOUS";
        suggestions.push({ source: fileBase, target, relation: "depends_on", file: file.replace(cwd, "."), confidence });
        if (d) {
          // Auto-upsert graph nodes and edges
          const srcId = `file:${fileBase}`;
          const tgtId = `module:${target}`;
          try {
            upsertGraphNode(d, { id: srcId, label: fileBase, type: "file", metadata: {}, created: nowIso() });
            upsertGraphNode(d, { id: tgtId, label: target, type: "module", metadata: {}, created: nowIso() });
            upserted.nodes += 2;
          } catch {}
          try {
            upsertGraphEdge(d, { source: srcId, target: tgtId, relation: "depends_on", confidence, metadata: {}, created: nowIso() });
            upserted.edges++;
          } catch {}
        }
      }
    }
  }
  suggestions._meta = { upserted };
  return suggestions;
}

function setupSkillText() {
  return `---
name: cm
description: Persistent project memory via \`cm\` CLI, with optional global memory. Save project facts, typed memories, retrieval plans, graph relationships, search conversations, watch daemon, and semantic recall.
---

# cm - Code-Mem Tool

## Init

\`\`\`bash
cm init            # default init with auto-scan
cm init claude     # init + generate CLAUDE.md
cm init pi         # init + generate AGENTS.md
cm init codex      # init + generate GEMINI.md
cm init copilot    # init + generate .github/copilot-instructions.md
cm init cursor     # init + generate .cursorrules
\`\`\`

## Core commands

- \`cm version\`
- \`cm save --kind decision "Use Vitest for unit tests"\`
- \`cm save --kind procedure --global "Deploy classico: docker sul server dal file .env"\`
- \`cm recall "fix flaky tests" --level 2 --mode hybrid\`
- \`cm recall-auto\` — auto-recall based on git context (used by SessionStart hook)
- \`cm watch [--interval 30] [--daemon]\` — continuous embedding + consolidation daemon
- \`cm plan "deploy preview build"\`
- \`cm backup\` — save project memories to \`./cm/memories/<timestamp>/project-memory.md\`
- \`cm backup --global\` — export global memories to a backup file in the current directory
- \`cm restore --global [file]\` — merge a global backup into \`~/.cm/state.db\`
- \`cm update\`
- \`cm recent\`
- \`cm consolidate\`

## Legacy commands

- \`cm add "text"\` -> fact
- \`cm add-user "text"\` -> preference
- \`cm ls\`
- \`cm ls-user\`

## Guidelines

1. Use \`cm recall\` before grep when you need project memory.
2. Save durable learnings with \`cm save\`.
3. When a learning should be available in every project, save it with \`cm save --global\`.
4. Run \`cm project\` or \`cm consolidate\` when projections feel stale.
5. \`MEMORY.md\` and \`USER.md\` are generated projections from \`state.db\`.
6. Start \`cm watch --daemon\` for automatic memory embedding and consolidation.
7. The \`SessionStart\` hook runs \`cm recall-auto\` to load relevant project and global memories at session start.
8. \`cm recall --mode hybrid\` combines keyword matching with semantic embedding (Ollama) or trigram fallback (zero deps).
9. Run \`cm setup\` from a project directory, not from the user's home folder, unless you explicitly want a global Claude hook.
`;
}

async function setupHarness() {
  const sk = setupSkillText();
  const cwd = process.cwd();
  const dirs = [
    join(process.env.HOME || "", ".pi", "agent", "skills", "cm"),
    join(process.env.HOME || "", ".claude", "skills", "cm"),
    join(process.env.HOME || "", ".codex", "skills", "cm"),
    join(process.env.HOME || "", ".cursor", "skills", "cm"),
  ];
  let n = 0;
  for (const d of dirs) {
    try {
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, "SKILL.md"), sk, "utf-8");
      n += 1;
    } catch {}
  }
  console.log(`Installed skill in ${n} harness(es)`);
  await installHooks(cwd);
}

async function installHooks(cwd) {
  const dir = join(cwd, ".claude");
  const settingsPath = join(dir, "settings.json");
  try {
    if (isHomeDir(cwd)) {
      const warning =
        `Warning: current directory is your home folder (${cwd}). ` +
        "Installing the SessionStart hook here would make it effectively global, which is not recommended.";
      if (!process.stdin.isTTY || !process.stdout.isTTY) {
        console.log(warning);
        console.log("Skipped hook installation. Run `cm setup` from a project directory if you want a project-local hook.");
        return;
      }
      console.log(warning);
      const confirmed = await askYesNo("Install the hook globally in your home .claude/settings.json anyway? [y/N] ");
      if (!confirmed) {
        console.log("Skipped hook installation.");
        return;
      }
    }
    let settings = {};
    if (existsSync(settingsPath)) {
      settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    }
    if (!settings.hooks) settings.hooks = {};
    if (!settings.hooks.SessionStart) settings.hooks.SessionStart = [];
    const hookEntry = {
      matcher: "",
      hooks: [
        {
          type: "command",
          command: "if [ -d memory ]; then cm recall-auto; fi",
        },
      ],
    };
    const exists = settings.hooks.SessionStart.some(
      (h) => typeof h === "object" && h.matcher === "" && h.hooks?.some((hh) => hh.command?.includes("cm recall-auto"))
    );
    if (!exists) {
      settings.hooks.SessionStart.push(hookEntry);
      mkdirSync(dir, { recursive: true });
      writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf-8");
      console.log(`Hook added: ${settingsPath} -> SessionStart: cm recall-auto`);
    } else {
      console.log("SessionStart hook already configured.");
    }
  } catch (e) {
    console.log(`Could not install hook: ${e.message}`);
  }
}

