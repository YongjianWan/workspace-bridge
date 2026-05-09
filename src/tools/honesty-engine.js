/**
 * Honesty engine — classifies likely false positives in audit results.
 *
 * Problem: workspace-bridge reports `confidence: high` but users cannot tell
 * how many of the 51 dead exports are real vs alias/framework false positives.
 * This module adds transparent "honesty" metadata so consumers can calibrate
 * trust and nextSteps.
 */
const fs = require('fs');
const path = require('path');
const { detectScaffold, SCAFFOLD_REASON_PREFIX } = require('./scaffold-detector');

// Known alias prefixes that frequently cause unresolved false positives
const ALIAS_PREFIXES = ['@/', '~/', '@/'];

// Framework path patterns that commonly produce implicit dependencies
// (matched against relative or absolute file paths)
const FRAMEWORK_IMPLICIT_PATTERNS = [
  // Vue router pages referenced by lazy-loading
  { pattern: /[\\/]views[\\/]/, reason: 'vue-page-implicit' },
  // Vue global components
  { pattern: /[\\/]components[\\/]/, reason: 'vue-component-implicit' },
  // Next.js App Router pages
  { pattern: /[\\/]app[\\/](page|layout|loading|error|not-found|route)\.(tsx|jsx|ts|js)$/, reason: 'nextjs-app-router' },
];

/**
 * Check whether the workspace has a tsconfig.json or jsconfig.json with
 * compilerOptions.paths configured. If not, alias imports are likely unresolved.
 */
function hasTsconfigPaths(root) {
  const tsconfigPath = path.join(root, 'tsconfig.json');
  const jsconfigPath = path.join(root, 'jsconfig.json');
  const configPath = fs.existsSync(tsconfigPath) ? tsconfigPath : (fs.existsSync(jsconfigPath) ? jsconfigPath : null);
  if (!configPath) return false;
  try {
    const content = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(content);
    const paths = parsed?.compilerOptions?.paths;
    return paths && Object.keys(paths).length > 0;
  } catch {
    return false;
  }
}

/**
 * Check whether an import path looks like an alias.
 */
function isAliasImport(importPath) {
  if (!importPath) return false;
  return ALIAS_PREFIXES.some((prefix) => importPath.startsWith(prefix));
}

/**
 * Check whether a resolved path points to a directory (missing extension).
 */
function isDirectoryPath(resolvedPath) {
  if (!resolvedPath) return false;
  try {
    return fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Classify unresolved imports by likely false-positive reason.
 * @returns {Array<{item: object, reason: string}>}
 */
function classifyUnresolved(unresolvedArray, root) {
  const hasPaths = hasTsconfigPaths(root);
  const classifications = [];

  for (const item of unresolvedArray) {
    const importPath = item.import || '';
    const resolvedTo = item.resolvedTo || '';

    if (isAliasImport(importPath)) {
      if (!hasPaths) {
        classifications.push({ item, reason: 'alias-unresolved' });
        continue;
      }
    }

    if (isDirectoryPath(resolvedTo)) {
      classifications.push({ item, reason: 'missing-extension' });
      continue;
    }

    classifications.push({ item, reason: 'unknown' });
  }

  return classifications;
}

/**
 * Classify dead exports by likely false-positive reason.
 * @returns {Array<{item: object, reason: string}>}
 */
function classifyDeadExports(deadExportsArray, depGraph) {
  const stats = depGraph?.getStats?.() || { files: 0, totalImports: 0 };
  const edgeRatio = stats.files > 0 ? stats.totalImports / stats.files : 0;
  const graphUnreliable = stats.files > 1 && edgeRatio < 0.1;

  const classifications = [];

  for (const item of deadExportsArray) {
    const filePath = item.file || '';
    const importerCount = item.importerCount || 0;
    const confidence = item.confidence || 'medium';

    // Global graph reliability downgrade
    if (graphUnreliable) {
      classifications.push({ item, reason: 'graph-unreliable' });
      continue;
    }

    // Framework implicit dependency patterns
    const implicitMatch = FRAMEWORK_IMPLICIT_PATTERNS.find((r) => r.pattern.test(filePath));
    if (implicitMatch) {
      classifications.push({ item, reason: implicitMatch.reason });
      continue;
    }

    // No importers at all — likely dead, but still uncertain if graph is thin
    if (importerCount === 0) {
      classifications.push({ item, reason: 'likely-dead' });
      continue;
    }

    // P72: Java constants-warehouse pattern (e.g. HttpStatus.java, UserConstants.java)
    const base = path.basename(filePath).toLowerCase();
    if (/\.java$/.test(filePath) && /(constants|status|utils)\.java$/.test(base) && importerCount > 0) {
      classifications.push({ item, reason: 'java-constants-warehouse' });
      continue;
    }

    // P78: Scaffold noise detection (RuoYi, Vue Admin, etc.)
    const scaffold = detectScaffold(filePath);
    if (scaffold) {
      classifications.push({ item, reason: scaffold.reason });
      continue;
    }

    // Has importers but symbols unused — may be barrel exports or dynamic usage
    classifications.push({ item, reason: 'uncertain' });
  }

  return classifications;
}

/**
 * Aggregate classifications into a summary.
 */
function buildClassificationSummary(classifications) {
  const counts = {};
  for (const { reason } of classifications) {
    counts[reason] = (counts[reason] || 0) + 1;
  }
  const total = classifications.length;
  const falsePositiveReasons = new Set([
    'alias-unresolved',
    'missing-extension',
    'graph-unreliable',
    'vue-page-implicit',
    'vue-component-implicit',
    'nextjs-app-router',
    'java-constants-warehouse',
    `${SCAFFOLD_REASON_PREFIX}ruoyi`,
    `${SCAFFOLD_REASON_PREFIX}vue-admin`,
  ]);
  let falsePositiveCount = 0;
  for (const [reason, count] of Object.entries(counts)) {
    if (falsePositiveReasons.has(reason)) {
      falsePositiveCount += count;
    }
  }
  const reasons = Object.entries(counts)
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);

  const primaryReason = reasons[0]?.reason || 'unknown';

  return { total, falsePositiveCount, primaryReason, reasons };
}

/**
 * Build a human-readable disclaimer string.
 */
function buildDisclaimer(label, summary) {
  if (summary.total === 0) return null;
  if (summary.falsePositiveCount === 0) {
    return `${summary.total} ${label} detected; all appear genuine.`;
  }
  const ratio = summary.falsePositiveCount / summary.total;
  if (ratio >= 0.8) {
    return `${summary.falsePositiveCount} of ${summary.total} ${label} are likely false positives (${summary.primaryReason}).`;
  }
  if (ratio >= 0.5) {
    return `About half of ${summary.total} ${label} may be false positives (${summary.primaryReason}).`;
  }
  return `${summary.falsePositiveCount} of ${summary.total} ${label} could be false positives (${summary.primaryReason}).`;
}

/**
 * Attach possibleFalsePositives metadata to a dep-tools result object.
 */
function attachHonesty(result, operation, classifications, root) {
  const summary = buildClassificationSummary(classifications);
  const disclaimer = buildDisclaimer(
    operation === 'unresolved' ? 'unresolved imports' : 'dead exports',
    summary
  );

  return {
    ...result,
    possibleFalsePositives: {
      count: summary.falsePositiveCount,
      total: summary.total,
      primaryReason: summary.primaryReason,
      reasons: summary.reasons,
      disclaimer,
    },
  };
}

module.exports = {
  classifyUnresolved,
  classifyDeadExports,
  buildClassificationSummary,
  buildDisclaimer,
  attachHonesty,
  // Exposed for testing
  hasTsconfigPaths,
  isAliasImport,
};
