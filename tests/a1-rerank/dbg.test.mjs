import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("dbg dump", () => {
  const BIN = "/Users/alessiobacin/Desktop/code-mem/.worktrees/cm-bench-hardening/bin/cm";
  const dir = mkdtempSync(join(tmpdir(), "cm-a1-")) + "/proj-dbg2";
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "proj", private: true }));
  const home = join(dir, "home");
  mkdirSync(home, { recursive: true });
  const env = { ...process.env, HOME: home };
  const run = (args) => {
    const r = spawnSync(process.execPath, [BIN, ...args], { cwd: dir, env, encoding: "utf-8", timeout: 60000 });
    return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
  };
  run(["init"]);
  run(["save", "--kind", "decision", "Deploy uses the blue-green pipeline script deploy.sh"]);
  run(["save", "--kind", "issue", "Flaky websocket reconnect tests break CI weekly"]);
  run(["save", "--kind", "fact", "PostgreSQL 16 runs on Neon with pgbouncer"]);
  const r = run(["recall-auto"]);
  console.log("CODE:", r.code);
  console.log("OUT:\n" + r.out);
});
