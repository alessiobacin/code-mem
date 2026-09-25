// File index: one FTS5 row per code or Markdown file, so a natural-language
// question lands on the file that answers it. Identifiers are split into words
// (setJevStatus → "set jev status") and leading comments / headings are
// indexed, which is what the graph alone could not match. The index follows
// the files on disk (mtime+size) at query time, so it is never stale.
// With Jev configured, the top candidates are re-ranked by one typed call:
// "does this file answer the question?" per candidate.

const FINDEX_STOPWORDS = new Set("a an and are as at be by can cm code do does file files for from function functions get has have how i if in into is it its me my of on or should so that the their then there this to use used uses using was we what when where which who why will with you your come cosa dove del della delle dei gli il la le lo per che con una uno non".split(" "));
const FINDEX_MAX_BYTES = 512 * 1024;
const FINDEX_TOP = 5;
const FINDEX_RERANK = 10;
const FINDEX_DECISIVE = 2;
const FINDEX_FILE_RE = /\.(?:[cm]?[jt]sx?|py|go|rs|java|rb|php|kt|swift|cs|c|cc|cpp|h|hpp|sh|md|markdown)$/i;

function splitIdentifiers(text) {
  return String(text || "")
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[_\-]+/g, " ")
    .toLowerCase();
}

function fileIndexDoc(path, content) {
  const text = String(content || "");
  const name = `${path} ${splitIdentifiers(path.replace(/[/.]/g, " "))}`;
  if (/\.(?:md|markdown)$/i.test(path)) {
    const headings = [...text.matchAll(/^#{1,6}\s+(.+)$/gm)].map((m) => m[1].replace(/[#`*_]/g, "").trim());
    const firstPara = text.replace(/^---[\s\S]*?---/, "").split(/\n\s*\n/).map((p) => p.replace(/\s+/g, " ").trim()).find((p) => p && !p.startsWith("#")) || "";
    return { name, symbols: headings.join(" · "), comments: "", body: text.slice(0, 40000), summary: `${headings[0] || path} — ${firstPara.slice(0, 220)}` };
  }
  const symbols = new Set();
  for (const m of text.matchAll(/\b(?:function\*?|class|def|func|fn|interface|type|enum)\s+([A-Za-z_$][\w$]*)|\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g)) symbols.add(m[1] || m[2]);
  const comments = [];
  for (const m of text.matchAll(/^\s*(?:\/\/+|#(?!!)|\*|\/\*+)\s?(.*)$|"""([\s\S]*?)"""/gm)) {
    const line = (m[1] ?? m[2] ?? "").replace(/\*\/\s*$/, "").trim();
    if (line) comments.push(line);
  }
  const list = [...symbols];
  const commentText = comments.join(" ");
  return {
    name,
    symbols: `${list.join(" ")} ${splitIdentifiers(list.join(" "))}`,
    comments: commentText.slice(0, 20000),
    body: splitIdentifiers(text.slice(0, 40000)),
    summary: `${list.slice(0, 12).join(", ")}${commentText ? ` — ${commentText.slice(0, 220)}` : ""}`,
  };
}

function fileSearchQuery(question) {
  const words = splitIdentifiers(question).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2 && !FINDEX_STOPWORDS.has(w));
  return [...new Set(words)].map((w) => `"${w}"`).join(" OR ");
}

function ensureFileIndex(d) {
  try {
    d.exec("CREATE VIRTUAL TABLE IF NOT EXISTS file_fts USING fts5(path UNINDEXED, name, symbols, comments, body, tokenize='porter unicode61')");
    d.exec("CREATE TABLE IF NOT EXISTS file_index(path TEXT PRIMARY KEY, stamp TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '')");
    return true;
  } catch { return false; } // no FTS5 in this SQLite build: ranking is skipped
}

// Sync the index with the code/Markdown files the graph knows about.
function refreshFileIndex(d, cwd) {
  if (!ensureFileIndex(d)) return false;
  // File nodes (inventory scan) plus the files that define functions/classes
  // (AST scan): either scan alone is enough to index a repository.
  const paths = allStmt(d, "SELECT DISTINCT json_extract(metadata_json,'$.source_path') AS path FROM graph_nodes WHERE type IN ('code-file','document','function','class')")
    .map((r) => String(r.path || "")).filter((path) => FINDEX_FILE_RE.test(path));
  const known = new Map(allStmt(d, "SELECT path, stamp FROM file_index").map((r) => [r.path, r.stamp]));
  const seen = new Set();
  d.exec("BEGIN");
  try {
    for (const path of paths) {
      let stat;
      try { stat = statSync(join(cwd, path)); } catch { continue; }
      if (stat.size > FINDEX_MAX_BYTES) continue;
      seen.add(path);
      const stamp = `${stat.mtimeMs}:${stat.size}`;
      if (known.get(path) === stamp) continue;
      let content = "";
      try { content = readFileSync(join(cwd, path), "utf8"); } catch { continue; }
      const doc = fileIndexDoc(path, content);
      runStmt(d, "DELETE FROM file_fts WHERE path=?", [path]);
      runStmt(d, "INSERT INTO file_fts(path,name,symbols,comments,body) VALUES(?,?,?,?,?)", [path, doc.name, doc.symbols, doc.comments, doc.body]);
      runStmt(d, "INSERT OR REPLACE INTO file_index(path,stamp,summary) VALUES(?,?,?)", [path, stamp, doc.summary]);
    }
    for (const path of known.keys()) {
      if (seen.has(path)) continue;
      runStmt(d, "DELETE FROM file_fts WHERE path=?", [path]);
      runStmt(d, "DELETE FROM file_index WHERE path=?", [path]);
    }
    d.exec("COMMIT");
  } catch (error) {
    d.exec("ROLLBACK");
    throw error;
  }
  return true;
}

const isTestPath = (path) => /(^|\/)(tests?|__tests__|e2e|spec)\//.test(path) || /\.(test|spec)\.[a-z]+$/.test(path);

// Ranked [{ path, summary, score, jev }] best first; [] when nothing matches.
async function searchFiles(d, cwd, question, opts = {}) {
  const limit = opts.limit || FINDEX_TOP;
  const query = fileSearchQuery(question);
  if (!query || !refreshFileIndex(d, cwd)) return [];
  let rows = [];
  try {
    rows = allStmt(d, `SELECT f.path, i.summary, bm25(file_fts, 0, 4, 3, 2, 1) AS rank FROM file_fts f JOIN file_index i ON i.path = f.path WHERE file_fts MATCH ? ORDER BY rank LIMIT 40`, [query]);
  } catch { return []; }
  // bm25 is negative (lower = better); tests only answer when nothing else does.
  let hits = rows.map((r) => ({ path: r.path, summary: r.summary, score: -r.rank * (isTestPath(r.path) ? 0.4 : 1) })).sort((a, b) => b.score - a.score);
  if (opts.jev !== false && hits.length > 1) hits = await jevRerankFiles(question, hits);
  return hits.slice(0, limit);
}

// One Jev call: a yes/no probability per top candidate, blended with the
// text-match score. Skipped when the text match is already decisive (the top
// file scores twice the runner-up): Jev only sees summaries, the index sees
// every word. Returns the input order when Jev is unavailable.
async function jevRerankFiles(question, hits) {
  if (hits[0].score >= FINDEX_DECISIVE * hits[1].score) return hits;
  const top = hits.slice(0, FINDEX_RERANK);
  const state = `QUESTION: ${question}\n\n${top.map((h, i) => `FILE c${i}: ${h.path} — ${String(h.summary || "").slice(0, 400)}`).join("\n")}`;
  const questions = Object.fromEntries(top.map((_, i) => [`c${i}`, { type: "noul", instructions: `Does FILE c${i} contain the answer to the QUESTION?` }]));
  const result = await jevAsk(state, questions);
  if (!result?.answers) return hits;
  const ranked = top.map((h, i) => {
    const p = Number(result.answers[`c${i}`]?.noul);
    return { ...h, jev: Number.isFinite(p) ? p : null, order: 0.65 * (Number.isFinite(p) ? p : 0.5) + 0.35 * (h.score / top[0].score) };
  }).sort((a, b) => b.order - a.order);
  return [...ranked, ...hits.slice(FINDEX_RERANK)];
}

function renderFileHits(hits) {
  if (!hits.length) return "";
  const lines = ["Relevant files:"];
  hits.forEach((h, i) => lines.push(`  ${i + 1}. ${h.path}${h.jev != null ? ` (jev ${h.jev.toFixed(2)})` : ""}${h.summary ? ` — ${String(h.summary).slice(0, 160)}` : ""}`));
  return `${lines.join("\n")}\n`;
}
