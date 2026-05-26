/**
 * query-tools.js — Stage 3.5 fine-grained query CLI
 *
 * Reads from precomputed aggregate snapshots when available;
 * falls back to full audit-overview computation on cache miss.
 */

const { buildProjectOverview } = require('./overview-tools');

const SNAPSHOT_KEY = 'analysis_snapshot';

function findSnapshot(container) {
  try {
    const rows = container.cache?.loadPrecomputedAggregates?.() || [];
    return rows.find((r) => r.key === SNAPSHOT_KEY) || null;
  } catch (_) {
    return null;
  }
}

async function ensureSnapshotData(parsed, container) {
  const snapshot = findSnapshot(container);
  if (snapshot?.data) {
    try {
      const payload = JSON.parse(snapshot.data);
      // Validate freshness: match gitHead and fileCount if available
      const currentHead = container.cache?.getWorkspaceInfo?.()?.gitHead || '';
      const currentFileCount = container.snapshot?.graph?.getAllFilePaths?.().length || 0;
      const headMatch = !currentHead || !snapshot.version || snapshot.version === currentHead;
      const countMatch = !currentFileCount || !snapshot.fileCount || Math.abs(snapshot.fileCount - currentFileCount) <= 5;
      if (headMatch && countMatch && payload.hotspots) {
        return payload;
      }
    } catch (_) {
      // corrupted snapshot — fall through to recompute
    }
  }
  // Cache miss or stale: run full audit-overview and return its raw data
  const result = await buildProjectOverview(parsed, container);
  if (result.ok === false) return null;
  return {
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
  };
}

async function queryHotspots(parsed, container) {
  const data = await ensureSnapshotData(parsed, container);
  if (!data) return { ok: false, error: 'Failed to load overview data' };

  let hotspots = data.hotspots || [];
  const riskFilter = parsed.risk;
  if (riskFilter && ['high', 'medium', 'low'].includes(riskFilter)) {
    hotspots = hotspots.filter((h) => h.risk === riskFilter);
  }
  const limit = Number(parsed.limit) || 0;
  if (limit > 0) hotspots = hotspots.slice(0, limit);

  return {
    ok: true,
    schemaVersion: '1.2.0',
    command: 'query-hotspots',
    count: hotspots.length,
    total: (data.hotspots || []).length,
    hotspots,
  };
}

async function queryKnowledgeRisk(parsed, container) {
  const data = await ensureSnapshotData(parsed, container);
  if (!data) return { ok: false, error: 'Failed to load overview data' };

  const level = parsed.level || 'high';
  const kr = data.knowledgeRisk || {};
  let items = kr[level] || [];
  const limit = Number(parsed.limit) || 0;
  if (limit > 0) items = items.slice(0, limit);

  return {
    ok: true,
    schemaVersion: '1.2.0',
    command: 'query-knowledge-risk',
    count: items.length,
    total: (kr[level] || []).length,
    level,
    files: items,
  };
}

async function queryStability(parsed, container) {
  const data = await ensureSnapshotData(parsed, container);
  if (!data) return { ok: false, error: 'Failed to load overview data' };

  let items = data.stability || [];
  const assessmentFilter = parsed.assessment;
  if (assessmentFilter && ['fragile', 'moderate', 'stable'].includes(assessmentFilter)) {
    items = items.filter((s) => s.assessment === assessmentFilter);
  }
  const limit = Number(parsed.limit) || 0;
  if (limit > 0) items = items.slice(0, limit);

  return {
    ok: true,
    schemaVersion: '1.2.0',
    command: 'query-stability',
    count: items.length,
    total: (data.stability || []).length,
    files: items,
  };
}

module.exports = {
  queryHotspots,
  queryKnowledgeRisk,
  queryStability,
};
