function checkOllama() {
  try {
    const res = execSync(
      `curl -s -o /dev/null -w "%{http_code}" ${OLLAMA_BASE}/api/tags 2>/dev/null || echo "fail"`,
      { stdio: ["ignore", "pipe", "ignore"], timeout: 3000, encoding: "utf-8" }
    ).trim();
    if (res !== "200") return false;
    const list = execSync(
      `curl -s ${OLLAMA_BASE}/api/tags 2>/dev/null || echo "{}"`,
      { stdio: ["ignore", "pipe", "ignore"], timeout: 3000, encoding: "utf-8" }
    ).trim();
    return list.includes(EMBED_MODEL);
  } catch { return false; }
}

function computeEmbedding(text) {
  return new Promise((resolve, reject) => {
    const safeText = String(text || "").slice(0, 7000);
    if (!safeText) { resolve(null); return; }
    const postData = JSON.stringify({ model: EMBED_MODEL, prompt: safeText });
    const u = new URL(`${OLLAMA_BASE}/api/embeddings`);
    const opts = {
      hostname: u.hostname,
      port: u.port,
      path: u.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(postData),
      },
    };
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 10000);
    const req = http.request(opts, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        clearTimeout(timer);
        try {
          const json = JSON.parse(data);
          if (json.embedding) resolve(new Float32Array(json.embedding));
          else reject(new Error("no embedding in response"));
        } catch (e) { reject(e); }
      });
    });
    req.on("error", (e) => { clearTimeout(timer); reject(e); });
    req.signal = ac.signal;
    req.write(postData);
    req.end();
  });
}

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

// --- trigram embedding (zero dipendenze, fallback universale) ---
const TRI_DIM = 4096;
function hash32(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return h >>> 0;
}
function trigramEmbed(text) {
  const vec = new Float32Array(TRI_DIM);
  const t = `  ${String(text || "").toLowerCase()}   `;
  for (let i = 0; i < t.length - 2; i++) {
    vec[hash32(t.slice(i, i + 3)) % TRI_DIM] += 1;
  }
  let norm = 0;
  for (let i = 0; i < TRI_DIM; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < TRI_DIM; i++) vec[i] /= norm;
  return vec;
}
function saveTrigramVector(d, id, text) {
  const vec = trigramEmbed(text);
  const buf = vectorToBuffer(vec);
  runStmt(
    d,
    "INSERT OR REPLACE INTO memory_vectors(memory_id,vector,model,created_at) VALUES(?,?,?,?)",
    [id, buf, "trigram", nowIso()]
  );
}

function vectorToBuffer(v) {
  // Quantize Float32 → Int8 (1 byte per float, ~75% storage savings)
  const len = v.length;
  const buf = Buffer.alloc(2 + len); // 2 bytes header + 1 byte per value
  let maxAbs = 0;
  for (let i = 0; i < len; i++) { const a = Math.abs(v[i]); if (a > maxAbs) maxAbs = a; }
  const scale = maxAbs > 1e-8 ? maxAbs : 1;
  buf.writeUInt16LE(len, 0);
  for (let i = 0; i < len; i++) {
    buf.writeInt8(Math.round((v[i] / scale) * 127), 2 + i);
  }
  return buf;
}
function bufferToVector(buf) {
  if (!(buf instanceof Buffer || ArrayBuffer.isView(buf))) buf = Buffer.alloc(0);
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf.buffer || buf);
  const len = b.readUInt16LE(0);
  const v = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    v[i] = b.readInt8(2 + i) / 127;
  }
  return v;
}

function embedText(d, id, model, text) {
  return computeEmbedding(text).then((vec) => {
    if (!vec) return;
    const buf = vectorToBuffer(vec);
    runStmt(
      d,
      "INSERT OR REPLACE INTO memory_vectors(memory_id,vector,model,created_at) VALUES(?,?,?,?)",
      [id, buf, model || EMBED_MODEL, nowIso()]
    );
  });
}

function listUnembeddedMemories(d) {
  return allStmt(
    d,
    `SELECT mi.id, mi.title, mi.body, mi.summary
     FROM memory_items mi
     LEFT JOIN memory_vectors mv ON mv.memory_id = mi.id
     WHERE mi.status = 'active' AND mv.memory_id IS NULL
     ORDER BY mi.updated_at ASC`
  );
}

