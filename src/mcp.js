// ─── MCP server (IMP-01, stdio JSON-RPC) ────────────────────────────────────
// `cm mcp` exposes the recall pipeline over the Model Context Protocol so any
// MCP-compatible harness can search project memory without shelling out.
// Zero dependencies: minimal JSON-RPC 2.0 over stdio (initialize,
// tools/list, tools/call, ping). Tools are read-mostly and reuse
// recallMemories / listMemoryRows directly; search returns titles+summaries
// (progressive disclosure), memory_get returns the full row.

const MCP_TOOL_DEFS = [
  {
    name: "memory_search",
    description: "Search project + global memories for a task or question. Returns ranked titles with summaries and scores.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Task or question to recall memory for" },
        limit: { type: "number", description: "Max results (default 5, max 20)" },
        mode: { type: "string", enum: ["keyword", "hybrid", "semantic"], description: "Ranking mode (default hybrid)" },
      },
      required: ["query"],
    },
  },
  {
    name: "memory_timeline",
    description: "List recent memories newest-first, optionally filtered by kind.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max rows (default 10, max 50)" },
        kind: { type: "string", description: "Filter by kind: fact, decision, procedure, issue, artifact, preference" },
      },
    },
  },
  {
    name: "memory_get",
    description: "Fetch one memory by id with full body, tags and files.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Memory id (e.g. mem_fact_h_1a2b3c)" },
      },
      required: ["id"],
    },
  },
];

function mcpText(obj) {
  return { content: [{ type: "text", text: JSON.stringify(obj, null, 2) }] };
}

function mcpError(id, code, message) {
  return { jsonrpc: "2.0", id: id === undefined ? null : id, error: { code, message } };
}

async function mcpCallTool(d, cwd, name, args) {
  const a = args && typeof args === "object" ? args : {};
  if (name === "memory_search") {
    const query = String(a.query || "").trim();
    if (!query) return { content: [{ type: "text", text: "query required" }], isError: true };
    const limit = Math.max(1, Math.min(20, Number.parseInt(a.limit, 10) || 5));
    const mode = ["keyword", "hybrid", "semantic"].includes(a.mode) ? a.mode : "hybrid";
    const recalled = await recallMemories(d, cwd, query, 2, limit, mode);
    return mcpText(recalled.ranked.map((e) => ({
      id: e.row.id,
      kind: e.row.kind,
      scope: e.row._scope || "project",
      title: e.row.title,
      summary: e.row.summary || summarize(e.row.body),
      score: Number(e.score.toFixed(3)),
    })));
  }
  if (name === "memory_timeline") {
    const limit = Math.max(1, Math.min(50, Number.parseInt(a.limit, 10) || 10));
    const kind = a.kind ? String(a.kind) : null;
    const rows = listMemoryRows(
      d,
      kind ? "WHERE mi.status='active' AND mi.kind = ?" : "WHERE mi.status='active'",
      kind ? [kind] : [],
      `ORDER BY mi.created_at DESC LIMIT ${limit}`
    );
    return mcpText(rows.map((r) => ({
      id: r.id, kind: r.kind, title: r.title,
      summary: r.summary || summarize(r.body), created_at: r.created_at,
    })));
  }
  if (name === "memory_get") {
    const id = String(a.id || "").trim();
    if (!id) return { content: [{ type: "text", text: "id required" }], isError: true };
    const row = loadMemoryRow(d, id);
    if (!row) return { content: [{ type: "text", text: `not found: ${id}` }], isError: true };
    return mcpText({ ...serializeMemoryRow(row), tags: tagsForRow(row), files: filesForRow(row) });
  }
  return { content: [{ type: "text", text: `unknown tool: ${name}` }], isError: true };
}

async function runMcpServer(d, cwd) {
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  const send = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);
  for await (const line of rl) {
    const raw = String(line || "").trim();
    if (!raw) continue;
    let msg;
    try { msg = JSON.parse(raw); } catch { send(mcpError(undefined, -32700, "parse error")); continue; }
    const id = msg.id;
    try {
      if (msg.method === "initialize") {
        send({
          jsonrpc: "2.0", id,
          result: {
            protocolVersion: (msg.params && msg.params.protocolVersion) || "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "cm", version: VERSION },
          },
        });
      } else if (msg.method === "notifications/initialized") {
        continue; // notification, no response
      } else if (msg.method === "ping") {
        send({ jsonrpc: "2.0", id, result: {} });
      } else if (msg.method === "tools/list") {
        send({ jsonrpc: "2.0", id, result: { tools: MCP_TOOL_DEFS } });
      } else if (msg.method === "tools/call") {
        const result = await mcpCallTool(d, cwd, msg.params && msg.params.name, msg.params && msg.params.arguments);
        send({ jsonrpc: "2.0", id, result });
      } else {
        send(mcpError(id, -32601, `method not found: ${msg.method}`));
      }
    } catch (e) {
      send(mcpError(id, -32603, `internal error: ${e.message}`));
    }
  }
}
