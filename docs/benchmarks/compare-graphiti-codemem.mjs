#!/usr/bin/env node
/**
 * Reproducible E2E comparison. Both systems receive the same corpus and the
 * same nine queries. Quality is scored from explicit expected answer terms;
 * no LLM judge is used, so a failed Graphiti run remains a failed run.
 */

import { execFile, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import net from "node:net";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(import.meta.dirname, "../..");
const datasetPath = resolve(import.meta.dirname, "graphiti-codemem-dataset.json");
const outputPath = process.env.BENCHMARK_OUTPUT
  ? resolve(process.env.BENCHMARK_OUTPUT)
  : resolve(repoRoot, "docs/comparisons/graphiti-vs-codemem-e2e-results.json");
const graphitiVenv = process.env.GRAPHITI_VENV || "/tmp/code-mem-graphiti-venv";
const repeats = 3;
const falkorPort = Number(process.env.FALKORDB_PORT || 6399);

function normalize(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function matchesExpected(text, expected) {
  const haystack = normalize(text);
  return expected.some((group) => group.every((term) => haystack.includes(normalize(term))));
}

function percentile(values, p) {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const index = Math.min(ordered.length - 1, Math.max(0, Math.ceil((p / 100) * ordered.length) - 1));
  return Number(ordered[index].toFixed(3));
}

function extractCodeMemRows(output) {
  const lines = String(output || "").split("\n");
  const rows = [];
  let current = [];
  for (const line of lines) {
    if (/^\[mem_[^\]]+\]/.test(line)) {
      if (current.length) rows.push(current.join("\n"));
      current = [line];
    } else if (current.length) {
      current.push(line);
    }
  }
  if (current.length) rows.push(current.join("\n"));
  return rows;
}

async function run(command, args, options = {}) {
  const started = performance.now();
  try {
    const result = await execFileAsync(command, args, { ...options, maxBuffer: 8 * 1024 * 1024 });
    return { ...result, elapsedMs: performance.now() - started, code: 0 };
  } catch (error) {
    return {
      stdout: error.stdout || "",
      stderr: error.stderr || error.message || "",
      elapsedMs: performance.now() - started,
      code: error.code ?? 1,
    };
  }
}

function waitForPort(host, port, timeoutMs = 30000) {
  return new Promise((resolvePromise, reject) => {
    const started = Date.now();
    const attempt = () => {
      const socket = net.createConnection({ host, port });
      socket.once("connect", () => { socket.destroy(); resolvePromise(); });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() - started >= timeoutMs) reject(new Error(`timeout waiting for ${host}:${port}`));
        else setTimeout(attempt, 250);
      });
    };
    attempt();
  });
}

async function waitForFalkor(host, port, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const probe = await run("redis-cli", ["-h", host, "-p", String(port), "GRAPH.QUERY", "codemem_probe", "RETURN 1"]);
    if (probe.code === 0 && !/unknown command|error/i.test(`${probe.stdout}\n${probe.stderr}`)) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error(`timeout waiting for FalkorDB graph module on ${host}:${port}`);
}

function summarizeQuery(query, runs) {
  const latencies = runs.map((run) => run.latency_ms).filter(Number.isFinite);
  const ranks = runs.map((run) => run.rank).filter(Number.isFinite);
  return {
    id: query.id,
    text: query.text,
    runs,
    hit_at_1: runs.filter((run) => run.rank === 1).length / runs.length,
    hit_at_3: runs.filter((run) => Number.isFinite(run.rank) && run.rank <= 3).length / runs.length,
    hit_at_8: runs.filter((run) => Number.isFinite(run.rank) && run.rank <= 8).length / runs.length,
    mrr: ranks.length ? ranks.reduce((sum, rank) => sum + (1 / rank), 0) / runs.length : 0,
    latency_ms: { p50: percentile(latencies, 50), p95: percentile(latencies, 95) },
  };
}

function summarizeSystem(querySummaries, ingestion) {
  const allRuns = querySummaries.flatMap((query) => query.runs);
  const latencies = allRuns.map((run) => run.latency_ms).filter(Number.isFinite);
  const average = (key) => querySummaries.reduce((sum, query) => sum + query[key], 0) / Math.max(1, querySummaries.length);
  return {
    queries: querySummaries.length,
    repeats_per_query: repeats,
    hit_at_1: Number(average("hit_at_1").toFixed(4)),
    hit_at_3: Number(average("hit_at_3").toFixed(4)),
    hit_at_8: Number(average("hit_at_8").toFixed(4)),
    mrr: Number(average("mrr").toFixed(4)),
    query_latency_ms: { p50: percentile(latencies, 50), p95: percentile(latencies, 95) },
    ingestion,
  };
}

async function main() {
  const dataset = JSON.parse(await readFile(datasetPath, "utf8"));
  const runRoot = await mkdtemp(join(tmpdir(), "code-mem-graphiti-e2e-"));
  const projectDir = join(runRoot, "project");
  const homeDir = join(runRoot, "home");
  await mkdir(projectDir, { recursive: true });
  await mkdir(homeDir, { recursive: true });
  const cmEnv = { ...process.env, HOME: homeDir, CM_BIN: resolve(repoRoot, "bin/cm") };
  const cmCommand = process.execPath;
  const cmArgs = (args) => [resolve(repoRoot, "bin/cm"), ...args];
  const codeMem = { system: "code-mem", status: "running", queries: [], errors: [], temp_root: runRoot };

  let init = await run(cmCommand, cmArgs(["init"]), { cwd: projectDir, env: cmEnv });
  if (init.code !== 0) codeMem.errors.push({ phase: "init", stderr: init.stderr });
  const ingestionLatencies = [];
  for (const memory of dataset.memories) {
    const started = performance.now();
    const saved = await run(cmCommand, cmArgs(["save", "--kind", memory.kind, memory.text]), { cwd: projectDir, env: cmEnv });
    ingestionLatencies.push(performance.now() - started);
    if (saved.code !== 0) codeMem.errors.push({ phase: "save", id: memory.id, stderr: saved.stderr });
  }
  codeMem.ingestion = {
    episodes: dataset.memories.length,
    latency_ms: { p50: percentile(ingestionLatencies, 50), p95: percentile(ingestionLatencies, 95), total: Number(ingestionLatencies.reduce((a, b) => a + b, 0).toFixed(3)) },
  };

  for (const query of dataset.queries) {
    const runs = [];
    for (let repeat = 0; repeat < repeats; repeat += 1) {
      const recalled = await run(cmCommand, cmArgs(["recall", query.text, "--mode", "hybrid", "--limit", "8", "--level", "3"]), { cwd: projectDir, env: cmEnv });
      const rows = extractCodeMemRows(recalled.stdout);
      const rank = rows.findIndex((row) => matchesExpected(row, query.expected));
      runs.push({ latency_ms: Number(recalled.elapsedMs.toFixed(3)), rank: rank >= 0 ? rank + 1 : null, hit: rank >= 0, rows });
      if (recalled.code !== 0) codeMem.errors.push({ phase: "recall", id: query.id, stderr: recalled.stderr });
    }
    codeMem.queries.push(summarizeQuery(query, runs));
  }
  codeMem.status = codeMem.errors.length ? "error" : "ok";

  const graphitiJson = join(runRoot, "graphiti.json");
  let dockerName = `codemem-graphiti-${process.pid}`;
  let dockerStarted = false;
  const graphitiEnv = { ...process.env, FALKORDB_PORT: String(falkorPort) };
  try {
    const docker = spawnSync("docker", ["run", "-d", "--rm", "--name", dockerName, "-p", `${falkorPort}:6379`, "falkordb/falkordb:latest"], { encoding: "utf8" });
    if (docker.status !== 0) {
      await writeFile(graphitiJson, JSON.stringify({ system: "graphiti", status: "error", errors: [{ type: "DockerStartError", message: docker.stderr || docker.stdout }] }, null, 2) + "\n");
    } else {
      dockerStarted = true;
      await waitForPort("127.0.0.1", falkorPort);
      await waitForFalkor("127.0.0.1", falkorPort);
      const graphiti = await run(join(graphitiVenv, "bin/python"), [resolve(import.meta.dirname, "graphiti_runner.py"), datasetPath, graphitiJson], { cwd: repoRoot, env: graphitiEnv });
      if (graphiti.code !== 0) {
        await writeFile(graphitiJson, JSON.stringify({ system: "graphiti", status: "error", errors: [{ type: "RunnerProcessError", message: graphiti.stderr || graphiti.stdout }] }, null, 2) + "\n");
      }
    }
  } catch (error) {
    await writeFile(graphitiJson, JSON.stringify({ system: "graphiti", status: "error", errors: [{ type: error.name, message: error.message }] }, null, 2) + "\n");
  } finally {
    if (dockerStarted) spawnSync("docker", ["stop", dockerName], { encoding: "utf8" });
  }

  const graphitiRaw = JSON.parse(await readFile(graphitiJson, "utf8"));
  const graphitiQueries = graphitiRaw.status === "ok"
    ? graphitiRaw.queries.map((query) => summarizeQuery(query, query.runs))
    : [];
  const result = {
    benchmark: "graphiti-vs-code-mem-e2e",
    dataset: dataset.name,
    corpus_size: dataset.memories.length,
    queries: dataset.queries.length,
    repeats_per_query: repeats,
    started_at: new Date().toISOString(),
    environment: {
      node: process.version,
      python: graphitiVenv,
      graphiti_package: "graphiti-core==0.30.2",
      graphiti_llm: process.env.GRAPHITI_MODEL || "llama3.1:8b",
      graphiti_embeddings: "local-hash-256",
      code_mem_command: resolve(repoRoot, "bin/cm"),
      graph_database: "FalkorDB Docker, isolated benchmark container",
    },
    code_mem: { ...codeMem, summary: summarizeSystem(codeMem.queries, codeMem.ingestion) },
    graphiti: { ...graphitiRaw, summary: graphitiRaw.status === "ok" ? summarizeSystem(graphitiQueries, graphitiRaw.ingestion) : null, queries: graphitiQueries },
    raw_paths: { graphiti: graphitiJson, code_mem_project: projectDir },
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({ output: outputPath, run_root: runRoot, code_mem: result.code_mem.summary, graphiti: result.graphiti.summary || result.graphiti.errors }, null, 2));
  if (codeMem.status !== "ok") process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
