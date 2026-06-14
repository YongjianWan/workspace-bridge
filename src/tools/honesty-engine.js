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
const { detectScaffold, SCAFFOLD_REASON_PREFIX } = require('../utils/scaffold-detector');

// Known alias prefixes that frequently cause unresolved false positives
const ALIAS_PREFIXES = ['@/', '~/', '@/'];

// P99: Third-party library files copied into src/ (global variable usage, no static imports)
const VENDOR_COPY_BASENAMES = new Set([
  'jsencrypt.js', 'md5.js', 'crypto-js.js', 'sha256.js', 'aes.js',
  'base64.js', 'uuid.js', 'jwt.js', 'qrcode.js', 'barcode.js',
  'exceljs.js', 'filesaver.js', 'html2canvas.js', 'jspdf.js',
]);

// Framework path patterns that commonly produce implicit dependencies
// (matched against relative or absolute file paths)
const FRAMEWORK_IMPLICIT_PATTERNS = [
  // Vue router pages referenced by lazy-loading
  { pattern: /[\\/]views[\\/][^\\/]+\.(js|ts|jsx|tsx|vue)$/, reason: 'vue-page-implicit' },
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
  try {
    const { _readTsconfigPaths } = require('../services/dep-graph/resolvers/base');
    const config = _readTsconfigPaths(root);
    return !!(config && config.paths && Object.keys(config.paths).length > 0);
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

    // P86: sink false-positive reason to individual dead-export record so users
    // can locate which items are flagged as false positives.
    // Preserve analyzer-level registry false-positive marks (e.g. SHADOW_EXTS).
    if (DEAD_EXPORT_FALSE_POSITIVE_REASONS.has(item.falsePositiveReason)) {
      classifications.push({ item, reason: item.falsePositiveReason });
      continue;
    }
    let reason = null;

    // Global graph reliability downgrade
    if (graphUnreliable) {
      reason = 'graph-unreliable';
    } else {
      // Framework implicit dependency patterns
      const implicitMatch = FRAMEWORK_IMPLICIT_PATTERNS.find((r) => r.pattern.test(filePath));
      if (implicitMatch) {
        reason = implicitMatch.reason;
      } else if (VENDOR_COPY_BASENAMES.has(path.basename(filePath).toLowerCase())) {
        reason = 'vendor-copy';
      } else if (importerCount === 0) {
        // No importers at all — likely dead, but still uncertain if graph is thin
        reason = 'likely-dead';
      } else {
        // P72: Java constants-warehouse pattern (e.g. HttpStatus.java, UserConstants.java)
        const base = path.basename(filePath).toLowerCase();
        if (/\.java$/.test(filePath) && /(constants|status|utils)\.java$/.test(base)) {
          reason = 'java-constants-warehouse';
        } else {
          // P78: Scaffold noise detection (RuoYi, Vue Admin, etc.)
          const scaffold = detectScaffold(filePath);
          if (scaffold) {
            reason = scaffold.reason;
          } else {
            // Has importers but symbols unused — may be barrel exports or dynamic usage
            reason = 'uncertain';
          }
        }
      }
    }

    item.falsePositiveReason = reason;
    classifications.push({ item, reason });
  }

  return classifications;
}

// Reasons that mark a dead-export finding as a known false positive.
// These findings are still surfaced for transparency but do not drive
// repository-level severity or deletion recommendations.
const DEAD_EXPORT_FALSE_POSITIVE_REASONS = new Set([
  'dynamic-registry-export',
  'java-constants-warehouse',
  'vendor-copy',
  `${SCAFFOLD_REASON_PREFIX}ruoyi`,
  `${SCAFFOLD_REASON_PREFIX}vue-admin`,
]);

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
    ...DEAD_EXPORT_FALSE_POSITIVE_REASONS,
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
  DEAD_EXPORT_FALSE_POSITIVE_REASONS,
  // Exposed for testing
  hasTsconfigPaths,
  isAliasImport,
};
