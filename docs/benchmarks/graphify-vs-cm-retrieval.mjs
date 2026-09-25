#!/usr/bin/env node
// Retrieval benchmark: graphify vs code-mem on real repositories.
//
// Usage: node graphify-vs-cm-retrieval.mjs <repoDir> [--home DIR] [--hand FILE.json] [--out FILE.json]
// The repo must already be indexed by both tools (graphify update . ;
// cm init --deep --no-llm). Question sets:
//   A code-comment: a function's leading comment is the question, its file the
//     answer (automatic, neither tool is tuned on it)
//   C doc-sentence: the first prose sentence of a Markdown file is the
//     question, the file the answer (automatic)
//   B hand-written questions with gold files (--hand)
// A hit = the gold path appears in the tool's output. MRR ranks by the first
// output line that mentions the gold path. Tokens = output chars / 4.

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";

const args = process.argv.slice(2);
const repo = args[0];
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const home = opt("--home", process.env.HOME);
const handFile = opt("--hand", null);
const outFile = opt("--out", null);
const CM = opt("--cm", "cm");
const BUDGET = Number(opt("--budget", 2000));
const PER_SET = Number(opt("--per-set", 25));

function files(dir, keep) {
  const out = [];
  const skip = new Set(["node_modules", ".git", "memory", "graphify-out", "dist", "build", "coverage", ".claude", ".pi", ".codex", ".agents", ".github"]);
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (skip.has(e.name)) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (keep(p)) out.push(relative(dir, p));
    }
  };
  walk(dir);
  return out.sort();
}

// deterministic spread sample
const sample = (list, n) => list.length <= n ? list : Array.from({ length: n }, (_, i) => list[Math.floor((i * list.length) / n)]);
const words = (s) => s.split(/\s+/).filter(Boolean).length;

function codeCommentSet() {
  const qs = [];
  for (const f of files(repo, (p) => /\.(?:[cm]?js|ts|tsx|py)$/.test(p) && !/(^|\/)(tests?|e2e|__tests__)\/|\.test\.|\.spec\./.test(p))) {
    const lines = readFileSync(join(repo, f), "utf8").split("\n");
    lines.forEach((line, i) => {
      if (!/^\s*(export\s+)?(async\s+)?function\s+\w+|^\s*(export\s+)?(const|let)\s+\w+\s*=\s*(async\s*)?\(|^\s*def\s+\w+/.test(line)) return;
      const comment = [];
      for (let j = i - 1; j >= 0 && /^\s*(\/\/|\*|\/\*\*|#)/.test(lines[j]); j -= 1) comment.unshift(lines[j].replace(/^\s*(\/\/+|\/\*\*|\*\/?|#)\s?/, "").trim());
      const text = comment.join(" ").replace(/\s+/g, " ").replace(/ponytail:.*$/i, "").trim();
      if (words(text) >= 6) qs.push({ q: text.split(/(?<=[.!?])\s/)[0].slice(0, 220), gold: [f] });
    });
  }
  return sample(qs, PER_SET);
}

function docSentenceSet() {
  const qs = [];
  for (const f of files(repo, (p) => /\.md$/i.test(p))) {
    const body = readFileSync(join(repo, f), "utf8").replace(/^---[\s\S]*?---/, "").replace(/```[\s\S]*?```/g, "");
    const para = body.split(/\n\s*\n/).map((p) => p.replace(/\s+/g, " ").trim()).find((p) => !/^[#>|\-*!<\d]/.test(p) && words(p) >= 8);
    if (para) qs.push({ q: para.split(/(?<=[.!?])\s/)[0].replace(/[*_`[\]]/g, "").slice(0, 220), gold: [f] });
  }
  return sample(qs, PER_SET);
}

const env = { ...process.env, HOME: home, CM_NO_OLLAMA: "1", CM_NO_NOTIFY: "1", CM_LLM_HARNESS: "none" };
const systems = {
  graphify: (q) => ["graphify", ["query", q, "--budget", String(BUDGET)]],
  "cm-query": (q) => [CM, ["query", q, "--budget", String(BUDGET)]],
  "cm-recall": (q) => [CM, ["recall", q, "--limit", "8"]],
};

// Every repository file, longest first, to read which files an answer cites.
const ALL = files(repo, () => true).sort((a, b) => b.length - a.length);
function citedFiles(out) {
  const order = [];
  for (const line of out.split("\n")) {
    let rest = line;
    for (const f of ALL) {
      if (!rest.includes(f)) continue;
      if (!order.includes(f)) order.push(f);
      rest = rest.split(f).join(" ");
    }
  }
  return order;
}

function ask(system, q) {
  const [bin, argv] = systems[system](q);
  const t0 = performance.now();
  const r = spawnSync(bin, argv, { cwd: repo, env, encoding: "utf8", timeout: 120000 });
  return { out: `${r.stdout || ""}`, ms: performance.now() - t0 };
}

function run(system, question) {
  const { out, ms } = ask(system, question.q);
  const cited = citedFiles(out);
  const rank = cited.findIndex((f) => question.gold.includes(f));
  return { rank, rr: rank >= 0 ? 1 / (rank + 1) : 0, tokens: Math.round(out.length / 4), ms: Math.round(ms), cited: cited.length };
}

const sets = { "A code-comment": codeCommentSet(), "C doc-sentence": docSentenceSet() };
if (handFile) sets["B hand-written"] = JSON.parse(readFileSync(handFile, "utf8"));

// Chance level: files a system cites for a meaningless question (hub bias).
const baseline = Object.fromEntries(Object.keys(systems).map((system) => [system, citedFiles(ask(system, "zqxv blorft quenz").out)]));
const report = { repo, budget: BUDGET, date: new Date().toISOString(), sets: {} };
for (const [name, questions] of Object.entries(sets)) {
  report.sets[name] = { n: questions.length, systems: {}, misses: {} };
  for (const system of Object.keys(systems)) {
    const rows = questions.map((q) => ({ q, ...run(system, q) }));
    const n = rows.length || 1;
    const med = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)] || 0;
    const at = (k) => +(rows.filter((r) => r.rank >= 0 && r.rank < k).length / n).toFixed(3);
    const chance = +(questions.filter((q) => baseline[system].slice(0, 5).some((f) => q.gold.includes(f))).length / n).toFixed(3);
    report.sets[name].systems[system] = {
      hit1: at(1), hit3: at(3), hit5: at(5), hit_any: at(Infinity), chance5: chance,
      mrr: +(rows.reduce((s, r) => s + r.rr, 0) / n).toFixed(3),
      files_cited_median: med(rows.map((r) => r.cited)),
      tokens_median: med(rows.map((r) => r.tokens)),
      ms_median: med(rows.map((r) => r.ms)),
    };
    report.sets[name].misses[system] = rows.filter((r) => r.rank < 0 || r.rank >= 5).map((r) => r.q.q).slice(0, 5);
  }
}
const json = JSON.stringify(report, null, 2);
if (outFile) writeFileSync(outFile, json);
for (const [name, set] of Object.entries(report.sets)) {
  console.log(`\n${name} (n=${set.n})`);
  const pct = (x) => `${(x * 100).toFixed(0).padStart(3)}%`;
  for (const [system, m] of Object.entries(set.systems)) console.log(`  ${system.padEnd(10)} @1 ${pct(m.hit1)} @3 ${pct(m.hit3)} @5 ${pct(m.hit5)} any ${pct(m.hit_any)} | chance@5 ${pct(m.chance5)} | MRR ${m.mrr.toFixed(2)} | files ${String(m.files_cited_median).padStart(3)} | tokens ${String(m.tokens_median).padStart(5)} | ${m.ms_median} ms`);
}
