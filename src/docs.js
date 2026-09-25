// Documentation view: how the documents of a repository relate, for any kind
// of documentation (Markdown, PDF, Office... already converted by the
// knowledge import). Units are the imported documents; topics come from the
// harness LLM once (folders without an LLM); candidate pairs come from
// deterministic signals (links, file-name mentions, similar content) and the
// optional Jev classifier types each relation. Stored in cm_meta (derived
// data) and refreshed incrementally: only changed documents are reclassified.

const DOC_META_KEY = "doc_map";
const DOC_MAX_TOPICS = 9;
const DOC_MAX_PAIRS = 400;
const DOC_TYPES = ["guide", "reference", "specification", "procedure", "policy", "decision", "report", "notes", "plan", "agreement", "data", "presentation", "changelog", "other"];
const DOC_TYPE_CRITERIA = {
  guide: "Explains how to use or understand something (tutorial, manual, handbook, readme)",
  reference: "Lookup material: glossary, catalogue, list of terms, API or field reference",
  specification: "Describes how something must be built or must behave (requirements, design, spec)",
  procedure: "Step-by-step instructions to carry out a task (checklist, runbook, operating procedure)",
  policy: "Rules or obligations to follow (policy, law, regulation, standard, code of conduct)",
  decision: "Records a decision and why it was taken (decision record, rationale)",
  report: "Findings, analysis, audit, research or results",
  notes: "Meeting notes, minutes, journal or loose notes",
  plan: "Plan, roadmap, schedule or proposal of future work",
  agreement: "Contract, agreement, offer, terms between parties",
  data: "Mostly tabular or raw data, spreadsheet, dataset",
  presentation: "Slides or pitch material",
  changelog: "History of changes or release notes",
  other: "None of the above",
};
const DOC_RELATIONS = {
  references: "A cites, links to or points the reader to B",
  details: "A explains part of B in more depth",
  applies: "A puts into practice rules, requirements or decisions stated in B",
  depends_on: "A requires B to be read, done or valid first",
  updates: "A replaces, revises or updates B",
  contradicts: "A states something that conflicts with B",
  same_subject: "A and B cover the same subject without a more specific link",
  unrelated: "A and B have no meaningful connection",
};

// Images (screenshots, covers) and JSON (data/config) stay in the technical
// view; text documents, office files, spreadsheets and audio/video
// transcripts are documentation.
function isDocumentationSource(path) {
  return !/\.(?:png|jpe?g|webp|gif|bmp|tiff?|svg|ico|json)$/i.test(String(path || ""));
}

// Converted media notes are labelled "name.ext (kind via tool)": prefer the
// document's own first heading, else the bare file name.
function docTitle(label, text, path) {
  const raw = String(label || path || "");
  if (!/\((?:document|image|audio|video) via [^)]+\)$/.test(raw)) return raw;
  const heading = String(text || "").match(/^\s*#{1,3}\s+(.{3,120})$/m);
  return heading ? heading[1].trim() : raw.replace(/\s*\([^)]*\)$/, "");
}

function docsFromGraph(d, graph) {
  const docs = [];
  for (const node of graph.nodes || []) {
    const path = node.metadata?.source_path;
    const match = String(node.id || "").match(/^wiki:([^:]+):(.+)$/);
    if (!path || !match || !/note$/.test(node.type || "") || !isDocumentationSource(path)) continue;
    let text = "";
    try { text = String(getStmt(d, "SELECT body FROM memory_items WHERE id = ?", [`mem_${match[1]}_wiki_${match[2]}`])?.body || ""); } catch {}
    if (!text.trim()) text = String(node.metadata?.summary || "");
    if (!text.trim()) continue;
    text = text.slice(0, 6000);
    docs.push({ id: node.id, path, title: docTitle(node.label, text, path), text, hash: createHash("sha1").update(text).digest("hex").slice(0, 16) });
  }
  return docs.sort((a, b) => a.path.localeCompare(b.path));
}

function docMentionKeys(doc) {
  const generic = new Set(["readme", "index", "notes", "changelog", "license", "contributing", "todo", "summary", "overview"]);
  const base = String(doc.path).split("/").pop().replace(/\.[^.]+$/, "").toLowerCase();
  const keys = [];
  if (base.length >= 5 && !generic.has(base)) keys.push(base, base.replace(/[-_]+/g, " "));
  const title = String(doc.title || "").toLowerCase().trim();
  if (title.length >= 8 && !generic.has(title)) keys.push(title);
  return [...new Set(keys)];
}

function docCandidatePairs(docs, links) {
  const out = [];
  const seen = new Set();
  const add = (from, to, via) => {
    if (!from || !to || from === to) return;
    const key = [from, to].sort().join("|");
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ from, to, via });
  };
  for (const link of links || []) add(link.from, link.to, "link");
  const byPath = new Map(docs.map((doc) => [doc.path, doc.id]));
  for (const doc of docs) {
    // markdown links, resolved relative to the document's folder
    for (const match of String(doc.text).matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)) {
      const parts = doc.path.split("/").slice(0, -1);
      for (const segment of decodeURIComponent(match[1]).split("/")) {
        if (segment === "..") parts.pop();
        else if (segment && segment !== ".") parts.push(segment);
      }
      add(doc.id, byPath.get(parts.join("/")), "link");
    }
  }
  for (const doc of docs) {
    const text = String(doc.text).toLowerCase();
    for (const other of docs) if (other !== doc && docMentionKeys(other).some((key) => text.includes(key))) add(doc.id, other.id, "mention");
  }
  const vectors = docs.map((doc) => trigramEmbed(`${doc.title} ${doc.text.slice(0, 4000)}`));
  docs.forEach((doc, i) => {
    let best = -1, bestScore = 0;
    docs.forEach((_, j) => {
      if (i === j) return;
      const score = cosineSimilarity(vectors[i], vectors[j]);
      if (score > bestScore) { bestScore = score; best = j; }
    });
    if (best >= 0 && bestScore >= 0.55) add(doc.id, docs[best].id, "similar");
  });
  return out.slice(0, DOC_MAX_PAIRS);
}

function normalizeDocTopics(raw, docs) {
  const topics = [];
  for (const item of Array.isArray(raw?.topics) ? raw.topics : []) {
    if (topics.length >= DOC_MAX_TOPICS) break;
    const name = String(item?.name || "").replace(/\s+/g, " ").trim().slice(0, 40);
    const id = logicSlug(item?.id || name);
    if (!name || !id || topics.some((topic) => topic.id === id)) continue;
    topics.push({ id, name, emoji: Array.from(String(item?.emoji || "📁").trim()).slice(0, 2).join("") || "📁", summary: String(item?.summary || "").replace(/\s+/g, " ").trim().slice(0, 200) });
  }
  const ids = new Set(topics.map((topic) => topic.id));
  const assign = {};
  for (const entry of Array.isArray(raw?.assign) ? raw.assign : []) {
    const [index, topic, type] = typeof entry === "string" ? entry.split(":") : [entry?.index, entry?.topic, entry?.type];
    const doc = docs[Number(index)];
    const topicId = logicSlug(topic);
    if (!doc || !ids.has(topicId)) continue;
    assign[doc.id] = [topicId, DOC_TYPES.includes(type) ? type : "other"];
  }
  const used = new Set(Object.values(assign).map(([topic]) => topic));
  const kept = topics.filter((topic) => used.has(topic.id));
  if (!kept.length) return null;
  return { language: String(raw?.language || "").slice(0, 30), topics: kept, assign };
}

function folderTopics(docs) {
  const byFolder = new Map();
  for (const doc of docs) {
    const folder = doc.path.includes("/") ? doc.path.split("/")[0] : "general";
    if (!byFolder.has(folder)) byFolder.set(folder, []);
    byFolder.get(folder).push(doc);
  }
  const topics = [...byFolder.keys()].sort().map((folder) => ({ id: logicSlug(folder) || "general", name: folder, emoji: "📁", summary: "" }));
  const assign = {};
  for (const [folder, list] of byFolder) for (const doc of list) assign[doc.id] = [logicSlug(folder) || "general", "other"];
  return { language: "", topics, assign };
}

function docSummary(text) {
  const plain = String(text).replace(/^---[\s\S]*?---/, "").replace(/[#>*_`|[\]()]+/g, " ").replace(/\s+/g, " ").trim();
  const sentence = plain.match(/^(.{20,200}?[.!?])(\s|$)/);
  return (sentence ? sentence[1] : plain.slice(0, 160)).trim();
}

function docTopicsPrompt(docs, readme) {
  // ponytail: first 120 documents only, so the reply fits the model's output
  // cap; the rest are assigned by Jev or by similarity in refreshDocMap.
  const listed = docs.slice(0, 120).map((doc, i) => `${i}. ${doc.path} — ${doc.title} — ${docSummary(doc.text).slice(0, 140)}`);
  return [
    "You organise a collection of documents so that anyone can see what it is about. Work read-only and return JSON only.",
    `Create 3-${DOC_MAX_TOPICS} TOPICS that group the documents by subject (what they are about, not their file format or folder).`,
    "Write topic names (1-4 plain words) and summaries (one short sentence) in the language of the README excerpt, or of the documents if there is no README.",
    `Assign every listed document to one topic and one type from: ${DOC_TYPES.join(", ")}.`,
    'Output: {"language":"...","topics":[{"id":"kebab-id","emoji":"one emoji","name":"...","summary":"..."}],"assign":["0:topic-id:type","1:topic-id:type"]}',
    `README excerpt:\n${readme || "(none)"}`,
    `DOCUMENTS (index. path — title — first sentence):\n${listed.join("\n")}`,
  ].join("\n");
}

async function docMapPool(items, size, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

function readDocMap(d) {
  return safeJsonParse(getMeta(d, DOC_META_KEY) || "null", null);
}

async function refreshDocMap(d, cwd, harness, graph, opts = {}) {
  const docs = docsFromGraph(d, graph);
  if (!docs.length) return { status: "no-docs", map: null };
  const prev = readDocMap(d);
  const prevDocs = new Map((prev?.docs || []).map((doc) => [doc.id, doc]));
  const changed = new Set(docs.filter((doc) => opts.force || prevDocs.get(doc.id)?.hash !== doc.hash).map((doc) => doc.id));
  if (prev && !changed.size && docs.length === prev.docs.length) return { status: "unchanged", map: prev };
  const llm = Boolean(harness?.available) && process.env.CM_NO_LLM !== "1";
  const jev = jevAvailable();

  let topics = prev?.topics || null, assign = {}, language = prev?.language || "", error = "";
  if (opts.force || !topics || changed.size > Math.max(3, docs.length * 0.3)) {
    let built = null;
    if (llm) {
      const result = runHarnessPrompt(harness, docTopicsPrompt(docs, logicReadmeExcerpt(cwd)), cwd, { timeout: Number(process.env.CM_LLM_TIMEOUT_MS || 120000) });
      built = normalizeDocTopics(result.data, docs);
      if (!built) error = String(result.error || "topics: invalid JSON").split("\n").pop().trim().slice(0, 200);
    }
    if (!built && (!topics || opts.force)) built = folderTopics(docs);
    if (built) ({ topics, assign, language } = { topics: built.topics, assign: built.assign, language: built.language || language });
  }
  const topicIds = new Set(topics.map((topic) => topic.id));

  const vectors = new Map(docs.map((doc) => [doc.id, trigramEmbed(`${doc.title} ${doc.text.slice(0, 4000)}`)]));
  const typed = await docMapPool(docs, 6, async (doc) => {
    const old = prevDocs.get(doc.id);
    let [topic, type] = assign[doc.id] || (old && !changed.has(doc.id) ? [old.topic, old.type] : [null, null]);
    if (changed.has(doc.id) && jev) {
      const questions = { type: { type: "choice", instructions: "What kind of document is this?", criteria: DOC_TYPE_CRITERIA } };
      if (!topicIds.has(topic)) questions.topic = { type: "choice", instructions: "Which topic does this document belong to?", criteria: Object.fromEntries(topics.map((t) => [t.id, `${t.name}${t.summary ? `: ${t.summary}` : ""}`])) };
      const answer = await jevAsk(`${doc.title} (${doc.path})\n${doc.text}`, questions);
      if (answer?.answers?.type?.choice && DOC_TYPES.includes(answer.answers.type.choice)) type = answer.answers.type.choice;
      if (answer?.answers?.topic?.choice && topicIds.has(answer.answers.topic.choice)) topic = answer.answers.topic.choice;
    }
    return { doc, topic, type: type || "other" };
  });
  // Documents still without a topic join the topic of their most similar document.
  for (const item of typed) {
    if (topicIds.has(item.topic)) continue;
    let best = null, bestScore = -1;
    for (const other of typed) {
      if (other === item || !topicIds.has(other.topic)) continue;
      const score = cosineSimilarity(vectors.get(item.doc.id), vectors.get(other.doc.id));
      if (score > bestScore) { bestScore = score; best = other.topic; }
    }
    item.topic = best || topics[0].id;
  }

  const links = [];
  const docIds = new Set(docs.map((doc) => doc.id));
  for (const edge of graph.edges || []) if (edge.relation === "links_to" && docIds.has(edge.source) && docIds.has(edge.target)) links.push({ from: edge.source, to: edge.target });
  const byId = new Map(docs.map((doc) => [doc.id, doc]));
  const prevRelations = new Map((prev?.relations || []).map((rel) => [[rel.from, rel.to].sort().join("|"), rel]));
  const relations = (await docMapPool(docCandidatePairs(docs, links), 6, async (pair) => {
    const old = prevRelations.get([pair.from, pair.to].sort().join("|"));
    if (old && !changed.has(pair.from) && !changed.has(pair.to)) return old;
    const fallback = { from: pair.from, to: pair.to, type: pair.via === "similar" ? "same_subject" : "references", via: pair.via, confidence: null };
    if (!jev) return fallback;
    const a = byId.get(pair.from), b = byId.get(pair.to);
    const answer = await jevAsk(`DOCUMENT A — ${a.title} (${a.path})\n${a.text.slice(0, 2500)}\n\nDOCUMENT B — ${b.title} (${b.path})\n${b.text.slice(0, 2500)}`, {
      relation: { type: "choice", instructions: "How is DOCUMENT A related to DOCUMENT B?", criteria: DOC_RELATIONS },
    });
    const choice = answer?.answers?.relation?.choice;
    if (!choice || !DOC_RELATIONS[choice]) return fallback;
    const confidence = Number(answer.answers.relation.probabilities?.[choice] ?? answer.answers.relation.confidence ?? 0);
    if (choice === "unrelated" || confidence < 0.5) return pair.via === "link" ? fallback : null;
    return { from: pair.from, to: pair.to, type: choice, via: "jev", confidence: Math.round(confidence * 100) / 100 };
  })).filter(Boolean);

  const usedTopics = new Set(typed.map((item) => item.topic));
  const map = {
    language,
    generated_at: nowIso(),
    topics: topics.filter((topic) => usedTopics.has(topic.id)),
    docs: typed.map(({ doc, topic, type }) => ({ id: doc.id, path: doc.path, title: doc.title, type, topic, summary: docSummary(doc.text), hash: doc.hash })),
    relations,
  };
  setMeta(d, DOC_META_KEY, JSON.stringify(map));
  return { status: "updated", map, error };
}

function docStatusLine(result) {
  if (result.status === "no-docs") return "Documentation view: no documents imported yet (run cm update --memory --deep).";
  const m = result.map;
  const typedByJev = m.relations.filter((rel) => rel.via === "jev").length;
  return `Documentation view: ${m.docs.length} documents, ${m.topics.length} topics, ${m.relations.length} relations${typedByJev ? ` (${typedByJev} typed by Jev)` : ""} (${result.status}${result.error ? `; ${result.error}` : ""}).`;
}
