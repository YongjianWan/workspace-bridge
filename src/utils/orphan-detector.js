/**
 * Orphan file detection — shared between project-map and overview-tools.
 * Eliminates inline duplication of orphan-detection logic.
 */
const path = require('path');
const { isStandaloneEntryPath, toRelativePosix } = require('./path');
const { ENTRY_BASE_NAMES } = require('./project-context');

/**
 * Find orphan files (not imported and not entry points).
 * @param {string[]} files — absolute file paths
 * @param {Set|string[]} entryFiles — absolute entry file paths
 * @param {object} graph — dependency graph with isTestLikeFile/getDependents
 * @param {string} root — workspace root
 * @param {Function|null} toRelativeFn — optional (root, filePath) => relativePath
 * @param {Function|null} isKnownEntryFile — optional (filePath) => boolean
 * @param {Function|null} shouldExclude — optional (filePath) => boolean
 * @returns {{docs: string[], scripts: string[], configs: string[], modules: string[], all: string[]}}
 */
function findOrphanFiles(files, entryFiles, graph, root, toRelativeFn = null, isKnownEntryFile = null, shouldExclude = null) {
  const orphans = { docs: [], scripts: [], configs: [], modules: [], all: [] };
  const toRel = toRelativeFn || toRelativePosix;

  for (const file of files) {
    const relativePath = toRel(root, file);
    const ext = path.extname(file).toLowerCase();
    const base = path.basename(file);

    if (shouldExclude?.(file)) continue;
    if (graph.isTestLikeFile?.(file)) continue;

    const dependents = graph.getDependents?.(file) || [];
    const isEntry = entryFiles.has?.(file) || entryFiles.includes?.(file);
    const isImported = dependents.length > 0;

    if (isEntry || isImported) continue;
    if (isKnownEntryFile?.(file)) continue; // shebang / config / framework entry files
    if (ENTRY_BASE_NAMES.has(base)) continue; // common entry files (main.js, app.js, etc.)
    if (isStandaloneEntryPath(relativePath)) continue; // scripts / bin / benchmark are standalone entry points

    orphans.all.push(relativePath);

    if (ext === '.md' || ext === '.mdx' || base.toLowerCase().includes('readme')) {
      orphans.docs.push(relativePath);
    } else if (ext === '.json' || ext === '.yaml' || ext === '.yml' || ext === '.toml') {
      orphans.configs.push(relativePath);
    } else if (['.js', '.ts', '.py', '.go', '.rs', '.java', '.kt', '.cpp', '.c', '.h', '.vue', '.svelte'].includes(ext)) {
      orphans.modules.push(relativePath);
    }
    // Other file types (e.g. .css, .html) are tracked in `all` but not categorized.
  }

  return orphans;
}

module.exports = { findOrphanFiles };
