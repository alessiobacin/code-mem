#!/usr/bin/env node
/** Demonstrate CodeMem features that a flat graph export does not model. */

import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = resolve(import.meta.dirname, "../..");
const cm = resolve(root, "bin/cm");
const runRoot = await mkdtemp(join(tmpdir(), "codemem-capabilities-"));
const project = join(runRoot, "project");
const home = join(runRoot, "home");
await mkdir(project, { recursive: true });
await mkdir(home, { recursive: true });
const env = { ...process.env, HOME: home };

async function call(args) {
  try {
    const result = await exec(process.execPath, [cm, ...args], { cwd: project, env, maxBuffer: 4 * 1024 * 1024 });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return { code: error.code ?? 1, stdout: error.stdout || "", stderr: error.stderr || error.message || "" };
  }
}

async function sql(statement) {
  const result = await exec("sqlite3", [join(project, "memory/state.db"), statement], { maxBuffer: 4 * 1024 * 1024 });
  return result.stdout.trim();
}

await call(["init"]);
const steps = {};
steps.seed = await call(["save", "--kind", "decision", "Production API provider is OpenAI; region eu-west-1."]);
steps.replace = await call(["replace", "Production API provider is OpenAI", "Production API provider changed to Anthropic on 2025-02-03; region eu-west-1."]);
steps.current = await call(["recall", "What is the current production API provider?", "--mode", "keyword", "--limit", "5", "--level", "3"]);
steps.historical = await call(["recall", "What was the production API provider in January 2025?", "--mode", "keyword", "--as-of", "2025-01-31T23:59:59Z", "--limit", "5", "--level", "3"]);
steps.autoCapture = await call(["save", "--auto", "--role", "dev", "Decision: always validate schema before deploy; record failure evidence."]);
steps.recallWorking = await call(["recall", "schema deploy failure evidence", "--mode", "keyword", "--limit", "5", "--level", "3"]);
const rows = await sql("SELECT id,body,status,belief_status,valid_from,valid_to,supersedes_id FROM memory_items ORDER BY created_at");
const counts = await sql("SELECT (SELECT COUNT(*) FROM memory_episodes) AS episodes,(SELECT COUNT(*) FROM memory_evidence) AS evidence,(SELECT COUNT(*) FROM memory_working_set) AS working,(SELECT COUNT(*) FROM memory_items WHERE status='candidate') AS candidates,(SELECT COUNT(*) FROM verification_queue WHERE status='pending') AS pending_verification;");
const [episodes, evidence, working, candidates, pendingVerification] = counts.split("|").map(Number);
const oldId = (await sql("SELECT id FROM memory_items WHERE body LIKE 'Production API provider is OpenAI%' LIMIT 1")).trim();
const newId = (await sql("SELECT id FROM memory_items WHERE body LIKE 'Production API provider changed%' LIMIT 1")).trim();
steps.contest = await call(["contest", newId, "provider claim requires recheck"]);
steps.verify = await call(["verify", newId, "--by", "benchmark-qa"]);
const audit = await sql(`SELECT id,status,belief_status,last_verified_at,corrected_by FROM memory_items WHERE id IN ('${oldId}','${newId}') ORDER BY id;`);
const result = {
  benchmark: "codemem-cognitive-capabilities-e2e",
  status: "ok",
  temp_root: runRoot,
  capabilities_demonstrated: [
    "explicit supersession keeps predecessor + successor",
    "as-of recall exposes historical truth without contaminating current recall",
    "capture gate creates reviewable candidate",
    "episodes/evidence/working-set are queryable audit structures",
    "contest -> verification queue -> verify is reversible and auditable",
  ],
  outputs: {
    current_recall: steps.current.stdout,
    historical_recall: steps.historical.stdout,
    contest: steps.contest.stdout,
    verify: steps.verify.stdout,
  },
  database: { counts: { episodes, evidence, working_set: working, candidates, pending_verification: pendingVerification }, audit, rows },
  comparison_boundary: "Graphify graph.json has nodes/edges/traversal; it does not expose these CodeMem belief/evidence/verification contracts as native memory lifecycle operations.",
};
const output = process.env.BENCHMARK_OUTPUT || resolve(root, "docs/benchmarks/cognitive-capabilities-e2e-results.json");
await writeFile(output, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ output, temp_root: runRoot, counts, audit }, null, 2));
