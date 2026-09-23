// A4 — store-open robustness.
//
// WHAT IS PINNED
//   1. A SQLite build without FTS5 (e.g. Node 22.12) makes cm create memory_fts
//   and messages_fts as plain tables. Opening the same store later with an
//   FTS5-capable Node must replace them with real FTS5 indexes (both are
//   derived data), otherwise `CREATE VIRTUAL TABLE IF NOT EXISTS` is a no-op
//   and full-text search silently degrades to LIKE forever.
//   2. Opening a store while another process holds a write lock waits
//      (busy_timeout is set before any locking pragma) instead of failing
//      with "database is locked".
//
// HOW
//   Build a store with cm, swap both indexes for the plain fallback tables,
//   reopen with cm, then MATCH directly. (1) is skipped when this Node has no FTS5.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const BIN = process.env.CM_BIN || join(repoRoot, "bin", "cm");

const hasFts5 = (() => {
  try { new DatabaseSync(":memory:").exec("CREATE VIRTUAL TABLE t USING fts5(x)"); return true; } catch { return false; }
})();

let rootTmp;
before(() => { rootTmp = mkdtempSync(join(tmpdir(), "cm-a4-")); });
after(() => { try { rmSync(rootTmp, { recursive: true, force: true }); } catch {} });

describe("A4 store open", () => {
  test("plain fallback FTS tables become FTS5 on next open", { skip: !hasFts5 && "SQLite build without FTS5" }, () => {
    const project = join(rootTmp, "project");
    const home = join(rootTmp, "home");
    mkdirSync(project, { recursive: true });
    mkdirSync(home, { recursive: true });
    const env = { ...process.env, HOME: home, CM_NO_OLLAMA: "1" };
    const cm = (...args) => spawnSync(process.execPath, [BIN, ...args], { cwd: project, env, encoding: "utf-8", timeout: 60000 });
    assert.equal(cm("init").status, 0);
    assert.equal(cm("save", "--kind", "fact", "Database uses Postgres for storage.").status, 0);

    const dbPath = join(project, "memory", "state.db");
    let d = new DatabaseSync(dbPath);
    d.exec(`
      DROP TRIGGER IF EXISTS memory_fts_ai; DROP TRIGGER IF EXISTS memory_fts_au; DROP TRIGGER IF EXISTS memory_fts_ad;
      DROP TRIGGER IF EXISTS messages_ai; DROP TRIGGER IF EXISTS messages_ad;
      DROP TABLE memory_fts; DROP TABLE messages_fts;
      CREATE TABLE memory_fts(id TEXT PRIMARY KEY,title TEXT,body TEXT,summary TEXT,tags TEXT,kind TEXT);
      CREATE TABLE messages_fts(rowid INTEGER PRIMARY KEY, role TEXT, content TEXT, session_id TEXT, timestamp TEXT);
      INSERT INTO messages(session_id,role,content,timestamp) VALUES('s1','user','Kubernetes rollout notes','2026-01-01T00:00:00Z');
    `);
    d.close();

    assert.equal(cm("recall", "Postgres").status, 0);

    d = new DatabaseSync(dbPath);
    const memHits = d.prepare("SELECT COUNT(*) AS c FROM memory_fts WHERE memory_fts MATCH ?").get("Postgres").c;
    const msgHits = d.prepare("SELECT COUNT(*) AS c FROM messages_fts WHERE messages_fts MATCH ?").get("Kubernetes").c;
    d.close();
    assert.ok(memHits >= 1, "memory_fts must be a populated FTS5 index");
    assert.equal(msgHits, 1, "messages_fts must be an FTS5 index rebuilt from messages");
  });

  test("cm waits for a concurrent writer instead of failing with database is locked", () => {
    const project = join(rootTmp, "busy");
    const home = join(rootTmp, "busy-home");
    mkdirSync(project, { recursive: true });
    mkdirSync(home, { recursive: true });
    const env = { ...process.env, HOME: home, CM_NO_OLLAMA: "1" };
    const cm = (...args) => spawnSync(process.execPath, [BIN, ...args], { cwd: project, env, encoding: "utf-8", timeout: 60000 });
    assert.equal(cm("init").status, 0);
    const dbPath = join(project, "memory", "state.db");
    const holder = `
      const d = new (require("node:sqlite").DatabaseSync)(process.argv[1]);
      d.exec("BEGIN EXCLUSIVE"); process.stdout.write("locked\\n");
      setTimeout(() => { d.exec("COMMIT"); d.close(); }, 1500);
    `;
    const script = `
      const { spawn, spawnSync } = require("node:child_process");
      const h = spawn(process.execPath, ["--experimental-sqlite", "-e", ${JSON.stringify(holder)}, ${JSON.stringify(dbPath)}]);
      h.stdout.once("data", () => {
        const r = spawnSync(process.execPath, [${JSON.stringify(BIN)}, "save", "--kind", "fact", "Busy writer anchor."], { cwd: ${JSON.stringify(project)}, env: process.env, encoding: "utf-8" });
        process.stdout.write(JSON.stringify({ status: r.status, err: r.stderr }));
      });
    `;
    const out = spawnSync(process.execPath, ["-e", script], { env, encoding: "utf-8", timeout: 60000 });
    const res = JSON.parse(out.stdout);
    assert.equal(res.status, 0, res.err);
  });
});
