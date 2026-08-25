function checkAcorn() {
  try {
    const acorn = require(join(CM_DEPS_DIR, "node_modules", "acorn"));
    const acornLoose = require(join(CM_DEPS_DIR, "node_modules", "acorn-loose"));
    return { acorn, acornLoose };
  } catch { return null; }
}

function installAcornDeps() {
  try {
    if (checkAcorn()) return true;
    const pj = join(CM_DEPS_DIR, "package.json");
    if (!existsSync(pj)) {
      mkdirSync(CM_DEPS_DIR, { recursive: true });
      writeFileSync(pj, JSON.stringify({ name: "cm-deps", private: true }));
    }
    execSync("npm install acorn acorn-loose", { cwd: CM_DEPS_DIR, stdio: "pipe", timeout: 60000 });
    return true;
  } catch { return false; }
}

function scanASTDeep(cwd, noAst) {
  // Walk directory, parse JS/TS files with AST, extract symbols and relations
  const nodes = [], edges = [];
  const seenNodes = new Set();
  const seenEdges = new Set();
  const files = [];

  function crawl(dir, depth) {
    if (depth > 5) return;
    let entries;
    try { entries = readdirSync(dir); } catch { return; }
    for (const en of entries) {
      if (en.startsWith(".") || en === "node_modules" || en === "dist" || en === "build" || en === "memory" || en === "coverage" || en === ".next") continue;
      const full = join(dir, en);
      let s;
      try { s = statSync(full); } catch { continue; }
      if (s.isDirectory()) crawl(full, depth + 1);
      else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(en)) files.push(full);
    }
  }
  crawl(cwd, 0);

  const acornDeps = noAst ? null : checkAcorn();
  const hasAcorn = !!acornDeps;
  const defaultRe = /(?:from\s+["']([^"']+)["']|require\(["']([^"']+)["']\)|import\s+["']([^"']+)["'])/g;
  const classRe = /\bclass\s+(\w+)(?:\s+extends\s+(\w+))?/g;
  const funcRe = /\b(?:async\s+)?function\s+(\w+)/g;
  const arrowRe = /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?(?:\(|(?:\w+\s*=>))/g;
  const exportRe = /export\s+(?:default\s+)?(?:class|function|interface|type|const|let|var|enum)\s+(\w+)/g;
  const interfaceRe = /\binterface\s+(\w+)(?:\s+extends\s+([^{]+))?/g;
  const typeRe = /\btype\s+(\w+)\s*=/g;
  const methodCallRe = /\b(\w+)\.(\w+)\s*\(/g;

  // Quick hash for node IDs
  function hashId(label) {
    let h = 0;
    for (let i = 0; i < label.length; i++) h = ((h << 5) - h + label.charCodeAt(i)) | 0;
    return "ast__" + (h >>> 0).toString(36);
  }

  function addNode(id, label, type) {
    if (seenNodes.has(id)) return;
    seenNodes.add(id);
    nodes.push({ id, label, type, metadata: {}, created: nowIso() });
  }

  function addEdge(source, target, relation) {
    const key = `${source}|${target}|${relation}`;
    if (seenEdges.has(key)) return;
    seenEdges.add(key);
    edges.push({ source, target, relation, confidence: "INFERRED", metadata: {}, created: nowIso() });
  }

  function walkASTWithAcorn(acorn, acornLoose, content, fileBase, filePath) {
    let ast;
    const isJSX = /\.(jsx|tsx)$/i.test(filePath);
    const isTS = /\.tsx?$/i.test(filePath);
    try {
      ast = (isTS ? acornLoose : acorn).parse(content, {
        ecmaVersion: "latest",
        sourceType: "module",
        allowReturnOutsideFunction: true,
        allowImportExportEverywhere: true,
        ...(isJSX ? { ecmaFeatures: { jsx: true } } : {}),
      });
    } catch { return; }

    const fileId = hashId(fileBase);
    addNode(fileId, fileBase, "file");

    function walkNode(node) {
      if (!node || typeof node !== "object") return;
      if (node.type === "ClassDeclaration" && node.id) {
        const cid = hashId(`class:${fileBase}:${node.id.name}`);
        addNode(cid, node.id.name, "class");
        addEdge(fileId, cid, "defines");
        if (node.superClass && node.superClass.type === "Identifier") {
          const sid = hashId(`class:${fileBase}:${node.superClass.name}`);
          addEdge(cid, sid, "extends");
        }
      } else if (node.type === "FunctionDeclaration" && node.id) {
        const fid = hashId(`fn:${fileBase}:${node.id.name}`);
        addNode(fid, node.id.name, "function");
        addEdge(fileId, fid, "defines");
      } else if (node.type === "VariableDeclarator" && node.id && node.init) {
        if (/^(ArrowFunctionExpression|FunctionExpression)$/.test(node.init.type)) {
          const fid = hashId(`fn:${fileBase}:${node.id.name}`);
          addNode(fid, node.id.name, "function");
          addEdge(fileId, fid, "defines");
        }
      } else if (node.type === "ExportDefaultDeclaration" && node.declaration) {
        if (node.declaration.id) {
          const eid = hashId(`export:${fileBase}:${node.declaration.id.name}`);
          addNode(eid, node.declaration.id.name, "export");
          addEdge(fileId, eid, "defines");
        }
      } else if (node.type === "ExportNamedDeclaration" && node.declaration && node.declaration.id) {
        const eid = hashId(`export:${fileBase}:${node.declaration.id.name}`);
        addNode(eid, node.declaration.id.name, "export");
        addEdge(fileId, eid, "defines");
      } else if (node.type === "ImportDeclaration" && node.source) {
        const targetName = node.source.value.split("/")[0];
        if (targetName && !targetName.startsWith(".") && targetName.length > 1) {
          const tid = hashId(`module:${targetName}`);
          addNode(tid, targetName, "module");
          addEdge(fileId, tid, "depends_on");
        }
      }

      // Recurse into children
      for (const key of Object.keys(node)) {
        if (key === "parent" || key === "start" || key === "end" || key === "loc" || key === "range") continue;
        const child = node[key];
        if (Array.isArray(child)) for (const c of child) walkNode(c);
        else if (child && typeof child.type === "string") walkNode(child);
      }
    }

    walkNode(ast);
  }

  function walkASTWithRegex(content, fileBase) {
    const fileId = hashId(fileBase);
    addNode(fileId, fileBase, "file");

    // Imports
    let match;
    defaultRe.lastIndex = 0;
    while ((match = defaultRe.exec(content)) !== null) {
      const target = (match[1] || match[2] || match[3] || "").split("/")[0];
      if (target && !target.startsWith(".") && target.length > 1) {
        const tid = hashId(`module:${target}`);
        addNode(tid, target, "module");
        addEdge(fileId, tid, "depends_on");
      }
    }

    // Classes
    classRe.lastIndex = 0;
    while ((match = classRe.exec(content)) !== null) {
      const cid = hashId(`class:${fileBase}:${match[1]}`);
      addNode(cid, match[1], "class");
      addEdge(fileId, cid, "defines");
      if (match[2]) {
        const sid = hashId(`class:${fileBase}:${match[2]}`);
        addEdge(cid, sid, "extends");
      }
    }

    // Functions
    funcRe.lastIndex = 0;
    while ((match = funcRe.exec(content)) !== null) {
      const fid = hashId(`fn:${fileBase}:${match[1]}`);
      addNode(fid, match[1], "function");
      addEdge(fileId, fid, "defines");
    }

    // Arrow functions (const fn = ...)
    arrowRe.lastIndex = 0;
    while ((match = arrowRe.exec(content)) !== null) {
      const fid = hashId(`fn:${fileBase}:${match[1]}`);
      if (!seenNodes.has(fid)) {
        addNode(fid, match[1], "function");
        addEdge(fileId, fid, "defines");
      }
    }

    // Exports
    exportRe.lastIndex = 0;
    while ((match = exportRe.exec(content)) !== null) {
      const eid = hashId(`export:${fileBase}:${match[1]}`);
      if (!seenNodes.has(eid)) {
        addNode(eid, match[1], "export");
        addEdge(fileId, eid, "defines");
      }
    }

    // Interfaces
    interfaceRe.lastIndex = 0;
    while ((match = interfaceRe.exec(content)) !== null) {
      const iid = hashId(`interface:${fileBase}:${match[1]}`);
      addNode(iid, match[1], "interface");
      addEdge(fileId, iid, "defines");
      if (match[2]) {
        const parent = match[2].trim().split(/\s*,\s*/)[0];
        if (parent && parent.length > 1) {
          const pid = hashId(`interface:${fileBase}:${parent}`);
          addEdge(iid, pid, "extends");
        }
      }
    }

    // Type aliases
    typeRe.lastIndex = 0;
    while ((match = typeRe.exec(content)) !== null) {
      const tid = hashId(`type:${fileBase}:${match[1]}`);
      addNode(tid, match[1], "type");
      addEdge(fileId, tid, "defines");
    }

    // Method calls (low confidence => AMBIGUOUS)
    methodCallRe.lastIndex = 0;
    const callCounts = {};
    while ((match = methodCallRe.exec(content)) !== null) {
      const obj = match[1];
      if (!callCounts[obj]) callCounts[obj] = 0;
      callCounts[obj]++;
    }
    for (const [obj, count] of Object.entries(callCounts)) {
      if (count > 2) {
        const tid = hashId(`module:${obj}`);
        // Only add edge if target node exists (already imported)
        if (seenNodes.has(tid)) {
          addEdge(fileId, tid, "references");
        }
      }
    }
  }

  // Process each file
  for (const file of files) {
    let content;
    try { content = readFileSync(file, "utf-8"); } catch { continue; }
    const fileBase = basename(file).replace(/\.[^.]+$/, "");

    if (hasAcorn && /\.(js|jsx|mjs|cjs)$/i.test(file)) {
      // Use real AST for JS files
      walkASTWithAcorn(acornDeps.acorn, acornDeps.acornLoose, content, fileBase, file);
    } else {
      // Use regex for TS files or when acorn unavailable
      walkASTWithRegex(content, fileBase);
    }
  }

  return { nodes, edges, hasAcorn, files: files.length };
}

