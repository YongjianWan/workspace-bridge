const fs = require('fs');
const path = require('path');

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
  const candidates = [
    path.join(root, relative),
    path.join(root, 'src', relative),
    path.join(root, 'src', 'main', 'java', relative),
    path.join(root, 'src', 'test', 'java', relative),
    path.join(root, 'app', relative),
  ];
  for (const base of candidates) {
    const fullPath = `${base}.java`;
    if (fs.existsSync(fullPath)) {
      return fullPath;
    }
  }
  return null;
}

function resolveImport(fromFile, importPath, ext, root) {
  if (ext === '.py') {
    return resolvePythonImport(fromFile, importPath, root);
  }
  if (ext === '.java') {
    return resolveJavaImport(importPath, root);
  }

  return resolveJavaScriptImport(fromFile, importPath);
}

module.exports = {
  resolveImport,
};
