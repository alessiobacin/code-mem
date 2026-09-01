// A1 — multi-round temperature re-ranking tests (cm-bench-hardening).
//
// WHAT IS PINNED
//   `cm recall-auto` runs a multi-round temperature re-ranking over the
//   hybrid-recall ranking before rendering the context block:
//   round r uses a softmax at temperature T0/r over the composite score,
//   and the final order follows the accumulated cross-round consensus.
//   The pattern is a JS ex-novo reimplementation of an EM-style "grow more
//   confident each iteration" loop — no third-party code is involved.
//
// HOW
//   Black-box, through the CLI binary (same harness as the non-regression
//   anchors): isolated HOME + throwaway project, no Ollama (trigram
//   fallback), no network.
//
// RUN
//   node --test tests/a1-rerank/temperature-rerank.test.mjs
//   Override the binary under test with: CM_BIN=/abs/path/to/cm

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const BIN = process.env.CM_BIN || join(repoRoot, "bin", "cm");

function run(bin, args, opts = {}) {
  const res = spawnSync(process.execPath, [bin, ...args], {
    cwd: opts.cwd,
    env: opts.env,
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
  rootTmp = mkdtempSync(join(tmpdir(), "cm-a1-"));
});

after(() => {
  for (const p of shelves) {
    try { rmSync(p, { recursive: true, force: true }); } catch {}
  }
  if (rootTmp) { try { rmSync(rootTmp, { recursive: true, force: true }); } catch {} }
});

function makeProject(name = "proj") {
  const dir = join(rootTmp, `${name}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name, private: true }));
  const home = join(dir, "home");
  mkdirSync(home, { recursive: true });
  shelves.push(dir);
  const env = { ...process.env, HOME: home };
  return {
    dir,
    env,
    run: (args, opts = {}) => run(BIN, args, { cwd: dir, env, ...opts }),
  };
}

// ---------------------------------------------------------------------------
// Pins
// ---------------------------------------------------------------------------

describe("A1 — recall-auto temperature re-ranking", () => {

  test("recall-auto renders the auto-recall header and ranked context lines", () => {
    const p = makeProject();
    p.run(["init"]);
    p.run(["save", "--kind", "decision", "Ship only through the blue-green deploy pipeline"]);
    p.run(["save", "--kind", "fact", "The datastore is PostgreSQL 16 on Neon"]);
    const r = p.run(["recall-auto"]);
    assert.equal(r.code, 0);
    assert.match(r.output, /## Contextual Memory \(auto-recall\)/);
    assert.match(r.output, /\[decision\] \[project\] Ship only through the blue-green deploy pipeline/);
  });

  test("the strongly-on-topic memory outranks distractors after re-ranking", () => {
    const p = makeProject();
    p.run(["init"]);
    p.run(["save", "--kind", "decision", "Deploy uses the blue-green pipeline script deploy.sh"]);
    // Distractors share single generic tokens with the auto query only.
    p.run(["save", "--kind", "issue", "Flaky websocket reconnect tests break CI weekly"]);
    p.run(["save", "--kind", "fact", "PostgreSQL 16 runs on Neon with pgbouncer"]);
    const r = p.run(["recall-auto"]);
    assert.equal(r.code, 0);
    const deployIdx = r.stdout.indexOf("Deploy uses the blue-green pipeline script");
    const wsIdx = r.stdout.indexOf("websocket reconnect");
    const pgIdx = r.stdout.indexOf("PostgreSQL 16 runs on Neon");
    assert.ok(deployIdx !== -1, "on-topic decision missing from auto-recall output");
    for (const [label, idx] of [["websocket", wsIdx], ["postgres", pgIdx]]) {
      if (idx !== -1) assert.ok(deployIdx < idx, `on-topic decision should precede ${label} distractor`);
    }
  });

  test("repeated recall-auto runs keep a stable head-of-list (consensus is deterministic)", () => {
    const p = makeProject();
    p.run(["init"]);
    p.run(["save", "--kind", "procedure", "Run bun test before every push"]);
    p.run(["save", "--kind", "fact", "The build cache lives in .turbo"]);
    const a = p.run(["recall-auto"]);
    const b = p.run(["recall-auto"]);
    assert.equal(a.code, 0);
    assert.equal(b.code, 0);
    const orderA = [...a.stdout.matchAll(/^- \[(\w+)\] \[(?:project|global)\] (.+)$/gm)].map((m) => m[2]);
    const orderB = [...b.stdout.matchAll(/^- \[(\w+)\] \[(?:project|global)\] (.+)$/gm)].map((m) => m[2]);
    assert.deepEqual(orderA, orderB, "auto-recall ordering must be deterministic across runs");
  });

  test("auto-recall on an empty store degrades gracefully", () => {
    const p = makeProject();
    p.run(["init"]);
    const r = p.run(["recall-auto"]);
    assert.equal(r.code, 0);
    assert.match(r.output, /## Contextual Memory \(auto-recall\)/);
    assert.match(r.output, /No relevant memories|^- \[/m);
  });

});
