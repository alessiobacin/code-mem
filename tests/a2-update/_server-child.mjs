// Tiny HTTP server for checksum.test.mjs — runs in a SEPARATE process so the
// test process can stay blocked in spawnSync while curl (grand-child of the
// test, child of `cm update`) still gets served. Routes are re-read from a
// JSON file on every request so the test can rewrite them between cases.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";

const PORT = Number(process.argv[2]);
const ROUTES_FILE = process.argv[3];

createServer((req, res) => {
  let routes = {};
  try { routes = JSON.parse(readFileSync(ROUTES_FILE, "utf-8")); } catch {}
  const route = routes[req.url];
  if (!route) { res.writeHead(404, { "content-type": "text/plain" }); res.end("not found"); return; }
  res.writeHead(route.status, { "content-type": "text/plain" });
  res.end(route.body);
}).listen(PORT, "127.0.0.1", () => console.log("READY"));
