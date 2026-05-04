function toRelativePath(root, filePath) {
  if (!root || !filePath) return filePath;
  const normalizedRoot = root.replace(/\\/g, '/');
  const normalizedFile = filePath.replace(/\\/g, '/');
  if (normalizedFile.toLowerCase().startsWith(normalizedRoot.toLowerCase())) {
    const nextChar = normalizedFile[normalizedRoot.length];
    if (nextChar !== '/' && nextChar !== undefined) {
      return normalizedFile;
    }
    let rel = normalizedFile.slice(normalizedRoot.length);
    return rel.replace(/^[/]+/, '');
  }
  return normalizedFile;
}

function buildDirectoryTree(flatFiles) {
  const root = [];
  const dirMap = new Map();

  for (const entry of flatFiles) {
    const parts = entry.file.split('/').filter(Boolean);
    let current = root;
    let currentPath = '';

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const pathKey = currentPath;

      let dirNode = dirMap.get(pathKey);
      if (!dirNode) {
        dirNode = { type: 'directory', name: part, path: currentPath, children: [] };
        dirMap.set(pathKey, dirNode);
        current.push(dirNode);
      }
      current = dirNode.children;
    }

    current.push({ type: 'file', name: parts[parts.length - 1], ...entry });
  }

  return root;
}

function compactTree(tree) {
  for (const node of tree) {
    if (node.type === 'file') {
      delete node.parseMode;
      delete node.exports;
    }
    if (node.type === 'directory' && node.children) {
      compactTree(node.children);
    }
  }
  return tree;
}

// Strip file nodes; keep only directory skeleton with file counts.
// Recursive structure naturally eliminates leaf files as a boundary case.
// When maxDepth is reached, deeper directories are folded into parent counts.
function buildDirectorySkeleton(tree, maxDepth = Infinity, currentDepth = 0) {
  const nodes = [];
  let foldedFileCount = 0;

  for (const n of tree) {
    if (n.type !== 'directory') continue;

    if (currentDepth >= maxDepth) {
      foldedFileCount += countAllFiles(n.children || []);
      continue;
    }

    const childResult = buildDirectorySkeleton(n.children || [], maxDepth, currentDepth + 1);
    const directFiles = (n.children || []).filter((c) => c.type === 'file').length;
    const totalFiles = directFiles + childResult.totalFileCount;

    nodes.push({
      type: 'directory',
      name: n.name,
      path: n.path,
      fileCount: currentDepth + 1 >= maxDepth ? totalFiles : directFiles,
      totalFileCount: totalFiles,
      children: childResult.nodes,
    });
  }

  const totalFileCount = nodes.reduce((sum, n) => sum + n.totalFileCount, 0) + foldedFileCount;
  return { nodes, totalFileCount };
}

/** Recursively count all file nodes in a tree branch. */
function countAllFiles(nodes) {
  let count = 0;
  for (const n of nodes || []) {
    if (n.type === 'file') count++;
    else if (n.type === 'directory') count += countAllFiles(n.children);
  }
  return count;
}

function getDirectoryOf(relativePath) {
  const idx = relativePath.lastIndexOf('/');
  return idx > 0 ? relativePath.slice(0, idx) : '.';
}

// Collect files worth calling out when the full file tree is hidden.
function buildHighlightedFiles(entrySet, issueOverlay, root) {
  const map = new Map();
  const add = (file, reason) => {
    if (!file) return;
    const rel = toRelativePath(root, file);
    if (!map.has(rel)) {
      map.set(rel, { file: rel, reasons: [reason] });
    } else if (!map.get(rel).reasons.includes(reason)) {
      map.get(rel).reasons.push(reason);
    }
  };

  for (const file of entrySet) add(file, 'entry');
  for (const item of issueOverlay.deadExports || []) add(item.file, 'dead-export');
  for (const item of issueOverlay.unresolved || []) add(item.file, 'unresolved');
  for (const cycle of issueOverlay.cycles || []) {
    for (const file of cycle) add(file, 'cycle');
  }
  for (const file of issueOverlay.orphans || []) add(file, 'orphan');
  for (const item of issueOverlay.hotspots || []) add(item.file, 'hotspot');

  return Array.from(map.values()).map(({ file, reasons }) => ({ file, reason: reasons[0] }));
}

function aggregateEdgesToDirectoryLevel(edges) {
  const map = new Map();
  for (const e of edges) {
    if (e.type === 're-export') continue;
    const fromDir = getDirectoryOf(e.from);
    const toDir = getDirectoryOf(e.to);
    if (fromDir === toDir) continue;
    const key = `${fromDir}|${toDir}|${e.type}`;
    const existing = map.get(key);
    if (existing) {
      existing.usesAllExports = existing.usesAllExports || Boolean(e.usesAllExports);
    } else {
      map.set(key, {
        from: fromDir,
        to: toDir,
        type: e.type,
        usesAllExports: Boolean(e.usesAllExports),
      });
    }
  }
  return Array.from(map.values());
}

/** Extract module prefix (first two path segments) from a directory path. */
function getModuleOf(dirPath) {
  if (dirPath === '.') return '.';
  const parts = dirPath.split('/');
  if (parts.length <= 1) return dirPath;
  return parts.slice(0, 2).join('/');
}

/** Aggregate directory-level edges up to module-level (first two path segments). */
function aggregateEdgesToModuleLevel(edges) {
  const map = new Map();
  for (const e of edges) {
    if (e.type !== 'import') continue;
    const fromMod = getModuleOf(e.from);
    const toMod = getModuleOf(e.to);
    if (fromMod === toMod) continue;
    const key = `${fromMod}|${toMod}`;
    const existing = map.get(key);
    if (existing) {
      existing.usesAllExports = existing.usesAllExports || Boolean(e.usesAllExports);
    } else {
      map.set(key, {
        from: fromMod,
        to: toMod,
        type: 'import',
        usesAllExports: Boolean(e.usesAllExports),
      });
    }
  }
  return Array.from(map.values());
}

function buildProjectMap(depGraph, options = {}) {
  if (!depGraph) {
    return { ok: false, error: 'Dependency graph not initialized' };
  }

  const compact = options.compact || false;
  const root = depGraph.root || depGraph.workspaceRoot || '';
  const projectContext = depGraph.projectContext || null;
  const allFiles = Array.from(depGraph.graph?.keys() || []);

  // Flat tree: all files with roles
  const flatTree = allFiles.map((file) => {
    const relative = toRelativePath(root, file);
    const classification = projectContext?.classifyFile?.(file) || {};
    const info = depGraph.getFileInfo(file) || {};
    const ext = (relative.match(/\.([^.]+)$/) || [])[1] || null;
    return {
      file: relative,
      role: classification.fileRole || 'library',
      mainline: classification.isMainline !== false,
      language: ext,
      parseMode: info.parseMode || 'none',
      exports: (info.exportRecords || info.exports || []).map((r) =>
        typeof r === 'string' ? r : r?.name
      ).filter(Boolean),
    };
  }).sort((a, b) => a.file.localeCompare(b.file));

  // Tree: directory-aggregated structure
  let tree = buildDirectoryTree(flatTree);
  if (compact) {
    tree = compactTree(tree);
    tree = buildDirectorySkeleton(tree, 2).nodes;
  }

  // Edges: import relationships (merge symbols for same from|to pairs)
  const edgeMap = new Map();
  for (const file of allFiles) {
    const fromRel = toRelativePath(root, file);
    const info = depGraph.getFileInfo(file) || {};
    const imports = info.importRecords || [];
    const importRecords = Array.isArray(imports) && imports.length > 0
      ? imports
      : (info.imports || []).map((source) => ({ source, usesAllExports: true }));

    for (const record of importRecords) {
      const resolved = record.resolved || record.source;
      if (!resolved) continue;
      const toRel = toRelativePath(root, resolved);
      const edgeKey = `${fromRel}|${toRel}`;
      const existing = edgeMap.get(edgeKey);
      if (existing) {
        for (const sym of record.imported || []) {
          if (!existing.symbols.includes(sym)) existing.symbols.push(sym);
        }
        existing.usesAllExports = existing.usesAllExports || Boolean(record.usesAllExports);
      } else {
        edgeMap.set(edgeKey, {
          from: fromRel,
          to: toRel,
          type: 'import',
          symbols: record.imported || [],
          usesAllExports: Boolean(record.usesAllExports),
        });
      }

      // Re-export edges piggyback on importRecords traversal
      if (record.reExportAll) {
        const reKey = `${fromRel}|${toRel}|re-export-all`;
        if (!edgeMap.has(reKey)) {
          edgeMap.set(reKey, {
            from: fromRel,
            to: toRel,
            type: 're-export-all',
            symbols: [],
          });
        }
      }
      if (record.reExported && record.reExported.length > 0) {
        for (const pair of record.reExported) {
          const reKey = `${fromRel}|${toRel}|re-export|${pair.imported || ''}|${pair.exported || ''}`;
          if (!edgeMap.has(reKey)) {
            edgeMap.set(reKey, {
              from: fromRel,
              to: toRel,
              type: 're-export',
              imported: pair.imported,
              exported: pair.exported,
            });
          }
        }
      }
    }
  }
  const rawEdges = Array.from(edgeMap.values());
  let edges = compact ? aggregateEdgesToDirectoryLevel(rawEdges) : rawEdges;
  if (compact) edges = aggregateEdgesToModuleLevel(edges);

  // IssueOverlay
  const deadExports = depGraph.findDeadExports?.() || [];
  const unresolved = depGraph.findUnresolvedImports?.() || [];
  const cycles = depGraph.findCircularDependencies?.() || [];

  // Simple orphan detection (inline to avoid circular deps with overview-tools)
  const orphans = [];
  const entrySet = depGraph.entryFiles || new Set();
  for (const file of allFiles) {
    if (depGraph.isTestLikeFile?.(file)) continue;
    const dependents = depGraph.getDependents?.(file) || [];
    const isEntry = entrySet.has?.(file) || entrySet.includes?.(file);
    if (!isEntry && dependents.length === 0) {
      orphans.push(toRelativePath(root, file));
    }
  }

  // Hotspots: files with high dependent count (dependency centrality)
  const hotspots = [];
  for (const file of allFiles) {
    const dependents = depGraph.getDependents?.(file) || [];
    if (dependents.length >= 5) {
      hotspots.push({
        file: toRelativePath(root, file),
        dependentCount: dependents.length,
        reason: `Imported by ${dependents.length} files`,
      });
    }
  }
  hotspots.sort((a, b) => (b.dependentCount || 0) - (a.dependentCount || 0));

  const issueOverlay = {
    deadExports: deadExports.map((item) => compact
      ? { file: toRelativePath(root, item.file), confidence: item.confidence || 'medium' }
      : { file: toRelativePath(root, item.file), exports: item.exports, confidence: item.confidence || 'medium' }
    ),
    unresolved: unresolved.map((item) => ({
      file: toRelativePath(root, item.file),
      import: item.import,
      resolvedTo: item.resolvedTo || null,
    })),
    cycles: cycles.map((cycle) => cycle.map((f) => toRelativePath(root, f))),
    orphans,
    hotspots: hotspots.slice(0, 10),
  };

  // In compact mode AI can't see the full file list; surface noteworthy files explicitly.
  let highlightedFiles = compact ? buildHighlightedFiles(entrySet, issueOverlay, root) : [];
  if (compact && highlightedFiles.length > 30) highlightedFiles = highlightedFiles.slice(0, 30);

  return {
    ok: true,
    workspaceRoot: root,
    tree,
    edges,
    issueOverlay,
    highlightedFiles,
  };
}

module.exports = {
  buildProjectMap,
  buildDirectoryTree,
  toRelativePath,
};
