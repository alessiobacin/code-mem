import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const BIN = join(repoRoot, "bin", "cm");

function run(project, args, input = "") {
  const result = spawnSync(process.execPath, [BIN, ...args], {
    cwd: project.dir,
    env: project.env,
    input,
    encoding: "utf8",
    timeout: 60000,
  });
  return { ...result, output: `${result.stdout || ""}\n${result.stderr || ""}` };
}

function dbQuery(project, sql, ...params) {
  const script = `
    const { DatabaseSync } = require("node:sqlite");
    const d = new DatabaseSync(process.argv[1]);
    // hooks spawn a background graph refresh that may still be writing
    d.exec("PRAGMA busy_timeout=30000");
    const row = d.prepare(process.argv[2]).get(...JSON.parse(process.argv[3] || "[]"));
    console.log(JSON.stringify(row || null));
    d.close();
  `;
  const result = spawnSync(process.execPath, ["--experimental-sqlite", "-e", script, join(project.dir, "memory", "state.db"), sql, JSON.stringify(params)], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout.trim() || "null");
}

// Node 22.12's bundled SQLite lacks FTS5; cm then falls back to LIKE search.
const HAS_FTS5 = spawnSync(process.execPath, ["--experimental-sqlite", "-e",
  'new (require("node:sqlite").DatabaseSync)(":memory:").exec("CREATE VIRTUAL TABLE t USING fts5(x)")'],
  { stdio: "ignore" }).status === 0;

function makeProject(name = "cognitive") {
  const dir = join(rootTmp, `${name}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name, private: true }));
  writeFileSync(join(dir, "src", "index.js"), "export const x = 1;\n");
  const home = join(dir, "home");
  mkdirSync(home, { recursive: true });
  const env = { ...process.env, HOME: home };
  return { dir, home, env };
}

let rootTmp;
let projects = [];

before(() => { rootTmp = mkdtempSync(join(tmpdir(), "cm-cognitive-")); });
after(() => {
  for (const project of projects) {
    try { rmSync(project.dir, { recursive: true, force: true }); } catch {}
  }
  try { rmSync(rootTmp, { recursive: true, force: true }); } catch {}
});

describe("cognitive memory T0", () => {
  test("stores episodes/evidence and repairs FTS retrieval", () => {
    const project = makeProject("evidence");
    projects.push(project);
    const init = run(project, ["init"]);
    assert.equal(init.status, 0, init.output);
    const saved = run(project, ["save", "--kind", "fact", "Database uses Postgres for transactional storage"]);
    assert.equal(saved.status, 0, saved.output);
    const episodes = dbQuery(project, "SELECT COUNT(*) AS c FROM memory_episodes WHERE source_type='manual'");
    const evidence = dbQuery(project, "SELECT COUNT(*) AS c FROM memory_evidence WHERE relation='supports'");
    assert.ok(Number(episodes.c) >= 1);
    assert.ok(Number(evidence.c) >= 1);
    if (HAS_FTS5) {
      const fts = dbQuery(project, "SELECT COUNT(*) AS c FROM memory_fts WHERE memory_fts MATCH ?", 'Postgres');
      assert.ok(Number(fts.c) >= 1);
    }
    const recall = run(project, ["recall", "Postgres transactional storage", "--mode", "keyword"]);
    assert.equal(recall.status, 0, recall.output);
    assert.match(recall.stdout, /Database uses Postgres/);
  });

  test("replace preserves the predecessor and makes a current successor", () => {
    const project = makeProject("successor");
    projects.push(project);
    assert.equal(run(project, ["init"]).status, 0);
    assert.equal(run(project, ["save", "--kind", "fact", "The service uses Postgres in production"]).status, 0);
    const old = dbQuery(project, "SELECT id,observed_at FROM memory_items WHERE body LIKE '%Postgres in production%' ORDER BY created_at DESC LIMIT 1");
    assert.ok(old?.id);
    const replaced = run(project, ["replace", "Postgres", "The service uses SQLite in production"]);
    assert.equal(replaced.status, 0, replaced.output);
    const predecessor = dbQuery(project, "SELECT status,belief_status,valid_to FROM memory_items WHERE id=?", old.id);
    const successor = dbQuery(project, "SELECT id,status,belief_status,supersedes_id FROM memory_items WHERE body LIKE '%SQLite in production%' LIMIT 1");
    assert.equal(predecessor.status, "corrected");
    assert.equal(predecessor.belief_status, "superseded");
    assert.ok(predecessor.valid_to);
    assert.equal(successor.status, "active");
    assert.equal(successor.belief_status, "accepted");
    assert.equal(successor.supersedes_id, old.id);
    const historical = run(project, ["history", "--as-of", old.observed_at, "--limit", "20"]);
    assert.equal(historical.status, 0, historical.output);
    assert.match(historical.stdout, /Postgres in production/);
    const current = run(project, ["recall", "production service", "--mode", "keyword"]);
    assert.equal(current.status, 0, current.output);
    assert.match(current.stdout, /SQLite in production/);
    assert.doesNotMatch(current.stdout, /The service uses Postgres in production/);
  });

  test("automatic capture gates durable input into a reviewable candidate", () => {
    const project = makeProject("gate");
    projects.push(project);
    assert.equal(run(project, ["init"]).status, 0);
    const hook = run(project, ["hook", "--event", "turn_end"], JSON.stringify({ last_assistant_message: "We decided to use SQLite for the local cache" }));
    assert.equal(hook.status, 0, hook.output);
    const episode = dbQuery(project, "SELECT gate_decision,gate_reason,processing_state FROM memory_episodes WHERE content LIKE '%SQLite for the local cache%' LIMIT 1");
    const candidate = dbQuery(project, "SELECT status,belief_status,kind FROM memory_items WHERE body LIKE '%SQLite for the local cache%' LIMIT 1");
    assert.equal(episode.gate_decision, "CREATE_CANDIDATE");
    assert.equal(episode.gate_reason, "durable_signal");
    assert.equal(candidate.status, "candidate");
    assert.equal(candidate.belief_status, "candidate");
    const sleep = run(project, ["consolidate"]);
    assert.equal(sleep.status, 0, sleep.output);
    assert.match(sleep.stdout, /processed/);
    const accepted = run(project, ["consolidate", "--accept-candidates"]);
    assert.equal(accepted.status, 0, accepted.output);
    const promoted = dbQuery(project, "SELECT status,belief_status FROM memory_items WHERE body LIKE '%SQLite for the local cache%' LIMIT 1");
    assert.equal(promoted.status, "active");
    assert.equal(promoted.belief_status, "tentative");
    const runLedger = dbQuery(project, "SELECT status,processed_count FROM consolidation_runs ORDER BY started_at DESC LIMIT 1");
    assert.equal(runLedger.status, "completed");
    assert.ok(Number(runLedger.processed_count) >= 1);
  });

  test("contest and verify are reversible and auditable", () => {
    const project = makeProject("verify");
    projects.push(project);
    assert.equal(run(project, ["init"]).status, 0);
    assert.equal(run(project, ["save", "--kind", "fact", "The API listens on port 4310"]).status, 0);
    const id = dbQuery(project, "SELECT id FROM memory_items WHERE body LIKE '%port 4310%' LIMIT 1").id;
    const contested = run(project, ["contest", id, "port changed in deployment"]);
    assert.equal(contested.status, 0, contested.output);
    const queue = dbQuery(project, "SELECT status,reason FROM verification_queue WHERE memory_id=? ORDER BY id DESC LIMIT 1", id);
    assert.equal(queue.status, "pending");
    assert.equal(queue.reason, "port changed in deployment");
    const hidden = run(project, ["recall", "API port", "--mode", "keyword"]);
    assert.doesNotMatch(hidden.stdout, /port 4310/);
    const verified = run(project, ["verify", id, "--by", "release-check"]);
    assert.equal(verified.status, 0, verified.output);
    const state = dbQuery(project, "SELECT status,belief_status,last_verified_at FROM memory_items WHERE id=?", id);
    assert.equal(state.status, "active");
    assert.equal(state.belief_status, "accepted");
    assert.ok(state.last_verified_at);
    const visible = run(project, ["recall", "API port", "--mode", "keyword"]);
    assert.match(visible.stdout, /port 4310/);
  });

  test("compacts memory text and rejects provider transport noise", () => {
    const project = makeProject("compact");
    projects.push(project);
    assert.equal(run(project, ["init"]).status, 0);
    const noise = run(project, ["save", "[llmp] provider: bacin-m13c | model: noisy"]);
    assert.equal(noise.status, 0, noise.output);
    assert.match(noise.stdout, /Ignored memory noise/);
    const saved = run(project, ["save", "Sure, it is important to note that there are durable facts in order to test."]);
    assert.equal(saved.status, 0, saved.output);
    const body = dbQuery(project, "SELECT body FROM memory_items WHERE body LIKE '%durable facts%' LIMIT 1").body;
    assert.equal(body, "durable facts to test.");
    const noiseCount = dbQuery(project, "SELECT COUNT(*) AS c FROM memory_items WHERE body LIKE '[llmp] provider%'");
    assert.equal(Number(noiseCount.c), 0);
  });
});
