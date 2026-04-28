const fs = require('fs');
const path = require('path');

let _javaSourceRootsCache = new Map(); // root -> string[]

function discoverJavaSourceRoots(root) {
  if (_javaSourceRootsCache.has(root)) {
    return _javaSourceRootsCache.get(root);
  }

  const roots = [root, path.join(root, 'src'), path.join(root, 'app')];

  // Single-module projects
  for (const srcDir of ['src/main/java', 'src/test/java', 'src/main/kotlin', 'src/test/kotlin']) {
    const candidate = path.join(root, srcDir);
    if (fs.existsSync(candidate)) {
      roots.push(candidate);
    }
  }

  // Multi-module projects
  try {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const sub = path.join(root, entry.name);
      for (const srcDir of ['src/main/java', 'src/test/java', 'src/main/kotlin', 'src/test/kotlin']) {
        const candidate = path.join(sub, srcDir);
        if (fs.existsSync(candidate)) {
          roots.push(candidate);
        }
      }
    }
  } catch (e) {
    // root unreadable, ignore
  }

  _javaSourceRootsCache.set(root, roots);
  return roots;
}

function resolvePythonImport(fromFile, importPath, root) {
  const tryPythonCandidates = (basePath) => {
    const candidates = [
      `${basePath}.py`,
      path.join(basePath, '__init__.py'),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
    return null;
  };

  if (importPath.startsWith('.')) {
    const leadingDots = importPath.match(/^\.+/)[0].length;
    const remainder = importPath.slice(leadingDots);
    let currentDir = path.dirname(fromFile);

    for (let i = 1; i < leadingDots; i += 1) {
      currentDir = path.dirname(currentDir);
    }

    const basePath = remainder
      ? path.join(currentDir, ...remainder.split('.'))
      : currentDir;

    return tryPythonCandidates(basePath) || basePath;
  }

  const modulePath = importPath.split('.').join(path.sep);
  const searchRoots = [
    root,
    path.join(root, 'backend'),
    path.join(root, 'src'),
    path.join(root, 'app'),
  ];

  for (const searchRoot of searchRoots) {
    const resolved = tryPythonCandidates(path.join(searchRoot, modulePath));
    if (resolved) {
      return resolved;
    }
  }

  return null;
}

function resolveJavaScriptImport(fromFile, importPath) {
  if (!importPath.startsWith('.') && !importPath.startsWith('/')) {
    return null;
  }

  const fromDir = path.dirname(fromFile);
  const resolvedBase = importPath.startsWith('.')
    ? path.resolve(fromDir, importPath)
    : importPath;

  const sourceExt = path.extname(fromFile).toLowerCase();
  const importExt = path.extname(importPath).toLowerCase();
  const isTypeScriptSource = ['.ts', '.tsx', '.mts', '.cts'].includes(sourceExt);

  const candidates = new Set();
  const addCandidate = (candidate) => {
    if (candidate) candidates.add(candidate);
  };

  addCandidate(resolvedBase);

  if (isTypeScriptSource && ['.js', '.mjs', '.cjs'].includes(importExt)) {
    const withoutImportExt = resolvedBase.slice(0, -importExt.length);
    addCandidate(`${withoutImportExt}.ts`);
    addCandidate(`${withoutImportExt}.tsx`);
    addCandidate(`${withoutImportExt}.mts`);
    addCandidate(`${withoutImportExt}.cts`);
    addCandidate(path.join(withoutImportExt, 'index.ts'));
    addCandidate(path.join(withoutImportExt, 'index.tsx'));
    addCandidate(path.join(withoutImportExt, 'index.mts'));
    addCandidate(path.join(withoutImportExt, 'index.cts'));
  }

  if (!importExt) {
    addCandidate(`${resolvedBase}.js`);
    addCandidate(`${resolvedBase}.jsx`);
    addCandidate(`${resolvedBase}.ts`);
    addCandidate(`${resolvedBase}.tsx`);
    addCandidate(`${resolvedBase}.mjs`);
    addCandidate(`${resolvedBase}.cjs`);
    addCandidate(`${resolvedBase}.json`);
    addCandidate(`${resolvedBase}.css`);
    addCandidate(path.join(resolvedBase, 'index.js'));
    addCandidate(path.join(resolvedBase, 'index.jsx'));
    addCandidate(path.join(resolvedBase, 'index.ts'));
    addCandidate(path.join(resolvedBase, 'index.tsx'));
    addCandidate(path.join(resolvedBase, 'index.mjs'));
    addCandidate(path.join(resolvedBase, 'index.cjs'));
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return resolvedBase;
}

function resolveJavaImport(importPath, root) {
  if (!importPath || importPath.endsWith('.*')) {
    return null;
  }
  const relative = importPath.split('.').join(path.sep);
  const candidates = discoverJavaSourceRoots(root).map((r) => path.join(r, relative));

  for (const base of candidates) {
    for (const ext of ['.java', '.kt']) {
      const fullPath = `${base}${ext}`;
      if (fs.existsSync(fullPath)) {
        return fullPath;
      }
    }
  }
  return null;
}

function resolveGoImport(fromFile, importPath, root) {
  // Phase B: only same-directory relative imports
  if (importPath.startsWith('.')) {
    const fromDir = path.dirname(fromFile);
    const resolved = path.resolve(fromDir, importPath);
    if (fs.existsSync(resolved)) return resolved;
    if (fs.existsSync(`${resolved}.go`)) return `${resolved}.go`;
  }
  // Cross-package imports require go.mod parsing, not implemented yet
  return null;
}

function resolveRustImport(fromFile, importPath, root) {
  // Phase B: only intra-crate mod references; no actual path resolution yet
  if (!importPath.startsWith('crate::') && !importPath.startsWith('super::')) {
    return null;
  }
  return null;
}

function resolveImport(fromFile, importPath, ext, root) {
  if (ext === '.py') {
    return resolvePythonImport(fromFile, importPath, root);
  }
  if (ext === '.java' || ext === '.kt') {
    return resolveJavaImport(importPath, root);
  }
  if (ext === '.go') {
    return resolveGoImport(fromFile, importPath, root);
  }
  if (ext === '.rs') {
    return resolveRustImport(fromFile, importPath, root);
  }

  return resolveJavaScriptImport(fromFile, importPath);
}

module.exports = {
  resolveImport,
  resolveJavaImport,
};
