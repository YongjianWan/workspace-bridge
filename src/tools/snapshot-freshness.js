/**
 * snapshot-freshness.js — analysis_snapshots 'overview' 行的 freshness 判据
 *
 * L3-11：这一行有两个读者（audit-overview / query-*），曾经各写一份
 * isSnapshotFresh，字段各自演进、无测试会红。收敛为单一判据函数，
 * 共享全部字段比较，由调用方选严格度：
 *
 *   strict: true   —— audit-overview。args 带预计算数据、或 withHistory
 *                     而快照无 history、或内容签名漂移，一律重算。
 *   strict: false  —— query-*。刻意粗粒度：原地编辑不触发 audit-overview
 *                     重建（这是 query-* 的速度承诺），漂移由 describeReplay
 *                     的 contentMatch + warnings[] 向消费方显式报告。
 *
 * 新增判据时只改这一处，并决定它属不属于粗粒度那份（TECH_DEBT L3-11
 * 触发条件）。
 */

const { computeConfigHash } = require('../utils/project-context');

/**
 * @param {object} snapshot  loadAnalysisSnapshot 的行（overview 侧 data 为
 *   对象；query 侧 findSnapshot 归一化过，本函数只读 version/fileCount/
 *   configHash/data，两种形态都兼容）
 * @param {object} container
 * @param {{ strict?: boolean, args?: object }} [options]
 */
function isSnapshotFresh(snapshot, container, options = {}) {
  const { strict = false, args = null } = options;

  if (strict && (args?.hotspotData || args?.stabilityTrendData || args?.overviewDashboard)) {
    return false;
  }

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

  if (!strict) {
    // Coarse on purpose — see file header. query-* trades strictness for speed
    // and pays for it in describeReplay(), which reports the drift instead of
    // letting the staleness go unmentioned.
    return headMatch && countMatch && configMatch;
  }

  const snapshotData = snapshot.data;
  const historyMatch = !args?.withHistory || (snapshotData?.knowledgeRisk && !snapshotData.knowledgeRisk.disabled);

  // L2-15: content changes are the whole point. Git head, file count and config
  // all stay identical when a file is edited in place — precisely when a
  // replayed answer lies. The stored signature covers path+mtime+size of every
  // indexed file, so an edit invalidates the snapshot even though the three
  // coarse keys above still match. This is what lets reports AND gates share
  // one snapshot with no special case for either.
  //
  // A snapshot written before this column existed carries '' and is treated as
  // unverifiable: recomputing is always safe, serving unvalidated data is not.
  // Unconditional on purpose: cache is post-ensureReady and the method is a
  // class method — `?.` here would read a wiring break as "unsigned" and pay a
  // cold rebuild to hide it (L3-8: 结构性不该发生的让它炸).
  const currentSignature = container.cache.getContentSignature() || '';
  const contentMatch = Boolean(snapshot.contentSignature) && snapshot.contentSignature === currentSignature;

  return headMatch && countMatch && configMatch && historyMatch && contentMatch;
}

module.exports = { isSnapshotFresh };
