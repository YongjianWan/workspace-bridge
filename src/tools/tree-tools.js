/**
 * Tree query — build import/dependent trees from the dependency graph.
 */

const path = require('path');

function buildTree(rootFile, depGraph, options = {}) {
  const maxDepth = options.maxDepth || 3;
  const direction = options.direction || 'both'; // 'imports' | 'dependents' | 'both'
  const visited = new Set();

  function walk(file, depth, dir) {
    const normalized = depGraph.normalizeFilePath?.(file) || file;
    if (visited.has(`${normalized}:${dir}:${depth}`)) {
      return null;
    }
    // Only mark visited per-direction to avoid cross-contamination,
    // but allow revisiting the same file at different depths for tree display
    if (depth > 0) {
      visited.add(`${normalized}:${dir}:${depth}`);
    }

    const result = {
      file: normalized,
      depth,
    };

    if (dir === 'imports' || dir === 'both') {
      const imports = depGraph.getDependencies(normalized)
        .filter((imp) => !imp.startsWith('.')) // internal imports only? no, keep all
        .map((imp) => {
          const resolved = depGraph.hasFile(imp) ? imp : null;
          return { file: imp, resolved, external: !resolved };
        });

      if (imports.length > 0 && depth < maxDepth) {
        result.imports = imports
          .map((imp) => {
            const child = imp.resolved ? walk(imp.resolved, depth + 1, 'imports') : null;
            if (child) {
              return child;
            }
            return { file: imp.file, external: imp.external, depth: depth + 1 };
          })
          .filter(Boolean);
      } else if (imports.length > 0) {
        result.imports = imports.map((imp) => ({
          file: imp.file,
          external: imp.external,
          depth: depth + 1,
        }));
      }
    }

    if ((dir === 'dependents' || dir === 'both') && depth < maxDepth) {
      const dependents = depGraph.getDependents(normalized);
      if (dependents.length > 0) {
        result.dependents = dependents
          .map((dep) => walk(dep, depth + 1, 'dependents'))
          .filter(Boolean);
      }
    }

    return result;
  }

  const rootNormalized = depGraph.normalizeFilePath?.(rootFile) || rootFile;
  const tree = walk(rootNormalized, 0, direction);

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
