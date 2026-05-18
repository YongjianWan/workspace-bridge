/**
 * Recommendation engine — generates personalized, stack-aware recommendation strings.
 *
 * Extracted to eliminate duplication between audit-summary (buildNextSteps)
 * and audit-overview (buildOverviewSummary). Previously both inlined nearly
 * identical if-else chains for unresolved/cycle/dead-export recommendations.
 */

function buildUnresolvedRecommendation(count, fp, stack) {
  if (count <= 0) return null;
  const fpRatio = fp?.total > 0 ? (fp.count / fp.total) : 0;
  if (fpRatio >= 0.8 && fp?.primaryReason === 'alias-unresolved') {
    const nodeFramework = stack?.node?.framework || null;
    if (nodeFramework === 'vue') {
      return `${count} unresolved imports — ${Math.round(fpRatio * 100)}% are alias/Vue extension omissions (e.g. missing .vue suffix or tsconfig paths not resolved). Check vite.config.js resolve.alias and ensure .vue files are imported with full extension.`;
    }
    return `${count} unresolved imports — ${Math.round(fpRatio * 100)}% are alias false positives. Check tsconfig.json / jsconfig.json compilerOptions.paths configuration.`;
  }
  return `Inspect ${count} unresolved import${count > 1 ? 's' : ''} first; they can indicate broken code paths or unsupported alias resolution.`;
}

function buildCycleRecommendation(count, stack) {
  if (count <= 0) return null;
  const nodeFramework = stack?.node?.framework || null;
  if (nodeFramework === 'vue') {
    return `${count} dependency cycle${count > 1 ? 's' : ''} detected — in Vue projects store→router→view cycles are often intentional design patterns. Review each cycle with 'audit-cycles --json' to distinguish framework-normal from structural debt.`;
  }
  return `Break ${count} dependency cycle${count > 1 ? 's' : ''} before making broad refactors.`;
}

function buildDeadExportRecommendation(count, fp, stack) {
  if (count <= 0) return null;
  const fpRatio = fp?.total > 0 ? (fp.count / fp.total) : 0;
  if (fpRatio >= 0.5) {
    const nodeFramework = stack?.node?.framework || null;
    const profile = stack?.profile || 'unknown';
    const { SCAFFOLD_REASON_PREFIX } = require('./scaffold-detector');
    let reason = fp?.primaryReason || 'unknown';
    if (reason.startsWith(SCAFFOLD_REASON_PREFIX)) {
      reason = 'known scaffolding boilerplate (RuoYi / Vue Admin)';
    } else if (nodeFramework === 'vue') {
      reason = 'Vue global components, directives, or lazy-loaded routes';
    } else if (profile === 'java-first') {
      reason = 'Spring Boot framework entry classes (Application, Configuration, etc.)';
    }
    return `${count} dead exports — about ${Math.round(fpRatio * 100)}% are likely false positives (${reason}). Review with 'audit-file' before deleting.`;
  }
  return `${count} dead export${count > 1 ? 's' : ''} — review as candidates, not automatic deletions. Run the project's test suite after any removal.`;
}

module.exports = {
  buildUnresolvedRecommendation,
  buildCycleRecommendation,
  buildDeadExportRecommendation,
};
