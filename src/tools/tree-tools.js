/**
 * Tree query — build import/dependent trees from the dependency graph.
 */

const path = require('path');

function buildTree(rootFile, depGraph, options = {}) {
  const maxDepth = options.maxDepth || 3;
  const direction = options.direction || 'both'; // 'imports' | 'dependents' | 'both'

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

    if (dir === 'imports' || dir === 'both') {
      const imports = depGraph.getDependencies(normalized).map((imp) => {
        const resolved = depGraph.hasFile(imp) ? imp : null;
        return { file: imp, resolved, external: !resolved };
      });

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
      const dependents = depGraph.getDependents(normalized);
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

function treeQuery({ cwd, file, depth, direction }, container) {
  if (!container || !container.ensureReady) {
    throw new Error('Container not ready');
  }
  container.ensureReady();

  const depGraph = container.depGraph;
  if (!depGraph) {
    throw new Error('DependencyGraph not initialized');
  }

  const resolvedFile = path.resolve(cwd || process.cwd(), file);
  const normalized = depGraph.normalizeFilePath?.(resolvedFile) || resolvedFile;

  if (!depGraph.hasFile(normalized)) {
    return {
      ok: false,
      error: `File not found in dependency graph: ${file}`,
      schemaVersion: '1.2.0',
    };
  }

  const tree = buildTree(normalized, depGraph, {
    maxDepth: Math.max(1, Math.min(depth || 3, 10)),
    direction: direction || 'both',
  });

  return {
    ok: true,
    file: normalized,
    tree,
    schemaVersion: '1.2.0',
  };
}

module.exports = {
  buildTree,
  treeQuery,
};
