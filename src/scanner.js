function checkAcorn() {
  try {
    const acorn = require(join(CM_DEPS_DIR, "node_modules", "acorn"));
    const acornLoose = require(join(CM_DEPS_DIR, "node_modules", "acorn-loose"));
    return { acorn, acornLoose };
  } catch { return null; }
}

// Optional AST dependency install (IMP-04): scan --deep prefers acorn but
// works offline with the regex fallback. This one-time `npm install` into
// ~/.cm/deps is explicit (not silent): it runs only after cm init (which
// announces it) or after scan --deep prints the notice below — never hidden.
function installAcornDeps() {
  try {
    if (checkAcorn()) return true;
    console.log("scan --deep: installing optional AST parser (acorn) into ~/.cm/deps — one-time npm install, offline falls back to regex.");
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
      else if (/\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|rb|php|cs|swift|kt|c|h|cpp|hpp|cc|cxx)$/i.test(en)) files.push(full);
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

  function addNode(id, label, type, metadata = {}) {
    if (seenNodes.has(id)) return;
    seenNodes.add(id);
    nodes.push({ id, label, type, metadata, created: nowIso() });
  }

  function addEdge(source, target, relation, confidence = "INFERRED") {
    const key = `${source}|${target}|${relation}`;
    if (seenEdges.has(key)) return;
    seenEdges.add(key);
    edges.push({ source, target, relation, confidence, metadata: {}, created: nowIso() });
  }

  // Line number for a parsed node (`L<n>`, graphify's source_location).
  // Acorn gives node.loc when parsed with locations:true; regex walkers
  // compute it from the match offset. Missing data -> "" (never a lie).
  function locOf(node) {
    const line = node?.loc?.start?.line;
    return Number.isInteger(line) && line > 0 ? `L${line}` : "";
  }
  function lineAt(content, index) {
    if (!Number.isInteger(index) || index < 0) return "";
    let line = 1;
    for (let i = 0; i < index && i < content.length; i++) if (content[i] === "\n") line += 1;
    return `L${line}`;
  }

  // Per-file symbol table for cross-file call linking (keyed by repo-relative
  // path so same-basename files in different folders never collide).
  const fileCallData = []; // per-file { fileId, fileBase, relPath, pending, calls, bindings }
  const fileSymbols = new Map(); // relPath -> { fileId, fileBase, fns: Map(name->id) }
  const fileRecords = new Map(); // relPath -> { fileId, fileBase }
  function recordFn(relPath, fileId, fileBase, name, id) {
    let rec = fileSymbols.get(relPath);
    if (!rec) { rec = { fileId, fileBase, fns: new Map() }; fileSymbols.set(relPath, rec); }
    if (!rec.fns.has(name)) rec.fns.set(name, id);
  }

  function addPendingBinding(pending, name, request) {
    const local = String(name || "").trim();
    const target = String(request || "").trim();
    if (!local || !target || !/^[A-Za-z_$][\w$]*$/.test(local)) return;
    if (!pending.some((entry) => entry.name === local && entry.request === target)) {
      pending.push({ name: local, request: target });
    }
  }

  function bindingNames(specifier) {
    return String(specifier || "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => part.replace(/^\.\.\./, "").trim())
      .map((part) => part.split(/\s+as\s+|\s*:\s*/).pop()?.trim() || "")
      .filter(Boolean);
  }

  // Acorn handles these declarations when available, but keeping one small
  // source-level binding pass makes the AST and offline regex paths agree.
  // It also covers CommonJS destructuring, which the old regex path missed
  // because its match started at `require(` and excluded the declaration.
  function collectSourceBindings(content, pending) {
    const patterns = [
      [/\b(?:const|let|var)\s*\{([^}]+)\}\s*=\s*require\(\s*["']([^"']+)["']\s*\)/g, 1],
      [/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*["']([^"']+)["']\s*\)/g, 0],
      [/\bimport\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g, 1],
      [/\bimport\s+([A-Za-z_$][\w$]*)\s+from\s*["']([^"']+)["']/g, 0],
    ];
    for (const [pattern, nameGroup] of patterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const names = nameGroup === 1 ? bindingNames(match[1]) : [match[1]];
        for (const name of names) addPendingBinding(pending, name, match[2]);
      }
    }
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
        locations: true,
        ...(isJSX ? { ecmaFeatures: { jsx: true } } : {}),
      });
    } catch { return; }

    const relPath = relative(cwd, filePath).replace(/\\/g, "/");
    const fileId = hashId(fileBase);
    addNode(fileId, fileBase, "file", { source_path: relPath });
    fileRecords.set(relPath, { fileId, fileBase });
    // Bindings are collected first and resolved after every file is indexed,
    // so import targets can be declared later in the traversal.
    const pendingBindings = []; // {name, request} resolved after all files seen
    collectSourceBindings(content, pendingBindings);

    const fileCalls = []; // { caller, callee }
    const memberCalls = {}; // obj -> count, for `obj.method()` (AMBIGUOUS references)
    let enclosingFn = null;
    function walkNode(node) {
      if (!node || typeof node !== "object") return;
      if (node.type === "ClassDeclaration" && node.id) {
        const cid = hashId(`class:${fileBase}:${node.id.name}`);
        addNode(cid, node.id.name, "class", { source_path: relPath, source_location: locOf(node) });
        addEdge(fileId, cid, "defines");
        if (node.superClass && node.superClass.type === "Identifier") {
          const sid = hashId(`class:${fileBase}:${node.superClass.name}`);
          addEdge(cid, sid, "extends");
        }
      } else if (node.type === "FunctionDeclaration" && node.id) {
        const fid = hashId(`fn:${fileBase}:${node.id.name}`);
        addNode(fid, node.id.name, "function", { source_path: relPath, source_location: locOf(node) });
        addEdge(fileId, fid, "defines");
        recordFn(relPath, fileId, fileBase, node.id.name, fid);
        const prev = enclosingFn; enclosingFn = { name: node.id.name, id: fid };
        for (const key of Object.keys(node)) {
          if (key === "parent" || key === "start" || key === "end" || key === "id" || key === "loc" || key === "range") continue;
          const child = node[key];
          if (Array.isArray(child)) for (const c of child) walkNode(c);
          else if (child && typeof child.type === "string") walkNode(child);
        }
        enclosingFn = prev;
        return;
      } else if (node.type === "VariableDeclarator" && node.id && node.init) {
        // const { login } = require('./auth')  -> binding login -> ./auth
        if (node.init.type === "CallExpression" && node.init.callee?.type === "Identifier" && node.init.callee.name === "require" && node.init.arguments?.[0]?.type === "Literal") {
          const req = String(node.init.arguments[0].value || "");
          // External module (require('db')) -> module node + depends_on,
          // mirroring the ImportDeclaration branch for ESM.
          if (req && !req.startsWith(".") && req.split("/")[0].length > 1) {
            const targetName = req.split("/")[0];
            const tid = hashId(`module:${targetName}`);
            addNode(tid, targetName, "module");
            addEdge(fileId, tid, "depends_on");
          }
          if (node.id.type === "ObjectPattern") {
            for (const prop of node.id.properties || []) {
              const nm = prop?.value?.name || prop?.key?.name;
              if (nm) pendingBindings.push({ name: nm, request: req });
            }
          } else if (node.id.type === "Identifier") {
            pendingBindings.push({ name: node.id.name, request: req });
          }
        }
        if (/^(ArrowFunctionExpression|FunctionExpression)$/.test(node.init.type)) {
          const fid = hashId(`fn:${fileBase}:${node.id.name}`);
          addNode(fid, node.id.name, "function", { source_path: relPath, source_location: locOf(node) });
          addEdge(fileId, fid, "defines");
          recordFn(relPath, fileId, fileBase, node.id.name, fid);
          const prev = enclosingFn; enclosingFn = { name: node.id.name, id: fid };
          walkNode(node.init);
          enclosingFn = prev;
          return;
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
        const req = String(node.source.value || "");
        const targetName = req.split("/")[0];
        if (req.startsWith(".")) {
          // import { login } from './auth' -> binding login -> ./auth
          for (const spec of node.specifiers || []) {
            const nm = spec?.imported?.name || spec?.local?.name;
            if (nm) pendingBindings.push({ name: nm, request: req });
          }
        } else if (targetName && !targetName.startsWith(".") && targetName.length > 1) {
          const tid = hashId(`module:${targetName}`);
          addNode(tid, targetName, "module");
          addEdge(fileId, tid, "depends_on");
        }
      } else if (node.type === "CallExpression" && node.callee?.type === "Identifier") {
        // login(...) inside handleLogin -> resolved in the linking pass.
        if (enclosingFn && node.callee.name !== "require") fileCalls.push({ caller: enclosingFn.name, callee: node.callee.name });
      } else if (node.type === "CallExpression" && node.callee?.type === "MemberExpression" && node.callee.object?.type === "Identifier") {
        // db.q() — the object may be an imported module; resolved below.
        const obj = node.callee.object.name;
        memberCalls[obj] = (memberCalls[obj] || 0) + 1;
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
    // Repeated member calls on a known module (count>2) become AMBIGUOUS
    // references — same rule as the regex walker, but from the real AST.
    for (const [obj, count] of Object.entries(memberCalls)) {
      if (count > 2) {
        const tid = hashId(`module:${obj}`);
        if (seenNodes.has(tid)) addEdge(fileId, tid, "references", "AMBIGUOUS");
      }
    }
    fileCallData.push({ fileId, fileBase, relPath, pending: pendingBindings, calls: fileCalls });
  }

  function walkASTWithRegex(content, fileBase, filePath) {
    const relPath = relative(cwd, filePath).replace(/\\/g, "/");
    const fileId = hashId(fileBase);
    addNode(fileId, fileBase, "file", { source_path: relPath });
    fileRecords.set(relPath, { fileId, fileBase });
    const pending = [];
    const calls = [];
    collectSourceBindings(content, pending);

    // Imports (+ relative bindings: const { login } = require('./auth'))
    let match;
    defaultRe.lastIndex = 0;
    while ((match = defaultRe.exec(content)) !== null) {
      const req = (match[1] || match[2] || match[3] || "");
      if (!req) continue;
      if (req.startsWith(".")) {
        const before = String(content.slice(0, match.index).split("\n").pop() || "");
        const destr = /\{([^}]+)\}\s*=\s*require\s*\(\s*["']/.exec(before) || /import\s*\{([^}]+)\}\s*from/.exec(before);
        if (destr) {
          for (const nm of destr[1].split(",").map((s) => s.trim().split(/\s+as\s+/).pop().trim()).filter(Boolean)) {
            if (/^[A-Za-z_$][\w$]*$/.test(nm)) addPendingBinding(pending, nm, req);
          }
        } else {
          const idm = /(?:const|let|var)\s+(\w+)\s*=\s*require/.exec(before) || /import\s+(\w+)\s+from/.exec(before);
          if (idm) addPendingBinding(pending, idm[1], req);
        }
      } else {
        const target = req.split("/")[0];
        if (target && target.length > 1) {
          const tid = hashId(`module:${target}`);
          addNode(tid, target, "module");
          addEdge(fileId, tid, "depends_on");
        }
      }
    }

    // Classes
    classRe.lastIndex = 0;
    while ((match = classRe.exec(content)) !== null) {
      const cid = hashId(`class:${fileBase}:${match[1]}`);
      addNode(cid, match[1], "class", { source_path: relPath, source_location: lineAt(content, match.index) });
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
      addNode(fid, match[1], "function", { source_path: relPath, source_location: lineAt(content, match.index) });
      addEdge(fileId, fid, "defines");
      recordFn(relPath, fileId, fileBase, match[1], fid);
    }

    // Arrow functions (const fn = ...)
    arrowRe.lastIndex = 0;
    while ((match = arrowRe.exec(content)) !== null) {
      const fid = hashId(`fn:${fileBase}:${match[1]}`);
      if (!seenNodes.has(fid)) {
        addNode(fid, match[1], "function", { source_path: relPath, source_location: lineAt(content, match.index) });
        addEdge(fileId, fid, "defines");
        recordFn(relPath, fileId, fileBase, match[1], fid);
      }
    }
    // Bare call sites: name(  outside function definitions. Caller is the
    // enclosing declared function when detectable, else the file itself.
    const callRe = /(?:^|[^\w$.])\b([A-Za-z_$][\w$]*)\s*\(/g;
    let cm;
    while ((cm = callRe.exec(content)) !== null) {
      const nm = cm[1];
      if (["require", "import", "if", "for", "while", "switch", "catch", "function"].includes(nm)) continue;
      // Skip only the definition's own name (`function f(`/ `const f = (`).
      // Calls later on the SAME line (e.g. one-line bodies) still count.
      const lineStart = content.lastIndexOf("\n", cm.index) + 1;
      const upto = content.slice(lineStart, cm.index + cm[0].length);
      if (/(?:export\s+)?(?:async\s+)?function\s+\w+\s*\($/.test(upto) || /(?:export\s+)?(?:const|let|var)\s+\w+\s*=\s*$/.test(content.slice(lineStart, cm.index))) continue;
      // attribute to nearest preceding declared function in the file
      const before = content.slice(0, cm.index);
      const fnDecls = [...before.matchAll(/(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?(?:\(|\w+\s*=>))/g)];
      const caller = fnDecls.length ? (fnDecls[fnDecls.length - 1][1] || fnDecls[fnDecls.length - 1][2]) : null;
      calls.push({ caller, callee: nm });
    }
    fileCallData.push({ fileId, fileBase, relPath, pending, calls });

    // Exports
    exportRe.lastIndex = 0;
    while ((match = exportRe.exec(content)) !== null) {
      const eid = hashId(`export:${fileBase}:${match[1]}`);
      if (!seenNodes.has(eid)) {
        addNode(eid, match[1], "export", { source_path: relPath, source_location: lineAt(content, match.index) });
        addEdge(fileId, eid, "defines");
      }
    }

    // Interfaces
    interfaceRe.lastIndex = 0;
    while ((match = interfaceRe.exec(content)) !== null) {
      const iid = hashId(`interface:${fileBase}:${match[1]}`);
      addNode(iid, match[1], "interface", { source_path: relPath, source_location: lineAt(content, match.index) });
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
      addNode(tid, match[1], "type", { source_path: relPath, source_location: lineAt(content, match.index) });
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
          addEdge(fileId, tid, "references", "AMBIGUOUS");
        }
      }
    }
  }

  // Generic walker for non-JS languages (py/go/rs/java/rb/php/…). Same
  // contract as the JS walkers: file node + symbol nodes + `defines` +
  // relative-import bindings + call sites registered for the linking pass.
  function walkGenericFile(content, fileBase, filePath, lang) {
    const relPath = relative(cwd, filePath).replace(/\\/g, "/");
    const fileId = hashId(fileBase);
    addNode(fileId, fileBase, "file", { source_path: relPath, language: lang });
    fileRecords.set(relPath, { fileId, fileBase });
    const pending = [];
    const calls = [];
    const define = (name, type, index) => {
      const id = hashId(`${type}:${fileBase}:${name}`);
      addNode(id, name, type, { source_path: relPath, source_location: lineAt(content, index), language: lang });
      addEdge(fileId, id, "defines");
      if (type === "function" || type === "class") recordFn(relPath, fileId, fileBase, name, id);
      return id;
    };
    let match;
    const patterns = {
      py: {
        fn: /^\s*(?:async\s+)?def\s+(\w+)\s*\(/gm,
        cls: /^\s*class\s+(\w+)/gm,
        imp: /^\s*(?:from\s+([\w.]+)\s+import\s+[^\n]+|import\s+([^\n]+))/gm,
      },
      go: {
        fn: /^\s*func\s+(?:\([^)]*\)\s+)?(\w+)\s*\(/gm,
        cls: /^\s*type\s+(\w+)\s+(?:struct|interface)/gm,
        imp: /^\s*(?:import\s+(?:\(\s*"([^"]+)"|"([^"]+)"))/gm,
      },
      rs: {
        fn: /^\s*(?:pub(?:\([^)]*\))?\s+)?fn\s+(\w+)\s*[<(]/gm,
        cls: /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:struct|enum|trait)\s+(\w+)/gm,
        imp: /^\s*use\s+([\w:]+)(?:::\{[\w,\s]+\})?\s*;/gm,
      },
      java: {
        fn: /^\s*(?:public|private|protected)?\s*(?:static\s+)?[\w<>\[\]]+\s+(\w+)\s*\([^;]*\)\s*(?:throws[^{]*)?\{/gm,
        cls: /^\s*(?:public\s+)?(?:class|interface|enum)\s+(\w+)/gm,
        imp: /^\s*import\s+(?:static\s+)?([\w.]+)\s*;/gm,
      },
    }[lang] || { fn: /^\s*(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\()/gm, cls: /^\s*class\s+(\w+)/gm, imp: /^\s*(?:from\s+["']([^"']+)["']|require\(["']([^"']+)["']\))/gm };
    while ((match = patterns.fn.exec(content)) !== null) define(match[1] || match[2], "function", match.index);
    patterns.fn.lastIndex = 0;
    while ((match = patterns.cls.exec(content)) !== null) define(match[1], "class", match.index);
    patterns.cls.lastIndex = 0;
    while ((match = patterns.imp.exec(content)) !== null) {
      const req = (match[1] || match[2] || "").trim();
      if (!req) continue;
      // Python bare imports (`from auth import login`) resolve as same-dir
      // siblings in the linking pass; push the binding unconditionally.
      if (lang === "py" && !/^[./]/.test(req) && /^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/.test(req)) {
        const fromImp = /from\s+[\w.]+\s+import\s+([\w\s,()]+)/.exec(match[0]);
        const names = fromImp ? fromImp[1].replace(/[()]/g, "").split(",").map((s) => s.trim().split(/\s+/)[0]).filter(Boolean) : [req.split(".").pop()];
        for (const nm of names) if (/^[A-Za-z_]\w*$/.test(nm)) addPendingBinding(pending, nm, `./${req.split(".")[0]}`);
      }
      if (/^[./]/.test(req)) {
        // relative: try to recover imported names from the same line/block
        const lineStart = Math.max(0, match.index - 300);
        const ctx = content.slice(lineStart, match.index + match[0].length);
        const names = new Set();
        for (const nm of [/(\w+)\s*=\s*$/.exec(ctx)?.[1], ...[...ctx.matchAll(/\b(import)\s+(\w+)/g)].map((m) => m[2])]) if (nm) names.add(nm);
        const fromImp = /from\s+[\w.]+\s+import\s+([\w\s,()]+)/.exec(match[0]);
        if (fromImp) for (const nm of fromImp[1].replace(/[()]/g, "").split(",").map((s) => s.trim().split(/\s+/)[0]).filter(Boolean)) names.add(nm);
        for (const nm of names) addPendingBinding(pending, nm, req);
      } else {
        const mod = req.split(/[./:]/)[0];
        if (mod && mod.length > 1) {
          const tid = hashId(`module:${mod}`);
          addNode(tid, mod, "module");
          addEdge(fileId, tid, "depends_on");
        }
      }
    }
    patterns.imp.lastIndex = 0;
    // Bare call sites attributed to the nearest preceding definition.
    const callRe = /(?:^|[^\w$.])\b([A-Za-z_]\w*)\s*\(/g;
    let cm;
    while ((cm = callRe.exec(content)) !== null) {
      const nm = cm[1];
      if (["if", "for", "while", "switch", "catch", "return", "import", "require", "print"].includes(nm)) continue;
      // Method call `obj.fn(` — the method name is not a resolvable symbol.
      const after = content.slice(cm.index + cm[0].length, cm.index + cm[0].length + 1);
      const prevChar = content[cm.index] || "";
      if (prevChar === "." || after === ".") continue;
      // Skip only the definition's own name (`def f(`, `func f(`, `fn f(`).
      // Calls later on the SAME line (e.g. one-line bodies) still count.
      const lineStart = content.lastIndexOf("\n", cm.index) + 1;
      const upto = content.slice(lineStart, cm.index + cm[0].length);
      if (/(?:async\s+)?def\s+\w+\s*\($/.test(upto) || /func\s+(?:\([^)]*\)\s+)?\w+\s*\($/.test(upto) || /(?:pub[^\n]*?)?fn\s+\w+\s*[<(]$/.test(upto) || /class\s+\w+\s*\($/.test(upto)) continue;
      const before = content.slice(0, cm.index);
      const defs = [...before.matchAll(lang === "py" ? /^\s*(?:async\s+)?def\s+(\w+)/gm : lang === "go" ? /^\s*func\s+(?:\([^)]*\)\s+)?(\w+)/gm : lang === "rs" ? /^\s*(?:pub[^\n]*?)?fn\s+(\w+)/gm : /function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=/g)];
      const last = defs.length ? defs[defs.length - 1] : null;
      calls.push({ caller: last ? (last[1] || last[2]) : null, callee: nm });
    }
    fileCallData.push({ fileId, fileBase, relPath, pending, calls });
  }

  function langOf(file) {
    const ext = extname(file).toLowerCase();
    if (ext === ".py") return "py";
    if (ext === ".go") return "go";
    if (ext === ".rs") return "rs";
    if (ext === ".java") return "java";
    if (ext === ".rb" || ext === ".php") return "rb";
    return "";
  }

  // Process each file
  for (const file of files) {
    let content;
    try { content = readFileSync(file, "utf-8"); } catch { continue; }
    const fileBase = basename(file).replace(/\.[^.]+$/, "");

    if (hasAcorn && /\.(js|jsx|mjs|cjs)$/i.test(file)) {
      // Use real AST for JS files
      walkASTWithAcorn(acornDeps.acorn, acornDeps.acornLoose, content, fileBase, file);
    } else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(file)) {
      // Use regex for JS/TS files when Acorn is unavailable or explicitly disabled.
      walkASTWithRegex(content, fileBase, file);
    } else {
      // Python/Go/Rust/Java/Ruby/PHP: dedicated symbol walker.
      walkGenericFile(content, fileBase, file, langOf(file) || "generic");
    }
  }

  // Linking pass: resolve name bindings to repo files, then emit
  // file->file `imports` (EXTRACTED) and function->function `calls`
  // (EXTRACTED when the callee is defined in the bound file, else INFERRED).
  const resolveLocalLink = (fromRel, request) => {
    if (!request || !request.startsWith(".")) return "";
    const base = normalize(join(dirname(fromRel), request)).replace(/\\/g, "/");
    const cands = [base, `${base}.js`, `${base}.jsx`, `${base}.mjs`, `${base}.cjs`, `${base}.ts`, `${base}.tsx`, `${base}.py`, `${base}.go`, `${base}.rs`, `${base}.java`, `${base}.rb`, `${base}.php`, `${base}/index.js`, `${base}/index.ts`, `${base}/__init__.py`];
    return cands.find((c) => fileRecords.has(c) || fileSymbols.has(c)) || "";
  };
  const fnId = (rel, name) => fileSymbols.get(rel)?.fns.get(name) || "";
  for (const rec of fileCallData) {
    const bindings = new Map(); // local name -> target relPath
    for (const b of rec.pending || []) {
      const target = resolveLocalLink(rec.relPath, b.request);
      if (target) bindings.set(b.name, target);
    }
    const boundTargets = new Set(bindings.values());
    for (const target of boundTargets) {
      const tgt = fileRecords.get(target) || fileSymbols.get(target);
      if (tgt) addEdge(rec.fileId, tgt.fileId, "imports", "EXTRACTED");
    }
    const ownFns = fileSymbols.get(rec.relPath)?.fns;
    for (const call of rec.calls || []) {
      // Same-file call (fn calls sibling fn): no import binding needed.
      if (!bindings.has(call.callee) && ownFns?.has(call.callee)) {
        const calleeId = ownFns.get(call.callee);
        const callerId = (call.caller && ownFns.get(call.caller)) || rec.fileId;
        if (callerId !== calleeId) addEdge(callerId, calleeId, "calls", "EXTRACTED");
        continue;
      }
      const target = bindings.get(call.callee) || (ownFns?.has(call.callee) ? rec.relPath : "");
      if (!target) continue;
      const calleeId = fnId(target, call.callee);
      if (call.caller) {
        const callerId = fnId(rec.relPath, call.caller) || rec.fileId;
        if (calleeId) addEdge(callerId, calleeId, "calls", "EXTRACTED");
        else addEdge(callerId, fileRecords.get(target)?.fileId || fileSymbols.get(target)?.fileId || rec.fileId, "calls", "INFERRED");
      } else if (calleeId) {
        addEdge(rec.fileId, calleeId, "calls", "INFERRED");
      }
    }
  }

  return { nodes, edges, hasAcorn, files: files.length };
}

// Full repository index used by `cm init --deep` and `cm update --memory --deep`.
// This is deliberately broader than the AST pass: a knowledge graph needs the
// repository's documents, folders, configuration, assets, and cross-file
// references, not only executable symbols.
function scanRepositoryInventory(cwd, opts = {}) {
  const nodes = [], edges = [];
  const seenNodes = new Set(), seenEdges = new Set();
  const files = [], directories = [];
  const ignored = new Set([
    ".git", ".obsidian", ".trash", "node_modules", "memory", "dist", "build",
    "coverage", ".next", ".venv", "venv", "__pycache__", ".cache", ".turbo",
  ]);
  const allowedHidden = new Set([".claude", ".codex", ".gemini", ".qwen", ".pi", ".cursor", ".github", ".windsurf"]);
  const maxFiles = Number(opts.maxFiles || 20000);
  const maxDepth = Number(opts.maxDepth || 14);
  const textExtensions = new Set([
    ".md", ".markdown", ".txt", ".json", ".jsonc", ".yaml", ".yml", ".toml", ".ini",
    ".conf", ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".py", ".go", ".rs",
    ".java", ".rb", ".php", ".css", ".scss", ".html", ".xml", ".sh", ".zsh",
  ]);
  const codeExtensions = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".py", ".go", ".rs", ".java", ".rb", ".php"]);
  const sourcePath = (full) => relative(cwd, full).replace(/\\/g, "/") || ".";
  const dirId = (rel) => `path:dir:${rel || "."}`;
  const fileId = (rel) => `path:file:${rel}`;
  const addNode = (node) => {
    if (!node.id || seenNodes.has(node.id)) return;
    seenNodes.add(node.id);
    nodes.push(node);
  };
  const addEdge = (edge) => {
    if (!edge.source || !edge.target || edge.source === edge.target) return;
    const key = `${edge.source}|${edge.target}|${edge.relation}`;
    if (seenEdges.has(key)) return;
    seenEdges.add(key);
    edges.push({ confidence: "EXTRACTED", metadata: {}, created: nowIso(), ...edge });
  };
  const fileType = (full) => {
    const ext = extname(full).toLowerCase();
    if (ext === ".md" || ext === ".markdown") return "document";
    if (codeExtensions.has(ext)) return "code-file";
    if ([".json", ".jsonc", ".yaml", ".yml", ".toml", ".ini", ".conf", ".env"].includes(ext)) return "configuration";
    if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico", ".pdf"].includes(ext)) return "asset";
    return "file";
  };
  const addDirectory = (full, rel) => {
    const id = dirId(rel);
    addNode({ id, label: rel === "." ? `${basename(cwd)}/` : `${basename(full)}/`, type: rel === "." ? "project-directory" : "directory", metadata: { source_path: rel }, created: nowIso() });
    return id;
  };
  const addFile = (full, rel, stat) => {
    const id = fileId(rel);
    const ext = extname(full).toLowerCase();
    addNode({ id, label: rel, type: fileType(full), metadata: { source_path: rel, extension: ext, bytes: stat.size, modified_at: stat.mtime.toISOString() }, created: stat.mtime.toISOString() });
    files.push({ full, relative: rel, id, type: fileType(full), extension: ext, size: stat.size });
    return id;
  };
  const walk = (dir, depth, parentId) => {
    if (depth > maxDepth || files.length >= maxFiles) return;
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    const sorted = entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of sorted) {
      if (ignored.has(entry.name) || (entry.name.startsWith(".") && !allowedHidden.has(entry.name))) continue;
      const full = join(dir, entry.name);
      let stat;
      try { stat = statSync(full); } catch { continue; }
      if (entry.isDirectory() || stat.isDirectory()) {
        const rel = sourcePath(full);
        const id = addDirectory(full, rel);
        addEdge({ source: parentId, target: id, relation: "contains" });
        walk(full, depth + 1, id);
      } else if ((entry.isFile() || stat.isFile()) && files.length < maxFiles) {
        const rel = sourcePath(full);
        const id = addFile(full, rel, stat);
        addEdge({ source: parentId, target: id, relation: "contains" });
      }
    }
  };

  const rootId = addDirectory(cwd, ".");
  addNode({ id: "project_root", label: basename(cwd), type: "project", metadata: { path: cwd }, created: nowIso() });
  addEdge({ source: "project_root", target: rootId, relation: "contains" });
  walk(cwd, 0, rootId);
  const byRelative = new Map(files.map((file) => [file.relative, file]));
  const resolveRelative = (from, request) => {
    const base = normalize(join(dirname(from), request)).replace(/^\.\//, "").replace(/\\/g, "/");
    const candidates = [base, ...[".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".py", ".json"].map((suffix) => `${base}${suffix}`), ...["index.js", "index.ts", "index.tsx", "index.py"].map((suffix) => `${base}/${suffix}`)];
    return candidates.find((candidate) => byRelative.has(candidate)) || "";
  };
  const importRe = /(?:from\s*["']([^"']+)["']|require\(\s*["']([^"']+)["']\s*\)|import\s*["']([^"']+)["'])/g;
  const headings = [];
  for (const file of files) {
    let content = "";
    if (textExtensions.has(file.extension) && file.size <= 256 * 1024) {
      try { content = readFileSync(file.full, "utf-8"); } catch {}
    }
    if (!content) continue;
    if (/\.md(?:own)?$/i.test(file.extension)) {
      let headingMatch;
      const headingRe = /^(#{1,6})\s+(.+)$/gm;
      while ((headingMatch = headingRe.exec(content)) !== null) {
        const title = headingMatch[2].trim().replace(/[#`*_]/g, "").slice(0, 180);
        if (!title) continue;
        const id = `section:${hashText(`${file.relative}:${title}`)}`;
        addNode({ id, label: title, type: "section", metadata: { source_path: file.relative, heading_level: headingMatch[1].length }, created: nowIso() });
        addEdge({ source: file.id, target: id, relation: "contains" });
        headings.push({ id, source: file.relative, title });
      }
    }
    if (codeExtensions.has(file.extension)) {
      importRe.lastIndex = 0;
      let match;
      while ((match = importRe.exec(content)) !== null) {
        const target = (match[1] || match[2] || match[3] || "").trim();
        if (!target || target === ".") continue;
        if (target.startsWith(".")) {
          const resolved = resolveRelative(file.relative, target);
          if (resolved) addEdge({ source: file.id, target: fileId(resolved), relation: "imports" });
        } else {
          const moduleId = `module:${target.split("/")[0]}`;
          addNode({ id: moduleId, label: target.split("/")[0], type: "module", metadata: { package: target }, created: nowIso() });
          addEdge({ source: file.id, target: moduleId, relation: "depends_on", confidence: "INFERRED" });
        }
      }
    }
  }
  return { nodes, edges, files, directories, headings, rootId };
}
