/**
 * query-tools.js — Stage 3.5 fine-grained query CLI
 *
 * Reads from precomputed aggregate snapshots when available;
 * falls back to full audit-overview computation on cache miss.
 */

const { buildProjectOverview } = require('./overview-tools');
const { computeConfigHash } = require('../utils/project-context');
const { SCHEMA_VERSION } = require('../config/constants');

function findSnapshot(container) {
  try {
    // analysis_snapshots is the single source of truth (version-gated in
    // GraphDB.loadAnalysisSnapshot). The old precomputed_aggregates
    // 'analysis_snapshot' fallback row is gone: it carried no cache_version
    // stamp (bypassing the version gate) and was wiped by every graph:built
    // full-replace write anyway.
    const snapshot = container.cache?.loadAnalysisSnapshot?.('overview');
    if (!snapshot) return null;
    return {
      data: JSON.stringify(snapshot.data),
      version: snapshot.version,
      fileCount: snapshot.fileCount,
      configHash: snapshot.configHash,
      computedAt: snapshot.computedAt,
      contentSignature: snapshot.contentSignature || '',
    };
  } catch (_) {
    return null;
  }
}

function isSnapshotFresh(snapshot, container) {
  const currentHead = container.cache?.getWorkspaceInfo?.()?.gitHead || '';
  const currentFileCount =
    container.snapshot?.graph?.getScopeSummary?.()?.counts?.totalFiles ||
    container.snapshot?.graph?.getAllFilePaths?.().length ||
    0;
  const headMatch = !currentHead || !snapshot.version || snapshot.version === currentHead;
  const countMatch = !currentFileCount || !snapshot.fileCount || snapshot.fileCount === currentFileCount;

  const currentConfig = container.projectContext?.config || null;
  const currentConfigHash = computeConfigHash(currentConfig);
  const snapshotConfigHash = snapshot.configHash ?? '';
  // Backward-compat: legacy snapshots without configHash are only fresh when
  // there is no effective config. Once config exists, they must recompute.
  const configMatch = snapshotConfigHash === currentConfigHash;

  // Intentionally skip content-change checks: query-* commands are designed as
  // fast cached-aggregate readers. File-level edits that do not change the
  // commit hash or file count should not trigger a full audit-overview rebuild
  // (audit-overview itself does compare content since L2-15, so the two
  // deliberately disagree about "fresh" while reading the same snapshot row).
  // The cost of that choice is paid by describeReplay(), which tells the
  // consumer the tree moved instead of letting the staleness go unmentioned.
  return headMatch && countMatch && configMatch;
}

/**
 * Provenance of a snapshot-served response. `contentMatch` answers the one
 * question the coarse freshness check refuses to ask: has the tree moved since
 * this snapshot was computed? An unsigned snapshot (pre-L2-15 row, '') is
 * unverifiable, which is not the same as verified-equal — it reports false.
 */
function describeReplay(snapshot, container) {
  const currentSignature = container.cache?.getContentSignature?.() || '';
  return {
    computedAt: snapshot.computedAt,
    gitHead: snapshot.version || null,
    fileCount: snapshot.fileCount,
    contentMatch: Boolean(snapshot.contentSignature) && snapshot.contentSignature === currentSignature,
  };
}

/**
 * Attach provenance to a query response, and warn when the served numbers
 * describe a tree that has already moved. L1-4: query-* is allowed to be
 * stale-by-design, it is not allowed to be quiet about it — an AI agent reads
 * the count and believes it.
 */
function withReplayProvenance(result, loaded) {
  if (!loaded.replayedFrom) return result;
  result.replayedFrom = loaded.replayedFrom;
  if (!loaded.replayedFrom.contentMatch) {
    result.warnings = [
      ...(result.warnings || []),
      {
        type: 'snapshot-content-drift',
        severity: 'medium',
        message:
          `${result.command} replayed a cached overview snapshot whose content signature no longer matches the working tree ` +
          '(files changed in place since it was computed); the numbers describe the earlier tree. ' +
          'Run `audit-overview` to recompute.',
      },
    ];
  }
  return result;
}

/**
 * @returns {{data: object, replayedFrom: object|null}|null} replayedFrom is
 * null when the data was computed in this run.
 */
async function ensureSnapshotData(parsed, container) {
  const snapshot = findSnapshot(container);
  if (snapshot?.data) {
    try {
      const payload = JSON.parse(snapshot.data);
      // Coarse freshness only — see isSnapshotFresh.
      if (isSnapshotFresh(snapshot, container) && payload.hotspots) {
        return { data: payload, replayedFrom: describeReplay(snapshot, container) };
      }
    } catch (_) {
      // corrupted snapshot — fall through to recompute
    }
  }
  // Cache miss or stale: run full audit-overview and return its raw data
  const result = await buildProjectOverview(parsed, container);
  if (result.ok === false) return null;
  return {
    replayedFrom: null,
    data: {
      hotspots: result.hotspots,
      knowledgeRisk: result.knowledgeRisk,
      stability: result.stability,
      languageSupport: result.languageSupport,
      deadExports: result.deadExports,
      unresolved: result.unresolved,
      cycles: result.cycles,
      orphans: result.orphans,
      aggregates: result.aggregates,
      summary: result.summary,
    },
  };
}

async function queryHotspots(parsed, container) {
  const loaded = await ensureSnapshotData(parsed, container);
  if (!loaded) return { ok: false, error: 'Failed to load overview data' };
  const data = loaded.data;

  let hotspots = data.hotspots || [];
  const riskFilter = parsed.risk;
  if (riskFilter && ['high', 'medium', 'low'].includes(riskFilter)) {
    hotspots = hotspots.filter((h) => h.risk === riskFilter);
  }
  const limit = Number(parsed.limit) || 0;
  const maxFiles = Number(parsed.maxFiles) || 0;
  const cap = maxFiles > 0 ? (limit > 0 ? Math.min(limit, maxFiles) : maxFiles) : limit;
  if (cap > 0) hotspots = hotspots.slice(0, cap);

  return withReplayProvenance({
    ok: true,
    schemaVersion: SCHEMA_VERSION,
    command: 'query-hotspots',
    count: hotspots.length,
    total: (data.hotspots || []).length,
    hotspots,
  }, loaded);
}

async function queryKnowledgeRisk(parsed, container) {
  // query-knowledge-risk explicitly requests blame-based data; ensure the
  // snapshot is computed with history enabled when it falls back to a full build.
  const loaded = await ensureSnapshotData({ ...parsed, withHistory: true }, container);
  if (!loaded) return { ok: false, error: 'Failed to load overview data' };
  const data = loaded.data;

  const level = parsed.level || 'high';
  const kr = data.knowledgeRisk || {};
  let items = kr[level] || [];
  const limit = Number(parsed.limit) || 0;
  const maxFiles = Number(parsed.maxFiles) || 0;
  const cap = maxFiles > 0 ? (limit > 0 ? Math.min(limit, maxFiles) : maxFiles) : limit;
  if (cap > 0) items = items.slice(0, cap);

  return withReplayProvenance({
    ok: true,
    schemaVersion: SCHEMA_VERSION,
    command: 'query-knowledge-risk',
    count: items.length,
    total: (kr[level] || []).length,
    level,
    files: items,
  }, loaded);
}

async function queryStability(parsed, container) {
  const loaded = await ensureSnapshotData(parsed, container);
  if (!loaded) return { ok: false, error: 'Failed to load overview data' };
  const data = loaded.data;

  let items = data.stability || [];
  const assessmentFilter = parsed.assessment;
  if (assessmentFilter && ['fragile', 'moderate', 'stable'].includes(assessmentFilter)) {
    items = items.filter((s) => s.assessment === assessmentFilter);
  }
  const limit = Number(parsed.limit) || 0;
  const maxFiles = Number(parsed.maxFiles) || 0;
  const cap = maxFiles > 0 ? (limit > 0 ? Math.min(limit, maxFiles) : maxFiles) : limit;
  if (cap > 0) items = items.slice(0, cap);

  return withReplayProvenance({
    ok: true,
    schemaVersion: SCHEMA_VERSION,
    command: 'query-stability',
    count: items.length,
    total: (data.stability || []).length,
    files: items,
  }, loaded);
}

module.exports = {
  queryHotspots,
  queryKnowledgeRisk,
  queryStability,
  isSnapshotFresh,
};
