const { HIGHLIGHT_SCORES, DEFAULTS, SCORING } = require('../../config/constants');
const { findOrphanFiles } = require('../../utils/orphan-detector');

function toRelativePath(root, filePath) {
  if (!root || !filePath) return filePath;
  let normalizedRoot = root.replace(/\\/g, '/');
  // Strip trailing slashes (except root '/') so absolute paths reliably resolve to relative
  if (normalizedRoot.length > 1 && normalizedRoot.endsWith('/')) {
    normalizedRoot = normalizedRoot.slice(0, -1);
  }
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

function countTreeFiles(tree) {
  if (!Array.isArray(tree)) return 0;
  let count = 0;
  for (const node of tree) {
    if (node.type === 'file') {
      count += 1;
    } else if (node.type === 'directory' && Array.isArray(node.children)) {
      count += typeof node.totalFileCount === 'number'
        ? node.totalFileCount
        : countTreeFiles(node.children);
    }
  }
  return count;
}

function getDirectoryOf(relativePath) {
  const idx = relativePath.lastIndexOf('/');
  return idx > 0 ? relativePath.slice(0, idx) : '.';
}

function scoreHighlightedFile(reason) {
  return HIGHLIGHT_SCORES[reason] || 0;
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

  return Array.from(map.values())
    .map(({ file, reasons }) => {
      const bestReason = reasons.reduce((best, r) =>
        scoreHighlightedFile(r) > scoreHighlightedFile(best) ? r : best, reasons[0]);
      return { file, reason: bestReason, score: scoreHighlightedFile(bestReason) };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.file.localeCompare(b.file);
    })
    .map(({ file, reason }) => ({ file, reason }));
}

function buildCompactSummary(issueOverlay) {
  const counts = {
    deadExports: issueOverlay.deadExports?.length ?? 0,
    unresolved: issueOverlay.unresolved?.length ?? 0,
    cycles: issueOverlay.cycles?.length ?? 0,
    orphans: issueOverlay.orphans?.length ?? 0,
    hotspots: issueOverlay.hotspots?.length ?? 0,
  };

  let severity = 'low';
  if (counts.unresolved > 0 || counts.cycles > 0) severity = 'high';
  else if (counts.deadExports > 0 || counts.orphans > 0) severity = 'medium';
  else if (counts.hotspots === 0) severity = 'none';

  const nextSteps = [];
  if (counts.unresolved > 0) nextSteps.push(`Inspect ${counts.unresolved} unresolved import(s) first — likely broken code path`);
  if (counts.cycles > 0) nextSteps.push(`Break ${counts.cycles} dependency cycle(s) before broad refactors`);
  if (counts.deadExports > 0) nextSteps.push(`Review ${counts.deadExports} dead export(s) as deletion candidates (verify dynamic loading)`);
  if (counts.orphans > 0) nextSteps.push(`Verify ${counts.orphans} orphan file(s) — may be unused or missing entry detection`);
  if (counts.hotspots > 0) nextSteps.push(`Review ${counts.hotspots} hotspot file(s) for refactoring risk`);
  if (nextSteps.length === 0) nextSteps.push('No structural issues detected by the aggregate audit.');

  return { severity, issueCounts: counts, nextSteps };
}

/** Extract module prefix (up to three path segments) from a directory path.
 *  Returns the full path if it has 2 or fewer segments. */
function getModuleOf(dirPath) {
  if (dirPath === '.') return '.';
  const parts = dirPath.split('/');
  if (parts.length <= 2) return dirPath;
  return parts.slice(0, 3).join('/');
}

function buildProjectMap(depGraph, options = {}) {
  if (!depGraph) {
    return { ok: false, error: 'Dependency graph not initialized' };
  }

  const compact = options.compact || false;
  const root = depGraph.root || depGraph.workspaceRoot || '';
  const projectContext = depGraph.projectContext || null;
  const allFiles = Array.from(depGraph.graph?.keys() || []).map((k) => depGraph._displayPath?.(k) || k);

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
    // buildDirectorySkeleton drops file nodes entirely, so compactTree field deletion is unnecessary.
    tree = buildDirectorySkeleton(tree, 3).nodes;
  }

  // Edges: import relationships
  let edges;
  if (compact) {
    // Compact: aggregate directly to module level, skipping file-level edgeMap + rawEdges.
    // Avoids building intermediate file-level edges and re-export records that are
    // ultimately discarded by the old aggregate pipeline.
    const modEdgeMap = new Map();
    for (const file of allFiles) {
      const fromRel = toRelativePath(root, file);
      const fromDir = getDirectoryOf(fromRel);
      const fromMod = getModuleOf(fromDir);
      const info = depGraph.getFileInfo(file) || {};
      const imports = info.importRecords || [];
      const importRecords = Array.isArray(imports) && imports.length > 0
        ? imports
        : (info.imports || []).map((source) => ({ source, usesAllExports: true }));

      for (const record of importRecords) {
        const resolved = record.resolved || record.source;
        if (!resolved) continue;
        const toRel = toRelativePath(root, resolved);
        const toDir = getDirectoryOf(toRel);
        if (fromDir === toDir) continue;
        const toMod = getModuleOf(toDir);
        if (fromMod === toMod) continue;

        const key = `${fromMod}|${toMod}`;
        const existing = modEdgeMap.get(key);
        if (existing) {
          existing.usesAllExports = existing.usesAllExports || Boolean(record.usesAllExports);
        } else {
          modEdgeMap.set(key, {
            from: fromMod,
            to: toMod,
            type: 'import',
            usesAllExports: Boolean(record.usesAllExports),
          });
        }
      }
    }
    edges = Array.from(modEdgeMap.values());
  } else {
    // Full: build file-level edgeMap with symbol merging and re-export tracking.
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
    edges = Array.from(edgeMap.values());
  }

  // IssueOverlay
  const deadExports = depGraph.findDeadExports?.() || [];
  const unresolved = depGraph.findUnresolvedImports?.() || [];
  const cycles = depGraph.findCircularDependencies?.() || [];

  const entrySet = depGraph.entryFiles || new Set();
  const orphanResult = findOrphanFiles(allFiles, entrySet, depGraph, root, toRelativePath, depGraph.isKnownEntryFile?.bind(depGraph), depGraph.shouldExcludeCli?.bind(depGraph));
  const orphans = orphanResult.all;

  // Hotspots: files with high dependent count (dependency centrality)
  const hotspots = [];
  for (const file of allFiles) {
    const dependents = depGraph.getDependents?.(file) || [];
    if (dependents.length >= SCORING.HOTSPOT_MIN_DEPENDENTS) {
      hotspots.push({
        file: toRelativePath(root, file),
        dependentsCount: dependents.length,
        reason: `Imported by ${dependents.length} files`,
      });
    }
  }
  hotspots.sort((a, b) => (b.dependentsCount || 0) - (a.dependentsCount || 0));

  const issueOverlay = {
    deadExports: deadExports.map((item) => compact
      ? { file: toRelativePath(root, item.file), confidence: item.confidence || 'medium' }
      : { file: toRelativePath(root, item.file), exports: item.exports, confidence: item.confidence || 'medium' }
    ).slice(0, compact ? DEFAULTS.COMPACT_ISSUE_MAX_ITEMS : deadExports.length),
    unresolved: unresolved.map((item) => ({
      file: toRelativePath(root, item.file),
      import: item.import,
      resolvedTo: item.resolvedTo || null,
    })).slice(0, compact ? DEFAULTS.COMPACT_ISSUE_MAX_ITEMS : unresolved.length),
    cycles: cycles.map((cycle) => cycle.map((f) => toRelativePath(root, f))),
    orphans: compact ? orphans.slice(0, DEFAULTS.COMPACT_ORPHAN_MAX_ITEMS) : orphans,
    hotspots: hotspots.slice(0, 10),
  };

  // In compact mode AI can't see the full file list; surface noteworthy files explicitly.
  let highlightedFiles = compact ? buildHighlightedFiles(entrySet, issueOverlay, root) : [];
  if (compact && highlightedFiles.length > DEFAULTS.PROJECT_MAP_HIGHLIGHT_MAX) highlightedFiles = highlightedFiles.slice(0, DEFAULTS.PROJECT_MAP_HIGHLIGHT_MAX);

  const result = {
    ok: true,
    workspaceRoot: root,
    tree,
    edges,
    issueOverlay,
    highlightedFiles,
  };

  result.summary = buildCompactSummary(issueOverlay);

  return result;
}

module.exports = {
  buildProjectMap,
  buildDirectoryTree,
  toRelativePath,
  countTreeFiles,
};
