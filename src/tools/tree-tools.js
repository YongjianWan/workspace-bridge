/**
 * Tree query — build import/dependent trees from the dependency graph.
 */

const path = require('path');
const { SCHEMA_VERSION } = require('../config/constants');

function buildTree(rootFile, depGraph, options = {}) {
  const maxDepth = options.maxDepth || 3;
  const direction = options.direction || 'both'; // 'imports' | 'dependents' | 'both'
  const maxFiles = Number.isFinite(options.maxFiles) && options.maxFiles > 0 ? options.maxFiles : null;

  function walk(file, depth, dir, pathStack) {
    const normalized = depGraph.normalizeFilePath?.(file) || file;

    // Prevent cycles on the current path (tree view: same file in one branch = loop)
    if (pathStack.has(normalized)) {
      return { file: normalized, circular: true };
    }

    const result = {
      file: normalized,
    };
    const shouldExpand = depth < maxDepth;
    const nextStack = new Set(pathStack);
    nextStack.add(normalized);
    const isRoot = depth === 0;

    if (dir === 'imports' || dir === 'both') {
      let imports = depGraph.getDependencies(normalized).map((imp) => {
        const resolved = depGraph.hasFile(imp) ? imp : null;
        return { file: imp, resolved, external: !resolved };
      });
      // Wave 12-5: cap root-level fan-out when --max-files is used.
      if (isRoot && maxFiles && imports.length > maxFiles) {
        imports = imports.slice(0, maxFiles);
        result.importsTruncated = true;
      }

      if (imports.length > 0) {
        result.imports = imports
          .map((imp) => {
            if (imp.resolved && shouldExpand) {
              const child = walk(imp.resolved, depth + 1, 'imports', nextStack);
              if (child) return child;
            }
            return { file: imp.file, external: imp.external, depth: depth + 1 };
          })
          .filter(Boolean);
      }
    }

    if (dir === 'dependents' || dir === 'both') {
      let dependents = depGraph.getDependents(normalized);
      // Wave 12-5: cap root-level fan-out when --max-files is used.
      if (isRoot && maxFiles && dependents.length > maxFiles) {
        dependents = dependents.slice(0, maxFiles);
        result.dependentsTruncated = true;
      }
      if (dependents.length > 0) {
        result.dependents = dependents
          .map((dep) => {
            if (shouldExpand) {
              const child = walk(dep, depth + 1, 'dependents', nextStack);
              if (child) return child;
            }
            return { file: dep, depth: depth + 1 };
          })
          .filter(Boolean);
      }
    }

    return result;
  }

  const rootNormalized = depGraph.normalizeFilePath?.(rootFile) || rootFile;
  const tree = walk(rootNormalized, 0, direction, new Set());

  // Remove depth from root to keep it clean
  if (tree) {
    delete tree.depth;
  }

  return tree;
}

function treeQuery({ cwd, file, depth, direction, maxFiles }, container) {
  if (!container || !container.ensureReady) {
    throw new Error('Container not ready');
  }
  container.ensureReady();

  const depGraph = container.snapshot?.graph || container.depGraph;
  if (!depGraph) {
    throw new Error('DependencyGraph not initialized');
  }

  const resolvedFile = path.resolve(cwd || process.cwd(), file);
  const normalized = depGraph.normalizeFilePath?.(resolvedFile) || resolvedFile;

  if (!depGraph.hasFile(normalized)) {
    return {
      ok: false,
      error: `File not found in dependency graph: ${file}`,
      schemaVersion: SCHEMA_VERSION,
    };
  }

  const tree = buildTree(normalized, depGraph, {
    maxDepth: depth,
    direction: direction || 'both',
    maxFiles,
  });

  return {
    ok: true,
    file: normalized,
    tree,
    truncated: Boolean(tree?.importsTruncated || tree?.dependentsTruncated),
    schemaVersion: SCHEMA_VERSION,
  };
}

module.exports = {
  buildTree,
  treeQuery,
};
