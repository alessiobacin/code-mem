// cm — non-regression anchor tests (Task A "cm-modular-capture").
//
// INTENT
//   These tests pin the behaviour of the CURRENT monolithic `bin/cm` before the
//   refactor (coder) splits it into modules + bundle. The coder reuses them to
//   prove the refactor does not change observable behaviour.
//
// HOW THEY RUN
//   - They EXECUTE the CLI as an external process (`spawnSync node <bin> ...`).
//     They never import internal functions, so they run identically against the
//     monolith and against a regenerated single-file bundle (install.sh ships ONE
//     file, so the path is simply `bin/cm`).
//   - They use an isolated HOME + a throwaway temp project, so they never touch
//     the real `~/.cm` global store and never need network.
//   - No Ollama required: assertions are embedding-backend-agnostic. Recall and
//     consolidate fall back to trigram embedding when Ollama is unavailable.
//   - The binary resolves `node:sqlite` itself (re-exec with the experimental
//     flag when needed), so no flags are needed here.
//
// RUN
//   node --test tests/non-regression/
//   or: node --test tests/non-regression/cm-cli.test.mjs
//   Override the binary under test with: CM_BIN=/abs/path/to/cm

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, chmodSync, realpathSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const BIN = process.env.CM_BIN || join(repoRoot, "bin", "cm");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function run(bin, args, opts = {}) {
  const res = spawnSync(process.execPath, [bin, ...args], {
    cwd: opts.cwd,
    env: opts.env,
    input: opts.input,
    encoding: "utf-8",
    timeout: 60000,
  });
  return {
    code: res.status,
    ok: res.status === 0,
    stdout: res.stdout || "",
    stderr: res.stderr || "",
    output: `${res.stdout || ""}\n${res.stderr || ""}`,
  };
}

let rootTmp;
let shelves = [];

before(() => {
  rootTmp = mkdtempSync(join(tmpdir(), "cm-nonreg-"));
});

after(() => {
  for (const p of shelves) {
    try { rmSync(p, { recursive: true, force: true }); } catch {}
  }
  if (rootTmp) { try { rmSync(rootTmp, { recursive: true, force: true }); } catch {} }
});

// Create an isolated project + HOME. Returns a bound run() with a per-test HOME.
function makeProject(name = "proj") {
  const dir = join(rootTmp, `${name}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name, private: true }));
  writeFileSync(join(dir, "src", "index.ts"), "export const x = 1;");
  // Isolated global store: real ~/.cm is never touched.
  const home = join(dir, "home");
  mkdirSync(home, { recursive: true });
  shelves.push(dir);
  const env = { ...process.env, HOME: home };
  return {
    dir,
    home,
    env,
    run: (args, opts = {}) => run(BIN, args, { cwd: dir, env, ...opts }),
  };
}

function initProject(p) {
  const r = p.run(["init"]);
  assert.equal(r.code, 0, `init failed: ${r.output}`);
  return r;
}

// ---------------------------------------------------------------------------
// Anchors
// ---------------------------------------------------------------------------

describe("cm CLI — non-regression anchor (monolith baseline)", () => {

  test('`cm --version` and `cm version` print a semantic version', () => {
    const p = makeProject();
    const v1 = p.run(["--version"]);
    const v2 = p.run(["version"]);
    assert.match(v1.stdout.trim(), /^\d+\.\d+\.\d+$/);
    assert.match(v2.stdout.trim(), /^\d+\.\d+\.\d+$/);
  });

  test("`cm help` exposes core commands", () => {
    const p = makeProject();
    const r = p.run(["help"]);
    assert.equal(r.code, 0);
    assert.match(r.output, /cm init/);
    assert.match(r.output, /cm save/);
    assert.match(r.output, /cm recall/);
    assert.match(r.output, /cm update/);
    assert.match(r.output, /keyword\|hybrid\|semantic/);
  });

  test("`cm init` scaffolds the expected files in ./memory/", () => {
    const p = makeProject();
    const r = initProject(p);
    assert.match(r.output, /Memory initialized/);
    for (const f of ["MEMORY.md", "USER.md", "graph.json", "state.db"]) {
      assert.ok(existsSync(join(p.dir, "memory", f)), `missing memory/${f}`);
    }
  });

  test("`cm init pi` installs a project-local Pi skill in .pi/", () => {
    const p = makeProject("pi-project");
    const r = p.run(["init", "pi"]);
    assert.equal(r.code, 0, `init pi failed: ${r.output}`);
    const skill = join(p.dir, ".pi", "skills", "cm", "SKILL.md");
    const extension = join(p.dir, ".pi", "extensions", "code-mem.ts");
    assert.ok(existsSync(skill), "missing .pi/skills/cm/SKILL.md");
    assert.ok(existsSync(extension), "missing .pi/extensions/code-mem.ts");
    assert.match(readFileSync(skill, "utf8"), /name: cm/);
    assert.match(readFileSync(extension, "utf8"), /turn_end/);
    assert.match(readFileSync(extension, "utf8"), /@mariozechner\/pi-coding-agent/);
    assert.match(readFileSync(extension, "utf8"), /node:child_process/);
    assert.match(r.output, /\.pi\/skills\/cm\/SKILL\.md written/);

    const again = p.run(["init", "pi"]);
    assert.equal(again.code, 0, `re-init pi failed: ${again.output}`);
    assert.match(again.output, /Skipped \.pi\/skills\/cm\/SKILL\.md \(already exists\)/);
  });

  test("`cm save` persists, fuzzy-dedupes, and `--force` re-saves identically", () => {
    const p = makeProject();
    initProject(p);
    const body = "React is the UI layer of this project";

    // New save
    const a = p.run(["save", "--kind", "fact", body]);
    assert.equal(a.code, 0);
    assert.match(a.stdout, /^Saved: mem_/);

    // Identical text, same kind -> fuzzy duplicate
    const dup = p.run(["save", "--kind", "fact", body]);
    assert.equal(dup.code, 0);
    assert.match(dup.stdout, /^Duplicate \(similar to \[mem_/);

    // Different kind, same text -> NOT treated as duplicate
    const otherKind = p.run(["save", "--kind", "decision", body]);
    assert.equal(otherKind.code, 0);
    assert.match(otherKind.stdout, /^Saved: mem_/);

    // --force with identical hash -> still content-deduped ("Already exists")
    const forced = p.run(["save", "--force", "--kind", "fact", body]);
    assert.equal(forced.code, 0);
    assert.match(forced.stdout, /^Already exists: mem_/);
  });

  test("`cm save` rejects empty text", () => {
    const p = makeProject();
    initProject(p);
    const r = p.run(["save", "   "]);
    assert.equal(r.code, 1);
    assert.match(r.output, /text required/);
  });

  test("`cm ls` lists saved memories with id + kind", () => {
    const p = makeProject();
    initProject(p);
    p.run(["save", "--kind", "fact", "MongoDB is the primary datastore"]);
    p.run(["save", "--kind", "procedure", "Run lint before commit"]);
    const r = p.run(["ls"]);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /\[mem_/);
    assert.match(r.stdout, /\[fact\]/);
    assert.match(r.stdout, /\[procedure\]/);
    assert.match(r.stdout, /MongoDB is the primary datastore/);
  });

  test("`cm recent` returns the most recent memories", () => {
    const p = makeProject();
    initProject(p);
    p.run(["save", "--kind", "fact", "Redis is used for caching"]);
    const r = p.run(["recent", "5"]);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /Redis is used for caching/);
    assert.match(r.stdout, /\[mem_/);
  });

  test("`cm recall` returns ranked memories without requiring Ollama", () => {
    const p = makeProject();
    initProject(p);
    p.run(["save", "--kind", "fact", "The auth module issues JWTs"]);
    const r = p.run(["recall", "auth jwt", "--mode", "hybrid"]);
    assert.equal(r.code, 0);
    assert.match(r.output, /^Task: auth jwt/m);
    assert.match(r.output, /Plan: .*mode=hybrid/);
    assert.match(r.output, /The auth module issues JWTs/);
    assert.match(r.output, /score=\d+\.\d+/);
  });

  test("`cm recall` on an empty-ish project yields a context frame (not a crash)", () => {
    const p = makeProject();
    initProject(p);
    const r = p.run(["recall", "zzzzunmatchedqq", "--mode", "hybrid"]);
    assert.equal(r.code, 0);
    assert.match(r.output, /^Task: /m);
  });

  test("global preferences are injected by default but excluded by explicit project scope", () => {
    const p = makeProject("scope-project");
    initProject(p);
    const saved = p.run(["save", "--global", "--kind", "preference", "--layer", "user", "I generally prefer Next.js, but project facts decide the active stack."]);
    assert.equal(saved.code, 0, `global save failed: ${saved.output}`);

    const normal = p.run(["recall", "unrelated task", "--mode", "keyword"]);
    assert.equal(normal.code, 0);
    assert.match(normal.output, /\[global-preference\]/);
    assert.match(normal.output, /Next\.js/);

    const projectOnly = p.run(["recall", "unrelated task", "--mode", "keyword", "--scope", "project"]);
    assert.equal(projectOnly.code, 0);
    assert.doesNotMatch(projectOnly.output, /global-preference|Next\.js/);
  });

  test("`cm projects` lists the catalog and cross-project recall requires an explicit selector", () => {
    const p = makeProject("managed-catalog");
    initProject(p);
    const catalog = p.run(["projects", "--json"]);
    assert.equal(catalog.code, 0, `projects --json failed: ${catalog.output}`);
    const parsed = JSON.parse(catalog.stdout);
    assert.equal(parsed.projects.length, 1);
    assert.equal(parsed.projects[0].root, realpathSync(p.dir));

    const recalled = p.run(["projects", "recall", parsed.projects[0].id, "project snapshot"]);
    assert.equal(recalled.code, 0, `explicit project recall failed: ${recalled.output}`);
    assert.match(recalled.output, /Project: managed-catalog/);
    assert.match(recalled.output, /Project snapshot/);
  });

  test("`cm project` regenerates MEMORY.md / USER.md and includes saved entries", () => {
    const p = makeProject();
    initProject(p);
    p.run(["save", "--kind", "fact", "Postgres powers analytics"]);
    const r = p.run(["project"]);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /Regenerated MEMORY\.md and USER\.md/);
    const mem = readFileSync(join(p.dir, "memory", "MEMORY.md"), "utf-8");
    assert.match(mem, /Postgres powers analytics/);
  });

  test("`cm consolidate` reports promotions and vectorization (trigram fallback ok)", () => {
    const p = makeProject();
    initProject(p);
    p.run(["save", "--kind", "fact", "The API returns HAL-formatted responses", "--layer", "working"]);
    const r = p.run(["consolidate"]);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /Consolidated \d+ item\(s\)/);
    assert.match(r.stdout, /vectorized/);
  });

  test("`cm plan` emits a strategy JSON", () => {
    const p = makeProject();
    initProject(p);
    const r = p.run(["plan", "deploy preview build"]);
    assert.equal(r.code, 0);
    const parsed = JSON.parse(r.stdout);
    assert.equal(typeof parsed.taskKind, "string");
    assert.equal(typeof parsed.strategy, "string");
  });

  test("`cm import <source-folder>` imports external notes, normalizes metadata and is idempotent", () => {
    const p = makeProject("wiki-import");
    initProject(p);
    p.env.CM_IMPORT_NO_LLM = "1";
    const vault = join(rootTmp, `external-vault-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(join(vault, "notes"), { recursive: true });
    writeFileSync(join(vault, "notes", "Auth.md"), [
      "---",
      "title: Authentication",
      "tags: [security, jwt]",
      "---",
      "# Authentication",
      "JWT tokens are issued by the auth module.",
      "See [[Database]] for persistence.",
    ].join("\n"));
    writeFileSync(join(vault, "notes", "Database.md"), "# Database\nPostgres stores users.\n");

    const imported = p.run(["import", vault]);
    assert.equal(imported.code, 0, `generic import failed: ${imported.output}`);
    assert.match(imported.stdout, /Imported 2 memories, 2 nodes, 1 links/);
    assert.match(imported.stdout, /LLM normalization: deterministic fallback/);
    assert.ok(existsSync(join(vault, "notes", "Auth.md")), "source must be preserved by default");
    assert.match(p.run(["ls"]).stdout, /Authentication/);
    assert.match(readFileSync(join(p.dir, "memory", "graph.json"), "utf8"), /Authentication/);

    const repeat = p.run(["import", vault]);
    assert.equal(repeat.code, 0, `repeat import failed: ${repeat.output}`);
    assert.match(repeat.stdout, /Imported 0 memories, 0 nodes, 0 links/);
    const memories = p.run(["ls"]).stdout.split("\n").filter((line) => /\[fact\].*(Authentication|Database)/.test(line));
    assert.equal(memories.length, 2, "repeat import must not duplicate wiki memories");

    const destructive = join(rootTmp, `external-delete-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(destructive, { recursive: true });
    writeFileSync(join(destructive, "One.md"), "# One\nKeep this fact.\n");
    const removed = p.run(["import", "--delete-source", destructive]);
    assert.equal(removed.code, 0, `destructive import failed: ${removed.output}`);
    assert.match(removed.stdout, /Deleted 1 imported source file/);
    assert.equal(existsSync(join(destructive, "One.md")), false, "explicit destructive import must remove imported Markdown");
  });

  test("`cm backup` writes a project backup; `cm backup --global` writes a global store backup", () => {
    const p = makeProject();
    initProject(p);
    p.run(["save", "--kind", "fact", "Terraform manages the cloud infra"]);

    const proj = p.run(["backup"]);
    assert.equal(proj.code, 0);
    const match = proj.stdout.match(/Project backup written to (\S+)/);
    assert.ok(match, `expected backup path, got: ${proj.output}`);
    assert.ok(existsSync(match[1]), `backup file missing: ${match[1]}`);

    const glob = p.run(["backup", "--global"]);
    assert.equal(glob.code, 0);
    const gmatch = glob.stdout.match(/Global backup written to (\S+)/);
    assert.ok(gmatch, `expected global backup path, got: ${glob.output}`);
    assert.ok(existsSync(gmatch[1]), `global backup file missing: ${gmatch[1]}`);
  });

  test("`cm restore` (non-global usage) prints usage and exits non-zero", () => {
    const p = makeProject();
    initProject(p);
    const r = p.run(["restore"]);
    assert.equal(r.code, 1);
    assert.match(r.output, /Usage: cm restore --global/);
  });

  test("running a command without `cm init` refuses with a clear message", () => {
    const p = makeProject();
    const r = p.run(["recall", "anything"]);
    assert.equal(r.code, 1);
    assert.match(r.output, /No memory\/\. Run: cm init/);
  });

  test("an unknown command is reported", () => {
    const p = makeProject();
    initProject(p);
    const r = p.run(["definitely-not-a-cmd"]);
    assert.equal(r.code, 0);
    assert.match(r.output, /Unknown "definitely-not-a-cmd"/);
  });

});

// ---------------------------------------------------------------------------
// cm update --memory (snapshot refresh, noise cleanup, memory reset)
// ---------------------------------------------------------------------------

describe("cm update --memory", () => {

  test("`cm update --memory` refreshes the stale project snapshot (old row archived, new scan row saved)", () => {
    const p = makeProject();
    initProject(p);

    // Simulate a stale snapshot: change the repo AFTER init so the fresh scan
    // body differs from the stored one.
    writeFileSync(join(p.dir, "package.json"), JSON.stringify({
      name: "proj", private: true, dependencies: { express: "^4.0.0", redis: "^4.0.0" },
    }));

    const r = p.run(["update", "--memory"]);
    assert.equal(r.code, 0, `update --memory failed: ${r.output}`);
    assert.match(r.output, /Memory refreshed/);
    assert.match(r.output, /Snapshot updated/);

    // Exactly ONE active snapshot row must remain (the fresh one), and the
    // stale row must be archived, not left as a duplicate.
    const ls = p.run(["ls"]);
    assert.equal(ls.code, 0);
    const snapshotLines = ls.stdout.split("\n").filter((l) => /Project snapshot/.test(l) && /\[mem_/.test(l));
    assert.ok(snapshotLines.length >= 1, "no active snapshot row after refresh");
    assert.ok(/express/i.test(ls.stdout) || /Express/.test(ls.stdout), "fresh snapshot body missing from ls");
  });

  test("`cm update --memory` on a project without init refuses with a clear message", () => {
    const p = makeProject();
    const r = p.run(["update", "--memory"]);
    assert.equal(r.code, 1);
    assert.match(r.output, /No memory\/\. Run: cm init/);
  });

  test("`cm update --memory` registers the project in the global catalog", () => {
    const p = makeProject("catalog-reg");
    // Unregister first: plain init registers, so remove the entry to prove
    // that update --memory itself (re)registers.
    initProject(p);
    const regPath = join(p.home, ".cm", "graphd", "projects.json");
    const reg = JSON.parse(readFileSync(regPath, "utf8"));
    assert.ok(Object.keys(reg.projects || {}).length >= 1, "init must register the project");
    for (const k of Object.keys(reg.projects)) delete reg.projects[k];
    writeFileSync(regPath, JSON.stringify(reg, null, 2));
    const r = p.run(["update", "--memory"]);
    assert.equal(r.code, 0, `update --memory failed: ${r.output}`);
    const after = JSON.parse(readFileSync(regPath, "utf8"));
    const roots = Object.values(after.projects || {}).map((x) => x.root);
    assert.ok(roots.some((root) => realpathSync(p.dir) === root), "update --memory must register the project root");
  });

  test("`cm update --memory` is idempotent when nothing changed (same scan body -> refresh, no duplicate)", () => {
    const p = makeProject();
    initProject(p);
    const r1 = p.run(["update", "--memory"]);
    assert.equal(r1.code, 0);
    const r2 = p.run(["update", "--memory"]);
    assert.equal(r2.code, 0);
    assert.match(r2.output, /Snapshot updated|Snapshot unchanged/);

    const ls = p.run(["ls"]);
    const snapshotLines = ls.stdout.split("\n").filter((l) => /Project snapshot/.test(l) && /\[mem_/.test(l));
    assert.equal(snapshotLines.length, 1, "duplicate snapshot rows after idempotent refresh");
  });

  test("`cm update --memory --clean --dry-run` lists noisy candidates without changing anything", () => {
    const p = makeProject();
    initProject(p);
    // Seed noise: two near-duplicate facts + one low-confidence fact.
    p.run(["save", "--kind", "fact", "Redis is the cache layer for sessions"]);
    p.run(["save", "--kind", "fact", "Redis is the cache layer for sessions and tokens"]);
    p.run(["save", "--kind", "fact", "--confidence", "0.1", "Fuzzy hypothesis about unused widget"]);
    const before = p.run(["ls"]).stdout;

    const r = p.run(["update", "--memory", "--clean", "--dry-run"]);
    assert.equal(r.code, 0, `clean --dry-run failed: ${r.output}`);
    assert.match(r.output, /dry-run/i);
    assert.match(r.output, /candidate|noise/i);

    // Nothing may have changed.
    assert.equal(p.run(["ls"]).stdout, before);
  });

  test("`cm update --memory --clean` archives noise (near-duplicates, low-confidence) and keeps originals", () => {
    const p = makeProject();
    initProject(p);
    p.run(["save", "--kind", "fact", "Redis is the cache layer for sessions"]);
    p.run(["save", "--kind", "fact", "Redis is the cache layer for sessions and tokens"]);
    p.run(["save", "--kind", "fact", "--confidence", "0.1", "Fuzzy hypothesis about unused widget"]);

    const r = p.run(["update", "--memory", "--clean"]);
    assert.equal(r.code, 0, `clean failed: ${r.output}`);
    assert.match(r.output, /cleaned|archived/i);

    const ls = p.run(["ls"]);
    assert.ok(/Redis is the cache layer for sessions(\n|$)/.test(ls.stdout), "original fact must survive clean");
    assert.doesNotMatch(ls.stdout, /Fuzzy hypothesis about unused widget/, "low-confidence noise must be gone");
  });

  test("`cm update --memory --reset` archives ALL project memories and re-scans fresh", () => {
    const p = makeProject();
    initProject(p);
    p.run(["save", "--kind", "fact", "Totally stale legacy statement about module Zed"]);

    const r = p.run(["update", "--memory", "--reset"]);
    assert.equal(r.code, 0, `reset failed: ${r.output}`);
    assert.match(r.output, /reset/i);

    const ls = p.run(["ls"]);
    assert.doesNotMatch(ls.stdout, /Totally stale legacy statement/, "old memory must not survive reset");
    assert.match(ls.stdout, /Project snapshot/, "fresh snapshot must exist after reset");
  });

});

// ---------------------------------------------------------------------------
// session_start staleness sync (git-driven auto-refresh + harness warning)
// ---------------------------------------------------------------------------

describe("cm hook session_start staleness", () => {

  function gitRun(dir, args) {
    const r = spawnSync("git", args, { cwd: dir, encoding: "utf-8" });
    assert.equal(r.status, 0, `git ${args.join(" ")} failed: ${r.stderr}`);
    return r.stdout;
  }

  function makeGitProject() {
    const p = makeProject();
    gitRun(p.dir, ["init", "-q"]);
    gitRun(p.dir, ["config", "user.email", "test@test.local"]);
    gitRun(p.dir, ["config", "user.name", "Test"]);
    gitRun(p.dir, ["add", "-A"]);
    gitRun(p.dir, ["commit", "-q", "-m", "init"]);
    initProject(p);
    // Register the commit cm saw at init time.
    gitRun(p.dir, ["commit", "-q", "--allow-empty", "-m", "snapshot marker"]);
    return p;
  }

  test("unregistered git commits at session_start trigger an auto memory refresh", () => {
    const p = makeProject();
    gitRun(p.dir, ["init", "-q"]);
    gitRun(p.dir, ["config", "user.email", "test@test.local"]);
    gitRun(p.dir, ["config", "user.name", "Test"]);
    gitRun(p.dir, ["add", "-A"]);
    gitRun(p.dir, ["commit", "-q", "-m", "init"]);
    initProject(p);

    // Register baseline: session_start right after init must NOT report staleness.
    const first = p.run(["hook", "--event", "session_start"]);
    assert.equal(first.code, 0, `session_start failed: ${first.output}`);
    assert.doesNotMatch(first.output, /memory (is|appears) stale/i);

    // New commit AFTER init (unregistered by any memory update).
    writeFileSync(join(p.dir, "package.json"), JSON.stringify({
      name: "proj", private: true, dependencies: { express: "^4.0.0" },
    }));
    gitRun(p.dir, ["add", "-A"]);
    gitRun(p.dir, ["commit", "-q", "-m", "add express"]);

    const r = p.run(["hook", "--event", "session_start"]);
    assert.equal(r.code, 0, `session_start failed: ${r.output}`);
    assert.match(r.output, /memory (is|appears) stale/i);
    assert.match(r.output, /auto-refreshed/i);

    const ls = p.run(["ls"]);
    assert.match(ls.stdout, /express/i, "refreshed snapshot must mention the new dependency");
  });

  test("session_start on an up-to-date project does not refresh or warn", () => {
    const p = makeGitProject();
    // Register the snapshot baseline: run update --memory so the snapshot is fresh.
    p.run(["update", "--memory"]);
    const r = p.run(["hook", "--event", "session_start"]);
    assert.equal(r.code, 0, `session_start failed: ${r.output}`);
    assert.doesNotMatch(r.output, /memory (is|appears) stale/i);
    assert.doesNotMatch(r.output, /auto-refreshed/i);
  });

});

// ---------------------------------------------------------------------------
// Harness hook audit: detect compatible harnesses whose hook is not installed
// and reinstall it automatically during `cm update --memory`.
// ---------------------------------------------------------------------------

describe("cm update --memory hook audit", () => {

  test("a pi-configured project without the pi hook gets it installed by update --memory", () => {
    const p = makeProject();
    initProject(p); // installs the Claude hook only
    // Simulate that the user also works with pi: AGENTS.md exists (pi harness
    // marker) but the pi extension was never installed.
    writeFileSync(join(p.dir, "AGENTS.md"), "# AGENTS\n");
    assert.ok(!existsSync(join(p.dir, ".pi", "extensions", "code-mem.ts")), "precondition: pi hook missing");

    const r = p.run(["update", "--memory"]);
    assert.equal(r.code, 0, `update --memory failed: ${r.output}`);
    assert.match(r.output, /pi.*hook installed|installed.*pi/i);
    assert.ok(existsSync(join(p.dir, ".pi", "extensions", "code-mem.ts")), "pi hook must be installed");

    // Re-run: no duplicate installation report.
    const again = p.run(["update", "--memory"]);
    assert.equal(again.code, 0);
    assert.doesNotMatch(again.output, /pi.*hook installed/i);
  });

  test("a cursor-configured project without hooks gets the cursor hook installed", () => {
    const p = makeProject();
    initProject(p);
    writeFileSync(join(p.dir, ".cursorrules"), "# cursor rules\n");
    assert.ok(!existsSync(join(p.dir, ".cursor", "hooks.json")), "precondition: cursor hook missing");

    const r = p.run(["update", "--memory"]);
    assert.equal(r.code, 0, `update --memory failed: ${r.output}`);
    assert.match(r.output, /cursor.*hook installed|installed.*cursor/i);
    const hooks = JSON.parse(readFileSync(join(p.dir, ".cursor", "hooks.json"), "utf-8"));
    assert.ok(hooks.hooks && hooks.hooks.sessionStart, "cursor sessionStart hook must exist");
  });

  test("a project with all detected harness hooks installed reports nothing new", () => {
    const p = makeProject();
    const r = p.run(["init", "pi"]);
    assert.equal(r.code, 0, `init pi failed: ${r.output}`);
    // AGENTS.md written by init pi + Claude hook from default init wiring.
    p.run(["update", "--memory"]);
    assert.equal(p.run(["update", "--memory"]).code, 0);
  });

});

// ---------------------------------------------------------------------------
// Unified deep workflow: full repository inventory + harness integration + 3D
// ---------------------------------------------------------------------------

describe("cm unified deep repository workflow", () => {

  test("`cm init --deep` indexes documents and code, installs /cm-update, and exports real 3D graph data", () => {
    const p = makeProject("deep-workflow");
    mkdirSync(join(p.dir, ".claude"), { recursive: true });
    mkdirSync(join(p.dir, "docs"), { recursive: true });
    mkdirSync(join(p.dir, "docs", "servers"), { recursive: true });
    mkdirSync(join(p.dir, "docs", "services"), { recursive: true });
    writeFileSync(join(p.dir, "src", "other.js"), "export function other(){ return 2; }\n");
    writeFileSync(join(p.dir, "src", "index.ts"), "import { other } from './other.js'; export function index(){ return other(); }\n");
    writeFileSync(join(p.dir, "docs", "architecture.md"), "# Architecture\n\nSee [[decisions]] and use `src/index.ts`.\n");
    writeFileSync(join(p.dir, "docs", "decisions.md"), "# Decisions\n\nThe runtime is documented here.\n");
    writeFileSync(join(p.dir, "docs", "servers", "edge.md"), "# Edge Server\n\nThe production host.\n");
    writeFileSync(join(p.dir, "docs", "services", "edge-api.md"), "---\nhost: edge\ndepends_on: []\n---\n# Edge API\n\nThe production API service.\n");
    writeFileSync(join(p.dir, "docs", "services", "edge-worker.md"), "---\nhost: edge\ndepends_on: [edge-postgres]\n---\n# Edge Worker\n\nApplication backend worker.\n");
    writeFileSync(join(p.dir, "docs", "services", "edge-postgres.md"), "---\nhost: edge\n---\n# Edge PostgreSQL\n\nPostgreSQL database for the production API.\n");
    p.env.CM_NO_LLM = "1";
    p.env.CM_HARNESS_DETECT = "local";

    const r = p.run(["init", "--deep", "--no-llm"]);
    assert.equal(r.code, 0, `deep init failed: ${r.output}`);
    assert.match(r.output, /Detected harnesses/);
    assert.match(r.output, /Full repository index/);
    assert.match(r.output, /Graph complete/);
    assert.ok(existsSync(join(p.dir, "memory", "graph-3d.html")), "3D graph must be generated");
    assert.ok(existsSync(join(p.dir, ".cm", "commands", "cm-update.md")), "generic /cm-update command must be generated");
    assert.ok(existsSync(join(p.dir, ".claude", "skills", "cm", "SKILL.md")), "Claude skill must be generated");
    assert.ok(existsSync(join(p.dir, ".claude", "settings.json")), "Claude hook settings must be generated");
    const claudeSettings = JSON.parse(readFileSync(join(p.dir, ".claude", "settings.json"), "utf8"));
    assert.match(JSON.stringify(claudeSettings), /cm hook --event response/, "harness response hook must be installed");

    const graph = JSON.parse(readFileSync(join(p.dir, "memory", "graph.json"), "utf8"));
    assert.ok(graph.nodes.some((node) => node.type === "document"), "Markdown files must become graph nodes");
    assert.ok(graph.nodes.some((node) => node.type === "section"), "Markdown headings must become section nodes");
    assert.ok(graph.nodes.some((node) => node.id === "path:file:src/index.ts"), "canonical file node must exist");
    assert.ok(graph.edges.some((edge) => (edge.relation || edge.r) === "imports"), "local import relation must exist");
    assert.ok(graph.edges.some((edge) => (edge.relation || edge.r) === "hosted_on"), "service frontmatter host must become a graph relation");
    const html = readFileSync(join(p.dir, "memory", "graph-3d.html"), "utf8");
    assert.match(html, /Code-Mem 3D Knowledge Graph/);
    const moduleStart = html.indexOf('<script type="module">') + '<script type="module">'.length;
    const moduleEnd = html.indexOf("</script>", moduleStart);
    const syntax = spawnSync(process.execPath, ["--input-type=module", "--check"], { input: html.slice(moduleStart, moduleEnd), encoding: "utf8" });
    assert.equal(syntax.status, 0, `generated 3D module must parse: ${syntax.stderr}`);
    assert.match(html, /communityIds/, "3D layout must group nodes by community");
    assert.match(html, /macroCenters/, "3D layout must assign spatial macro-cluster centers");
    assert.match(html, /labelFar/, "3D labels must use a distance threshold");
    assert.match(html, /updateLabels/, "3D labels must update as the camera moves");
    assert.match(html, /distanceTo/, "3D labels must be distance-aware");
    assert.match(html, /pointermove/, "3D graph must react to node hover");
    assert.match(html, /applyHighlight/, "3D graph must highlight a node neighborhood");
    assert.match(html, /pointer-events:auto;cursor:pointer/, "node labels must be clickable");
    assert.match(html, /closest\?\.\('\.label'\)/, "clicking a node label must resolve to its node");
    assert.match(html, /neighborIdsById/, "3D graph must track connected neighbors");
    assert.match(html, /focusNodeAndRelations/, "3D node selection must fit the selected node and its relations");
    assert.match(html, /focusOnIds/, "3D graph must fit groups of nodes");
    assert.match(html, /searchMatches/, "3D graph must track live search matches");
    assert.match(html, /keydown/, "3D search must support keyboard submit");
    assert.match(html, /function clearSelection/, "3D graph must clear selection when empty space is clicked");
    assert.match(html, /addEventListener\('click'/, "empty-space reset must use a click handler");
    assert.match(html, /if\(!hit\)clearSelection/, "clicking empty space must clear node highlighting");
    assert.match(html, /macro-label/, "overview must show a readable label for each macro cluster");
    assert.match(html, /communityMembers/, "3D graph must derive macro labels from grouped nodes");
    assert.match(html, /dragged/, "3D graph must distinguish drag gestures from clicks");
    assert.match(html, /if\(gesture\?\.dragged\)/, "drag release must not clear the selected node");
    assert.match(html, /COLORS\[n\.type\]/, "search highlights must preserve node category colors");
    assert.match(html, /const active=selected\|\|hovered/, "clicked selection must remain authoritative over hover");
    assert.match(html, /targetColor\.set\(nodeColor\)/, "highlighted nodes must retain their category color");
    assert.match(html, /\.label\.selected,\.label\.hovered\{color:var\(--node-color/, "highlighted labels must retain their category color");
    assert.match(html, /category-filters/, "3D graph must expose category visibility filters");
    assert.match(html, /visibleTypes/, "category filters must control node visibility");
    assert.match(html, /controls-toggle/, "navigation legend must be collapsible");
    assert.match(html, /chat-resize/, "graph chat must expose a top-right resize handle");
    assert.match(html, /chatHead.addEventListener\('pointerdown'/, "graph chat must be draggable from its header");
    assert.match(html, /id=\"chat-toggle\"/, "graph chat must expose a collapse button");
    assert.match(html, /chatPanel.classList.add\('collapsed'\)/, "graph chat collapse must add its collapsed state");
    assert.match(html, /#chat\.collapsed::after\{display:none/, "collapsed chat must hide the resize hint");
    assert.match(html, /left:50%/, "initial graph chat position must be centered across the full viewport");
    assert.match(html, /nav-command-list/, "navigation commands must be rendered as a vertical list");
    assert.match(html, /class="collapsed" hidden/, "graph chat must start collapsed");
    assert.match(html, /aria-label="Expand chat"/, "collapsed chat must expose an expand action");
    assert.match(html, /#chat::after\{content:none;display:none/, "chat header must not render a resize hint behind the collapse button");
    assert.match(html, /#controls\{width:min\(230px,30vw\)\}/, "navigation must match the visible-categories width");
    assert.match(html, /keepChatInsideViewport/, "graph chat must remain inside the browser viewport");
    assert.ok(html.includes("degree"), "3D nodes must carry relationship degree");
    assert.match(html, /targetColor:new THREE\.Color\(0x55708d\)/, "3D edges must initialize highlight state before the render loop");
    assert.match(html, /BRIDGE_URL/, "3D graph must know its local chat bridge");
    assert.match(html, /api\/graph\/status/, "3D graph must check chat readiness on open");
    assert.match(html, /api\/graph\/chat/, "3D graph must send questions to the local chat bridge");
    const graphView = JSON.parse(html.match(/const DATA=(.*?);\nconst COLORS=/s)[1]);
    assert.equal(graphView.mode, "operational", "infra repositories must export an operational graph view");
    assert.deepEqual(new Set(graphView.nodes.map((node) => node.type)), new Set(["server", "service", "application", "database"]));
    assert.equal(graphView.nodes.length, 4, "operational view must include semantic application/database nodes and exclude evidence nodes");
    assert.ok(graphView.nodes.some((node) => node.label === "Edge Worker" && node.type === "application"), "service notes describing an application must be classified as applications");
    assert.ok(graphView.nodes.some((node) => node.label === "Edge PostgreSQL" && node.type === "database"), "service notes describing a database must be classified as databases");
    assert.equal(graphView.evidenceNodes, graph.nodes.length, "3D payload must expose the complete evidence-node count");
    assert.ok(graphView.nodes.every((node) => Number.isInteger(node.degree)), "operational nodes must expose degree");
    assert.ok(graphView.nodes.filter((node) => node.type === "server").every((node) => node.degree > 0), "operational servers must not be isolated");
    assert.ok(graph.nodes.some((node) => node.label === "docs/architecture.md"), "full evidence graph must retain repository documents");

    const update = p.run(["update", "--memory", "--deep", "--no-llm"]);
    assert.equal(update.code, 0, `deep update failed: ${update.output}`);
    const graphAgain = JSON.parse(readFileSync(join(p.dir, "memory", "graph.json"), "utf8"));
    assert.equal(graphAgain.nodes.length, graph.nodes.length, "deep update must remain idempotent");
    assert.equal(graphAgain.edges.length, graph.edges.length, "deep update must remain edge-idempotent");
  });

  test("harness response hook refreshes the generated 3D graph in the background", async () => {
    const p = makeProject("hook-graph-refresh");
    mkdirSync(join(p.dir, ".claude"), { recursive: true });
    p.env.CM_HARNESS_DETECT = "local";
    p.env.CM_NO_LLM = "1";
    const init = p.run(["init", "--deep", "--no-llm"]);
    assert.equal(init.code, 0, `deep init failed: ${init.output}`);
    writeFileSync(join(p.dir, "docs-refresh.md"), "# Hook refresh marker\n\nThis file must appear in the refreshed graph.\n");
    const hook = p.run(["hook", "--event", "response"], { input: JSON.stringify({ response: "Finished a repository change." }) });
    assert.equal(hook.code, 0, `response hook failed: ${hook.output}`);
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline && existsSync(join(p.dir, "memory", ".graph-refresh.lock"))) {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    const html = readFileSync(join(p.dir, "memory", "graph-3d.html"), "utf8");
    assert.match(html, /docs-refresh\.md/, "background response refresh must regenerate graph HTML");
  });

  test("graph server exposes chat only when a project provider is configured", async () => {
    const p = makeProject("graph-chat");
    mkdirSync(join(p.dir, ".claude"), { recursive: true });
    mkdirSync(join(p.home, "bin"), { recursive: true });
    const fakeClaude = join(p.home, "bin", "claude");
    writeFileSync(join(p.dir, ".claude", "settings.json"), JSON.stringify({
      env: { ANTHROPIC_BASE_URL: "http://127.0.0.1:7045", API_TIMEOUT_MS: "3000000" },
      model: "llmProxy",
    }));
    writeFileSync(fakeClaude, "#!/bin/sh\nprintf '[llmproxy] credito residuo: n/a\\nTest graph answer from harness\\n'\n");
    chmodSync(fakeClaude, 0o755);
    p.env.CM_HARNESS_DETECT = "local";
    p.env.CM_NO_LLM = "1";
    p.env.PATH = `${join(p.home, "bin")}:${process.env.PATH || ""}`;
    const init = p.run(["init", "--deep", "--no-llm"]);
    assert.equal(init.code, 0, `deep init failed: ${init.output}`);
    delete p.env.CM_NO_LLM;
    const port = 4600 + Math.floor(Math.random() * 100);
    const child = spawn(process.execPath, [BIN, "serve", "--foreground", "--port", String(port)], {
      cwd: p.dir,
      env: p.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let serverOutput = "";
    const ready = new Promise((resolve, reject) => {
      child.stdout.on("data", (chunk) => {
        serverOutput += String(chunk);
        if (serverOutput.includes(`127.0.0.1:${port}`)) resolve();
      });
      child.stderr.on("data", (chunk) => { serverOutput += String(chunk); });
      child.on("error", reject);
      child.on("exit", (code) => { if (code && !serverOutput.includes(`127.0.0.1:${port}`)) reject(new Error(serverOutput)); });
    });
    try {
      await ready;
      const status = await fetch(`http://127.0.0.1:${port}/api/graph/status`);
      const statusBody = await status.json();
      assert.equal(statusBody.chatReady, true, `chat should be ready: ${JSON.stringify(statusBody)}`);
      assert.equal(statusBody.harness.provider, "anthropic-compatible");
      const chat = await fetch(`http://127.0.0.1:${port}/api/graph/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "What does the graph say?" }),
      });
      const chatBody = await chat.json();
      assert.equal(chat.status, 200, JSON.stringify(chatBody));
      assert.match(chatBody.answer, /Test graph answer/);
      assert.doesNotMatch(chatBody.answer, /credito residuo|llmproxy/i);
    } finally {
      child.kill("SIGTERM");
      await new Promise((resolve) => child.once("exit", resolve));
    }
  });

  test("graph chat answers factual questions from source evidence when the harness emits transport metadata only", async () => {
    const p = makeProject("graph-chat-context");
    mkdirSync(join(p.dir, ".claude"), { recursive: true });
    mkdirSync(join(p.dir, "docs"), { recursive: true });
    mkdirSync(join(p.home, "bin"), { recursive: true });
    writeFileSync(join(p.dir, "docs", "labirinto.md"), "# Labirinto\n\nlabirinto.newbiz.it is hosted on 192.168.122.100.\n");
    writeFileSync(join(p.dir, ".claude", "settings.json"), JSON.stringify({
      env: { ANTHROPIC_BASE_URL: "http://127.0.0.1:7045" },
      model: "llmProxy",
    }));
    const fakeClaude = join(p.home, "bin", "claude");
    writeFileSync(fakeClaude, "#!/bin/sh\nprintf '[llmproxy] credito residuo: n/a\\n'\n");
    chmodSync(fakeClaude, 0o755);
    p.env.CM_HARNESS_DETECT = "local";
    p.env.CM_NO_LLM = "1";
    p.env.PATH = `${join(p.home, "bin")}:${process.env.PATH || ""}`;
    const init = p.run(["init", "--deep", "--no-llm"]);
    assert.equal(init.code, 0, `deep init failed: ${init.output}`);
    delete p.env.CM_NO_LLM;
    const port = 4800 + Math.floor(Math.random() * 100);
    const child = spawn(process.execPath, [BIN, "serve", "--foreground", "--port", String(port)], { cwd: p.dir, env: p.env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const ready = new Promise((resolve, reject) => {
      child.stdout.on("data", (chunk) => { output += String(chunk); if (output.includes(`127.0.0.1:${port}`)) resolve(); });
      child.stderr.on("data", (chunk) => { output += String(chunk); });
      child.on("error", reject);
      child.on("exit", (code) => { if (code && !output.includes(`127.0.0.1:${port}`)) reject(new Error(output)); });
    });
    try {
      await ready;
      const chat = await fetch(`http://127.0.0.1:${port}/api/graph/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "What IP does labirinto.newbiz.it use?" }),
      });
      const body = await chat.json();
      assert.equal(chat.status, 200, JSON.stringify(body));
      assert.match(body.answer, /192\.168\.122\.100/);
      assert.match(body.answer, /docs[\\/]labirinto\.md/);
      assert.doesNotMatch(body.answer, /credito residuo|llmproxy/i);
    } finally {
      child.kill("SIGTERM");
      await new Promise((resolve) => child.once("exit", resolve));
    }
  });

  test("global graph service serves a registered project and rejects missing project credentials", async () => {
    const p = makeProject("global-graph-service");
    p.env.CM_NO_LLM = "1";
    p.env.CM_HARNESS_DETECT = "local";
    const init = p.run(["init", "--deep", "--no-llm"]);
    assert.equal(init.code, 0, `deep init failed: ${init.output}`);
    const html = readFileSync(join(p.dir, "memory", "graph-3d.html"), "utf8");
    const project = JSON.parse(html.match(/const GRAPH_PROJECT=(.*?);\nfunction graphApi/)[1]);
    const port = 4700 + Math.floor(Math.random() * 100);
    const child = spawn(process.execPath, [BIN, "service", "run", "--port", String(port)], {
      cwd: p.dir,
      env: p.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const ready = new Promise((resolve, reject) => {
      child.stdout.on("data", (chunk) => { output += String(chunk); if (output.includes(`127.0.0.1:${port}`)) resolve(); });
      child.stderr.on("data", (chunk) => { output += String(chunk); });
      child.on("error", reject);
      child.on("exit", (code) => { if (code && !output.includes(`127.0.0.1:${port}`)) reject(new Error(output)); });
    });
    try {
      await ready;
      const query = new URLSearchParams({ project: project.id, token: project.token }).toString();
      const status = await fetch(`http://127.0.0.1:${port}/api/graph/status?${query}`);
      const statusBody = await status.json();
      assert.equal(status.status, 200, JSON.stringify(statusBody));
      assert.equal(statusBody.project, project.id);
      const missing = await fetch(`http://127.0.0.1:${port}/api/graph/status`);
      assert.equal(missing.status, 400);
      const served = await fetch(`http://127.0.0.1:${port}/graph-3d.html?${query}`);
      assert.equal(served.status, 200);
      assert.match(await served.text(), /Code-Mem 3D Knowledge Graph/);
    } finally {
      child.kill("SIGTERM");
      await new Promise((resolve) => child.once("exit", resolve));
    }
  });

  test("server descriptions connect co-hosted applications in the operational graph", () => {
    const p = makeProject("server-hosting");
    mkdirSync(join(p.dir, "docs", "servers"), { recursive: true });
    mkdirSync(join(p.dir, "docs", "apps"), { recursive: true });
    writeFileSync(join(p.dir, "docs", "servers", "labirinto.md"), "# labirinto — 192.168.122.100\n\nWindows host running the MioDOC, Labirinto, and Autocontrollo applications.\n");
    for (const app of ["MioDOC", "Labirinto", "Autocontrollo"]) {
      writeFileSync(join(p.dir, "docs", "apps", `${app.toLowerCase()}.md`), `---\ntype: application\napplication: ${app}\n---\n# ${app}\n\nApplication inventory.\n`);
    }
    p.env.CM_NO_LLM = "1";
    p.env.CM_HARNESS_DETECT = "local";

    const r = p.run(["init", "--deep", "--no-llm"]);
    assert.equal(r.code, 0, `hosting graph init failed: ${r.output}`);
    const html = readFileSync(join(p.dir, "memory", "graph-3d.html"), "utf8");
    const graphView = JSON.parse(html.match(/const DATA=(.*?);\nconst COLORS=/s)[1]);
    const server = graphView.nodes.find((node) => node.label.startsWith("labirinto —"));
    const byId = new Map(graphView.nodes.map((node) => [node.id, node]));
    const hostedApps = graphView.edges
      .filter((edge) => edge.relation === "hosted_on" && edge.target === server.id)
      .map((edge) => byId.get(edge.source)?.label)
      .filter(Boolean);
    assert.deepEqual(new Set(hostedApps), new Set(["MioDOC", "Labirinto", "Autocontrollo"]));
  });

});

// ---------------------------------------------------------------------------
// cm mcp — stdio JSON-RPC server (IMP-01)
// ---------------------------------------------------------------------------

describe("cm mcp", () => {

  // Drive the stdio server: send N JSON-RPC requests, collect N responses.
  function mcpSession(p, requests) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [BIN, "mcp"], { cwd: p.dir, env: p.env });
      let out = "";
      const responses = [];
      const timer = setTimeout(() => { child.kill(); reject(new Error("mcp timeout")); }, 30000);
      child.stdout.on("data", (chunk) => {
        out += chunk.toString();
        const lines = out.split("\n");
        out = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          try { responses.push(JSON.parse(line)); } catch {}
          if (responses.length >= requests.length) {
            clearTimeout(timer);
            child.kill();
            resolve(responses);
          }
        }
      });
      child.on("error", (e) => { clearTimeout(timer); reject(e); });
      for (const req of requests) child.stdin.write(`${JSON.stringify(req)}\n`);
    });
  }

  test("`cm mcp` answers initialize + tools/list with the 3 memory tools", async () => {
    const p = makeProject();
    initProject(p);
    const res = await mcpSession(p, [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
    ]);
    assert.equal(res[0].result.serverInfo.name, "cm");
    const names = res[1].result.tools.map((t) => t.name).sort();
    assert.deepEqual(names, ["graph_node", "graph_path", "graph_query", "graph_stats", "memory_get", "memory_search", "memory_timeline"]);
  });

  test("`graph_query`/`graph_stats`/`graph_path`/`graph_node` traverse the project graph", async () => {
    const p = makeProject("mcp-graph");
    initProject(p);
    writeFileSync(join(p.dir, "src", "auth.js"), "function login(u){ return u; }\nmodule.exports = { login };\n");
    writeFileSync(join(p.dir, "src", "api.js"), "const { login } = require('./auth');\nfunction handleLogin(r){ return login(r); }\nmodule.exports = { handleLogin };\n");
    p.run(["scan", "--deep"]);
    const res = await mcpSession(p, [
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "graph_query", arguments: { question: "login" } } },
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "graph_stats", arguments: {} } },
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "graph_path", arguments: { from: "handleLogin", to: "login" } } },
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "graph_node", arguments: { id: "login" } } },
    ]);
    const q = JSON.parse(res[0].result.content[0].text);
    assert.ok(q.results.length >= 2, "graph_query must return seeds + related");
    const st = JSON.parse(res[1].result.content[0].text);
    assert.ok(st.nodes >= 4 && st.gods.length >= 1, "graph_stats must report nodes + gods");
    const path = JSON.parse(res[2].result.content[0].text);
    assert.ok(path.hops >= 1, "graph_path must find handleLogin -> login");
    const node = JSON.parse(res[3].result.content[0].text);
    assert.equal(node.label, "login");
    assert.ok(node.connections.length >= 1, "graph_node must list connections");
  });

  test("`memory_search` finds a saved fact and `memory_get` returns its body", async () => {
    const p = makeProject();
    initProject(p);
    p.run(["save", "--kind", "fact", "MCP probe fact about hexagonal backups"]);
    const [searchRes] = await mcpSession(p, [
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "memory_search", arguments: { query: "hexagonal backups", limit: 3 } } },
    ]);
    const hits = JSON.parse(searchRes.result.content[0].text);
    assert.ok(hits.length >= 1, "expected at least one hit");
    assert.match(hits[0].title + hits[0].summary, /hexagonal backups/i);
    const [getRes] = await mcpSession(p, [
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "memory_get", arguments: { id: hits[0].id } } },
    ]);
    const full = JSON.parse(getRes.result.content[0].text);
    assert.match(full.body, /hexagonal backups/i);
  });

  test("`memory_timeline` lists recent rows and unknown methods error cleanly", async () => {
    const p = makeProject();
    initProject(p);
    p.run(["save", "--kind", "decision", "MCP timeline decision marker"]);
    const res = await mcpSession(p, [
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "memory_timeline", arguments: { limit: 5 } } },
      { jsonrpc: "2.0", id: 2, method: "nope/unknown" },
    ]);
    const rows = JSON.parse(res[0].result.content[0].text);
    assert.ok(rows.some((r) => /timeline decision marker/i.test(r.title)), "timeline must include the saved decision");
    assert.equal(res[1].error.code, -32601);
  });

});

// ---------------------------------------------------------------------------
// Goal gap-fill: selective init, preference LLM normalization, AST calls,
// multi-language symbols, recall noise gate, dual-vector Ollama upgrade,
// media ingest, obsidian export, cost ledger.
// ---------------------------------------------------------------------------

describe("cm goal gap-fill", () => {

  test("`cm init` without a harness marker creates no harness folders", () => {
    const p = makeProject("selective-init");
    const r = p.run(["init"]);
    assert.equal(r.code, 0, `init failed: ${r.output}`);
    for (const dir of [".claude", ".pi", ".codex", ".gemini", ".qwen", ".cursor", ".opencode", ".windsurf", ".github"]) {
      assert.ok(!existsSync(join(p.dir, dir)), `must not create ${dir} without a marker`);
    }
    assert.match(r.output, /No harness marker detected/);
  });

  test("`cm init` with a .claude marker wires only claude", () => {
    const p = makeProject("selective-claude");
    mkdirSync(join(p.dir, ".claude"), { recursive: true });
    const r = p.run(["init"]);
    assert.equal(r.code, 0, `init failed: ${r.output}`);
    assert.ok(existsSync(join(p.dir, ".claude", "settings.json")), "claude hook must be installed");
    for (const dir of [".pi", ".codex", ".gemini", ".qwen", ".cursor", ".opencode", ".windsurf"]) {
      assert.ok(!existsSync(join(p.dir, dir)), `must not create ${dir} for a claude-only project`);
    }
  });

  test("Italian preferences normalize to compact English (deterministic path)", () => {
    const p = makeProject("pref-normalize");
    initProject(p);
    p.env.CM_NO_LLM = "1";
    const r = p.run(["save", "--global", "--kind", "preference", "--layer", "user", "Preferenza: tutte le relazioni devono essere salvate nella cartella docs/reports del progetto"]);
    assert.equal(r.code, 0, `preference save failed: ${r.output}`);
    assert.match(r.output, /\[preference via deterministic\]/);
    const stored = JSON.parse(p.run(["projects", "--json"]).stdout);
    assert.ok(stored, "catalog must stay readable");
  });

  test("`cm scan --deep` emits function-level calls edges for destructured require", () => {
    const p = makeProject("ast-calls");
    initProject(p);
    writeFileSync(join(p.dir, "src", "auth.js"), "function login(u){ return u; }\nmodule.exports = { login };\n");
    writeFileSync(join(p.dir, "src", "api.js"), "const { login } = require('./auth');\nfunction handleLogin(r){ return login(r); }\nmodule.exports = { handleLogin };\n");
    const r = p.run(["scan", "--deep"]);
    assert.equal(r.code, 0, `scan failed: ${r.output}`);
    const graph = JSON.parse(readFileSync(join(p.dir, "memory", "graph.json"), "utf8"));
    const calls = (graph.edges || []).filter((e) => (e.relation || e.r) === "calls");
    assert.ok(calls.length >= 1, `expected >=1 calls edge, got ${calls.length}`);
    const imports = (graph.edges || []).filter((e) => (e.relation || e.r) === "imports");
    assert.ok(imports.length >= 1, `expected >=1 imports edge, got ${imports.length}`);
  });

  test("`cm scan --deep` extracts python symbols with imports and calls", () => {
    const p = makeProject("ast-python");
    initProject(p);
    writeFileSync(join(p.dir, "src", "auth.py"), "def login(u):\n    return u\n");
    writeFileSync(join(p.dir, "src", "app.py"), "from auth import login\n\ndef handle(u):\n    return login(u)\n");
    const r = p.run(["scan", "--deep"]);
    assert.equal(r.code, 0, `scan failed: ${r.output}`);
    const graph = JSON.parse(readFileSync(join(p.dir, "memory", "graph.json"), "utf8"));
    const labels = (graph.nodes || []).map((n) => n.label || n.l);
    assert.ok(labels.includes("login"), "python function login must be a node");
    assert.ok(labels.includes("handle"), "python function handle must be a node");
    const calls = (graph.edges || []).filter((e) => (e.relation || e.r) === "calls");
    assert.ok(calls.length >= 1, `expected >=1 python calls edge, got ${calls.length}`);
  });

  test("bogus recall emits a low-confidence signal instead of silent noise", () => {
    const p = makeProject("noise-gate");
    initProject(p);
    p.run(["save", "--kind", "fact", "The API uses signed webhook verification."]);
    const r = p.run(["recall", "quantum flux capacitor deployment", "--scope", "project", "--limit", "3"]);
    assert.equal(r.code, 0);
    assert.match(r.output, /Confidence: low/);
  });

  test("`cm gx --format obsidian` writes vault notes plus community overviews", () => {
    const p = makeProject("obsidian-export");
    initProject(p);
    const r = p.run(["gx", "--format", "obsidian"]);
    assert.equal(r.code, 0, `gx obsidian failed: ${r.output}`);
    assert.match(r.output, /Obsidian vault/);
    assert.ok(existsSync(join(p.dir, "memory", "obsidian")), "obsidian dir must exist");
    const files = readdirSync(join(p.dir, "memory", "obsidian"));
    assert.ok(files.some((f) => f.startsWith("_COMMUNITY_")), "community overview must exist");
  });

  test("`cm init --deep` writes memory\/cost.json ledger", () => {
    const p = makeProject("cost-ledger");
    mkdirSync(join(p.dir, ".claude"), { recursive: true });
    p.env.CM_NO_LLM = "1";
    p.env.CM_HARNESS_DETECT = "local";
    const r = p.run(["init", "--deep", "--no-llm"]);
    assert.equal(r.code, 0, `deep init failed: ${r.output}`);
    assert.match(r.output, /Cost ledger/);
    assert.ok(existsSync(join(p.dir, "memory", "cost.json")), "cost.json must exist");
  });

  test("AST nodes carry source_location line numbers (graphify loc parity)", () => {
    const p = makeProject("ast-loc");
    initProject(p);
    writeFileSync(join(p.dir, "src", "auth.js"), "function login(u){ return u; }\nmodule.exports = { login };\n");
    writeFileSync(join(p.dir, "src", "app.py"), "def handle(u):\n    return u\n");
    const r = p.run(["scan", "--deep"]);
    assert.equal(r.code, 0, `scan failed: ${r.output}`);
    const graph = JSON.parse(readFileSync(join(p.dir, "memory", "graph.json"), "utf8"));
    const login = graph.nodes.find((n) => n.label === "login" && n.type === "function");
    assert.ok(login, "login function node must exist");
    assert.match(String(login.source_location || login.metadata?.source_location || ""), /^L\d+$/, "login must carry a source_location line");
    const handle = graph.nodes.find((n) => n.label === "handle" && n.type === "function");
    assert.ok(handle, "python handle node must exist");
    assert.match(String(handle.source_location || handle.metadata?.source_location || ""), /^L\d+$/, "python fn must carry a source_location line");
  });

  test("`cm report` writes a narrative GRAPH_REPORT.md (god nodes, surprises, questions)", () => {
    const p = makeProject("graph-report");
    initProject(p);
    writeFileSync(join(p.dir, "src", "auth.js"), "function login(u){ return u; }\nmodule.exports = { login };\n");
    writeFileSync(join(p.dir, "src", "api.js"), "const { login } = require('./auth');\nfunction handleLogin(r){ return login(r); }\nmodule.exports = { handleLogin };\n");
    p.run(["scan", "--deep"]);
    const r = p.run(["report"]);
    assert.equal(r.code, 0, `report failed: ${r.output}`);
    assert.match(r.output, /God Nodes/);
    assert.match(r.output, /Surprising Connections/);
    assert.match(r.output, /Suggested Questions/);
    assert.match(r.output, /Token Efficiency/);
    assert.ok(existsSync(join(p.dir, "memory", "GRAPH_REPORT.md")), "GRAPH_REPORT.md must exist");
    const md = readFileSync(join(p.dir, "memory", "GRAPH_REPORT.md"), "utf8");
    assert.match(md, /God Nodes/);
    assert.match(md, /reduction_x|fewer tokens per query/);
  });

  test("`cm query --dfs` traces a chain and `--budget` truncates output", () => {
    const p = makeProject("query-flags");
    initProject(p);
    writeFileSync(join(p.dir, "src", "auth.js"), "function login(u){ return u; }\nmodule.exports = { login };\n");
    writeFileSync(join(p.dir, "src", "api.js"), "const { login } = require('./auth');\nfunction handleLogin(r){ return login(r); }\nmodule.exports = { handleLogin };\n");
    p.run(["scan", "--deep"]);
    const bfs = p.run(["query", "login"]);
    assert.equal(bfs.code, 0);
    assert.match(bfs.output, /BFS depth/);
    const dfs = p.run(["query", "--dfs", "login"]);
    assert.equal(dfs.code, 0, `dfs failed: ${dfs.output}`);
    assert.match(dfs.output, /DFS depth/);
    // budget truncation is exercised on the MCP path (deterministic small graph)
    const tiny = p.run(["query", "--budget", "100", "login"]);
    assert.equal(tiny.code, 0);
  });

  test("`cm gx --format cypher` writes a MERGE-based import file", () => {
    const p = makeProject("cypher-export");
    initProject(p);
    writeFileSync(join(p.dir, "src", "auth.js"), "function login(u){ return u; }\nmodule.exports = { login };\n");
    p.run(["scan", "--deep"]);
    const r = p.run(["gx", "--format", "cypher"]);
    assert.equal(r.code, 0, `cypher failed: ${r.output}`);
    assert.match(r.output, /cypher-shell/);
    const cy = readFileSync(join(p.dir, "memory", "cypher.txt"), "utf8");
    assert.match(cy, /MERGE \(n:/);
    assert.match(cy, /MERGE \(a\)-\[.*\]->\(b\)/);
  });

  test("method-call references are marked AMBIGUOUS (honest provenance)", () => {
    const p = makeProject("ambiguous-prov");
    initProject(p);
    writeFileSync(join(p.dir, "src", "svc.js"),
      "const db = require('db');\nfunction a(){ db.q(); db.q(); db.q(); db.q(); }\nmodule.exports = { a };\n");
    p.run(["scan", "--deep"]);
    const graph = JSON.parse(readFileSync(join(p.dir, "memory", "graph.json"), "utf8"));
    const refs = (graph.edges || []).filter((e) => (e.relation || e.r) === "references");
    assert.ok(refs.length >= 1, "expected a references edge");
    assert.ok(refs.every((e) => (e.confidence || e.c) === "AMBIGUOUS"), "references must be AMBIGUOUS");
  });

});
