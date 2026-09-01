// A2b — stale-lock recovery tests for `cm watch` (.watch.lock).
//
// WHAT IS PINNED
//   If a previous watcher crashed leaving a stale .watch.lock (PID recorded in
//   the file is dead), a new `cm watch` run must recover: remove the stale
//   lock and start. If the recorded PID is alive, the run must still refuse
//   (busy). A malformed/empty PID is treated as stale.
//
// HOW
//   The bundle's acquireLock is evaluated from the shipped bin/cm source
//   (no copy of the logic), against a temp cwd with a handcrafted .watch.lock.
//   Only fs/path/os helpers the function actually uses are provided.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, openSync, writeSync, closeSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const BIN = process.env.CM_BIN || join(repoRoot, "bin", "cm");
const bundleSource = (await import("node:fs")).readFileSync(BIN, "utf-8");

let rootTmp;
before(() => { rootTmp = mkdtempSync(join(tmpdir(), "cm-a2b-")); });
after(() => { try { rmSync(rootTmp, { recursive: true, force: true }); } catch {} });

function extractFunction(name) {
  const start = bundleSource.indexOf(`function ${name}(`);
  assert.ok(start !== -1, `function ${name} must exist in the bundle`);
  const next = bundleSource.indexOf("\nfunction ", start + 1);
  return bundleSource.slice(start, next === -1 ? bundleSource.length : next);
}

function loadAcquireLock() {
  const isProcessAlive = extractFunction("isProcessAlive");
  const acquireLock = extractFunction("acquireLock");
  const src = `
    const readFileSync = __readFileSync;
    const openSync = __openSync;
    const writeSync = __writeSync;
    const closeSync = __closeSync;
    const unlinkSync = __unlinkSync;
    const rd = (p) => readFileSync(p, "utf-8");
    const mp = (cwd, name) => join(cwd, name);
    ${isProcessAlive}
    ${acquireLock}
    return acquireLock;
  `;
  // eslint-disable-next-line no-new-func
  const fn = new Function("join", "__readFileSync", "__openSync", "__writeSync", "__closeSync", "__unlinkSync", src)(
    join, readFileSync, openSync, writeSync, closeSync, unlinkSync
  );
  return fn;
}

function makeDir() {
  const dir = join(rootTmp, `lock-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeLock(dir, content) {
  writeFileSync(join(dir, ".watch.lock"), content, "utf-8");
}


describe("A2b — stale-lock recovery (evaluated from the shipped bundle)", () => {
  const acquireLock = loadAcquireLock();

  test("no lock present → acquired, release removes the file", () => {
    const dir = makeDir();
    const release = acquireLock(dir);
    assert.ok(typeof release === "function", "must acquire when no lock exists");
    assert.ok(existsSync(join(dir, ".watch.lock")));
    release();
    assert.ok(!existsSync(join(dir, ".watch.lock")), "release must remove the lock");
  });

  test("stale lock with dead pid → recovered and acquired", () => {
    const dir = makeDir();
    writeLock(dir, "3999999"); // pid almost certainly not running
    const release = acquireLock(dir);
    assert.ok(typeof release === "function", "stale lock must be recovered");
    assert.equal(readFileSync(join(dir, ".watch.lock"), "utf-8"), String(process.pid), "new lock must record our pid");
    release();
  });

  test("live lock (our own pid is alive) → refused", () => {
    const dir = makeDir();
    writeLock(dir, String(process.pid));
    const release = acquireLock(dir);
    assert.equal(release, null, "live holder must still be respected");
  });

  test("malformed pid content → treated as stale and recovered", () => {
    const dir = makeDir();
    writeLock(dir, "not-a-pid");
    const release = acquireLock(dir);
    assert.ok(typeof release === "function", "malformed pid must be treated as stale");
    release();
  });

  test("empty lock file → treated as stale and recovered", () => {
    const dir = makeDir();
    writeLock(dir, "");
    const release = acquireLock(dir);
    assert.ok(typeof release === "function", "empty pid must be treated as stale");
    release();
  });
});
